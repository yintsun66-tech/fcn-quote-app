# Phase 3 Outbound Email

Status: implemented and locally verified on 2026-07-21. Cloudflare D1 migrations and the Worker version are deployed. The Queue producer is active; the Queue consumer requires the account-level `workers.dev` namespace to be initialized before its trigger can be attached.

## Implemented scope

- One shared JavaScript email-format module is used by both the static browser app and the Worker.
- The eight approved request batches remain `BMJB`, `NOMURA`, `UBS`, `DBS`, `SG`, `CITI`, `GS`, and `CA`.
- Sending snapshots eleven expected issuers; `BMJB` represents BNP, MS, JPM, and BARCLAYS as four separate expected replies.
- `POST /api/v1/rfqs/:rfqId/send` requires an authenticated owner, same-origin request, CSRF token, validated RFQ, and `Idempotency-Key`.
- The sender and recipient are fixed server-side to `rfq@yintsun66.com` and `i14053@firstbank.com.tw`.
- Subjects retain the approved base subject and append `[RFQ:<opaque-token>][BATCH:<code>]`.
- The opaque token is deterministically derived with the server HMAC secret. Only its SHA-256 hash is stored as a dedicated correlation value; the original token is reconstructed only while composing the outbound message.
- The HTML-only trailing empty-cell workaround remains in place for UBS, CITI, and CA.
- Each email batch has an observable D1 job and is sent through `fcn-outbound-email` with `fcn-outbound-email-dlq` as its dead-letter queue.
- After all eight batches are marked sent, the RFQ enters `WAITING` and receives a deadline ten minutes after `sent_at`.

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
- General logs and audit metadata do not contain transaction conditions, email bodies, or the opaque correlation token.

## Retry invariant and residual risk

Queue delivery is at least once. A D1 lease prevents concurrent duplicate processing, and a `SENT` batch is never sent again. The content hash is persisted before the call to Cloudflare Email Sending.

Cloudflare Email Sending does not expose a provider idempotency key in the binding used here. There remains a narrow unavoidable case: if the provider accepts a message but the Worker terminates before D1 records `SENT`, a retry can send the same batch again. Inbound Phase 4 must deduplicate replies by RFQ token, batch, Message-ID, and content evidence; operations should also monitor duplicate outbound provider IDs.

The deterministic token depends on `EMPLOYEE_LOOKUP_KEY`. Do not rotate this secret while any RFQ is queued or waiting. A future key-version migration is required before routine key rotation.

## Cloudflare resources

- D1: `fcn-quote`
- Queue: `fcn-outbound-email` (24-hour Free-plan retention)
- DLQ: `fcn-outbound-email-dlq`
- Email destination: `i14053@firstbank.com.tw` (verified)
- Email binding sender allowlist: `rfq@yintsun66.com`
- API custom domain: `api.yintsun66.com`

The Free plan includes 10,000 Queue operations per day. A normally delivered eight-batch RFQ consumes about 24 operations (eight writes, reads, and deletes), excluding retries. At 2,000 email messages/day, other Phase 4 queues will need a separate capacity calculation before production use.

## Verification

Run from `backend`:

```powershell
pnpm test
pnpm run typecheck
pnpm build
```

Tests cover the eight profile column counts, final blank cells, CITI transformations, subject safety, eleven-issuer/eight-batch snapshots, idempotent D1 creation, all-eight send completion, and duplicate post-`SENT` delivery.
