# ADR 0007: Top-five ranking and ranked-quote images

Status: Accepted  
Date: 2026-07-23

## Context

The results view previously persisted and displayed only the first three economic ranks. It also
allowed at most one artifact per trade, always for the deterministic rank-one quote. Users need
to compare the first five economic ranks, receive the rank-one image immediately, and optionally
create an image for another displayed issuer.

## Decision

1. Ranking retains the first five **economic ranks**. Quotes with equal economic value share the
   same rank and all ties at rank five remain visible, so a trade can display more than five rows.
2. Finalization still selects exactly one deterministic `is_image_winner` per trade: the earliest
   valid receipt in the rank-one tie. It creates and queues only that quote's artifact initially.
3. Every persisted top-five result may subsequently receive its own private image. The additive
   endpoint
   `POST /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/artifact`
   verifies ownership, finalization, trade membership and current-ranking membership. The prior
   per-trade endpoint remains a compatible rank-one shortcut.
4. Migration 0009 expands `ranking_results.economic_rank` to 1–5 and keys artifacts/jobs by
   `(ranking_run_id, trade_code, quote_id)`. Existing migration-0008 artifacts are preserved by
   mapping each one to its persisted deterministic rank-one quote.
5. Artifact creation is idempotent. R2 keys include the quote ID so two ranked issuers for the
   same trade cannot overwrite each other.

## Consequences

- Rank-five ties can produce more than five displayed quotes and optional image choices.
- Browser Rendering work remains one job per trade at finalization; additional cost occurs only
  when the owner explicitly requests another ranked quote's image.
- Artifact list responses add `quoteId`, `rank`, and `isDefault`. Existing response fields and the
  old rank-one mutation endpoint remain available.
- `allTradesHaveThreeValidQuotes` remains in the provisional response for compatibility;
  `allTradesHaveFiveValidQuotes` drives the updated frontend readiness cue.

## Evidence / implementation links

- `backend/migrations/0009_top_five_quote_artifacts.sql`
- `backend/src/ranking.ts`, `backend/src/artifacts.ts`, `backend/src/results.ts`
- `backend/src/coordinator.ts`, `backend/src/types.ts`, `backend/src/index.ts`
- `backend-client.js`
- `backend/test/ranking.test.ts`, `backend/test/ranking-load.test.ts`,
  `backend/test/ranking-integration.test.ts`
