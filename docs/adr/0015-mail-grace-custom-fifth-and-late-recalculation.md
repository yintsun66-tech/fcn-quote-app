# ADR 0015: Mail-transport grace, custom fifth issuer, and late-reply recalculation

Status: Accepted
Date: 2026-07-27

## Context

Production transport evidence showed a reply that entered the bank forwarding path before another
message but reached Cloudflare 18.6 seconds after the fifteen-minute cutoff. The issuer response
was parsed successfully; the delay occurred inside the forwarding/relay path. The existing result
view also displayed five automatic economic ranks, while users need the fifth displayed choice to
come from an issuer they select outside the first four.

Late replies were already retained and recalculation was versioned, but `LATE_REPLY` quote rows
were deliberately excluded by the normal ranking filter. Recalculation therefore needed an
explicit, bounded rule for admitting a valid late value without mutating the original quote status.

## Decision

1. Keep the normal issuer reply window at fifteen minutes (`RFQ_DEADLINE_SECONDS=900`) and add a
   sixty-second transport grace (`RFQ_MAIL_GRACE_SECONDS=60`). The persisted `deadline_at` and
   Durable Object alarm use the combined 960 seconds. All-issuer terminal completion may still
   finalize earlier.
2. During the final minute the result view stays provisional and displays
   **正在等待最後郵件轉送**. The user-visible fifteen-minute point is exposed as
   `mailGraceStartsAt`; `deadlineAt` remains the actual finalization time. Early-finalize is hidden
   during the grace period so it cannot accidentally defeat the approved buffer.
3. A `RECALCULATION` ranking version may admit a `LATE_REPLY` only when its target field is a finite
   canonical number, it matched the same immutable trade, and it has no issuer rejection reason.
   Original inbound/quote statuses remain unchanged for audit. Normal and provisional ranking still
   accept only `VALID`.
4. The owner and an `ADMIN` may request the existing versioned recalculation endpoint. Same-origin,
   CSRF and authorization checks remain mandatory, and the actor is audited. The UI exposes the
   action only when a newer late reply has not yet been covered by the current recalculation run.
5. The public result view shows automatic economic ranks 1–4, including ties. Its fifth row is a
   user choice from issuers absent from those first four ranks. Each candidate is that issuer's
   best eligible quote for the trade, ordered by the same target-field economics and deterministic
   receipt-time tie break.
6. The existing top-five rows remain persisted internally for schema compatibility and historical
   audit, but rank five is no longer presented as an automatic fifth choice. A selected candidate
   outside the persisted top five may receive an idempotent private artifact tied to the current
   ranking run, trade and exact quote. Server-side candidate validation prevents arbitrary quote
   IDs from being rendered.

## Consequences

- Normal completion can take up to sixteen minutes when one or more expected issuers remain
  pending; the added minute is specifically identified as mail-transport grace.
- A late quote never silently changes a published result. A user or ADMIN must create a new
  immutable ranking version.
- A custom fifth candidate can be economically below rank five, but it is visibly labelled
  **第 5 名（自選）** and never changes ranks 1–4.
- No D1 migration, production dependency, lockfile, email format, authentication method, Queue,
  Durable Object or R2 binding change is required. One additive Worker variable is required.

## Evidence / implementation links

- `backend/src/rfq-timing.ts`, `backend/src/outbound.ts`, `backend/wrangler.jsonc`
- `backend/src/ranking-policy.ts`, `backend/src/ranking.ts`, `backend/src/results.ts`
- `backend/src/artifacts.ts`, `backend-client.js`, `styles.css`
- `backend/test/rfq-timing.test.ts`, `backend/test/outbound.test.ts`,
  `backend/test/ranking.test.ts`, `backend/test/ranking-integration.test.ts`,
  `backend/test/rfqs.test.ts`
