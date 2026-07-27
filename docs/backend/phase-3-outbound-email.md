# Phase 3 Outbound Email

Status: implemented and deployed as of 2026-07-27. Queue producers, consumers and dead-letter
queues are attached. The prior marker rule was exercised in production; ADR 0014's
issuer-specific first-trade label is deployed but has not yet been verified by a new real RFQ.

## Implemented scope

- One shared JavaScript email-format module is used by both the static browser app and the Worker.
- The eight approved request batches remain `BMJB`, `NOMURA`, `UBS`, `DBS`, `SG`, `CITI`, `GS`, and `CA`.
- Sending snapshots eleven expected issuers; `BMJB` represents BNP, MS, JPM, and BARCLAYS as four separate expected replies.
- `POST /api/v1/rfqs/:rfqId/send` requires an authenticated owner, same-origin request, CSRF token, validated RFQ, and `Idempotency-Key`.
- The sender and recipient are fixed server-side to `rfq@yintsun66.com` and `i14053@firstbank.com.tw`.
- The first trade selects the product shown in the T+7 segment. FCN uses `FCN(T+7)` for every
  batch. DAC-family requests use `DRA(T+7)` for NOMURA/DBS/SG/GS/CA and `DAC(T+7)` for
  BMJB/UBS/CITI. Newly generated subjects do not contain the legacy ` DAC/DRA` marker
  (ADR 0014).
- Subjects append the deterministic short code `[RFQ:<code>][BATCH:<code>]`. Only its SHA-256
  hash is stored as a dedicated correlation value; the code is reconstructed while composing
  the outbound message.
- The HTML-only trailing empty-cell workaround remains in place for UBS, CITI, and CA.
- Each email batch has an observable D1 job and is sent through `fcn-outbound-email` with `fcn-outbound-email-dlq` as its dead-letter queue.
- After all required batches are marked sent, the RFQ enters `WAITING` and receives a hard deadline
  fifteen minutes after `sent_at`; the seven-minute point is a UI reminder only.

## Public API response

Successful first submission returns HTTP `202`:

```json
{
  "rfq": {
    "id": "rfq_...",
    "status": "VALIDATED",
    "dispatchStatus": "QUEUED",
    "outboundQueuedAt": "2026-07-21T00:00:00.000Z",
    "sentAt": null,
    "deadlineAt": null,
    "expectedIssuerCount": 11,
    "outboundBatchCount": 8
  }
}
```

Repeating the same operation with the same `Idempotency-Key` returns the stored response and safely re-enqueues only database jobs that are still `QUEUED` or `FAILED`. Reusing the key for another RFQ returns `409`.

## Data and privacy boundaries

- No arbitrary browser-supplied sender, recipient, or subject is accepted.
- Email HTML/plain text is generated just in time from frozen trades and is not stored in D1.
- D1 stores base subject, content hash, correlation-token hash, safe status/error codes, provider message ID, and timestamps.
- General logs and audit metadata do not contain transaction conditions, email bodies, or the
  plaintext short correlation code.

## Retry invariant and residual risk

Queue delivery is at least once. A D1 lease prevents concurrent duplicate processing, and a `SENT` batch is never sent again. The content hash is persisted before the call to Cloudflare Email Sending.

Cloudflare Email Sending does not expose a provider idempotency key in the binding used here. There remains a narrow unavoidable case: if the provider accepts a message but the Worker terminates before D1 records `SENT`, a retry can send the same batch again. Inbound processing therefore deduplicates replies by RFQ code, batch, Message-ID, and content evidence; operations should also monitor duplicate outbound provider IDs.

The deterministic token depends on `EMPLOYEE_LOOKUP_KEY`. Do not rotate this secret while any RFQ is queued or waiting. A future key-version migration is required before routine key rotation.

## Production evidence and unresolved BARCLAYS rule

Before ADR 0013, an authorized three-trade DAC run sent all eight batches with the then-current
`FCN(T+7) DAC/DRA` marker, branch and correlation-tag order. Eight issuer replies correlated
successfully. BNP, MS, JPM, NOMURA, UBS, DBS and SG returned valid DAC quotes. BARCLAYS also
replied, but COMET rejected Product=`DAC` for every row with a product-name error; this is an
issuer rejection, not a delivery or parser failure. This is historical evidence and does not
describe the current subject-construction contract.

The exact BARCLAYS DAC-family Product value or module-specific subject is not yet confirmed. Because
BMJB is shared with BNP, MS and JPM—and Product=`DAC` worked for those three—do not globally replace
the BMJB Product value with `DRA`, `WRA` or another guess. A BARCLAYS-specific body/batch is a
separate design change that first requires issuer confirmation and bank-routing verification.

## Cloudflare resources

- D1: `fcn-quote`
- Queue: `fcn-outbound-email` (24-hour Free-plan retention)
- DLQ: `fcn-outbound-email-dlq`
- Email destination: `i14053@firstbank.com.tw` (verified)
- Email binding sender allowlist: `rfq@yintsun66.com`
- API custom domain: `api.yintsun66.com`

A normally delivered eight-batch RFQ creates multiple Queue operations before inbound parsing,
normalization, ranking and rendering are counted. Cloudflare plan limits are external and may
change; confirm the current account limits and measure real Queue usage before the 2,000-message
daily target is treated as supported.

## Verification

Run from `backend`:

```powershell
pnpm test
pnpm run typecheck
pnpm run build
```

The current repository baseline is 16 test files / 99 tests. Tests cover the eight profile column
counts, final blank cells, CITI transformations, subject safety, first-row and issuer-specific
DAC/DRA labels, eleven-issuer/eight-batch snapshots, idempotent D1 creation, send completion, and
duplicate post-`SENT` delivery.
