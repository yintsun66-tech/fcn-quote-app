# ADR 0023: Alpha Vantage end-of-day prices and market ideas

Status: Accepted
Date: 2026-07-29

## Context

The FCN analysis page needs the previous US trading day's closing price and useful underlying
ideas. A 1Y ATM implied-volatility feed is not required for the proof of concept. The supported
underlying pool is small enough for Alpha Vantage's free request allowance, while FRED macro data
does not satisfy the selected-price use case.

Alpha Vantage's free service is limited and its licence is not automatically an institutional
multi-user licence. The application therefore needs a hard shared request budget, reconstructable
cache, visible source dates and a production-licensing gate.

## Decision

1. Stop issuing FRED API requests. Keep SEC company/filing context and the existing opt-in
   TradingView chart.
2. Use only the fixed Alpha Vantage HTTPS origin and these functions:
   - `TIME_SERIES_DAILY` with `outputsize=compact` for the latest completed daily OHLCV;
   - `TOP_GAINERS_LOSERS` for end-of-day gainers, losers and most-active lists.
3. Store `ALPHA_VANTAGE_API_KEY` only as a Cloudflare Secret. Never return, log or commit it.
4. Cache each normalized equity and the global mover list for 24 hours, with the existing visibly
   labelled seven-day stale fallback. Cache rows are shared across users and contain no RFQ,
   quote, employee, branch or user identity.
5. Enforce a Worker-side daily provider budget of 24 attempted requests. Every provider attempt,
   including a failed one, consumes one budget unit. Concurrent requests for one cache key remain
   coalesced.
6. Derive the following from the same daily series without more provider requests:
   - daily percentage change;
   - 20-day annualized historical volatility using sample standard deviation of log returns and
     `sqrt(252)`;
   - previous-day volume divided by the prior 20-day average volume;
   - 20-day high/low range.
7. Build a clearly labelled cached-underlying heat score using percentile ranks:
   relative volume 40%, absolute daily change 35%, historical volatility 25%.
8. Automatically place the provider's latest completed close into an empty browser analysis spot
   field. Never overwrite a saved manual value; offer an explicit “套用前收” action instead.
   Provider values may affect browser-only scenarios after display, but never RFQ terms, issuer
   ranking, quote-card data or artifacts.
9. Add authenticated `GET /api/v1/market/ideas` for the normalized mover lists and derived
   cached-underlying rankings.
10. Before broader institutional or multi-user production use, obtain written confirmation that
    the selected Alpha Vantage plan/licence permits that use.

## Consequences

- Migration `0012_alpha_vantage_market_data.sql` expands the reconstructable cache source check and
  adds a small daily provider-usage counter. It does not alter RFQ, email, quote, ranking,
  authentication or artifact records.
- `FRED_API_KEY` is no longer a required Worker Secret. Historical FRED cache rows may remain until
  normal expiry/cleanup but are never refreshed.
- The feature remains non-blocking: Alpha Vantage failure leaves manual spot entry, SEC, RFQ,
  ranking and quote images operational.
- Free allowance supports at most 23 unique daily symbols plus the one daily mover request under
  the configured safety cap. Cache misses beyond the cap fail closed instead of silently
  overspending.

## Evidence / implementation links

- `backend/migrations/0012_alpha_vantage_market_data.sql`
- `backend/src/market-context.ts`
- `backend/src/index.ts`
- `backend-client.js`
- `styles.css`
- `backend/test/market-context.test.ts`
- `docs/runbooks/market-context-operations.md`
