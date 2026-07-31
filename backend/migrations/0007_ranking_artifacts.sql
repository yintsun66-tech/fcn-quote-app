PRAGMA foreign_keys = ON;

ALTER TABLE rfqs ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'DRAFT'
  CHECK (workflow_status IN
    ('DRAFT', 'VALIDATED', 'QUEUED', 'SENDING', 'WAITING', 'PARTIAL',
     'FINALIZING', 'COMPLETED', 'NO_VALID_QUOTE', 'FAILED', 'CANCELLED'));
ALTER TABLE rfqs ADD COLUMN finalized_at TEXT;
ALTER TABLE rfqs ADD COLUMN finalization_trigger TEXT
  CHECK (finalization_trigger IS NULL OR finalization_trigger IN ('ALL_TERMINAL', 'DEADLINE', 'RECALCULATION'));
ALTER TABLE rfqs ADD COLUMN current_ranking_version INTEGER NOT NULL DEFAULT 0
  CHECK (current_ranking_version >= 0);

UPDATE rfqs SET workflow_status = CASE
  WHEN status = 'CANCELLED' THEN 'CANCELLED'
  WHEN dispatch_status = 'WAITING' THEN 'WAITING'
  WHEN dispatch_status = 'SENDING' THEN 'SENDING'
  WHEN dispatch_status = 'QUEUED' THEN 'QUEUED'
  WHEN dispatch_status = 'FAILED' THEN 'FAILED'
  WHEN status = 'VALIDATED' THEN 'VALIDATED'
  ELSE 'DRAFT'
END;

CREATE TABLE quote_rank_jobs (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('ALL_TERMINAL', 'DEADLINE', 'RECALCULATION')),
  requested_version INTEGER NOT NULL CHECK (requested_version > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  lease_expires_at TEXT,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (rfq_id, requested_version)
);

CREATE TABLE ranking_runs (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  trigger TEXT NOT NULL CHECK (trigger IN ('ALL_TERMINAL', 'DEADLINE', 'RECALCULATION')),
  target_field_rules_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'NO_VALID_QUOTE', 'FAILED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  last_error_code TEXT,
  UNIQUE (rfq_id, version)
);

CREATE TABLE ranking_results (
  id TEXT PRIMARY KEY,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL REFERENCES rfq_trades(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES issuer_quotes(id) ON DELETE CASCADE,
  economic_rank INTEGER NOT NULL CHECK (economic_rank BETWEEN 1 AND 3),
  display_order INTEGER NOT NULL CHECK (display_order > 0),
  target_field TEXT NOT NULL CHECK (target_field IN ('COUPON', 'PRICE', 'STRIKE', 'KO_BARRIER', 'KI_BARRIER')),
  normalized_value REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('ASC', 'DESC')),
  is_image_winner INTEGER NOT NULL CHECK (is_image_winner IN (0, 1)),
  tie_group TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (ranking_run_id, trade_id, quote_id)
);

CREATE TABLE ranking_exclusions (
  id TEXT PRIMARY KEY,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  trade_id TEXT REFERENCES rfq_trades(id) ON DELETE CASCADE,
  quote_id TEXT REFERENCES issuer_quotes(id) ON DELETE CASCADE,
  issuer TEXT,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE generated_artifacts (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  r2_object_key TEXT,
  content_type TEXT NOT NULL DEFAULT 'image/png',
  content_hash TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RENDERING', 'READY', 'FAILED')),
  render_profile_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  UNIQUE (ranking_run_id, issuer)
);

CREATE TABLE image_render_jobs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL UNIQUE REFERENCES generated_artifacts(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
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

CREATE INDEX idx_rfqs_workflow_deadline ON rfqs(workflow_status, deadline_at);
CREATE INDEX idx_quote_rank_jobs_status_available ON quote_rank_jobs(status, available_at);
CREATE INDEX idx_ranking_runs_rfq_version ON ranking_runs(rfq_id, version);
CREATE INDEX idx_ranking_results_trade_rank ON ranking_results(rfq_id, trade_id, economic_rank);
CREATE INDEX idx_ranking_exclusions_run_trade ON ranking_exclusions(ranking_run_id, trade_id);
CREATE INDEX idx_generated_artifacts_rfq_created ON generated_artifacts(rfq_id, created_at);
CREATE INDEX idx_image_render_jobs_status_available ON image_render_jobs(status, available_at);
