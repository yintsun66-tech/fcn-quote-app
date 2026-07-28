# ADR 0022: Worker-normalized SEC and FRED market context

Status: Accepted
Date: 2026-07-28

## Context

The FCN analysis page benefits from issuer-independent company filings and macroeconomic context.
These public records must not become pricing inputs, and fifty concurrent users must not each call
the same upstream service. SEC requires a declared client identity and fair access. FRED requires
an API key and its attribution notice. Yahoo Finance and Google Trends still lack approved
programmatic access for this project.

## Decision

1. Add an authenticated, display-only endpoint:
   `GET /api/v1/market/instruments/:symbol/context`.
2. Fetch only fixed official HTTPS origins: SEC ticker/submissions/archive services and FRED.
   The Worker is not a general URL proxy.
3. Normalize only CIK, company name, exchange, ticker, the latest five 10-K/10-Q/8-K filings,
   and DGS10/FEDFUNDS/VIXCLS latest/prior/change/units/date.
4. Store the FRED API key only as the `FRED_API_KEY` Cloudflare Secret. Use the declared SEC
   identity `FCN Quote App rfq@yintsun66.com`.
5. Share normalized D1 cache rows across users. Instrument identity expires after 30 days;
   SEC/FRED context expires after 24 hours and may be served, clearly labelled stale, for up to
   seven more days.
6. Coalesce same-isolate misses and use a short D1 refresh lease across isolates. Upstream failure
   returns bounded stale data or a safe unavailable envelope; it never exposes an upstream body,
   request URL or Secret.
7. Enforce hashed per-user and per-IP request limits. Shared cache rows contain no RFQ, quote,
   branch, employee number or user identity.
8. Clean expired cache and old rate-limit rows from the existing scheduled handler without
   allowing cleanup failure to interrupt RFQ recovery.
9. Expose cache health counts only to ADMIN. Do not expose payloads or keys in that endpoint.
10. Keep Yahoo Finance and Google Trends as user-initiated links. Do not add `yfinance`,
    `pytrends`, unofficial endpoints or a production dependency.
11. Public context never changes RFQ input, ranking, risk calculations, quote-card data or
    generated artifacts.

## Consequences

- Migration `0011_market_context.sql` adds reconstructable public-cache, instrument and hashed
  rate-limit tables. It does not alter existing RFQ or financial tables.
- `MARKET_CONTEXT_ENABLED` is an immediate Phase 3 kill switch. Disabling it preserves Phase 1,
  RFQ, mail, ranking and quote images.
- The API can remain useful during a bounded upstream outage by visibly serving stale data.
- FRED requests cannot operate until the production Secret exists. The Secret must never be
  entered into chat, source, Wrangler configuration or Git.
- D1 writes are bounded to cache refreshes and rate-limit counters, not analysis slider changes
  or per-view analytics.

## Evidence / implementation links

- `backend/migrations/0011_market_context.sql`
- `backend/src/market-context.ts`
- `backend/src/admin-market.ts`
- `backend/test/market-context.test.ts`
- `docs/runbooks/market-context-operations.md`
