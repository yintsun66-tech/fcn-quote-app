# FCN market analysis roadmap — Phases 2 to 4

Status: Phases 2–4 implemented locally; production Secret, migration and deployment not yet applied
Baseline: Phase 1 in `codex/market-analysis-phase1`; Phase 2 work in `codex/market-analysis-phase2-4`
Updated: 2026-07-28 (Asia/Taipei)

## Purpose and non-negotiable rules

This roadmap extends the owner-scoped Phase 1 FCN analysis without changing RFQ ranking, issuer
parsing or quote-card economics.

- The finalized ranking snapshot remains the only source for the selected issuer quote.
- External market content is display/reference information and never changes the ranking.
- A third-party widget or public-data API must never supply a hidden value to the quote card.
- Every datum shown must state source, observation time and known delay.
- User ownership remains server-enforced. A URL, ticker, requester marker or browser control is
  never authorization.
- No scraping, automated link opening, remote email image loading or unapproved personal-data
  transfer is allowed.
- Each phase requires its own review, tests, commit and deployment approval.

## Phase 2 — opt-in public market-resource panel

### Goal

Add useful public visual references without creating a market-data backend or D1 write load.

### User experience

1. Add a collapsed “公開市場資源” panel below the Phase 1 analysis.
2. The user must explicitly choose “載入外部圖表” before any third-party frame is created.
3. Show one TradingView symbol chart at a time. Switching an underlying replaces the existing
   frame instead of creating several simultaneous widgets.
4. Add ordinary external links for Yahoo Finance, Google Trends, Cboe delayed quote pages and
   Options Industry Council educational/options calculator pages.
5. Mark the widget and links as third-party resources, state that their values do not enter the
   calculation, and show a privacy/referrer notice before loading.
6. If a corporate network blocks the widget, preserve the Phase 1 analysis and show a non-blocking
   fallback link.

### Technical design

- New frontend module: `market-resources.mjs`.
- Add it to `backend/scripts/prepare-assets.mjs`; do not add an npm dependency.
- Create the iframe only after consent, with the narrowest supported sandbox/referrer policy.
- Use a strict symbol mapping function; never concatenate unsanitized user text into executable
  widget code.
- Keep a per-browser consent preference only. Do not store consent or viewed symbols in D1.
- Review the existing Content Security Policy before deployment. Any new host must be narrowly
  allowlisted and documented; do not relax unrelated directives.
- No server proxy and no periodic polling in Phase 2.

### Verification

- Widget is absent before opt-in.
- Opt-out/blocked widget leaves Phase 1 fully operational.
- One widget maximum per analysis page.
- Invalid/unmapped Bloomberg suffix fails closed and offers a neutral external search link only.
- No third-party request includes RFQ ID, quote ID, branch, employee number or issuer quote value.
- Mobile/tablet/desktop layout and keyboard navigation.

### Risks and controls

| Risk | Control |
| --- | --- |
| Third party learns the selected ticker/IP | Explicit opt-in and privacy text |
| Widget blocked by bank network | Non-blocking fallback link |
| Display price mistaken for calculation input | Strong source separation; never bind widget data to Phase 1 |
| Terms/licence violation | Embed/link only under provider terms; no extraction or scraping |

### Phase 2 source decision after reviewing the 2019 Python article

The article correctly separates company, fundamental, price/volume, macroeconomic and search-
interest data, and it highlights symbol normalization and scheduled refreshes. Its implementation
examples are historical research examples, not current production API contracts:

- `yfinance` is not an official Yahoo Finance API. Yahoo's current terms restrict automated
  collection without prior permission, and the Yahoo developer catalogue does not offer a
  supported Finance market-data endpoint. Yahoo Finance is therefore link-only.
- `pytrends` relies on an unofficial Google Trends interface. Google's official Trends API is
  currently limited to approved alpha testers. Google Trends is therefore link-only until this
  project receives official API access.
- FRED has a documented key-based API and remains suitable for Phase 3 after a Secret is provided.
- SEC EDGAR provides keyless JSON APIs and remains suitable for Phase 3 under SEC fair-access
  requirements.

This classification is recorded in ADR 0021 and prevents a research scraper from becoming an
unmonitored financial-data dependency.

Primary references:

- TradingView widget documentation: <https://www.tradingview.com/widget-docs/getting-started/>
- TradingView data FAQ: <https://www.tradingview.com/widget-docs/faq/data/>
- Cboe delayed quotes: <https://www.cboe.com/delayed_quotes/all/quote_table/>
- OIC calculator: <https://www.optionseducation.org/options-calculator-for-all-investors>
- Yahoo Terms of Service: <https://legal.yahoo.com/xw/en/yahoo/terms/otos/index.html>
- Yahoo developer APIs: <https://developer.yahoo.com/api/>
- Google Trends API alpha: <https://developers.google.com/search/apis/trends>

## Phase 3 — Worker-normalized SEC and FRED context

### Goal

Add issuer-independent company filings and macro context through a controlled Worker cache. This
phase still does not provide a tradeable stock/option price.

### Approved release boundary

The user approved migration `0011`, the FRED Secret/configuration boundary, cache retention,
monitoring, cleanup, a 50-user concurrent test and the following first-release fields:

- SEC company identity: CIK, legal name, exchange and ticker;
- SEC recent filings: latest five 10-K, 10-Q and 8-K filings with filing date and official link;
- FRED: latest observation, prior observation, change, units and observation date for `DGS10`,
  `FEDFUNDS` and `VIXCLS`;
- no Yahoo Finance or Google Trends values in the Worker response until approved official access
  exists.

The key value is ready but is not stored in the repository. It must be entered only through
Cloudflare Secret management before the first production deployment.

### Implemented data model

`market_instruments`

- `symbol_normalized TEXT PRIMARY KEY`
- `company_name TEXT NOT NULL`
- `exchange TEXT`
- `sec_cik TEXT`
- `sec_ticker TEXT`
- `country TEXT`
- `updated_at TEXT NOT NULL`

`public_data_cache`

- `cache_key TEXT PRIMARY KEY`
- `source TEXT NOT NULL`
- `symbol TEXT`
- `data_type TEXT NOT NULL`
- `normalized_payload_json TEXT NOT NULL`
- `source_as_of TEXT`
- `fetched_at TEXT NOT NULL`
- `expires_at TEXT NOT NULL`
- `stale_until TEXT NOT NULL`
- `etag TEXT`
- `status TEXT NOT NULL`
- `last_error_code TEXT`
- `refresh_lease_expires_at TEXT`
- `updated_at TEXT NOT NULL`

`market_context_rate_limits`

- hashed `request_key TEXT PRIMARY KEY`
- `scope USER|IP`
- bounded window/count timestamps

Indexes:

- unique `cache_key`;
- `(source, symbol, expires_at)`;
- `(expires_at)`.

Do not store a complete SEC CompanyFacts payload in one D1 row. Normalize only the small fields the
UI actually displays; use private R2 for an approved raw/large cache if later required.

### Implemented API

- `GET /api/v1/market/instruments/:symbol/context`
- owner-authenticated, rate-limited, and independent from RFQ ownership;
- returns normalized source records with `source`, `sourceAsOf`, `fetchedAt`, `expiresAt`,
  `isStale` and safe error codes;
- never returns API keys, raw upstream errors or unrestricted upstream payloads.

ADMIN-only cache health:

- `GET /api/v1/admin/market-context-health`
- returns aggregate source/status/stale/expired/rate-limit counts only.

### Fetch/cache flow

1. Normalize the requested public ticker against `market_instruments`.
2. Read a fresh shared cache row first.
3. On miss/expiry, one Worker request obtains and normalizes the upstream response.
4. Use conditional requests/ETag when supported.
5. Serve stale-but-labelled data for a bounded period if the upstream source is temporarily down.
6. Coalesce concurrent misses so 50 users requesting the same ticker do not generate 50 upstream
   calls.
7. Write only when cache content/expiry changes — never on every page view or slider change.

Implemented TTL:

- instrument mapping: 30 days;
- SEC filing index and normalized company identity: 24 hours;
- FRED observations: 24 hours.
- stale fallback: no more than 7 days and always labelled stale.

### Security and operating controls

- Store `FRED_API_KEY` only as a Cloudflare Secret.
- Identify the SEC client according to SEC fair-access guidance.
- Bind upstream hosts exactly; reject arbitrary proxy URLs.
- Apply per-user and per-IP rate limits.
- Store no RFQ ID, quote ID, branch or user identity in shared public cache rows.
- Return timestamps and stale status to the UI.
- Synthetic fixtures only; no real RFQ or personal data in tests.

### Verification

- Synthetic tests cover fresh-cache reuse, stale fallback, upstream failure, strict symbol
  normalization, SEC filing filtering, FRED missing observations, ADMIN authorization, cleanup,
  same-key miss coalescing and 50 simultaneous users.
- The complete repository suite, typecheck and dry-run build remain mandatory before handoff.
- Production D1 query/write and upstream latency evidence remain unverified until explicit
  migration/Secret/deployment authorization.

Primary references:

- SEC EDGAR APIs: <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>
- FRED API: <https://fred.stlouisfed.org/docs/api/fred/overview.html>

## Phase 4 — capacity, monitoring, retention and production hardening

### Goal

Keep market context sustainable as RFQ volume grows toward 10,000 trades per month and 50
concurrent users.

### Capacity baseline and interpretation

A read-only production measurement on 2026-07-28 recorded 10 users, 55 RFQs / 205 trades,
406 inbound messages, 1,693 issuer quotes, 637 ranking results, 2,488 audit events, 149 artifacts,
and D1 size 6,815,744 bytes. Cloudflare reported 8,228 read queries, 3,416 write queries,
377,492 rows read and 10,862 rows written during the preceding 24 hours. This is a point-in-time
capacity baseline, not a user-activity audit.

This sample must be re-measured before Phase 4 implementation. Its rough density (about 33 KB per
trade across the whole application) implies that 10,000 trades could add roughly 330 MB before
indexes/retention variation. Therefore a 500 MB free D1 database is not a safe long-term 365-day
store at that volume. Existing email, quote and audit records are a larger capacity driver than
the Phase 1 browser-only calculations or a shared SEC/FRED cache.

### Monitoring dashboard

Track D1 size/growth, rows read/written, cache hit/miss/stale rates, upstream success/latency,
analysis-input API traffic/latency/errors, active users and cache cleanup failures.

The implemented first step is an ADMIN-only safe cache-health panel plus structured Worker error
events. It intentionally avoids per-view D1 analytics. Plan-level D1/Worker measurements remain in
Cloudflare observability and must be recorded after rollout.

Alert thresholds:

- 70% of current D1 plan capacity: capacity review and retention forecast;
- 85%: freeze nonessential cache expansion and execute approved archive/plan-upgrade action;
- repeated upstream throttling: lengthen TTL and disable refresh-on-demand without breaking
  Phase 1.

### Retention and storage design

- Keep market cache shared, short-lived and reconstructable.
- Purge expired cache rows with an idempotent scheduled job.
- Do not write per-view analytics into D1; use aggregated Cloudflare observability where approved.
- Continue the existing RFQ/mail/artifact retention policy.
- Before sustained 10,000-trade months, approve paid D1 capacity, annual/archive databases with an
  owner-authorized archive API, or an approved sharding boundary.
- Never silently delete financial records to stay inside a free tier.

### Load and incident work

- The automated public-context test exercises 50 concurrent distinct users and confirms one shared
  SEC instrument/filing refresh path. Existing RFQ/analysis-input ownership tests remain unchanged.
- A production-like mixed result/analysis/public-context load test is still required after the
  Secret and migration exist in a non-production or explicitly approved environment.
- Confirm owner isolation under concurrent quote selections.
- Test cache stampede, upstream timeout, cleanup retry and D1 saturation.
- Add a kill switch for Phase 2 widgets and Phase 3 external context while keeping RFQ/ranking and
  Phase 1 functional.
- Document deploy, health verification, rollback, stale-cache purge and upstream outage response.
- Record cost/capacity evidence after each production rollout.

The implemented runtime kill switch is `MARKET_CONTEXT_ENABLED`. Phase 2 TradingView remains
explicit opt-in and can be removed by rolling back the static asset deployment; it has no Worker
polling or automatic load.

## Recommended implementation order

1. Phase 2 frontend-only opt-in panel and privacy/CSP review.
2. Re-measure D1 and traffic; approve Phase 3 schema/Secret/API contract.
3. Phase 3 migration, Worker cache and synthetic tests.
4. Phase 4 load test and observability before broad rollout.
5. Only after measured demand, decide whether a paid D1 plan or archive boundary is necessary.
