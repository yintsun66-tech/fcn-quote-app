# ADR 0024: Homepage TradingView hot lists and Alpha Vantage narrowed to previous close

Status: Accepted
Date: 2026-07-29

Supersedes the market-idea portion of ADR 0023. The SEC and previous-close portions of ADR 0023
remain in force.

## Context

ADR 0023 added an Alpha Vantage `TOP_GAINERS_LOSERS` panel plus derived rankings (20-day historical
volatility, relative volume, absolute move, composite heat) to the authenticated FCN analysis page.
Two problems emerged.

**The provider could not sustain it.** The first production requests returned an Alpha Vantage
`Information` envelope and produced no normalized payload. Free Alpha Vantage keys are tightly
throttled, and the configured safety cap is 24 attempted requests per UTC day for the whole
application. A market-movers list is exactly the kind of shared, high-frequency read that exhausts
that budget while delivering the least issuer-specific value.

**It was in the wrong place.** Hot lists exist to help a user *form* a trade idea, which happens
before an RFQ exists. Putting them behind a finalized ranking meant they were only reachable after
the decision they were meant to inform. The derived "composite heat" ranking also only compared
symbols the cache happened to hold, so it was never a market-wide ranking despite reading like one.

TradingView's screener widget is free, client-rendered, market-wide, and already an approved
Phase 2 third-party resource in this application.

## Decision

1. **Hot lists move to the homepage and are served by TradingView.** `index.html` gains a
   collapsed 「美股／日股熱門榜」 panel above the trade-input workspace, offering markets `us` and
   `japan` across four screens (`volume_leaders`, `top_gainers`, `top_losers`, `most_capitalized`).
   It runs in both runtime modes because it is pure client-side markup in `app.js` and
   `market-resources.mjs`.
2. **Alpha Vantage is narrowed to the previous close.** The per-symbol
   `TIME_SERIES_DAILY&outputsize=compact` path that fills 「輸入標的參考現價」 is unchanged.
   `TOP_GAINERS_LOSERS`, the movers cache, the cached-universe rankings, the composite heat score
   and `GET /api/v1/market/ideas` are removed.
3. **The Phase 2 consent rule still applies.** No third-party frame is created until the user
   ticks consent, so simply opening the quote page discloses nothing to TradingView. Consent is
   stored per browser under `HOTLIST_CONSENT_KEY`; clearing it unloads any active frame.
4. **The widget URL is built directly**, as the existing chart already does, so TradingView's
   loader script never executes in the application origin. Iframe attributes match the deployed
   Phase 2 chart exactly (`referrerPolicy="no-referrer"` plus the same sandbox token set).
5. **Markets and screens are fixed allowlists checked with own-property lookups.** Nothing a user
   types reaches the widget configuration, and an unknown key fails closed.
6. **A non-blocking fallback link** to TradingView's public market-movers page is always shown, for
   networks that block embedded content.

## Consequences

- The daily Alpha Vantage budget now serves only per-symbol previous closes — the one thing the
  application genuinely needs from it and the one thing a widget cannot supply, because that value
  seeds a calculation rather than being displayed.
- Hot lists no longer depend on a provider key, a D1 cache row, a Worker request or the daily
  budget, and they stop being blocked by the unresolved Alpha Vantage entitlement issue.
- Hot-list content is market-wide rather than limited to symbols already in cache, and it is
  correctly no longer presented as a ranking this application computed.
- Migration `0012` and `market_provider_daily_usage` stay in place; only the movers cache rows stop
  being written. No migration, schema change or Secret change is required.
- Hot-list values are display-only and reach no RFQ term, ranking, mail or quote card — unchanged
  from the Phase 2/3 rules.
- **Not verified:** whether TradingView serves populated screener rows for `market: "japan"` from
  the production domain. The widget accepts the parameter and renders its chrome, but a local probe
  cannot confirm data because widget providers may gate content by host. Verify on
  `app.yintsun66.com` after deployment.
