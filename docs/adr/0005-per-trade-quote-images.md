# ADR 0005: One quote image per trade

Status: Accepted
Date: 2026-07-23

## Context

The original design grouped rank-one trades by winning issuer and produced one multi-trade
image per issuer (`docs/backend/architecture.md`, "Multi-issuer winners" and the Browser
Rendering section). The user asked for **one image per trade**, reachable from a hyperlink next
to each trade's winning issuer name in the results view, so a single trade's quote can be shared
on its own.

## Decision

1. **One image per trade** — each image is the trade's deterministic rank-1 winner (earliest
   valid receipt on ties). A trade with no valid quote produces no image.
2. **Re-key the artifact tables by trade.** `generated_artifacts` and `image_render_jobs` were
   uniquely keyed by `(ranking_run_id, issuer)`, which cannot hold multiple trades won by the
   same issuer. Migration 0008 rebuilds both tables with a `trade_code` column and
   `UNIQUE (ranking_run_id, trade_code)`; the winning `issuer` stays on each row. Prior
   issuer-grouped rows are dropped — they do not map to the per-trade model and are regenerable
   via recalculation; their R2 objects expire under the existing 90-day lifecycle.
3. **Render** fetches the trade's `is_image_winner = 1` quote and renders the existing quote card
   (layout unchanged). The R2 object key changes from `.../{issuer}.png` to `.../{tradeCode}.png`.
4. **APIs** expose `tradeCode` on each artifact (status + list); `isDefault` is removed (every
   per-trade artifact is that trade's winner). The frontend links the trade's image next to the
   rank-1 issuer name in the rankings table and shows a per-trade download list; the previous
   issuer-switcher gallery is removed.

## Consequences

- Up to 20 render jobs per RFQ (one per trade) instead of up to 8 issuer groups — more Browser
  Rendering load. The user accepted this; free-plan capacity remains a known gap to watch under
  real completion bursts (image jobs are queued and retryable).
- Reverses the "group winning trades by issuer" approved decision; `architecture.md` is updated.
- No email, authentication, or ranking-semantics change. The only public-API change is the
  artifact response shape (added `tradeCode`, removed `isDefault`).

## Evidence / implementation links

- `backend/migrations/0008_trade_artifacts.sql`
- `backend/src/ranking.ts` (per-trade winners → `persistArtifacts`), `backend/src/artifacts.ts`
  (per-trade render), `backend/src/results.ts` (`tradeCode` in status/list), `backend/src/types.ts`
  (`ImageRenderJob.tradeCode`)
- `backend-client.js` (inline per-trade link + per-trade download list)
- `backend/test/ranking-integration.test.ts`
