PRAGMA defer_foreign_keys = ON;

CREATE TABLE follow_board_products_new (
  id TEXT PRIMARY KEY,
  product_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PUBLISHED', 'ARCHIVED')),
  source_rfq_id TEXT REFERENCES rfqs(id) ON DELETE RESTRICT,
  source_outbound_batch_id TEXT REFERENCES outbound_email_batches(id) ON DELETE RESTRICT,
  source_inbound_message_id TEXT NOT NULL REFERENCES inbound_messages(id) ON DELETE RESTRICT,
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

INSERT INTO follow_board_products_new
  (id, product_code, status, source_rfq_id, source_outbound_batch_id,
   source_inbound_message_id, source_reference_hash, parser_profile,
   source_table_index, source_row_index, batch_code, deal_sequence,
   subject_date_mmdd, issuer, trade_date, estimated_yield_pct,
   public_snapshot_json, published_by_email, published_at, archived_at,
   archived_by_user_id, created_at, updated_at)
SELECT
  id, product_code, status, source_rfq_id, source_outbound_batch_id,
  source_inbound_message_id, source_reference_hash, parser_profile,
  source_table_index, source_row_index, batch_code, deal_sequence,
  subject_date_mmdd, issuer, trade_date, estimated_yield_pct,
  public_snapshot_json, published_by_email, published_at, archived_at,
  archived_by_user_id, created_at, updated_at
FROM follow_board_products;

CREATE TABLE follow_board_publication_commands_new (
  id TEXT PRIMARY KEY,
  inbound_message_id TEXT NOT NULL UNIQUE REFERENCES inbound_messages(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES follow_board_products_new(id) ON DELETE SET NULL,
  sender_email TEXT,
  product_code TEXT NOT NULL COLLATE NOCASE,
  batch_code TEXT NOT NULL CHECK (batch_code IN ('BMJB', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  deal_sequence INTEGER NOT NULL CHECK (deal_sequence BETWEEN 1 AND 20),
  deal_sequence_end INTEGER NOT NULL CHECK (
    deal_sequence_end BETWEEN 1 AND 20 AND deal_sequence_end >= deal_sequence
  ),
  product_codes_json TEXT NOT NULL,
  subject_date_mmdd TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PUBLISHED', 'MANUAL_REVIEW', 'REJECTED')),
  error_code TEXT,
  processed_at TEXT NOT NULL
);

INSERT INTO follow_board_publication_commands_new
  (id, inbound_message_id, product_id, sender_email, product_code, batch_code,
   deal_sequence, deal_sequence_end, product_codes_json, subject_date_mmdd,
   status, error_code, processed_at)
SELECT
  id, inbound_message_id, product_id, sender_email, product_code, batch_code,
  deal_sequence, deal_sequence, '["' || product_code || '"]', subject_date_mmdd,
  status, error_code, processed_at
FROM follow_board_publication_commands;

CREATE TABLE follow_board_interests_new (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES follow_board_products_new(id) ON DELETE RESTRICT,
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

INSERT INTO follow_board_interests_new
  (id, product_id, branch_code, branch_name, employee_number_ciphertext,
   employee_number_iv, employee_number_lookup_hash, employee_number_mask,
   amount_value, currency, submission_date, source_site, created_at, updated_at)
SELECT
  id, product_id, branch_code, branch_name, employee_number_ciphertext,
  employee_number_iv, employee_number_lookup_hash, employee_number_mask,
  amount_value, currency, submission_date, source_site, created_at, updated_at
FROM follow_board_interests;

DROP TABLE follow_board_publication_commands;
DROP TABLE follow_board_interests;
DROP TABLE follow_board_products;

ALTER TABLE follow_board_products_new RENAME TO follow_board_products;
ALTER TABLE follow_board_publication_commands_new RENAME TO follow_board_publication_commands;
ALTER TABLE follow_board_interests_new RENAME TO follow_board_interests;

CREATE TABLE follow_board_publication_items (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES follow_board_publication_commands(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL UNIQUE REFERENCES follow_board_products(id) ON DELETE RESTRICT,
  item_ordinal INTEGER NOT NULL CHECK (item_ordinal BETWEEN 1 AND 20),
  product_code TEXT NOT NULL COLLATE NOCASE,
  source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (command_id, item_ordinal),
  UNIQUE (command_id, product_code)
);

INSERT INTO follow_board_publication_items
  (id, command_id, product_id, item_ordinal, product_code, source_row_index, created_at)
SELECT
  'fbpi_legacy_' || c.id,
  c.id,
  c.product_id,
  1,
  c.product_code,
  p.source_row_index,
  c.processed_at
FROM follow_board_publication_commands c
JOIN follow_board_products p ON p.id = c.product_id
WHERE c.product_id IS NOT NULL;

CREATE INDEX idx_follow_board_products_status_published
  ON follow_board_products(status, published_at DESC);
CREATE INDEX idx_follow_board_products_source_message
  ON follow_board_products(source_inbound_message_id, product_code);
CREATE INDEX idx_follow_board_interests_date_product
  ON follow_board_interests(submission_date, product_id, created_at);
CREATE INDEX idx_follow_board_interests_product_updated
  ON follow_board_interests(product_id, updated_at);
CREATE INDEX idx_follow_board_publication_items_command
  ON follow_board_publication_items(command_id, item_ordinal);
