CREATE TABLE IF NOT EXISTS raw_events (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  block_timestamp TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  round_id INTEGER,
  wallet TEXT,
  amount_mon TEXT,
  payload TEXT NOT NULL,
  finalized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_raw_events_block_number ON raw_events(block_number);
CREATE INDEX IF NOT EXISTS idx_raw_events_event_name ON raw_events(event_name);
CREATE INDEX IF NOT EXISTS idx_raw_events_round_id ON raw_events(round_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_wallet ON raw_events(wallet);

CREATE TABLE IF NOT EXISTS rounds (
  round_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (
    state IN ('open', 'committed', 'drawn', 'unstaking', 'settled', 'skipped')
  ),
  is_skipped INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  sales_end_time TEXT,
  committed_at TEXT,
  drawn_at TEXT,
  unstaking_at TEXT,
  settled_at TEXT,
  deposit_total_mon TEXT NOT NULL DEFAULT '0',
  mon_received TEXT NOT NULL DEFAULT '0',
  yield_mon TEXT NOT NULL DEFAULT '0',
  loss_ratio TEXT NOT NULL DEFAULT '0',
  ticket_count INTEGER NOT NULL DEFAULT 0,
  unique_wallet_count INTEGER NOT NULL DEFAULT 0,
  winner_wallets_count INTEGER NOT NULL DEFAULT 0,
  winner TEXT,
  winning_ticket INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (round_id, pool_address)
);

CREATE TABLE IF NOT EXISTS wallet_rounds (
  wallet TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  pool_address TEXT NOT NULL DEFAULT '',
  tickets INTEGER NOT NULL DEFAULT 0,
  mon_paid TEXT NOT NULL DEFAULT '0',
  won INTEGER NOT NULL DEFAULT 0,
  withdrew INTEGER NOT NULL DEFAULT 0,
  prize_claimed TEXT NOT NULL DEFAULT '0',
  principal_withdrawn TEXT NOT NULL DEFAULT '0',
  withdrawn_at TEXT,
  net_position TEXT NOT NULL DEFAULT '0',
  v5_resolved_base REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (wallet, round_id, pool_address)
);

CREATE INDEX IF NOT EXISTS idx_wallet_rounds_round_id ON wallet_rounds(round_id);
CREATE INDEX IF NOT EXISTS idx_wallet_rounds_wallet ON wallet_rounds(wallet);

CREATE TABLE IF NOT EXISTS wallet_stats (
  wallet TEXT PRIMARY KEY,
  total_rounds INTEGER NOT NULL DEFAULT 0,
  total_tickets INTEGER NOT NULL DEFAULT 0,
  total_mon_paid TEXT NOT NULL DEFAULT '0',
  rounds_won INTEGER NOT NULL DEFAULT 0,
  rounds_withdrew INTEGER NOT NULL DEFAULT 0,
  net_position TEXT NOT NULL DEFAULT '0',
  first_round_id INTEGER,
  last_round_id INTEGER,
  last_active_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  wallet TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  statement TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires_at ON auth_nonces(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_wallet ON auth_sessions(wallet);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_points (
  wallet TEXT PRIMARY KEY,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  has_received_first_deposit_bonus INTEGER NOT NULL DEFAULT 0,
  has_received_first_win_bonus INTEGER NOT NULL DEFAULT 0,
  has_received_comeback_king_bonus INTEGER NOT NULL DEFAULT 0,
  has_received_prize_patron_bonus INTEGER NOT NULL DEFAULT 0,
  highest_loss_streak_bonus_awarded INTEGER NOT NULL DEFAULT 0,
  highest_streak_milestone_awarded INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_streaks (
  wallet TEXT PRIMARY KEY,
  current_streak_weeks INTEGER NOT NULL DEFAULT 0,
  longest_streak_weeks INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_unix INTEGER,
  consecutive_non_wins INTEGER NOT NULL DEFAULT 0,
  consecutive_missed_draws INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_round_points (
  wallet TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  base_points INTEGER NOT NULL,
  multiplier_x100 INTEGER NOT NULL,
  bonuses_breakdown TEXT NOT NULL,
  total_points INTEGER NOT NULL,
  awarded_at_unix INTEGER NOT NULL,
  PRIMARY KEY (wallet, pool_address, round_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_round_points_wallet ON wallet_round_points(wallet);
CREATE INDEX IF NOT EXISTS idx_wallet_points_lifetime ON wallet_points(lifetime_points DESC);

CREATE TABLE IF NOT EXISTS v5_position_events (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  block_timestamp TEXT NOT NULL,
  vault_address TEXT NOT NULL,
  wallet TEXT NOT NULL,
  pool_type TEXT NOT NULL CHECK (pool_type IN ('vault', 'degen')),
  action TEXT NOT NULL CHECK (action IN ('deposit', 'withdraw', 'transfer_in', 'transfer_out')),
  amount TEXT NOT NULL,
  balance_after TEXT,
  raw_event_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'prize_compound', 'transfer')),
  PRIMARY KEY (tx_hash, log_index, wallet)
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
