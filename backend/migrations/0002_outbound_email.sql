PRAGMA foreign_keys = ON;

ALTER TABLE rfqs ADD COLUMN dispatch_status TEXT NOT NULL DEFAULT 'NOT_SENT'
  CHECK (dispatch_status IN ('NOT_SENT', 'QUEUED', 'SENDING', 'WAITING', 'FAILED'));
ALTER TABLE rfqs ADD COLUMN correlation_token_hash TEXT;
ALTER TABLE rfqs ADD COLUMN outbound_queued_at TEXT;
ALTER TABLE rfqs ADD COLUMN sent_at TEXT;
ALTER TABLE rfqs ADD COLUMN deadline_at TEXT;
ALTER TABLE rfqs ADD COLUMN expected_issuer_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_issuer_count >= 0);
ALTER TABLE rfqs ADD COLUMN outbound_batch_count INTEGER NOT NULL DEFAULT 0 CHECK (outbound_batch_count >= 0);

CREATE TABLE rfq_expected_issuers (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL CHECK (issuer IN ('BNP', 'MS', 'JPM', 'BARCLAYS', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  outbound_batch_code TEXT NOT NULL CHECK (outbound_batch_code IN ('BMJB', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VALID_REPLY', 'NO_QUOTE', 'ISSUER_REJECTED', 'PARSE_ERROR', 'TIMEOUT')),
  snapshot_at TEXT NOT NULL,
  terminal_at TEXT,
  terminal_reason TEXT,
  UNIQUE (rfq_id, issuer)
);

CREATE TABLE outbound_email_batches (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  batch_code TEXT NOT NULL CHECK (batch_code IN ('BMJB', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA')),
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  base_subject TEXT NOT NULL,
  correlation_token_hash TEXT NOT NULL,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  queued_at TEXT NOT NULL,
  lease_expires_at TEXT,
  sent_at TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  UNIQUE (rfq_id, batch_code)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('OUTBOUND_EMAIL')),
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  related_entity_id TEXT NOT NULL,
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

CREATE INDEX idx_rfqs_dispatch_deadline ON rfqs(dispatch_status, deadline_at);
CREATE INDEX idx_expected_issuers_rfq_status ON rfq_expected_issuers(rfq_id, status);
CREATE INDEX idx_outbound_batches_rfq_status ON outbound_email_batches(rfq_id, status);
CREATE INDEX idx_outbound_batches_status_lease ON outbound_email_batches(status, lease_expires_at);
CREATE INDEX idx_jobs_status_available ON jobs(status, available_at);
CREATE INDEX idx_jobs_rfq ON jobs(rfq_id, job_type);
