-- Preserve the first five economic ranks and allow one private quote image for each
-- ranked quote. Existing per-trade artifacts from migration 0008 are mapped to the
-- deterministic rank-one quote before the artifact tables are rebuilt.

PRAGMA foreign_keys = OFF;

ALTER TABLE ranking_results RENAME TO ranking_results_legacy;

CREATE TABLE ranking_results (
  id TEXT PRIMARY KEY,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL REFERENCES rfq_trades(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES issuer_quotes(id) ON DELETE CASCADE,
  economic_rank INTEGER NOT NULL CHECK (economic_rank BETWEEN 1 AND 5),
  display_order INTEGER NOT NULL CHECK (display_order > 0),
  target_field TEXT NOT NULL CHECK (target_field IN ('COUPON', 'PRICE', 'STRIKE', 'KO_BARRIER', 'KI_BARRIER')),
  normalized_value REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('ASC', 'DESC')),
  is_image_winner INTEGER NOT NULL CHECK (is_image_winner IN (0, 1)),
  tie_group TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (ranking_run_id, trade_id, quote_id)
);

INSERT INTO ranking_results
  (id, ranking_run_id, rfq_id, trade_id, quote_id, economic_rank, display_order,
   target_field, normalized_value, direction, is_image_winner, tie_group, created_at)
SELECT id, ranking_run_id, rfq_id, trade_id, quote_id, economic_rank, display_order,
       target_field, normalized_value, direction, is_image_winner, tie_group, created_at
  FROM ranking_results_legacy;

DROP TABLE ranking_results_legacy;

ALTER TABLE image_render_jobs RENAME TO image_render_jobs_legacy;
ALTER TABLE generated_artifacts RENAME TO generated_artifacts_legacy;

CREATE TABLE generated_artifacts (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  trade_code TEXT NOT NULL,
  quote_id TEXT NOT NULL REFERENCES issuer_quotes(id) ON DELETE CASCADE,
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
  UNIQUE (ranking_run_id, trade_code, quote_id)
);

INSERT INTO generated_artifacts
  (id, rfq_id, ranking_run_id, trade_code, quote_id, issuer, r2_object_key,
   content_type, content_hash, byte_size, status, render_profile_version,
   idempotency_key, attempt_count, last_error_code, created_at, completed_at, expires_at)
SELECT artifact.id, artifact.rfq_id, artifact.ranking_run_id, artifact.trade_code,
       result.quote_id, artifact.issuer, artifact.r2_object_key, artifact.content_type,
       artifact.content_hash, artifact.byte_size, artifact.status,
       artifact.render_profile_version, artifact.idempotency_key, artifact.attempt_count,
       artifact.last_error_code, artifact.created_at, artifact.completed_at, artifact.expires_at
  FROM generated_artifacts_legacy artifact
  JOIN rfq_trades trade
    ON trade.rfq_id = artifact.rfq_id AND trade.trade_code = artifact.trade_code
  JOIN ranking_results result
    ON result.ranking_run_id = artifact.ranking_run_id
   AND result.trade_id = trade.id
   AND result.is_image_winner = 1;

CREATE TABLE image_render_jobs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL UNIQUE REFERENCES generated_artifacts(id) ON DELETE CASCADE,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  ranking_run_id TEXT NOT NULL REFERENCES ranking_runs(id) ON DELETE CASCADE,
  trade_code TEXT NOT NULL,
  quote_id TEXT NOT NULL REFERENCES issuer_quotes(id) ON DELETE CASCADE,
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

INSERT INTO image_render_jobs
  (id, artifact_id, rfq_id, ranking_run_id, trade_code, quote_id, issuer,
   idempotency_key, status, attempt_count, last_error_code, lease_expires_at,
   available_at, created_at, updated_at, completed_at)
SELECT job.id, job.artifact_id, job.rfq_id, job.ranking_run_id, job.trade_code,
       artifact.quote_id, job.issuer, job.idempotency_key, job.status,
       job.attempt_count, job.last_error_code, job.lease_expires_at,
       job.available_at, job.created_at, job.updated_at, job.completed_at
  FROM image_render_jobs_legacy job
  JOIN generated_artifacts artifact ON artifact.id = job.artifact_id;

DROP TABLE image_render_jobs_legacy;
DROP TABLE generated_artifacts_legacy;

CREATE INDEX idx_ranking_results_trade_rank ON ranking_results(rfq_id, trade_id, economic_rank);
CREATE INDEX idx_generated_artifacts_rfq_created ON generated_artifacts(rfq_id, created_at);
CREATE INDEX idx_generated_artifacts_quote ON generated_artifacts(ranking_run_id, quote_id);
CREATE INDEX idx_image_render_jobs_status_available ON image_render_jobs(status, available_at);

PRAGMA foreign_keys = ON;
