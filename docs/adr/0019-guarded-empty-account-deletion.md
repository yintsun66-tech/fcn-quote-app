# ADR 0019: Guarded permanent deletion of empty user accounts

Status: Superseded by ADR 0035
Date: 2026-07-28

## Context

The existing `剔除` action from ADR 0012 is intentionally a soft disable. It prevents login but
retains the encrypted employee number and normalized username, so both uniqueness constraints
continue to block registration. That is correct for accounts with financial history, but it
prevents an operator from safely clearing an unused or mistaken account so the employee can apply
again.

`rfqs.user_id` uses `ON DELETE RESTRICT`, while sessions and idempotency keys use
`ON DELETE CASCADE`. Other user references that must retain history use `ON DELETE SET NULL`.

## Decision

1. Keep `剔除` as the reversible ADMIN/PS soft-disable action.
2. Add a separate `永久刪除` action available only to `ADMIN`.
3. Permanent deletion is allowed only when all of these remain true on the server:
   - the target is a stored `USER` and not a PS;
   - the target is not the current ADMIN;
   - the account is already `DISABLED`;
   - the account owns zero RFQs; and
   - the request repeats the exact normalized login name as confirmation.
4. The Worker deletes the `users` row through the authenticated, same-origin, CSRF-protected
   endpoint. It never uses the D1 console as an operational shortcut.
5. Deletion cascades sessions and idempotency keys and releases the unique username and encrypted
   employee-number lookup hash. Historical references configured as `SET NULL` remain, and audit
   rows retain only opaque entity IDs. A new `ACCOUNT_PERMANENTLY_DELETED` audit event records the
   ADMIN actor without storing username or employee number.
6. An account with any RFQ is refused with `ACCOUNT_HAS_RFQS`. No RFQ, quote, email, ranking,
   artifact, R2 object, or financial audit record is deleted.
7. The account list exposes `rfqCount` so the UI can show the button only for eligible-looking
   rows. The server repeats every check; browser visibility is not authorization.

## Consequences

- An unused disabled account can be fully removed and its employee number can register again.
- Accounts with financial history remain immutable at the ownership boundary.
- ADMIN, PS, self-target, active, pending, rejected, or otherwise non-disabled accounts cannot be
  permanently deleted.
- No migration, dependency, lockfile, binding, secret, or R2 lifecycle change is required.
- The operation is irreversible. The UI uses a danger style, a warning, and typed-login
  confirmation before calling the endpoint.

## Evidence / implementation links

- `backend/src/auth.ts` — `deleteAccountPermanently` and account `rfqCount`
- `backend/src/index.ts` — ADMIN account-delete route
- `backend-client.js`, `styles.css` — guarded permanent-delete control
- `backend/test/auth.test.ts` — role, confirmation, cascade, re-registration, and RFQ guard tests
- `docs/backend/contracts.md`
- `docs/runbooks/admin.md`
