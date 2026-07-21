PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  employee_number_ciphertext TEXT NOT NULL,
  employee_number_iv TEXT NOT NULL,
  employee_number_lookup_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_algorithm TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DISABLED')),
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version > 0)
);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  credential_version INTEGER NOT NULL CHECK (credential_version > 0)
);

CREATE TABLE auth_attempts (
  id TEXT PRIMARY KEY,
  attempt_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('LOGIN', 'REGISTER')),
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  occurred_at TEXT NOT NULL
);

CREATE TABLE rfqs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'VALIDATED', 'CANCELLED')),
  trade_count INTEGER NOT NULL CHECK (trade_count BETWEEN 1 AND 20),
  created_at TEXT NOT NULL,
  validated_at TEXT,
  cancelled_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE rfq_trades (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 20),
  trade_code TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('FCN', 'DAC')),
  currency TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  effective_date_offset_calendar_days INTEGER NOT NULL,
  tenor_months INTEGER NOT NULL,
  guaranteed_periods_months INTEGER NOT NULL,
  underlyings_json TEXT NOT NULL,
  strike_pct REAL,
  ko_type TEXT NOT NULL,
  ko_barrier_pct REAL,
  coupon_pa_pct REAL,
  upfront_or_note_price_pct REAL,
  barrier_type TEXT NOT NULL,
  ki_barrier_pct REAL,
  observation_frequency_months INTEGER NOT NULL,
  otc TEXT NOT NULL,
  target_field TEXT NOT NULL CHECK (target_field IN ('COUPON', 'PRICE', 'STRIKE', 'KO_BARRIER', 'KI_BARRIER')),
  matching_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  frozen_at TEXT,
  UNIQUE (rfq_id, sequence),
  UNIQUE (rfq_id, trade_code)
);

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (user_id, scope, idempotency_key)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT NOT NULL,
  safe_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_users_status_created ON users(status, created_at);
CREATE INDEX idx_sessions_user_expires ON user_sessions(user_id, expires_at);
CREATE INDEX idx_auth_attempts_key_time ON auth_attempts(attempt_key, kind, occurred_at);
CREATE INDEX idx_rfqs_user_created ON rfqs(user_id, created_at);
CREATE INDEX idx_rfqs_status ON rfqs(status);
CREATE INDEX idx_trades_rfq_matching ON rfq_trades(rfq_id, matching_key_hash);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);
CREATE INDEX idx_audit_entity_time ON audit_events(entity_type, entity_id, created_at);
