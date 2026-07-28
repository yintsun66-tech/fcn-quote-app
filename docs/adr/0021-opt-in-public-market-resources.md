# ADR 0021: Opt-in public market resources

Status: Accepted
Date: 2026-07-28

## Context

The owner-scoped FCN analysis page needs public market references, but Phase 1 intentionally keeps
user-entered spot prices separate from live data. Loading a third-party chart can disclose the
user's IP address, browser characteristics and selected public ticker. Historical examples based
on `yfinance` and `pytrends` do not establish a production licence or a stable official API.

Yahoo's current terms restrict automated data collection without prior permission, and Yahoo's
developer catalogue does not list an official Yahoo Finance market-data API. The official Google
Trends API is currently limited to approved alpha testers. Neither source may be scraped by this
application.

## Decision

1. Add a collapsed public-resource panel to the FCN analysis page.
2. Do not create a third-party frame until the user checks a privacy acknowledgement and presses
   the load button. Remember only the acknowledgement in browser local storage.
3. Load at most one TradingView widget at a time inside a sandboxed `srcdoc` iframe with a
   no-referrer policy. Switching underlyings replaces the existing frame.
4. Pass only a strictly mapped public market symbol. Never include an RFQ ID, quote ID, employee
   number, branch, issuer, quote value or user identity in a third-party URL.
5. Initially support Bloomberg `UW`, `UN` and `UA` US-equity suffixes. Unknown or unsafe symbols
   fail closed and receive a neutral TradingView search link only.
6. Provide ordinary user-initiated links to Yahoo Finance, Google Trends, Cboe delayed quotes and
   the Options Industry Council. Do not fetch, parse, cache or persist their content.
7. Third-party content remains display-only and never becomes an input to analysis, ranking,
   quote cards or artifacts.
8. A blocked widget is non-fatal; Phase 1 analysis and all ordinary links remain usable.

## Consequences

- Phase 2 adds no D1 migration, Cloudflare binding, Secret, npm dependency or lockfile change.
- The user's IP and browser data are disclosed to TradingView only after opt-in. Yahoo, Google,
  Cboe and OIC receive a request only when the user follows their link.
- Yahoo Finance and Google Trends can move to a Worker provider only after explicit licence or
  official API access is documented in a new ADR.
- External data can be delayed or unavailable and must retain its provider's own labelling.

## Evidence / implementation links

- `market-resources.mjs`
- `backend-client.js`
- `styles.css`
- `backend/test/market-resources.test.ts`
- `docs/backend/market-analysis-roadmap.md`
