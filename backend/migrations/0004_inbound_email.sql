PRAGMA foreign_keys = ON;

CREATE TABLE inbound_messages (
  id TEXT PRIMARY KEY,
  r2_raw_mime_key TEXT NOT NULL UNIQUE,
  message_id TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  envelope_from TEXT NOT NULL,
  envelope_to TEXT NOT NULL,
  header_from TEXT,
  return_path TEXT,
  raw_subject TEXT NOT NULL,
  in_reply_to TEXT,
  references_header TEXT,
  authentication_results TEXT,
  raw_size_bytes INTEGER NOT NULL CHECK (raw_size_bytes >= 0),
  received_at TEXT NOT NULL,
  queued_at TEXT,
  rfq_id TEXT REFERENCES rfqs(id) ON DELETE SET NULL,
  detected_issuer TEXT CHECK (detected_issuer IS NULL OR detected_issuer IN
    ('BNP', 'MS', 'JPM', 'BARCLAYS', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN
    ('RECEIVED', 'QUEUED', 'PARSING', 'PARSED', 'DUPLICATE', 'PARSE_ERROR',
     'SENDER_MISMATCH', 'UNMATCHED_RFQ', 'MANUAL_REVIEW', 'LATE_REPLY')),
  parser_version TEXT,
  parse_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (parse_attempt_count >= 0),
  last_error_code TEXT
);

CREATE TABLE email_parse_jobs (
  id TEXT PRIMARY KEY,
  inbound_message_id TEXT NOT NULL UNIQUE REFERENCES inbound_messages(id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX idx_inbound_messages_message_id
  ON inbound_messages(message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX idx_inbound_messages_rfq_received
  ON inbound_messages(rfq_id, received_at);
CREATE INDEX idx_inbound_messages_status_received
  ON inbound_messages(status, received_at);
CREATE INDEX idx_email_parse_jobs_status_available
  ON email_parse_jobs(status, available_at);
