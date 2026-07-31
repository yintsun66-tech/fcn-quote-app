PRAGMA foreign_keys = ON;

-- Add the privileged-support (PS) application tier. PS sits between USER and ADMIN:
-- it can review registrations and remove (disable) regular USER accounts, but cannot
-- remove ADMIN or PS accounts and cannot promote accounts.
--
-- The existing `role` CHECK stays `('USER','ADMIN')` to avoid rebuilding this
-- production auth table (five foreign keys reference users.id). PS is a flag on top
-- of role='USER'; the Worker derives the effective role server-side.
ALTER TABLE users
  ADD COLUMN is_privileged_support INTEGER NOT NULL DEFAULT 0
    CHECK (is_privileged_support IN (0, 1));

CREATE INDEX idx_users_privileged_support ON users(is_privileged_support);
