# Backend Contracts

Status: Current implemented HTTP/domain contract baseline (2026-07-28).

## Contract principles

- JSON APIs use UTF-8 and an explicit version prefix such as `/api/v1`.
- All IDs are opaque and server-generated.
- User-facing resources are authorized by server-side ownership on every request.
- Mutating endpoints use an idempotency key.
- Stored numbers and display strings are separate.
- Invalid or unknown values remain `null` plus status/reason; they are never coerced to zero.
- The approved shared email-format module is the source for browser/Worker outbound column order.

## Authentication API

### `POST /api/v1/auth/register`

Request fields:

- `employeeNumber`: exactly five decimal digits
- `branchName`
- `password`

The server derives both `username` and `displayName` from `employeeNumber`; client-supplied
values for either field are ignored. This makes the five-digit employee number the login account
for new registrations while retaining `branchName` for the outbound email subject. Existing
accounts keep their stored login names and require no migration.

Response creates a `PENDING_APPROVAL` registration only. It must not reveal whether a sensitive
employee number already exists beyond a generic registration response.

### `POST /api/v1/auth/login`

Accepts username and password. Newly registered users enter their five-digit employee number as
the username; existing accounts continue to use their existing stored login name. Only `ACTIVE`
users may receive a session. Failure responses are generic and rate-limited.

### `POST /api/v1/auth/logout`

Revokes the current server-side session and expires the cookie.

### `GET /api/v1/auth/session`

Returns the minimum current-user profile needed by the UI. It never returns password material, employee-number protection keys, approval notes, or other users.

### Quote-card document (ADR 0017)

- `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/card` — rank-one card.
- `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/card` — a specific authorized quote.

Returns `{ card: { tradeCode, quoteId, issuer, rankingVersion, renderProfileVersion, width, html } }`. The requesting browser rasterizes `html` locally and downloads a PNG, so no Browser Rendering capacity, queue message or R2 object is consumed.

Authorization is identical to the artifact endpoints and is enforced by the shared `authorizeCardQuote`: the caller must own the RFQ, the RFQ must be `COMPLETED` with a current ranking run, and the quote must be ranked 1–4 by the server or be a custom-fifth candidate. A quote id supplied by the browser is never trusted on its own. The document is returned inside JSON rather than as `text/html` so the API origin never serves renderable markup.

### FCN market-analysis input (ADR 0020)

- `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/analysis-input`

Returns:

```text
{
  analysisInput: {
    version,
    rfq: { id, finalizedAt, rankingVersion },
    trade: { sequence, tradeCode, targetField, requestedProduct, requestedUnderlyings },
    quote: {
      id, issuer, issuerDisplayName, receivedAt,
      rawPriceValue, rawPriceLabel, priceSemantics,
      quoteReference, issuerComment, normalizationWarnings
    },
    terms: {
      product, currency, tradeDate, effectiveDateOffsetCalendarDays,
      tenorMonths, guaranteedPeriodsMonths, underlyings,
      strikePct, koType, koBarrierPct, couponPaPct,
      upfrontOrNotePricePct, barrierType, kiBarrierPct,
      observationFrequencyMonths, otc
    }
  }
}
```

This read endpoint reuses `authorizeCardQuote`; ownership, completed-RFQ status, current ranking
version and rank 1–4/custom-fifth eligibility are server-enforced. A missing non-target quote term
may fall back only to the immutable requested trade, never to another issuer. Phase 1 accepts FCN
only and returns `422 ANALYSIS_PRODUCT_UNSUPPORTED` for DAC/DRA.

The browser performs all spot/scenario calculations. User-entered indicative spots and timestamps
are stored only in browser `localStorage`; this endpoint does not write D1, change a ranking or
create an artifact.

### Administrative registration endpoints

- `GET /api/v1/admin/registrations?status=PENDING_APPROVAL`
- `POST /api/v1/admin/registrations/:id/approve`
- `POST /api/v1/admin/registrations/:id/reject`

Registration review requires the protected administration boundary and an effective role of `ADMIN` or `PS`. Approval/rejection records actor, time, and reason.

`GET /api/v1/admin/registrations` also returns a `duplicates` summary of recently blocked
duplicate registrations (`{ windowDays, count, latestAt, byField: { employeeNumber, username,
unknown } }`). Because new accounts use the employee number as the username, either uniqueness
constraint may report the collision. A duplicate registration is intentionally answered with the
same generic `202` as a new one to preserve anti-enumeration and creates no user row; this summary
lets a reviewer see how many were blocked and which unique field collided, without ever exposing
the attempted value.

### Account management endpoints (ADR 0012)

- `GET /api/v1/admin/accounts` — all accounts with `id`, `username`, `displayName`, `branchName`, effective `role`, `status`, `createdAt`, `lastSeenAt` (approximate last-online = `MAX(user_sessions.last_seen_at)`), and `rfqCount`. Employee numbers are intentionally excluded. Requires `ADMIN` or `PS`.
- `POST /api/v1/admin/accounts/:id/promote` — upgrade an ACTIVE regular `USER` to `PS`. `ADMIN` only.
- `POST /api/v1/admin/accounts/:id/demote` — return a `PS` account to `USER`. `ADMIN` only.
- `POST /api/v1/admin/accounts/:id/disable` — remove (soft-disable) a regular `USER`: set `status='DISABLED'` and revoke sessions. `ADMIN` or `PS`.
- `POST /api/v1/admin/accounts/:id/delete` — `{ confirmation }` permanently deletes a disabled
  plain `USER` only when `confirmation` equals the normalized login account and `rfqCount` is zero.
  `ADMIN` only. Self, ADMIN, PS, non-disabled, or RFQ-owning targets are refused.
- `POST /api/v1/admin/accounts/lookup` — `{ employeeNumber }` (five digits) → `{ account }` (the single account holding that employee number, with `id`/`username`/`displayName`/`branchName`/effective `role`/`status`/`createdAt`) or `{ account: null }`. **`ADMIN` only** (it maps the employee-number identifier to an account, the linkage kept out of the PS account list). Matched via the keyed lookup hash — no employee number is decrypted, and the queried value is never written to the audit log (only whether a match was found).

The `PS` tier is an effective role derived server-side from `users.is_privileged_support`
(migration 0010); the stored `role` column stays `USER`/`ADMIN`. `promote`/`demote`/`disable`
guard on the target being a plain `USER` (`role='USER'` plus the flag) in SQL, so an `ADMIN` or
`PS` target changes zero rows and returns `409 ACCOUNT_NOT_ELIGIBLE`; `disable` also rejects a
self-target with `422`. These mutations are same-origin + CSRF protected and audited.

Per ADR 0019, permanent deletion is a separate ADMIN-only operation after soft disable. It is
refused when an RFQ exists, so `rfqs.user_id ON DELETE RESTRICT` remains the final database guard.
Successful deletion cascades sessions/idempotency keys, releases the employee-number/login
uniqueness, and records `ACCOUNT_PERMANENTLY_DELETED` without personal data.

### Administrative RFQ diagnostics

`GET /api/v1/admin/rfq-timelines?limit=...` remains `ADMIN`-only. It returns the recent safe RFQ
timelines plus a seven-day `health` aggregate. The aggregate contains issuer counts/rates,
unmatched/manual-review inbound counts, failed-artifact counts and machine-readable alerts. It
never returns raw subjects, requester markers, correlation tokens, quote values, mail bodies,
private R2 keys or message IDs.

## RFQ API

### `POST /api/v1/rfqs`

Creates a draft RFQ containing 1 to 20 trades. The server assigns RFQ and trade IDs and determines each trade's single target field.

### `POST /api/v1/rfqs/:rfqId/send`

Validates and freezes the RFQ, snapshots expected issuers/outbound batches, and queues sending. Requires an idempotency key. A second request with the same key returns the original operation result.

### User read endpoints

- `GET /api/v1/rfqs/summary`
- `GET /api/v1/rfqs?scope=active|completed|all&limit=20&cursor=...`
- `GET /api/v1/rfqs/:rfqId`
- `GET /api/v1/rfqs/:rfqId/status`
- `GET /api/v1/rfqs/:rfqId/snapshot?since=<version>`
- `GET /api/v1/rfqs/:rfqId/results`
- `GET /api/v1/rfqs/:rfqId/artifacts`
- `GET /api/v1/artifacts/:artifactId/download`

The server returns `404` for resources not owned by the current user, avoiding cross-user existence disclosure.

The summary endpoint returns only `{ activeCount }` for the authenticated user. It is the
lightweight source for the persistent workspace badge and does not execute the RFQ-card issuer or
artifact aggregation query.

The snapshot endpoint combines status, results and current-ranking artifacts behind one
owner-scoped request. Its first or changed response is
`{ changed: true, version, status, results, artifacts }`. A later request with the same opaque
`since` version returns `{ changed: false, version }` and skips quote/result/artifact-list
reloading. The version is only a change detector and is never authorization evidence.

The RFQ collection endpoint is always filtered by the authenticated `user_id`. It returns
workspace summaries ordered by creation time and opaque ID, an opaque `nextCursor`, and
`summary.activeCount`. `scope` defaults to `all`; `limit` defaults to 20 and is capped at 50.
Each summary includes workflow/dispatch status, timestamps, trade count, the first trade's
underlyings and target field, issuer terminal/valid-reply counts, ranking version and ready image
count. It never returns another user's RFQ or raw email content.

Artifacts are keyed to an exact current-version quote choice (ADR 0015): each `artifacts[]` entry
carries `tradeCode`, `quoteId`, `issuer`, `rank`, `isCustom`, `isDefault`, `status`, `downloadUrl`,
and `previewUrl` (`?preview=1` renders inline). The deterministic rank-one artifact is queued at
finalization; ranks 1–4 and the server-validated custom-fifth candidate are optional.

While an RFQ is `WAITING`, `PARTIAL`, or `FINALIZING`, `GET /results` returns
`rfq.isProvisional: true`, `allTradesHaveFiveValidQuotes`, the compatibility field
`allTradesHaveThreeValidQuotes`, and per-trade
`validQuoteCount`/`lastUpdatedAt`. Each trade returns automatic `rankings` for economic ranks 1–4
and `alternateQuotes`, containing one best eligible quote per issuer outside those ranks. These
values use the final ranking algorithm but are not written to `ranking_runs` or `ranking_results`.

Status payloads expose `mailGraceStartsAt`, the actual `deadlineAt`, `hasLateReplies`, and
`hasUnrankedLateReplies`. At `mailGraceStartsAt` the UI remains provisional for sixty seconds and
displays **正在等待最後郵件轉送**.

### Controlled mutation endpoints

- `POST /api/v1/rfqs/:rfqId/cancel`
- `POST /api/v1/rfqs/:rfqId/finalize`
- `POST /api/v1/rfqs/:rfqId/recalculate`
- `POST /api/v1/rfqs/:rfqId/trades/:tradeCode/artifact`
- `POST /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/artifact`
- `POST /api/v1/admin/quotes/:quoteId/manual-review`

Recalculation creates a new ranking version and never overwrites the previously finalized snapshot.
The RFQ owner or an `ADMIN` may request it; same-origin and CSRF checks still apply. Only an explicit
`RECALCULATION` version may admit a finite, trade-matched, non-rejected `LATE_REPLY`.

`POST /api/v1/rfqs/:rfqId/finalize` lets the RFQ owner close the reply window early (see
[ADR 0004](../adr/0004-user-early-finalize.md)). It is accepted only while the RFQ is `WAITING`
or `PARTIAL`, requires same-origin + CSRF, is owner-enforced (`404` otherwise), and returns `202`
with `workflowStatus: "FINALIZING"`. It reuses the `DEADLINE` finalization trigger, so it is
idempotent with the eventual deadline alarm on the same ranking version; issuers that have not
replied are excluded from that ranking exactly as at a natural deadline. Once
`mailGraceStartsAt` is reached, the endpoint returns `409 RFQ_MAIL_GRACE_ACTIVE`; the approved
sixty-second transport buffer cannot be bypassed through a direct request.

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

FCN:

`<issuer base subject> <branch label?> [RFQ:<10-character-code>][BATCH:<batch-code>]`

DAC family:

`<issuer prefix> <DAC|DRA>(T+7) <branch label?> [RFQ:<10-character-code>][BATCH:<batch-code>]`

Requirements:

- The first trade alone selects FCN versus the DAC family. FCN always produces `FCN(T+7)`.
- DAC-family aliases (`DAC`, `DRA`, `WRA`, `Range Accrual`) produce `DRA(T+7)` for
  NOMURA/DBS/SG/GS/CA and `DAC(T+7)` for BMJB/UBS/CITI.
- Newly generated subjects never contain the legacy literal segment ` DAC/DRA`.
- The deterministic short code contains no personal email address or employee number; only its
  hash is stored in the dedicated correlation column.
- Do not use `##`.
- Do not generate `Re:`, `RE:`, `Fw:`, `FW:`, `Fwd:` or equivalent prefixes.
- Preserve the issuer prefix. Product label, optional branch label and correlation tags must
  remain in the order above.
- BMJB is shared by BNP, MS, JPM and BARCLAYS. An issuer-specific Product-body change must not be
  applied to the shared batch without proving it remains valid for all four issuers.
- Inbound normalization may remove repeated mail-system reply/forward prefixes for matching, but always preserves `rawSubject`.
- Subject evidence is never sufficient for authorization or ownership.
- If the subject tag is missing, exactly one tag found in sanitized message body content may be
  used as correlation evidence. Multiple or conflicting subject/body tags produce
  `MANUAL_REVIEW`; sender/batch/ownership checks are unchanged.

## Parser interface

Each issuer parser must implement the conceptual operations:

1. `detect(evidence) -> confidence/result`
2. `extract(message) -> raw rows and metadata`
3. `normalize(raw row, profile version) -> canonical quote`
4. `validate(canonical quote, matching trade) -> status/errors`

Parser output includes profile/version and source-row metadata. Parsers must prefer sanitized HTML tables and use plain text only as fallback. They must never fetch external links or execute attachments.

Special parser invariants:

- UBS Quote Id metadata cannot consume or remove the previous formal cell.
- CA must exclude the repeated original blank request table.
- Forwarded original request tables with the exact known BMJB, DBS or CA outbound header
  signatures are excluded before trade matching. Completed response rows are not deduplicated
  merely because their values are identical.
- SG supports vertical/plain-text blocks and multiple quote rows.
- SG `At Maturity` is normalized to `EKI`.
- NOMURA tolerates blank lines and wrapped cells.
- GS preserves rejection remarks and excludes `N/A`/rejected quotes.
- JPM does not depend on fixed Excel row offsets.
- MS FCN and MS DRA remain separate parser profiles.
- `*Price Unavailable` and `Pls see below` are explicit no-quote target values unless an attached
  issuer comment/error table supplies a distinct rejection reason.

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

Quotes with null, non-finite, rejected, error, unmatched, ambiguous, timeout, late, or
unconfirmed-unit targets are excluded from normal ranking. An explicit recalculation may include
a matched `LATE_REPLY` only when its target is finite and it has no rejection reason.

Equal economic values share a rank. Results are displayed deterministically by `receivedAt` and then opaque quote ID. The earliest valid receipt is selected only for a single image winner and does not change the economic tie.

Every finalized result records:

- ranking version
- normalized target and direction
- eligible/excluded quote IDs and reasons
- top five economic ranks, including all ties at rank five
- deterministic image winner
- finalized time and trigger (`ALL_TERMINAL`, `DEADLINE`, or `RECALCULATION`)

## Artifact contract

Generated quote images are tied to a finalized ranking version. The deterministic
`is_image_winner = 1` quote is queued automatically for each trade. The owner may request an image
for an exact rank 1–4 quote or for one server-returned custom-fifth candidate. A custom candidate
must belong to the same trade, be the issuer's best eligible quote, and come from an issuer absent
from ranks 1–4. Arbitrary, rejected, invalid, unmatched or unrecalculated-late quote IDs remain
unavailable. Each artifact is rendered as a mobile-portrait PNG using that issuer's theme.

A failed artifact can be re-requested by its owner through the same idempotent ranked-quote
endpoint. The existing artifact/job is reset and re-enqueued; no duplicate artifact is created.
Browser Rendering failures preserve a safe request/HTTP category such as
`BROWSER_RENDER_REQUEST_FAILED` or `BROWSER_RENDER_HTTP_429`, without storing response content.

The quote-card footer displays the complete outbound subject reference as `[RFQ:<10-character-code>]`, derived with the same server-side correlation helper used by outbound email. It is a display/reference value only; ownership continues to be enforced by the authenticated RFQ/artifact join.

## Public market-context contract

`GET /api/v1/market/instruments/:symbol/context`

- requires a valid application session;
- accepts only a normalized public US ticker, never an arbitrary URL;
- is independently rate-limited by hashed user and IP keys;
- returns display-only SEC and Alpha Vantage envelopes;
- never changes RFQ, quote, ranking, analysis-input or artifact state.

Response shape:

```json
{
  "marketContext": {
    "symbol": "AAPL",
    "generatedAt": "2026-07-28T00:00:00.000Z",
    "sec": {
      "source": "SEC",
      "status": "FRESH",
      "sourceAsOf": "2026-07-25",
      "fetchedAt": "2026-07-28T00:00:00.000Z",
      "expiresAt": "2026-07-29T00:00:00.000Z",
      "isStale": false,
      "errorCode": null,
      "data": {
        "company": {
          "symbol": "AAPL",
          "companyName": "Example",
          "exchange": "Nasdaq",
          "cik": "0000000000",
          "ticker": "AAPL",
          "country": "US"
        },
        "recentFilings": []
      }
    },
    "alphaVantage": {
      "source": "ALPHA_VANTAGE",
      "status": "FRESH",
      "sourceAsOf": "2026-07-28",
      "fetchedAt": "2026-07-28T00:00:00.000Z",
      "expiresAt": "2026-07-29T00:00:00.000Z",
      "isStale": false,
      "errorCode": null,
      "data": {
        "symbol": "AAPL",
        "tradingDate": "2026-07-28",
        "openPrice": 198,
        "highPrice": 202,
        "lowPrice": 197,
        "closePrice": 200,
        "volume": 88000000,
        "priorTradingDate": "2026-07-27",
        "priorClosePrice": 198,
        "dailyChangePct": 1.0101,
        "averageVolume20d": 72000000,
        "relativeVolume20d": 1.2222,
        "realizedVolatility20dPct": 24.5,
        "range20dPct": 13.75
      }
    }
  }
}
```

`status` is `FRESH`, `STALE` or `UNAVAILABLE`. `STALE` is always visibly labelled. An unavailable
provider returns a safe error code and `data: null`; it does not fail or alter the FCN analysis.
The response never includes the Alpha Vantage key, upstream request URL/body, RFQ identifiers or user
identity.

`GET /api/v1/market/ideas` was **removed** by ADR 0024, together with the Alpha Vantage
`TOP_GAINERS_LOSERS` fetch, the cached-universe rankings and the composite heat score. Market hot
lists are now a client-side TradingView screener widget on the homepage; they involve no Worker
endpoint, no D1 cache row and no provider budget.

Alpha Vantage is therefore used for exactly one purpose: the per-symbol previous close that fills
「輸入標的參考現價」. The Worker still permits at most `ALPHA_VANTAGE_DAILY_REQUEST_LIMIT` attempted
upstream calls per UTC day, which now covers only those per-symbol daily-series requests.

`GET /api/v1/admin/market-context-health`

- requires effective role `ADMIN`;
- returns only grouped cache status/counts, expired/stale/rate-limit row counts and today's
  provider request count;
- never returns normalized payloads, symbols, user/IP hashes, Secrets or upstream bodies.

## Error response

Errors use a stable machine code, user-safe message, request ID, and optional field errors. They never include raw mail, stack traces, secrets, password material, correlation tokens, or another user's identifiers.

## Follow-board endpoints

The follow-board is a no-registration surface protected by the shared four-digit
`FOLLOW_BOARD_VIEW_PIN` Secret. Public requests send the PIN in `X-Follow-Board-Pin`.
The Worker returns CORS headers only for `https://app.yintsun66.com` and
`https://yintsun66-tech.github.io`.

Publication email contract:

- accepts only the approved First Bank publisher addresses with aligned DKIM/SPF evidence;
- requires reply-thread evidence or an opaque correlation token;
- recognizes exactly one issuer from distinctive HTML-table headers;
- applies the existing issuer parser to unique complete rows from one issuer profile; `deal-N` is
  audit/count metadata and never selects a row;
- for multiple products, selects an unambiguous table-local candidate with the exact product-code
  count before considering message-wide unique rows;
- treats BATCH only as an issuer/table consistency check, never as a ranking lookup; and
- rejects ambiguous, missing, incomplete, rejected or mismatched table rows into manual review.

`GET /api/v1/public/follow-board/manifest`

- returns current published product snapshots and today's public interest rows;
- masks employee numbers; and
- never returns RFQ IDs, correlation tokens, requester data, source mail or documents.

`POST /api/v1/public/follow-board/interests`

- requires `Idempotency-Key`, JSON, an approved browser Origin and the shared PIN;
- accepts `productCode`, `branchCode`, `branchName`, five-digit `employeeNumber` and a positive
  whole-unit `amountValue`; and
- updates the current amount when the same employee submits the same product again.

`GET /api/v1/admin/follow-board/interests?date=YYYY-MM-DD`

- requires effective role `ADMIN` or `PS`; and
- returns complete employee numbers decrypted server-side and writes an audit event.

`POST /api/v1/admin/follow-board/products/:productCode/archive`

- requires effective role `ADMIN` or `PS`, a same-origin session and CSRF; and
- archives rather than deletes the product.

`GET /api/v1/public/follow-board/images/:token.png`

- unauthenticated by necessity: LINE fetches the image itself and sends no credentials;
- `:token` is `keyedHash(EMPLOYEE_LOOKUP_KEY, "follow-board-image:<PRODUCT CODE>")`, base64url, and
  is the only access control — it reveals neither the product code nor any identifier;
- serves the product-conditions card only. **The card carries no 手收**: it is rendered with
  `comparablePricePct: null` so the fee cannot appear even if the template changes; and
- returns 404 for a malformed or unknown token, and for every object expired by ADR 0030's 10-day
  image window, which also bounds how long the URL stays live.

`POST /api/v1/public/line/webhook`

- **disabled**: returns 404 unless `LINE_WEBHOOK_ENABLED="1"` and `LINE_CHANNEL_SECRET` is set;
- exists only to capture the LINE group id, which LINE delivers in no other way. Discovery was
  completed on 2026-07-31 and the endpoint was closed again;
- requires a valid `x-line-signature` (`base64(HMAC-SHA256(channel secret, raw body))` — standard
  base64, not base64url) verified by constant-time compare, so only LINE can write to the audit
  trail. A bad signature returns 401 without disclosing which part was wrong; and
- records `LINE_SOURCE_DISCOVERED` with the source type and chat id only — no member id, display
  name or message text — and always returns 200 on a valid signature, because LINE retries non-2xx.

## LINE push contract

When `LINE_PUSH_ENABLED="1"`, a completed follow-board publication is pushed to one private LINE
group through `POST https://api.line.me/v2/bot/message/push`.

- Runs **after** the publication batch has committed and never throws. A LINE outage, a revoked
  token or a rate limit cannot fail or roll back a publication.
- Two outputs per publication, split on purpose. The image sits behind a public URL, so 手收 must
  not be in it; **手收 and 交易日期 travel only in the Flex message text**, inside the private group.
- `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_GROUP_ID` are Secrets, not vars — the group id names a
  private chat. The `FOLLOW_BOARD_LINE_PUSHED` audit event records message counts and HTTP status
  only; neither value is ever logged.
- No RFQ id, correlation token, requester or employee data may travel to LINE.
