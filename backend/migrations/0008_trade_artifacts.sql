-- Per-trade quote images (ADR 0005): one image per trade (the trade's rank-1 winner),
-- replacing the previous per-issuer grouping. generated_artifacts / image_render_jobs were
-- uniquely keyed by (ranking_run_id, issuer), which cannot hold multiple trades won by the
-- same issuer. Rebuild both tables keyed by trade_code. Prior issuer-grouped artifact rows do
-- not map to the per-trade model and are regenerable via recalculation, so they are dropped;
-- their R2 objects are left to expire under the existing 90-day lifecycle.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS image_render_jobs;
DROP TABLE IF EXISTS generated_artifacts;

CREATE TABLE generated_artifacts (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  trade_code TEXT NOT NULL,
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
  UNIQUE (ranking_run_id, trade_code)
);

CREATE TABLE image_render_jobs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL UNIQUE REFERENCES generated_artifacts(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  trade_code TEXT NOT NULL,
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

CREATE INDEX idx_generated_artifacts_rfq_created ON generated_artifacts(rfq_id, created_at);
CREATE INDEX idx_image_render_jobs_status_available ON image_render_jobs(status, available_at);

PRAGMA foreign_keys = ON;
