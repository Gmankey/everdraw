import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'indexer.sqlite');
const SCHEMA_PATH = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');

export function openDatabase(dbPath = process.env.INDEXER_DB_PATH ?? process.env.DB_PATH ?? DEFAULT_DB_PATH): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function applySchema(db: Database.Database, schemaPath = SCHEMA_PATH): void {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
  const cols = db.prepare("SELECT COUNT(*) as c FROM pragma_table_info('wallet_rounds') WHERE name='pool_address'").get() as { c: number };
  if (cols.c === 0) {
    db.exec('DROP TABLE IF EXISTS wallet_rounds');
    db.exec('DROP TABLE IF EXISTS rounds');
    db.exec(schemaSql);
    console.log('[db] migrated to multi-pool schema - derived tables will rebuild on next sync');
  }
  ensureRoundsColumns(db);
  ensureWalletRoundsColumns(db);
  ensureWalletPointsColumns(db);
  ensureV5TrancheTables(db);
}

function ensureRoundsColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(rounds)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('pool_address')) {
    return;
  }

  if (!names.has('winner')) {
    db.exec('ALTER TABLE rounds ADD COLUMN winner TEXT');
  }

  if (!names.has('winning_ticket')) {
    db.exec('ALTER TABLE rounds ADD COLUMN winning_ticket INTEGER');
  }
}

function ensureWalletRoundsColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(wallet_rounds)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('pool_address')) {
    return;
  }

  if (!names.has('prize_claimed')) {
    db.exec("ALTER TABLE wallet_rounds ADD COLUMN prize_claimed TEXT NOT NULL DEFAULT '0'");
  }

  if (!names.has('principal_withdrawn')) {
    db.exec("ALTER TABLE wallet_rounds ADD COLUMN principal_withdrawn TEXT NOT NULL DEFAULT '0'");
  }

  if (!names.has('withdrawn_at')) {
    db.exec('ALTER TABLE wallet_rounds ADD COLUMN withdrawn_at TEXT');
  }

  if (!names.has('v5_resolved_base')) {
    db.exec('ALTER TABLE wallet_rounds ADD COLUMN v5_resolved_base REAL');
  }
}

function ensureWalletPointsColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(wallet_points)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (columns.length === 0) return;

  if (!names.has('has_received_comeback_king_bonus')) {
    db.exec('ALTER TABLE wallet_points ADD COLUMN has_received_comeback_king_bonus INTEGER NOT NULL DEFAULT 0');
  }

  if (!names.has('has_received_prize_patron_bonus')) {
    db.exec('ALTER TABLE wallet_points ADD COLUMN has_received_prize_patron_bonus INTEGER NOT NULL DEFAULT 0');
  }

  if (!names.has('highest_loss_streak_bonus_awarded')) {
    db.exec('ALTER TABLE wallet_points ADD COLUMN highest_loss_streak_bonus_awarded INTEGER NOT NULL DEFAULT 0');
  }

  const streakColumns = db.prepare("PRAGMA table_info(wallet_streaks)").all() as Array<{ name: string }>;
  const streakNames = new Set(streakColumns.map((column) => column.name));
  if (streakColumns.length > 0 && !streakNames.has('consecutive_missed_draws')) {
    db.exec('ALTER TABLE wallet_streaks ADD COLUMN consecutive_missed_draws INTEGER NOT NULL DEFAULT 0');
  }
}

function ensureV5TrancheTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS v5_position_events (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      block_timestamp TEXT NOT NULL,
      vault_address TEXT NOT NULL,
      wallet TEXT NOT NULL,
      pool_type TEXT NOT NULL CHECK (pool_type IN ('vault', 'degen')),
      action TEXT NOT NULL CHECK (action IN ('deposit', 'withdraw')),
      amount TEXT NOT NULL,
      balance_after TEXT,
      raw_event_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'prize_compound')),
      PRIMARY KEY (tx_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_v5_position_events_wallet ON v5_position_events(wallet);
    CREATE INDEX IF NOT EXISTS idx_v5_position_events_vault_pool ON v5_position_events(vault_address, pool_type);
    CREATE INDEX IF NOT EXISTS idx_v5_position_events_order ON v5_position_events(block_number, log_index);

    CREATE TABLE IF NOT EXISTS v5_tranches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      vault_address TEXT NOT NULL,
      pool_type TEXT NOT NULL CHECK (pool_type IN ('vault', 'degen')),
      amount TEXT NOT NULL,
      remaining_amount TEXT NOT NULL,
      opened_block_number INTEGER NOT NULL,
      opened_log_index INTEGER NOT NULL,
      opened_at TEXT NOT NULL,
      opened_tx_hash TEXT NOT NULL,
      start_draw_id INTEGER,
      closed_at TEXT,
      closed_block_number INTEGER,
      closed_log_index INTEGER,
      closed_tx_hash TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_v5_tranches_opening_event ON v5_tranches(opened_tx_hash, opened_log_index);
    CREATE INDEX IF NOT EXISTS idx_v5_tranches_wallet_pool ON v5_tranches(wallet, vault_address, pool_type);
    CREATE INDEX IF NOT EXISTS idx_v5_tranches_open ON v5_tranches(wallet, vault_address, pool_type, remaining_amount);
  `);

  const positionEventColumns = db.prepare("PRAGMA table_info(v5_position_events)").all() as Array<{ name: string }>;
  const positionEventNames = new Set(positionEventColumns.map((column) => column.name));
  if (positionEventColumns.length > 0 && !positionEventNames.has('source')) {
    db.exec("ALTER TABLE v5_position_events ADD COLUMN source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'prize_compound'))");
  }
}
