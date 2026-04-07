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
  round_id INTEGER PRIMARY KEY,
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
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_rounds (
  wallet TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  tickets INTEGER NOT NULL DEFAULT 0,
  mon_paid TEXT NOT NULL DEFAULT '0',
  won INTEGER NOT NULL DEFAULT 0,
  withdrew INTEGER NOT NULL DEFAULT 0,
  prize_claimed TEXT NOT NULL DEFAULT '0',
  principal_withdrawn TEXT NOT NULL DEFAULT '0',
  net_position TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (wallet, round_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_rounds_round_id ON wallet_rounds(round_id);

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
