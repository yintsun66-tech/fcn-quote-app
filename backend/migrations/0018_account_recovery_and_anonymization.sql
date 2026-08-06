ALTER TABLE users ADD COLUMN password_change_required INTEGER NOT NULL DEFAULT 0
  CHECK (password_change_required IN (0, 1));

ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT;

ALTER TABLE users ADD COLUMN anonymized_at TEXT;

CREATE TABLE password_reset_attempts (
  id TEXT PRIMARY KEY,
  attempt_key TEXT NOT NULL,
  succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
  occurred_at TEXT NOT NULL
);

CREATE INDEX idx_password_reset_attempts_key_time
  ON password_reset_attempts(attempt_key, occurred_at);

CREATE INDEX idx_users_password_reset_expiry
  ON users(password_change_required, password_reset_expires_at);
