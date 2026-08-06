# ADR 0012: PS support tier and account management

Status: Accepted
Date: 2026-07-25

The hard-deletion boundary in this ADR is superseded by ADR 0035. `剔除` remains a soft disable,
while ADMIN or PS may remove a disabled plain USER's identifying account data and retain any RFQs
under an inaccessible anonymous tombstone owner.

## Context

Only the single `ADMIN` account could review registrations and there was no way to see the
full account roster, an account's last-online time, or to remove a stale regular account. The
operator asked for an ADMIN-visible **所有帳號列表** (all-accounts list) that also lets ADMIN
delegate a limited subset of moderation to trusted regular users ("PS" accounts), which can
approve new applicants and remove regular accounts — but never touch ADMIN or PS accounts.

Constraints from the existing schema:

- `users.role` has a `CHECK (role IN ('USER','ADMIN'))`. SQLite cannot alter a CHECK in place;
  widening it means rebuilding a production auth table referenced by five foreign keys
  (`user_sessions`, `rfqs`, `idempotency_keys`, `audit_events`, and the self-referential
  `approved_by_user_id`). That rebuild carries real FK/pragma risk on live auth data.
- `rfqs.user_id REFERENCES users(id) ON DELETE RESTRICT` forbids hard-deleting any user who has
  ever created an RFQ.
- `user_sessions.last_seen_at` already tracks activity, updated with a coalesced sliding-expiry
  write (ADR 0003), so it advances in ~60s granularity, not per request.

## Decision

1. **PS is a flag, not a stored role value.** Migration `0010` adds
   `users.is_privileged_support INTEGER NOT NULL DEFAULT 0 CHECK (in (0,1))` with a plain
   `ALTER TABLE ADD COLUMN` — no table rebuild, no FK/pragma risk. The stored `role` CHECK is
   left as `('USER','ADMIN')`.
2. **The Worker derives the effective role** (`effectiveRole` in `db.ts`): `ADMIN` when the
   stored role is `ADMIN`, else `PS` when the flag is set, else `USER`. Login and session
   loading return this effective role, so `SessionContext.user.role` and the frontend see a
   clean three-value `UserRole = "USER" | "ADMIN" | "PS"`.
3. **Permission matrix.**
   - `GET /admin/accounts` (view all accounts + last-online): ADMIN or PS.
   - `POST /admin/accounts/:id/promote` (USER→PS) and `/demote` (PS→USER): ADMIN only.
   - `POST /admin/accounts/:id/disable` (remove a regular account): ADMIN or PS.
   - Registration review (`/admin/registrations` list, `/approve`, `/reject`): ADMIN or PS.
   - Outbound archive and RFQ timelines remain ADMIN only.
4. **剔除 = soft disable.** Removal sets `status='DISABLED'` and revokes the account's active
   sessions; it never hard-deletes (RESTRICT). A DISABLED user cannot log in and existing
   sessions fail the `status='ACTIVE'` check immediately.
5. **ADMIN/PS accounts are protected.** `promote`, `demote`, and `disable` all guard on
   `role='USER'` (and `is_privileged_support` as appropriate) in the SQL `WHERE` clause, so a
   PS or ADMIN target changes zero rows and returns `409 ACCOUNT_NOT_ELIGIBLE`. `disable` also
   refuses a self-target. Every mutation is same-origin + CSRF protected and audited
   (`ACCOUNT_PROMOTED_PS`, `ACCOUNT_DEMOTED_PS`, `ACCOUNT_DISABLED`).
6. **上次上線時間** is `MAX(user_sessions.last_seen_at)` per user, presented as approximate. No
   schema change beyond the flag column.
7. The all-accounts list deliberately **omits the 5-digit employee number**; that PII stays on
   the pending-registration review screen only.

## Consequences

- The production auth table gains one nullable-safe boolean column instead of a risky rebuild.
- The UI enforces role gating for usability, but every rule is re-checked server-side; a hidden
  button or crafted request cannot bypass the guards.
- PS delegation is reversible (ADMIN demote) and auditable.
- Migration `0010` must be applied to remote D1 before the Worker that reads
  `is_privileged_support`. Applying the migration and deploying are separately authorized steps.
