# ADR 0035: Self-service password reset and account anonymization

Status: Accepted
Date: 2026-08-06

## Context

New users log in with a five-digit employee number. There is no verified recovery email, phone,
or external identity provider. The operator nevertheless approved a low-friction recovery flow in
which an ordinary user can reset the password to twelve zeroes, with a mandatory change within
thirty minutes.

The earlier hard-delete boundary in ADR 0019 allowed ADMIN to remove only a disabled USER with no
RFQs. That released an unused employee number, but it could not help an employee whose account had
financial history. Deleting that RFQ graph would destroy quote, mail, ranking and audit evidence.

## Decision

1. `POST /api/v1/auth/password/reset` accepts a normalized login name and always returns the same
   generic response. Only an ACTIVE plain USER is eligible. ADMIN and PS accounts are excluded.
2. An eligible reset replaces the password hash with the hash of `000000000000`, records a
   thirty-minute expiry, sets `password_change_required=1`, increments `credential_version`,
   revokes every active session and writes a safe audit event.
3. Reset requests are rate-limited to three per hour for the keyed login/network combination.
   This reduces casual abuse but does not make the fixed temporary password a second factor.
4. A temporary-password login receives a session marked `passwordChangeRequired`. The Worker
   permits only session inspection, logout and password change; every RFQ, market and admin route
   returns `PASSWORD_CHANGE_REQUIRED`. An expired reset credential cannot log in or load a session.
5. `POST /api/v1/auth/password/change` requires the current password and a new 12–128 character
   password. The new password cannot be twelve zeroes or equal the current password. Success clears
   reset state, increments `credential_version`, revokes every session and requires a fresh login.
6. Migration `0018` adds reset/anonymization fields and a separate rate-limit table. No plaintext
   password is stored; normal PBKDF2, per-password salt and pepper handling remains in force.
7. ADMIN and PS may delete the identifying data of a disabled plain USER after exact-login
   confirmation. ADMIN, PS and self targets remain protected.
8. The operation does not delete the user row. It replaces username, display name, branch,
   encrypted employee-number material, employee lookup hash and password with irreversible
   tombstone values; clears reset/rejection data; deletes sessions and idempotency keys; and marks
   `anonymized_at`. The old username and employee-number hash are therefore free for registration.
9. RFQs continue to reference the same opaque tombstone user ID. Quotes, mail, rankings, images and
   audit events are preserved, and a newly registered account receives a different user ID and no
   access to the old RFQs. Anonymized rows are omitted from account lists and employee lookup.
10. `ACCOUNT_PERSONAL_DATA_DELETED` records the actor and preserved RFQ count without recording the
    deleted username or employee number.

## Consequences

- Recovery is simple but intentionally weaker than a verified recovery channel: anyone who knows
  an ordinary user's login can trigger a reset and attempt to use the known temporary password.
  The forced-change boundary, privileged-account exclusion, short expiry and rate limit reduce but
  do not eliminate account-takeover and denial-of-service risk. A verified recovery factor should
  replace this flow before the service handles regulated or official records.
- Historical financial ownership remains stable and owner isolation is not transferred to a new
  account that reuses the employee number.
- ADR 0019's physical deletion behavior is superseded. Its pre-disable, protected-role,
  self-target and exact-confirmation guards remain.

## Evidence / implementation links

- `backend/migrations/0018_account_recovery_and_anonymization.sql`
- `backend/src/auth.ts`, `backend/src/db.ts`, `backend/src/index.ts`, `backend/src/validation.ts`
- `backend-client.js`, `styles.css`, `styles-dark.css`
- `backend/test/auth.test.ts`
- `docs/backend/contracts.md`
- `docs/runbooks/admin.md`
