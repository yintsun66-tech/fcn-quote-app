# Backend Contracts

Status: Phase 1 design draft. These contracts are not implemented and do not constitute a public API until a later phase is approved.

## Contract principles

- JSON APIs use UTF-8 and an explicit version prefix such as `/api/v1`.
- All IDs are opaque and server-generated.
- User-facing resources are authorized by server-side ownership on every request.
- Mutating endpoints use an idempotency key.
- Stored numbers and display strings are separate.
- Invalid or unknown values remain `null` plus status/reason; they are never coerced to zero.
- Existing frontend email layouts remain the source for outbound column order until extracted into an approved shared module.

## Authentication API draft

### `POST /api/v1/auth/register`

Request fields:

- `employeeNumber`: exactly five decimal digits
- `branchName`
- `displayName`
- `username`
- `password`

Response creates a `PENDING_APPROVAL` registration only. It must not reveal whether a sensitive employee number already exists beyond a generic registration response.

### `POST /api/v1/auth/login`

Accepts username and password. Only `ACTIVE` users may receive a session. Failure responses are generic and rate-limited.

### `POST /api/v1/auth/logout`

Revokes the current server-side session and expires the cookie.

### `GET /api/v1/auth/session`

Returns the minimum current-user profile needed by the UI. It never returns password material, employee-number protection keys, approval notes, or other users.

### Administrative registration endpoints

- `GET /api/v1/admin/registrations?status=PENDING_APPROVAL`
- `POST /api/v1/admin/registrations/:id/approve`
- `POST /api/v1/admin/registrations/:id/reject`

Administration requires both the protected administration boundary and an application `ADMIN` role. Approval/rejection records actor, time, and reason.

## RFQ API draft

### `POST /api/v1/rfqs`

Creates a draft RFQ containing 1 to 20 trades. The server assigns RFQ and trade IDs and determines each trade's single target field.

### `POST /api/v1/rfqs/:rfqId/send`

Validates and freezes the RFQ, snapshots expected issuers/outbound batches, and queues sending. Requires an idempotency key. A second request with the same key returns the original operation result.

### User read endpoints

- `GET /api/v1/rfqs/:rfqId`
- `GET /api/v1/rfqs/:rfqId/status`
- `GET /api/v1/rfqs/:rfqId/results`
- `GET /api/v1/rfqs/:rfqId/artifacts`
- `GET /api/v1/artifacts/:artifactId/download`

The server returns `404` for resources not owned by the current user, avoiding cross-user existence disclosure.

Artifacts are keyed to an exact persisted ranking quote (ADR 0007): each `artifacts[]` entry
carries `tradeCode`, `quoteId`, `issuer`, `rank`, `isDefault`, `status`, `downloadUrl`, and
`previewUrl` (`?preview=1` renders inline). `GET /status` also returns `tradeCode` and `quoteId`.
The deterministic rank-one artifact is queued at finalization; other top-five rows are optional.

While an RFQ is `WAITING`, `PARTIAL`, or `FINALIZING`, `GET /results` returns
`rfq.isProvisional: true`, `allTradesHaveFiveValidQuotes`, the compatibility field
`allTradesHaveThreeValidQuotes`, and per-trade
`validQuoteCount`/`lastUpdatedAt`. These ranks use the final ranking algorithm but are not written
to `ranking_runs` or `ranking_results`.

### Controlled mutation endpoints

- `POST /api/v1/rfqs/:rfqId/cancel`
- `POST /api/v1/rfqs/:rfqId/finalize`
- `POST /api/v1/rfqs/:rfqId/recalculate`
- `POST /api/v1/rfqs/:rfqId/trades/:tradeCode/artifact`
- `POST /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/artifact`
- `POST /api/v1/admin/quotes/:quoteId/manual-review`

Recalculation creates a new ranking version and never overwrites the previously finalized snapshot.

`POST /api/v1/rfqs/:rfqId/finalize` lets the RFQ owner close the reply window early (see
[ADR 0004](../adr/0004-user-early-finalize.md)). It is accepted only while the RFQ is `WAITING`
or `PARTIAL`, requires same-origin + CSRF, is owner-enforced (`404` otherwise), and returns `202`
with `workflowStatus: "FINALIZING"`. It reuses the `DEADLINE` finalization trigger, so it is
idempotent with the eventual deadline alarm on the same ranking version; issuers that have not
replied are excluded from that ranking exactly as at a natural deadline.

The trade-artifact endpoint is accepted only for the owner of a finalized `COMPLETED` RFQ and a
trade with a persisted rank-one winner. It requires same-origin + CSRF, returns the existing
artifact when repeated, and enqueues at most one idempotent render job. Images are not generated
automatically at finalization.

## RFQ request model

An RFQ includes:

- `rfqId`
- `userId`
- `status`
- `createdAt`
- `sentAt`
- `deadlineAt`
- `targetDomain`
- `expectedIssuers[]`
- `outboundBatches[]`
- `trades[]`
- `finalRankingVersion`

Each trade includes:

- `tradeId`: immutable `T01` through `T20` within the RFQ
- `sequence`
- `product`
- `currency`
- `tradeDate`
- `effectiveDateOffsetCalendarDays`
- `tenorMonths`
- `guaranteedPeriodsMonths`
- `underlyings[]`
- `strikePct`
- `koType`
- `koBarrierPct`
- `couponPaPct`
- `upfrontOrNotePricePct`
- `barrierType`
- `kiBarrierPct`
- `observationFrequencyMonths`
- `otc`
- `targetField`
- `matchingKey`

The target field is exactly one of:

- `COUPON`
- `PRICE`
- `STRIKE`
- `KO_BARRIER`
- `KI_BARRIER`

## Canonical quote model

Every issuer parser returns the same shape:

- `quoteId`
- `rfqId`
- `tradeId`
- `outboundBatchId`
- `inboundMessageId`
- `issuer`
- `issuerDisplayName`
- `product`
- `currency`
- `tradeDate`
- `effectiveDateOffsetCalendarDays`
- `tenorMonths`
- `guaranteedPeriodsMonths`
- `underlyings[]`
- `strikePct`
- `koType`
- `koBarrierPct`
- `couponPaPct`
- `rawPriceValue`
- `rawPriceLabel`
- `priceSemantics`
- `comparablePricePct`
- `barrierType`
- `kiBarrierPct`
- `observationFrequencyMonths`
- `otc`
- `quoteReference`
- `issuerComment`
- `rejectionReason`
- `receivedAt`
- `parserProfile`
- `parserVersion`
- `sourceRowIndex`
- `normalizationWarnings[]`
- `validationErrors[]`
- `status`

Canonical percentages use percentage points: `15.46` means 15.46%, not 0.1546. Issuer and field profiles perform unit conversion before producing canonical values.

## Quote statuses

- `VALID`
- `NO_QUOTE`
- `INVALID_VALUE`
- `PARSE_ERROR`
- `ISSUER_REJECTED`
- `TIMEOUT`
- `LATE_REPLY`
- `SENDER_MISMATCH`
- `UNMATCHED_RFQ`
- `AMBIGUOUS_TRADE_MATCH`
- `DUPLICATE`
- `PRODUCT_MISMATCH`
- `UNIT_UNCONFIRMED`
- `MANUAL_REVIEW`

Only `VALID` quotes with a finite target value are eligible for ranking.

## Issuer identification contract

Issuer identification accepts evidence rather than a single subject string:

- raw and normalized subject
- envelope sender
- `From`
- `Return-Path`
- DKIM `header.d`
- Message-ID and thread headers
- forwarded original headers, when available
- RFQ correlation token

Confirmed primary mappings:

| Issuer | Primary evidence |
| --- | --- |
| BNP | `quotation.tw@bnpparibas.com`, `bnpparibas.com` |
| MS | `mstwsp@morganstanley.com`, `morganstanley.com` |
| JPM | `no_reply_jpm_autopricer@jpmorgan.com`, `jpmorgan.com` |
| BARCLAYS | `barcapcomet@barclays.com`, `barclays.com` |
| NOMURA | `pricing@nomura.com`, `nomura.com` |
| UBS | `OL-GED-EmailPricer@ubs.com`, `ubs.com` |
| DBS | `sperfq@dbs.com`, `dbs.com` |
| SG | `ASI-MARK-SLS-TW-AUTOPRICER@sgcib.com`, `sgcib.com` |
| CITI | `mailrfq@citi.com`, `citi.com` |
| GS | `gs-asia-pb-autoquote-reply@gs.com`, `gs.com` |
| CA | `EISEmailPricer@ca-cib.com`, `ca-cib.com` |

`BMJB` is a request-batch label, not an issuer identity. It must be disambiguated using sender evidence among BNP, MS, JPM, and BARCLAYS. Conflicting or unknown evidence returns `SENDER_MISMATCH` or `MANUAL_REVIEW`; it must never guess.

## Subject and correlation contract

Outbound subject structure:

`<existing subject> [RFQ:<opaque-token>][BATCH:<batch-code>]`

Requirements:

- No personal email address in the token.
- Do not use `##`.
- Do not generate `Re:`, `RE:`, `Fw:`, `FW:`, `Fwd:` or equivalent prefixes.
- Preserve the existing issuer subject before the appended token.
- Inbound normalization may remove repeated mail-system reply/forward prefixes for matching, but always preserves `rawSubject`.
- Subject evidence is never sufficient for authorization or ownership.
- If the subject tag is missing, exactly one tag found in sanitized message body content may be
  used as correlation evidence. Multiple or conflicting subject/body tags produce
  `MANUAL_REVIEW`; sender/batch/ownership checks are unchanged.

## Parser interface draft

Each issuer parser must implement the conceptual operations:

1. `detect(evidence) -> confidence/result`
2. `extract(message) -> raw rows and metadata`
3. `normalize(raw row, profile version) -> canonical quote`
4. `validate(canonical quote, matching trade) -> status/errors`

Parser output includes profile/version and source-row metadata. Parsers must prefer sanitized HTML tables and use plain text only as fallback. They must never fetch external links or execute attachments.

Special parser invariants:

- UBS Quote Id metadata cannot consume or remove the previous formal cell.
- CA must exclude the repeated original blank request table.
- SG supports vertical/plain-text blocks and multiple quote rows.
- NOMURA tolerates blank lines and wrapped cells.
- GS preserves rejection remarks and excludes `N/A`/rejected quotes.
- JPM does not depend on fixed Excel row offsets.
- MS FCN and MS DRA remain separate parser profiles.

## Price normalization contract

Store both raw and normalized price semantics.

For confirmed CITI Upfront input:

`comparablePricePct = 100 - rawUpfrontPct`

For issuer fields already expressed as Note Price/Cost/Offer Price, the issuer profile defines the corresponding normalized calculation. No global `value < 1` percentage heuristic is allowed; unit rules are profile- and field-specific.

## Ranking contract

Ranking is independent for each RFQ trade and compares only quotes matched to that immutable trade.

| Target | Direction |
| --- | --- |
| Coupon | Descending |
| Comparable price | Ascending |
| Strike | Ascending |
| KO Barrier | Ascending |
| KI Barrier | Ascending |

Quotes with null, non-finite, rejected, error, unmatched, ambiguous, timeout, late, or unconfirmed-unit targets are excluded.

Equal economic values share a rank. Results are displayed deterministically by `receivedAt` and then opaque quote ID. The earliest valid receipt is selected only for a single image winner and does not change the economic tie.

Every finalized result records:

- ranking version
- normalized target and direction
- eligible/excluded quote IDs and reasons
- top five economic ranks, including all ties at rank five
- deterministic image winner
- finalized time and trigger (`ALL_TERMINAL` or `DEADLINE`)

## Artifact contract

Generated quote images are based only on a finalized ranking snapshot. The deterministic
`is_image_winner = 1` quote is queued automatically for each trade. The owner may request an
additional image by exact `quoteId` only when that quote belongs to the trade and current
persisted top-five snapshot. Rejected, invalid, unmatched, late, timed-out and outside-top-five
quotes remain unavailable. Each artifact is rendered as a mobile-portrait PNG using that issuer's
theme. An artifact response exposes `tradeCode`, `quoteId`, authenticated preview/download
endpoints and metadata, never the private R2 object key or a permanent public URL.

The quote-card footer displays the complete outbound subject reference as `[RFQ:<10-character-code>]`, derived with the same server-side correlation helper used by outbound email. It is a display/reference value only; ownership continues to be enforced by the authenticated RFQ/artifact join.

## Error response draft

Errors use a stable machine code, user-safe message, request ID, and optional field errors. They never include raw mail, stack traces, secrets, password material, correlation tokens, or another user's identifiers.
