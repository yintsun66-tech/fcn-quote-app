# ADR 0006: Live provisional ranking, two-stage deadline, and on-demand images

Status: Superseded in part by ADR 0007
Date: 2026-07-23

## Context

Production evidence showed that many valid issuer replies arrive after the former ten-minute
deadline, while users had no ranking visibility during the wait. Finalization also created every
trade image immediately, consuming Browser Rendering capacity even when a user did not need all
images. SG replies additionally vary the number of Underlying columns, and forwarded subjects may
lose the RFQ tag even when the quoted body retains it.

## Decision

1. `GET /api/v1/rfqs/:id/results` returns a read-only provisional top three while the RFQ is
   `WAITING`, `PARTIAL`, or `FINALIZING`. It uses the same ranking function as finalization but
   writes no ranking snapshot, version, or image work.
2. The UI presents a soft reminder at seven minutes. The Durable Object hard deadline becomes
   fifteen minutes. Only the hard deadline finalizes automatically.
3. Queue consumers use one-message batches and one-second batch timeouts, retaining their bounded
   concurrency, retry, and DLQ configuration.
4. Finalization persists the deterministic rank-one winner but does not enqueue image work.
   The owner explicitly requests a trade image through
   `POST /api/v1/rfqs/:id/trades/:tradeCode/artifact`. Creation is idempotent and remains private.
5. SG parsing maps fields by normalized headers and supports a variable number of Underlying
   columns, with the old positional mapping retained as a compatibility fallback.
6. When the normalized subject has no correlation tag, exactly one tag in sanitized plain/HTML
   body content may be used. Conflicting tags go to manual review. Sender allowlists, batch
   consistency, thread evidence, and D1 ownership remain mandatory security controls.
7. Administrators receive a safe RFQ timing view containing only status/count/duration aggregates;
   it excludes raw subjects, mail content, tokens, and R2 keys.

## Consequences

- Users see useful partial results sooner, but they are explicitly marked provisional and may
  change until finalization.
- The hard wait increases to fifteen minutes, capturing observed 11–14 minute replies. Users can
  still finalize early.
- Queue invocation count may increase because batches are smaller; latency is more predictable.
- Browser Rendering work is proportional to images users actually request.
- No D1 migration or production dependency change is required.

## Evidence / implementation links

- `backend/src/issuer-profiles.ts`, `backend/src/inbound-parser.ts`
- `backend/src/results.ts`, `backend/src/ranking.ts`, `backend/src/artifacts.ts`
- `backend/src/rfq-timing.ts`, `backend/src/admin-rfq.ts`
- `backend/wrangler.jsonc`, `backend-client.js`
- Parser, inbound, admin, outbound, and ranking integration tests under `backend/test/`
