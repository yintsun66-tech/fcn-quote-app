# ADR 0017: Client-side quote-card rasterization

Status: Accepted
Date: 2026-07-27

## Context

ADR 0016 stopped rendering rank-one images automatically, which cut Browser Rendering demand to
images people actually ask for. It did not remove the structural problem: every image still
consumed a centrally metered, concurrency-limited resource (`fcn-image-render` at
`max_concurrency: 3`, plus a per-day browser-time budget), and that resource is shared by all
users. Demand therefore still grows with headcount while supply stays fixed.

The static GitHub-Pages mode has never had this problem. `app.js` rasterizes the on-screen quote
sheet with html2canvas in the user's own browser: each user contributes their own CPU, so total
capacity grows with the number of users instead of competing for a fixed pool, and nothing is
stored server-side.

The backend path was not redundant, though. It provides three properties the static mode lacks and
which must be preserved: server-decided authorization (the browser must never be able to nominate
an arbitrary quote id), a consistent card independent of the viewer's browser, and a retrievable
copy for the owner.

## Decision

1. **Add `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/card`** (and the rank-one form
   without `/quotes/:quoteId`). It returns the fully rendered quote-card document for a quote the
   **server** authorizes.
2. **Authorization is shared, not duplicated.** `authorizeCardQuote` is now the single path used by
   both this endpoint and `requestTradeArtifact`: RFQ ownership, `COMPLETED` status, a current
   ranking run, and membership of economic ranks 1–4 or the custom-fifth candidate set. A quote id
   supplied by the browser is only ever accepted if the server independently ranks it there.
3. **The card template and data query are shared.** `loadCardTrades` and `renderQuoteCardHtml`
   serve both the client-rendered card and the Browser Rendering artifact, so the two cannot drift.
   `QUOTE_CARD_WIDTH_PX` is exported and used by both the render viewport and the client.
4. **The HTML is returned inside JSON**, not as a rendered `text/html` response, so the API origin
   never serves renderable markup.
5. **The client rasterizes it.** The on-demand `backend-image.mjs` module loads the document into an offscreen
   `sandbox="allow-same-origin"` iframe — which lets html2canvas read the DOM while keeping scripts
   blocked — waits for `document.fonts.ready`, rasterizes with the same phone-size profile on every
   device (`scale` capped at 1.5 and canvas area capped at 4M pixels), and produces the PNG via
   `canvas.toBlob`. Nothing is queued and nothing is written to R2.
6. **A server-side fallback is retained.** html2canvas is self-hosted under `vendor/` and is loaded
   only after a PNG request through `html2canvas-loader.mjs`. When it cannot be loaded or local
   rendering fails, the button falls back to the existing server-rendered artifact request.

## Consequences

- Image capacity now scales with the number of users instead of competing for three shared
  browsers. The 30–50 user projection that exceeded the free-plan daily budget no longer applies to
  the default path.
- Images are produced immediately, with no queue latency and no exposure to the 7.3%
  `BROWSER_RENDER_FAILED` rate observed in production.
- Default-path images are **not** persisted: no `generated_artifacts` row, no R2 object, no
  90-day expiry. The download is the deliverable. When an archived, server-hashed copy is required,
  the artifact path still exists and is unchanged.
- Output pixels now depend on the viewer's font rasterization. The card already specified a system
  font stack (`Arial, "Microsoft JhengHei", "Noto Sans TC"`), so server rendering was never
  byte-canonical either; ADR 0018 (server-generated SVG) is the step that makes the artifact itself
  exactly reproducible.
- No D1 migration, schema change, dependency, lockfile, mail format, authentication rule or binding
  change is required. ADR 0036 later made the existing self-hosted html2canvas load on demand.
