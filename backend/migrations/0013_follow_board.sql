PRAGMA foreign_keys = ON;

CREATE TABLE follow_board_products (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PUBLISHED', 'ARCHIVED')),
  source_rfq_id TEXT REFERENCES rfqs(id) ON DELETE RESTRICT,
  source_outbound_batch_id TEXT REFERENCES outbound_email_batches(id) ON DELETE RESTRICT,
  source_inbound_message_id TEXT NOT NULL UNIQUE REFERENCES inbound_messages(id) ON DELETE RESTRICT,
  source_reference_hash TEXT NOT NULL,
  parser_profile TEXT NOT NULL,
  source_table_index INTEGER NOT NULL CHECK (source_table_index >= 0),
  source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
  batch_code TEXT NOT NULL CHECK (batch_code IN ('BMJB', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  deal_sequence INTEGER NOT NULL CHECK (deal_sequence BETWEEN 1 AND 20),
  subject_date_mmdd TEXT NOT NULL,
  issuer TEXT NOT NULL CHECK (issuer IN
    ('BNP', 'MS', 'JPM', 'BARCLAYS', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  trade_date TEXT NOT NULL,
  estimated_yield_pct REAL NOT NULL,
  public_snapshot_json TEXT NOT NULL,
  published_by_email TEXT NOT NULL,
  published_at TEXT NOT NULL,
  archived_at TEXT,
  archived_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE follow_board_publication_commands (
  id TEXT PRIMARY KEY,
  inbound_message_id TEXT NOT NULL UNIQUE REFERENCES inbound_messages(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES follow_board_products(id) ON DELETE SET NULL,
  sender_email TEXT,
  product_code TEXT NOT NULL COLLATE NOCASE,
  batch_code TEXT NOT NULL CHECK (batch_code IN ('BMJB', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  deal_sequence INTEGER NOT NULL CHECK (deal_sequence BETWEEN 1 AND 20),
  subject_date_mmdd TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PUBLISHED', 'MANUAL_REVIEW', 'REJECTED')),
  error_code TEXT,
  processed_at TEXT NOT NULL
);

CREATE TABLE follow_board_interests (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES follow_board_products(id) ON DELETE RESTRICT,
  branch_code TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  employee_number_ciphertext TEXT NOT NULL,
  employee_number_iv TEXT NOT NULL,
  employee_number_lookup_hash TEXT NOT NULL,
  employee_number_mask TEXT NOT NULL,
  amount_value INTEGER NOT NULL CHECK (amount_value > 0),
  currency TEXT NOT NULL,
  submission_date TEXT NOT NULL,
  source_site TEXT NOT NULL CHECK (source_site IN ('APP', 'STATIC')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, employee_number_lookup_hash)
);

CREATE TABLE follow_board_idempotency_keys (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE follow_board_request_attempts (
  id TEXT PRIMARY KEY,
  attempt_key_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PIN', 'INTEREST')),
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_follow_board_products_status_published
  ON follow_board_products(status, published_at DESC);
CREATE INDEX idx_follow_board_interests_date_product
  ON follow_board_interests(submission_date, product_id, created_at);
CREATE INDEX idx_follow_board_interests_product_updated
  ON follow_board_interests(product_id, updated_at);
CREATE INDEX idx_follow_board_idempotency_expires
  ON follow_board_idempotency_keys(expires_at);
CREATE INDEX idx_follow_board_attempts_key_time
  ON follow_board_request_attempts(attempt_key_hash, kind, occurred_at);
