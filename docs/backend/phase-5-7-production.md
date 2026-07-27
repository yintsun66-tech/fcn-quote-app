# Phase 5–7 production baseline

Implemented: 2026-07-21; current baseline reviewed 2026-07-25
Branch: `feature/subject-branch-correlation`

## Workflow

1. `POST /api/v1/rfqs` creates 1–20 immutable trades.
2. Validation freezes the rows and enforces exactly one target field.
3. Send creates only the outbound batches required by the selected issuers and snapshots those
   expected issuers. An absent selection preserves the original eight-batch/eleven-issuer default;
   BMJB remains one shared batch for BNP/MS/JPM/BARCLAYS.
4. The final successful outbound batch starts one named RFQ Durable Object. Seven minutes is a UI
   reminder, fifteen minutes starts the mail-transport grace, and the hard alarm fires sixty
   seconds later.
5. Inbound MIME is stored privately, parsed, normalized through an issuer profile and matched to a trade.
6. All-terminal or deadline finalization enqueues a versioned ranking run.
7. The deterministic rank-one quote for each trade is automatically rendered into a private R2
   mobile-portrait PNG artifact.
8. The owner polls status/results and may explicitly request an idempotent image for ranks 1–4 or
   a server-validated custom fifth issuer, then previews or downloads it through the authenticated
   Worker.

Late replies are stored but do not overwrite a finalized run. Owner/ADMIN recalculation creates a
new version and admits only finite, matched, non-rejected late values.

## Ranking rules

| Target | Direction |
| --- | --- |
| Coupon | highest first |
| Upfront / NotePrice | lowest first |
| Strike | lowest first |
| KO Barrier | lowest first |
| KI Barrier | lowest first |

Only `VALID` finite normalized values participate normally. An explicit recalculation may also use
finite, matched, non-rejected `LATE_REPLY` rows. Equal values retain the same economic rank; receipt
time then opaque quote ID determines display order. The public UI shows ranks 1–4 and lets the user
choose a fifth issuer outside those ranks.

## Production resources

- Worker/custom domains: `api.yintsun66.com`, `app.yintsun66.com`
- D1: `fcn-quote`
- Private R2: `fcn-quote-private`
- Email route: `rfq@yintsun66.com`
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
- A late reply requires an explicit owner/ADMIN recalculation; the previous ranking run remains immutable.
- If Browser Rendering is unavailable, the artifact remains failed/queued independently of the completed ranking.
  The owner can retry a failed artifact from the result page without creating a duplicate; the
  stored safe error distinguishes request failure from an HTTP status such as 429.

## Live verification status

One authorized three-trade DAC RFQ exercised all eight outbound batches. Eight issuer replies were
forwarded and correlated. BNP, MS, JPM, NOMURA, UBS, DBS and SG produced valid quotes; BARCLAYS
replied from its allowlisted sender but rejected Product=`DAC`, so it correctly became
`ISSUER_REJECTED` rather than `TIMEOUT`, `NO_QUOTE` or `PARSE_ERROR`. Ranking persisted five results
per trade and the three deterministic rank-one image artifacts reached `READY`.

This evidence proves the observed forwarding path and current SG/UBS normalization cases, not every
issuer template or optional mail header. The exact BARCLAYS DAC-family Product/module rule remains
unknown. Do not guess an alternate Product value or globally change the shared BMJB body; obtain
issuer confirmation and verify whether a separate BARCLAYS request batch can be routed before
changing production behavior.
