# Phase 5–7 production baseline

Implemented: 2026-07-21
Branch: `feature/backend-foundation`

## Workflow

1. `POST /api/v1/rfqs` creates 1–20 immutable trades.
2. Validation freezes the rows and enforces exactly one target field.
3. Send creates eight outbound batches and an eleven-issuer expectation snapshot.
4. The final successful outbound batch starts one named RFQ Durable Object and sets the ten-minute alarm.
5. Inbound MIME is stored privately, parsed, normalized through an issuer profile and matched to a trade.
6. All-terminal or deadline finalization enqueues a versioned ranking run.
7. Rank-one trades are grouped by issuer and rendered into private R2 PNG artifacts.
8. The owner polls status/results and downloads artifacts through the authenticated Worker.

Late replies are stored but do not overwrite a finalized run. Recalculation creates a new version.

## Ranking rules

| Target | Direction |
| --- | --- |
| Coupon | highest first |
| Upfront / NotePrice | lowest first |
| Strike | lowest first |
| KO Barrier | lowest first |
| KI Barrier | lowest first |

Only `VALID` finite normalized values participate. Equal values retain the same economic rank; receipt time then opaque quote ID determines display order. The earliest rank-one receipt is the deterministic image winner while the UI still labels the tie.

## Production resources

- Worker/custom domains: `api.yintsun66.com`, `app.yintsun66.com`
- D1: `fcn-quote`
- Private R2: `fcn-quote-private`
- Email route: `reply@yintsun66.com`
- Queues: `fcn-outbound-email`, `fcn-email-parse`, `fcn-quote-normalize`, `fcn-quote-rank`, `fcn-image-render`, each with a DLQ
- Durable Object: `RfqCoordinator`
- Cron recovery: every two minutes
- Browser binding: `BROWSER`

R2 retention prefixes:

- `raw-email/`: 30 days
- `parsed-email/`: 30 days
- `quote-images/`: 90 days

## Operations

Useful commands from `backend/`:

```powershell
pnpm run typecheck
pnpm test
pnpm run build
pnpm exec wrangler d1 migrations list fcn-quote --remote
pnpm exec wrangler deploy
```

Do not put secrets in `wrangler.jsonc`. `EMPLOYEE_DATA_KEY` and `EMPLOYEE_LOOKUP_KEY` remain Cloudflare secrets. Raw mail, normalized debug artifacts and images remain private.

## Recovery

- Queue delivery is idempotent and may retry.
- The cron re-enqueues due finalization and queued ranking/image work.
- A failed issuer is terminal after the retry budget and cannot block the deadline.
- A late reply requires an explicit owner recalculation; the previous ranking run remains immutable.
- If Browser Rendering is unavailable, the artifact remains failed/queued independently of the completed ranking.

## Remaining live verification

The full path from `i14053@firstbank.com.tw` through the forwarding rule needs one real issuer reply. Confirm preservation of original From/Return-Path/DKIM/Message-ID/In-Reply-To/References and opaque RFQ token before treating automatic issuer recognition as production-proven.
