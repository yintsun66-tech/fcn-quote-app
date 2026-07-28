# ADR 0018: Employee-number login for new registrations

Status: Accepted
Date: 2026-07-28

## Context

The original registration form asked applicants for five values: employee number, branch name,
display name, a separate login name, and password. The separate identity fields caused confusion
and allowed an employee number to become bound to an unexpected login name. At the same time,
`branch_name` must remain available because ADR 0002 places the sanitized branch label in outbound
RFQ subjects.

Existing accounts and historical RFQs already reference stored user IDs and login names. Rewriting
them would create unnecessary authentication and audit risk.

## Decision

1. A new applicant submits only `branchName`, a five-digit `employeeNumber`, and `password`.
2. The server, not the browser, assigns both `username_normalized` and `display_name` to the
   normalized five-digit employee number. Any client-supplied `username` or `displayName` is
   ignored.
3. `branch_name` continues to be stored and used by the existing sanitized subject-label flow.
4. Existing users keep their stored login names. No data migration or automatic rename is
   performed.
5. The existing approval state, encrypted employee-number storage, keyed lookup hash, password
   requirements, rate limits, generic duplicate response, session behavior, roles, and audit
   events remain unchanged.
6. Administrative response objects retain `username` and `displayName` for compatibility, even
   though both values are identical for newly registered accounts.

## Consequences

- New applicants have one unambiguous login account: their five-digit employee number.
- The rule cannot be bypassed by manually crafting a registration request.
- Branch information remains available for the `XX分行` outbound subject segment.
- A previously registered employee number still cannot be registered again. Administrators must
  use the existing employee-number lookup and the approved recovery process for legacy accounts.
- No D1 migration, binding, secret, email format, or deployment configuration change is required.

## Evidence / implementation links

- `backend/src/validation.ts` — server-side identity derivation
- `backend-client.js` — simplified registration and review UI
- `backend/test/auth.test.ts` — registration, legacy-field, approval, duplicate, and login coverage
- `docs/backend/contracts.md`
- `docs/runbooks/admin.md`
