# ADR 0004: User-initiated early finalization of an RFQ

Status: Accepted
Date: 2026-07-22

## Context

The reply window is configured by `RFQ_DEADLINE_SECONDS`. It was 600 seconds when this decision
was accepted; ADR 0006 changes the current hard default to 900 seconds and adds a 420-second
soft reminder.
Early finalization already happens automatically when all expected issuers reach a terminal
state. But when the issuers a user actually cares about have replied and the rest are expected
to stay silent, the user still waits out the remaining window. The user asked for a control to
end the wait and rank immediately, while keeping the configured hard deadline for the untouched case.

## Decision

Add `POST /api/v1/rfqs/:rfqId/finalize`.

- Same-origin + CSRF required; owner-enforced via the shared `ownedWorkflow` check (`404` for a
  non-owner, with no cross-user existence disclosure).
- Accepted only when `workflow_status` is `WAITING` or `PARTIAL` (the reply-window states);
  otherwise `409 RFQ_NOT_WAITING`. Not sent yet, already finalizing, completed, failed, or
  cancelled RFQs are rejected.
- Reuses the existing `DEADLINE` finalization trigger through `requestFinalization`. Because
  `queuedRankJob` keys idempotency on the next ranking version, a user early-finalize followed by
  the eventual deadline alarm produces exactly one ranking run — no double ranking. No new
  `finalization_trigger` value and therefore no D1 migration.
- The user actor is recorded in a dedicated `RFQ_EARLY_FINALIZE_REQUESTED` audit event (the
  reused `DEADLINE` trigger itself carries no actor).
- Frontend: a "提早結束並比價" button in the RFQ progress dialog, shown only while
  `WAITING`/`PARTIAL`, confirms before calling the endpoint, then refreshes results.

## Consequences

- Ranking semantics are unchanged: an early finalize ranks the valid replies present at that
  moment and excludes non-responders, identical to a natural deadline. It is the user's choice to
  forgo the remaining window; issuers that had not yet replied are simply not ranked.
- Late replies after an early finalize follow the existing `LATE_REPLY` path and do not overwrite
  the finalized snapshot without an explicit recalculation.
- No D1 schema, binding, address, email-format, or authentication change. One new owner-scoped,
  CSRF-protected public endpoint.

## Evidence / implementation links

- `backend/src/results.ts` — `finalizeRfqNow`
- `backend/src/index.ts` — `POST /api/v1/rfqs/:rfqId/finalize` route
- `backend-client.js` — progress-dialog "提早結束並比價" button and handler
- `backend/test/rfqs.test.ts` — owner success, non-owner 404, missing-CSRF 403, wrong-state 409
- `docs/backend/contracts.md` — endpoint contract
