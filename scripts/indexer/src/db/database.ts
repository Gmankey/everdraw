import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'indexer.sqlite');
const SCHEMA_PATH = path.resolve(process.cwd(), 'src', 'db', 'schema.sql');

export function openDatabase(dbPath = process.env.INDEXER_DB_PATH ?? DEFAULT_DB_PATH): Database.Database {
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
}
