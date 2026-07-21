# Phase 4a Inbound Email Ingestion

Status: implemented for deployment on 2026-07-21.

## Scope

Phase 4a receives RFC822/MIME addressed to `reply@yintsun66.com`, stores the raw message in private R2, writes bounded metadata to D1, and enqueues one idempotent parse job. It does not parse issuer quote tables, open attachments, fetch links, render HTML, match trades, or rank quotes.

## Cloudflare resources

- Private R2 bucket: `fcn-quote-private`
- Queue producer: `fcn-email-parse`
- Dead-letter queue reserved for the Phase 4b consumer: `fcn-email-parse-dlq`
- Email Routing address: `reply@yintsun66.com`
- Worker bindings: `RAW_MAIL_BUCKET` and `INBOUND_EMAIL_QUEUE`

The R2 bucket must not have a public development URL or custom domain. Raw mail under `raw-email/` follows the approved 30-day retention policy.

## Ingestion invariants

- Only the configured recipient is accepted.
- Messages larger than 25 MiB are rejected before persistence when the envelope size is available and rechecked after reading the raw MIME.
- Raw MIME is hashed as bytes, not converted to text.
- The R2 object key is deterministic from the SHA-256 content hash and contains no sender, subject, RFQ token, or user information.
- Exact content and preserved Message-ID are deduplication evidence.
- R2 persistence happens before the D1 metadata/job batch.
- A Queue failure leaves the D1 message in `RECEIVED`; an Email Worker retry re-enqueues the existing job instead of creating another message.
- A successfully queued duplicate does not enqueue again.
- D1 stores only bounded header evidence and never stores the raw MIME body.
- No attachment is executed and no remote resource is loaded.

## Deferred to Phase 4b

- MIME parsing dependency and sanitized HTML/plain-text extraction
- issuer sender/domain and DKIM evidence evaluation
- subject normalization and RFQ correlation
- eleven issuer parser profiles
- quote normalization and trade matching
- parse Queue consumer and dead-letter handling

Before production parser trust rules are enabled, forward a controlled message through `i14053@firstbank.com.tw` and verify which original headers and MIME parts survive the bank forwarding rule.
