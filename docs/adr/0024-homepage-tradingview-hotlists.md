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

1. **Hot lists move to the homepage.** `index.html` gains a collapsed 「美股／日股熱門榜」 panel
   above the trade-input workspace, mirroring TradingView's own hierarchy: a market selector
   (美股 → NASDAQ, NYSE, NYSE ARCA, OTC ／ 日股 → TSE, NAG, FSE, SAPSE) above five rankings
   (波動最大, 大型股, 現金最多, 成交最活躍, 營收最高). The five rankings are **links to
   TradingView's own pages** and work for both markets. For 美股 only, an embedded hotlists widget
   additionally shows live 活躍／漲幅榜／跌幅榜 rows inline. It runs in both runtime modes because
   it is pure client-side markup in `app.js` and `market-resources.mjs`.
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
5. **Markets are a fixed allowlist checked with own-property lookups.** Nothing a user types
   reaches the widget configuration, and an unknown key fails closed.
6. **Japan is link-only, deliberately.** See the measured evidence below.
7. **A non-blocking fallback link** to TradingView's public market-movers page is always shown, for
   networks that block embedded content.

## Measured widget behavior (2026-07-29, against the live widgets)

The first implementation used TradingView's **screener** widget with `market: "us"`/`"japan"`. It
rendered the widget chrome but showed 「沒有商品符合您的條件」 in production. Probing the live
widgets with TradingView's own embed tags established why:

| Configuration | Result |
| --- | --- |
| `hotlists` `exchange: "US"` | **Real rows**, with built-in 活躍/漲幅榜/跌幅榜 tabs |
| `hotlists` `exchange: "NASDAQ"` (control) | Different rows to `US` — the parameter *is* honoured |
| `hotlists` `exchange: "TSE"` | Refused: "This exchange is not available for widget" |
| `hotlists` `exchange: "JP"` / `"JPX"` / `"TYO"` | Accepted, but returns **US** rows |
| `screener` `defaultScreen: "most_volatile"` | Preset recognized, but returns **zero** rows |
| `screener` `large_cap` / `highest_cash` / `most_active` / `highest_revenue` | Not recognized — falls back to an unranked 18,057-symbol "General" list |
| `screener` `market: "japan"` (any preset) | Ignored — returns AAPL priced in **USD** |
| `market-overview` with `TSE:` symbols | Symbols resolve to errors, no prices |

The five named rankings (Most volatile, Large cap, Highest cash, Most active, Highest revenue) and
the USA/JAPAN exchange grouping exist on **TradingView's website**, not in the free embeddable
widgets. All ten pages (five rankings × two markets) return HTTP 200 and are therefore linked
directly.

Two conclusions follow. The screener widget is not usable for this purpose at all, and
**TradingView's free widgets have no Japan hot list**. The `JP`/`JPX`/`TYO` values are the dangerous
case: they look like they work while showing US stocks under a Japan label. In a trading tool that
is worse than showing nothing, so those values are not used and Japan renders an explicit
explanation plus a link to TradingView's Japan market-movers page.

The shipped configuration was then verified end to end: the direct hot-list URL with
`exchange: "US"`, `locale=zh_TW`, `referrerPolicy="no-referrer"` and the production sandbox tokens
returns live rows with Chinese labels.

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
- Japan users get an honest explanation and a working link instead of a silently wrong embed. If a
  licensed Japan hot-list source is obtained later, only `HOTLIST_MARKETS.japan` needs to change.
- **Do not "fix" Japan by setting `exchange` to `JP`, `JPX` or `TYO`.** They render populated rows
  and will pass a casual check, but the rows are US stocks.
