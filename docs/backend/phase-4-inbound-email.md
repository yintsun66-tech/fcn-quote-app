# Phase 4 Inbound Email Ingestion and MIME Classification

Status: deployed production baseline as of 2026-07-25.

## Scope

Phase 4a receives RFC822/MIME addressed to `rfq@yintsun66.com`, stores the raw message in private R2, writes bounded metadata to D1, and enqueues one idempotent parse job. Phase 4b parses MIME with `postal-mime`, extracts bounded table cell text, evaluates sender/subject evidence, correlates replies to an RFQ, and records a terminal classification. It does not execute attachments or fetch links. Downstream Queue consumers normalize issuer rows, match trades and rank valid quotes.

## Cloudflare resources

- Private R2 bucket: `fcn-quote-private`
- Queue producer: `fcn-email-parse`
- Queue consumer and dead-letter queue: `fcn-email-parse` and `fcn-email-parse-dlq`
- Email Routing address: `rfq@yintsun66.com`
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
- The deterministic 10-character `[RFQ:...][BATCH:...]` correlation code, or a unique
  `In-Reply-To`/`References` match, is required for RFQ correlation.
- BMJB identifies a mail batch, not an issuer. BNP, MS, JPM, and BARCLAYS are disambiguated by sender evidence.
- Sender evidence is limited to approved issuer domains and exact known sender addresses in a forwarding wrapper.
- Conflicting sender evidence becomes `SENDER_MISMATCH`; unknown sender becomes `MANUAL_REVIEW`; missing correlation becomes `UNMATCHED_RFQ`.
- HTML is never stored or rendered as received. Only bounded table cell text and dimensions are saved under `parsed-email/` in private R2.
- Queue jobs use a lease and terminal completion state so duplicate deliveries do not produce duplicate parse results.
- Replies after `deadline_at` are preserved as `LATE_REPLY` and are not eligible to overwrite a finalized result.

## Downstream normalization status

The `quote-normalize` and `quote-rank` consumers now implement the eleven issuer profiles, quote
normalization, trade matching, rejection/no-quote handling, expected-issuer state updates and
versioned ranking/finalization. Parser profiles remain fail-closed when sender, correlation,
template, unit or trade evidence is ambiguous.

Observed production evidence now includes eight forwarded issuer replies from one authorized DAC
RFQ. All eight correlated; seven normalized to valid quotes, while BARCLAYS was correctly recorded
as `ISSUER_REJECTED` because its own COMET response rejected Product=`DAC`. SG fixed-period mapping
and the UBS VMRAN alias were proven on this path. This evidence is intentionally anonymized and
does not replace tests or prove behavior for issuer templates that did not reply.

Parser profile version `issuer-fcn-v4` additionally normalizes SG `At Maturity` as `EKI`, treats
`*Price Unavailable` / `Pls see below` as explicit no-quote target values unless separate issuer
error detail proves rejection, and excludes exact known forwarded-original BMJB/DBS/CA request
table signatures before trade matching. It intentionally does not deduplicate otherwise identical
completed quote rows.
