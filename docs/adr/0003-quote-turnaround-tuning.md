# ADR 0003: Quote-turnaround tuning (configurable deadline, coalesced session writes)

Status: Accepted
Date: 2026-07-22

Current note: ADR 0006 supersedes the 600-second default and Queue batch settings with a
seven-minute soft reminder, fifteen-minute hard deadline, and one-message/one-second batches.

## Context

The quote pipeline is architecturally sound: replies are parsed and normalized as they
arrive, each terminal issuer pings the RFQ Durable Object (`/issuer-complete`), and an
all-issuers-terminal state finalizes immediately without waiting for the deadline alarm.
The remaining time-to-quote and per-request cost came from a few concrete points, of which
two touch governed boundaries and are recorded here (the others — a queue batch-timeout
reduction and two frontend polling/UX tweaks — are configuration/UX only).

## Decision

1. **Configurable reply deadline.** The 10-minute window was hardcoded as
   `sent_at + 10*60*1000` in `outbound.ts`. It is now `rfqDeadlineSeconds(env) * 1000`,
   read from the `RFQ_DEADLINE_SECONDS` var (default `"600"`). Invalid/absent values fall
   back to 600, so the default behavior is unchanged. This lets the reply window be tuned
   from configuration without a code change. Whenever any expected issuer stays silent, the
   window still runs to completion; shortening it is now an operational lever, not a rewrite.

2. **Coalesced session sliding-expiry write.** `loadSession` previously issued a D1
   `UPDATE user_sessions` on every authenticated request to bump `last_seen_at`/`expires_at`.
   During the 4-second result polling that is ~150 writes per RFQ purely for sliding expiry.
   The write is now skipped unless the new expiry would advance the stored `expires_at` by
   more than 60 seconds. The idle-timeout semantics are preserved to ~60s granularity against
   an 1800s idle window; absolute expiry, revocation, and credential-version checks are
   unchanged.

## Consequences

- `RFQ_DEADLINE_SECONDS` is a new environment variable; deploying without it keeps the
  600-second default. Lowering it speeds up the "some issuers silent" case at the cost of a
  shorter reply window for every issuer — an operational decision, not a code change.
- The session idle timeout may now fire up to ~60s later than the exact last request, because
  the sliding write is coalesced. This is immaterial against the 1800s window and removes a
  D1 write from ~95% of authenticated requests, lowering latency and D1 cost.
- No D1 schema, binding, address, public-API, or email-format change. No change to
  authentication strength, CSRF, absolute expiry, or revocation.

## Evidence / implementation links

- `backend/src/outbound.ts` — `rfqDeadlineSeconds`, deadline computation
- `backend/wrangler.jsonc` — `RFQ_DEADLINE_SECONDS` var; `fcn-quote-rank` batch timeout 5→2
- `backend/src/db.ts` — `loadSession` coalesced sliding-expiry write
- `backend-client.js` — progress dialog opens on submit; post-deadline polling at 2s
- Regression coverage: `backend/test/outbound.test.ts` continues to assert the default
  600000 ms deadline via the fallback; `backend/test/auth.test.ts` covers session validity.
