# Phase 4 Inbound Email Ingestion and MIME Classification

Status: Phase 4a ingestion and Phase 4b MIME classification implemented for deployment on 2026-07-21.

## Scope

Phase 4a receives RFC822/MIME addressed to `reply@yintsun66.com`, stores the raw message in private R2, writes bounded metadata to D1, and enqueues one idempotent parse job. Phase 4b parses MIME with `postal-mime`, extracts bounded table cell text, evaluates sender/subject evidence, correlates replies to an RFQ, and records a terminal classification. It does not execute attachments, fetch links, normalize issuer quote rows, match trades, or rank quotes.

## Cloudflare resources

- Private R2 bucket: `fcn-quote-private`
- Queue producer: `fcn-email-parse`
- Queue consumer and dead-letter queue: `fcn-email-parse` and `fcn-email-parse-dlq`
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

## MIME classification invariants

- `postal-mime` is pinned to version `2.7.5`; parsing depth and header size are bounded.
- Subject matching uses an NFKC-normalized copy while preserving `raw_subject`.
- `##<requester-marker>##` is auxiliary evidence only and is persisted only as a keyed, irreversible hash.
- The opaque `[RFQ:...][BATCH:...]` token, or a unique `In-Reply-To`/`References` match, is required for RFQ correlation.
- BMJB identifies a mail batch, not an issuer. BNP, MS, JPM, and BARCLAYS are disambiguated by sender evidence.
- Sender evidence is limited to approved issuer domains and exact known sender addresses in a forwarding wrapper.
- Conflicting sender evidence becomes `SENDER_MISMATCH`; unknown sender becomes `MANUAL_REVIEW`; missing correlation becomes `UNMATCHED_RFQ`.
- HTML is never stored or rendered as received. Only bounded table cell text and dimensions are saved under `parsed-email/` in private R2.
- Queue jobs use a lease and terminal completion state so duplicate deliveries do not produce duplicate parse results.
- Replies after `deadline_at` are preserved as `LATE_REPLY` and are not eligible to overwrite a finalized result.

## Deferred to the issuer-normalization phase

- eleven issuer parser profiles
- quote normalization and trade matching
- plain-text-only issuer table fallbacks
- quote rejection/no-quote interpretation
- expected-issuer terminal-state updates
- ranking and finalization

Before production parser trust rules are enabled, forward a controlled message through `i14053@firstbank.com.tw` and verify which original headers and MIME parts survive the bank forwarding rule.
