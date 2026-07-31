# ADR 0020: Owner-scoped FCN market and risk analysis

Status: Accepted
Date: 2026-07-28

## Context

The RFQ result page already lets an owner inspect ranked issuer quotes and create a quote image.
Users also need an educational view that translates the selected FCN percentages into indicative
price levels and downside scenarios. This feature must not weaken quote authorization, alter a
ranking snapshot, imply that user-entered prices are live market data, or mix terms from different
issuers.

Phase 1 deliberately has no external market-data source. It therefore cannot claim a live price,
an official fixing, a valuation, or exact contractual cash flow.

## Decision

1. Add the owner-only endpoint
   `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/analysis-input`.
2. Reuse `authorizeCardQuote`, the same server-side authorization used by quote-card rendering.
   The browser-supplied quote ID is accepted only when the owner has a completed RFQ and the quote
   is in economic ranks 1–4 or the current custom-fifth candidate set.
3. Return the requested trade, the exact authorized canonical issuer quote, the current ranking
   version and resolved analysis terms. A missing non-target quote term may fall back only to the
   immutable requested trade — never to another issuer.
4. Phase 1 supports FCN only. DAC/DRA returns `ANALYSIS_PRODUCT_UNSUPPORTED` and does not silently
   reuse FCN assumptions.
5. The analysis view is a separate responsive application route:
   `/?rfq=<id>&view=analysis&trade=<tradeCode>&quote=<quoteId>`.
6. Indicative spot prices and their user-entered timestamps remain in browser `localStorage`,
   keyed by RFQ, trade and normalized underlying. No D1 row, audit event or server log is created
   for slider/input changes.
7. Before fixing, the page labels derived strike/KO/KI prices as calculations:
   `spot × percentage / 100`. It never labels them as official fixing levels.
8. Multi-underlying scenarios use worst-of logic; they never average underlying performance.
9. EKI terminal observation and AKI path dependence remain separate. AKI always shows both
   “not touched during life” and “touched during life” branches rather than inferring path history
   from the terminal price.
10. The fixed Phase 1 grid is −50%, −40%, −30%, −20%, −10%, 0%, +10%, +20%. Its descriptions are
    directional and repeatedly defer final cash flow to the formal term sheet.
11. Changing the selected issuer loads another independently authorized quote. Analysis never
    changes ranking, quote status, artifacts or the quote-card model.

## Consequences

- No migration, Cloudflare binding, environment variable, dependency or lockfile change is needed.
- A user can repeat analysis without adding D1 writes or shared backend compute beyond the
  owner-scoped read endpoint.
- Browser storage is device/browser-specific and may be cleared by the user; it is convenience
  state, not a record of advice or a market-data archive.
- The analysis remains useful offline after its inputs are loaded, but it is intentionally not a
  live quote service.
- Adding third-party widgets or public-data APIs requires the staged controls in
  `docs/backend/market-analysis-roadmap.md`.

## Evidence / implementation links

- `backend/src/analysis.ts`
- `backend/src/artifacts.ts`
- `backend/src/index.ts`
- `market-analysis.mjs`
- `backend-client.js`
- `backend/test/market-analysis.test.ts`
- `backend/test/ranking-integration.test.ts`
