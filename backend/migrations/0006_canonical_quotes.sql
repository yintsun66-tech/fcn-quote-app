PRAGMA foreign_keys = ON;

ALTER TABLE inbound_messages ADD COLUMN normalized_at TEXT;
ALTER TABLE inbound_messages ADD COLUMN normalized_quote_count INTEGER NOT NULL DEFAULT 0
  CHECK (normalized_quote_count >= 0);

CREATE TABLE quote_normalize_jobs (
  id TEXT PRIMARY KEY,
  inbound_message_id TEXT NOT NULL UNIQUE REFERENCES inbound_messages(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL CHECK (issuer IN
    ('BNP', 'MS', 'JPM', 'BARCLAYS', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  lease_expires_at TEXT,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE issuer_quotes (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  trade_id TEXT REFERENCES rfq_trades(id) ON DELETE SET NULL,
  outbound_batch_id TEXT REFERENCES outbound_email_batches(id) ON DELETE SET NULL,
  inbound_message_id TEXT NOT NULL REFERENCES inbound_messages(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL CHECK (issuer IN
    ('BNP', 'MS', 'JPM', 'BARCLAYS', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  issuer_display_name TEXT NOT NULL,
  product TEXT,
  currency TEXT,
  trade_date TEXT,
  effective_date_offset_calendar_days INTEGER,
  tenor_months INTEGER,
  guaranteed_periods_months INTEGER,
  underlyings_json TEXT NOT NULL DEFAULT '[]',
  strike_pct REAL,
  ko_type TEXT,
  ko_barrier_pct REAL,
  coupon_pa_pct REAL,
  raw_price_value REAL,
  raw_price_label TEXT,
  price_semantics TEXT CHECK (price_semantics IS NULL OR price_semantics IN
    ('NOTE_PRICE', 'COST', 'OFFER_PRICE', 'UPFRONT')),
  comparable_price_pct REAL,
  barrier_type TEXT,
  ki_barrier_pct REAL,
  observation_frequency_months INTEGER,
  otc TEXT,
  quote_reference TEXT,
  issuer_comment TEXT,
  rejection_reason TEXT,
  received_at TEXT NOT NULL,
  parser_profile TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  source_table_index INTEGER NOT NULL CHECK (source_table_index >= 0),
  source_row_index INTEGER NOT NULL CHECK (source_row_index >= 0),
  raw_values_json TEXT NOT NULL,
  normalization_warnings_json TEXT NOT NULL DEFAULT '[]',
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN
    ('VALID', 'NO_QUOTE', 'INVALID_VALUE', 'PARSE_ERROR', 'ISSUER_REJECTED',
     'TIMEOUT', 'LATE_REPLY', 'SENDER_MISMATCH', 'UNMATCHED_RFQ',
     'AMBIGUOUS_TRADE_MATCH', 'DUPLICATE', 'PRODUCT_MISMATCH',
     'UNIT_UNCONFIRMED', 'MANUAL_REVIEW')),
  created_at TEXT NOT NULL,
  UNIQUE (inbound_message_id, parser_profile, source_table_index, source_row_index)
);

CREATE TABLE quote_parse_errors (
  id TEXT PRIMARY KEY,
  inbound_message_id TEXT NOT NULL REFERENCES inbound_messages(id) ON DELETE CASCADE,
  issuer TEXT,
  parser_version TEXT NOT NULL,
  error_code TEXT NOT NULL,
  safe_error_detail TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE issuer_parser_versions (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  product TEXT NOT NULL,
  version TEXT NOT NULL,
  unit_profile_json TEXT NOT NULL,
  enabled_at TEXT NOT NULL,
  disabled_at TEXT,
  change_summary TEXT NOT NULL,
  UNIQUE (issuer, product, version)
);

CREATE INDEX idx_quote_normalize_jobs_status_available
  ON quote_normalize_jobs(status, available_at);
CREATE INDEX idx_issuer_quotes_rfq_trade_issuer
  ON issuer_quotes(rfq_id, trade_id, issuer);
CREATE INDEX idx_issuer_quotes_status_received
  ON issuer_quotes(status, received_at);
CREATE INDEX idx_quote_parse_errors_inbound
  ON quote_parse_errors(inbound_message_id, created_at);
