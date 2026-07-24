# Project handoff

Updated: 2026-07-24 (Asia/Taipei)

Current branch: `feature/subject-branch-correlation`

Latest production implementation commit:
`65a233a perf(rfq): reduce unchanged polling load`

Production deployment record:
Worker `66384b5b-42fe-4032-a9c0-79a033b6eb96` deployed 2026-07-24 from `65a233a`;
recorded in this handoff update.

Branch remote state when this handoff was updated: synchronized with
`origin/feature/subject-branch-correlation`; not merged to `main`.

The separate untracked `.claude/settings.local.json` remains user-owned and must stay out of commits.

## Production snapshot

- Application: `https://app.yintsun66.com`
- API: `https://api.yintsun66.com`
- Latest verified Cloudflare Worker version:
  `66384b5b-42fe-4032-a9c0-79a033b6eb96` (efficient polling + all earlier selective-send and
  DAC/DRA behavior, deployed 2026-07-24; `GET /api/v1/health` → `{"status":"ok"}`; the deployed
  `backend-client.js` carries the summary/snapshot routes, hidden-document pause and adaptive
  polling).
- D1 database: `fcn-quote`; migrations in the repository currently run through
  `0009_top_five_quote_artifacts.sql`. Migration 0009 was applied and verified during the
  top-five deployment; verify remote migration state again before any future migration.
- Private R2 bucket: `fcn-quote-private`
- Outbound sender and inbound Email Worker address: `rfq@yintsun66.com`
- Fixed outbound recipient: `i14053@firstbank.com.tw`
- Soft reminder / hard deadline: 420 / 900 seconds.
- The live `backend-client.js` and `styles.css` were read back after the latest deployment and
  contain the recoverable RFQ workspace markers.

A successful Worker deployment does not prove that GitHub, the bank mailbox, forwarding rules,
or issuer replies are healthy. Verify each boundary separately.

## Implemented system

The repository has two intentionally different runtime modes:

1. The root static FCN/DAC interface remains compatible with GitHub Pages. Its mail action uses
   the existing browser/manual-email workflow.
2. `app.yintsun66.com` serves the root assets through the Cloudflare Worker and activates
   `backend-client.js`, adding authentication, automated RFQ email, results, ADMIN tools, and
   private quote-image downloads.

The Cloudflare backend currently implements:

- approval-based username/password registration and login;
- server-side ownership checks and separate ADMIN authorization;
- RFQs containing 1–20 trades, validation, eight outbound mail batches, and eleven expected
  issuer snapshots;
- outbound mail archival in private R2 and an ADMIN archive viewer;
- inbound RFC822/MIME intake, R2 retention, Queue-based parsing, issuer recognition,
  normalization, trade matching, and audit/error states;
- per-trade ranking with the first five economic ranks, including ties at rank five;
- Coupon descending and Price/Strike/KO/KI ascending ranking directions;
- seven-minute provisional-result reminder, fifteen-minute hard finalization, and an
  owner-authorized early-finalize action;
- deterministic rank-one image generation plus owner-requested images for another persisted
  top-five quote;
- portrait, issuer-themed quote cards stored in private R2;
- ADMIN registration review, outbound archive, and RFQ timing diagnostics;
- owner-scoped recoverable RFQ workspace.

## Latest feature: recoverable RFQ workspace

The problem was that `backend-client.js` kept the current RFQ only in memory. Closing the dialog,
reloading, or returning later left the D1 result intact but gave the user no route back to it.

Implemented behavior:

- permanent **新增詢價 / 我的詢價** controls and an active-RFQ count badge;
- `GET /api/v1/rfqs?scope=active|completed|all&limit=...&cursor=...`;
- the collection query always filters by the authenticated `user_id`;
- responsive RFQ cards, status filters, cursor pagination, and reopen actions;
- `?rfq=<id>` deep links that survive reload, login recovery, and browser history;
- closing the foreground dialog stops only browser polling; Durable Object/Queue processing
  continues;
- no localStorage copy of terms, rankings, or results—D1 remains authoritative;
- no D1 migration, dependency, lockfile, binding, or deployment-setting change.

See [ADR 0008](adr/0008-recoverable-rfq-workspace.md) and
[API contracts](backend/contracts.md).

## Entry points for the next engineer

- `AGENTS.md`: canonical rules for every coding agent.
- `CLAUDE.md`: Claude Code startup and handback checklist.
- `index.html`, `app.js`, `styles.css`: compatibility UI and root static behavior.
- `backend-client.js`: application-domain authentication, RFQ workspace, result UI, images, and
  ADMIN dialogs. It activates only on `app.yintsun66.com` or with `?backend=1`.
- `backend/src/index.ts`: Worker/Email/Queue/scheduled-event router.
- `backend/src/rfqs.ts`: RFQ create/read/list/validate behavior.
- `backend/src/outbound.ts`: outbound snapshot and Queue processing.
- `backend/src/inbound.ts`, `backend/src/inbound-parser.ts`: MIME intake and correlation/parsing.
- `backend/src/issuer-profiles.ts`: issuer-specific row parsing and units.
- `backend/src/quote-normalize.ts`: canonical quote normalization and expected-issuer terminal
  states.
- `backend/src/ranking.ts`, `backend/src/results.ts`: finalization, ranking, result contracts.
- `backend/src/artifacts.ts`, `backend/src/quote-card.ts`: image jobs and quote-card rendering.
- `backend/src/coordinator.ts`: per-RFQ Durable Object and deadline orchestration.
- `backend/migrations/`: immutable D1 migrations; never edit an applied migration.
- `backend/test/`: Worker, parser, ranking, artifact, auth, and security regressions.
- `backend/wrangler.jsonc`: production bindings and non-secret variables.
- `docs/backend/architecture.md`: current system/data flow.
- `docs/backend/contracts.md`: current HTTP interfaces.
- `docs/backend/phase-5-7-production.md`: parser/ranking/image operational details.
- `docs/runbooks/deploy.md`, `docs/runbooks/admin.md`: deployment and human operations.
- `docs/adr/`: accepted architecture decisions; use Git history for superseded implementation
  chronology.

Generated files—`backend/public/`, `backend/dist/`, and
`backend/worker-configuration.d.ts`—must not be edited or committed.

## Verification baseline

The latest implementation was verified with:

```powershell
node --check backend-client.js
Set-Location backend
pnpm run typecheck
pnpm test
pnpm run build
```

Results:

- JavaScript syntax: passed.
- TypeScript source and test checks: passed.
- Full test suite: 16 files / 76 tests passed.
- Cloudflare Worker dry-run build: passed.
- Production static-asset readback: HTTP 200 for `backend-client.js` and `styles.css`, with the
  new workspace markers present.

An authenticated browser walkthrough of every new workspace interaction was not performed after
the deployment. Treat that as the smallest remaining UI verification task.

## UI and selective-send changes (2026-07-24)

- AUTOMATED RFQ countdown label: 「硬截止剩餘」 → 「詢價流程剩餘時間」.
- Toolbar button 「確認所有詢價條件」 → 「手動貼郵件詢價」 with a blue-green gradient
  (`.manual-email-button`). It still runs the static mailto/clipboard flow.
- Both quote buttons enforce the Barrier Type / KI Barrier rule before acting: NONE requires a blank
  KI Barrier, and a filled KI Barrier requires EKI/AKI. The static button already did this via
  `validateRow`; the backend send now checks it in `backend-client.js` before creating the RFQ.
- **Selective issuer send (ADR 0009).** 「發送詢價條件」 now opens an issuer checklist (eleven issuers
  + an "all" toggle); only the selected issuers are queried and ranked. `POST /send` accepts an
  optional `{ issuers: [...] }` (absent → all eleven). BMJB is a shared email, so selecting any of
  BNP/MS/JPM/BARCLAYS sends the BMJB batch but ranks only the selected ones.
- Quote image (`quote-card.ts`): for DAC products the card now adds a note under 保證配息期間 —
  「*DAC/DRA第{X+1}個月起為浮動收益」 (X = guaranteed periods). FCN cards are unchanged.
- Verified: `node --check backend-client.js`; `pnpm run typecheck`; `pnpm test` (16 files, 76);
  `pnpm run build` (dry run). Committed (`4a45ad5`, `376f48c`) and deployed 2026-07-24 as Worker
  `c33e0b05-5052-4567-8a82-c87750346630` (health `ok`; live assets carry the new button + picker).

## Efficient RFQ polling (committed, pushed, and deployed)

- Corrects stale architecture/production text: current branch/migrations, selective issuer
  snapshots, rank-one-only automatic image rendering and the latest 76-test baseline.
- Adds owner-scoped `GET /api/v1/rfqs/summary` for the active badge, avoiding the full RFQ-card
  aggregation query.
- Adds owner-scoped `GET /api/v1/rfqs/:rfqId/snapshot?since=<version>` to combine status, results
  and current-ranking artifacts. An unchanged version skips quote/result/artifact-list loading and
  provisional reranking.
- Snapshot invalidation includes safe status/issuer/artifact state plus a provisional quote
  count/latest-created aggregate, so a second quote from an already-terminal issuer is detected.
- Hidden documents stop badge/result timers. Visible unchanged polls back off 4s → 8s → 15s;
  finalization, the last deadline minute and queued/rendering artifacts use 2s.
- Existing status/results/artifacts APIs remain compatible. No migration, dependency, lockfile,
  binding, secret, environment-variable or email-format change.
- Verification: root JavaScript syntax and source/test TypeScript checks passed;
  `backend/test/rfqs.test.ts` passed (1 file / 9 tests); the full suite passed (16 files /
  77 tests); and the Cloudflare Worker dry-run build passed.
- Implementation commit `65a233a` is pushed to
  `origin/feature/subject-branch-correlation` and deployed as Worker
  `66384b5b-42fe-4032-a9c0-79a033b6eb96`.
- Post-deploy verification: API health and the cache-bypassed live client returned HTTP 200; the
  client contains `/rfqs/summary`, `/snapshot`, `document.hidden`, and adaptive-polling markers.
- Not yet verified: an authenticated browser walkthrough and a live 50-user read-path load test.

## Local issuer-parser corrections awaiting commit/deployment

- A production RFQ diagnostic proved that mail delivery, correlation and Queue processing
  completed, but valid DAC replies from SG and UBS were discarded by product recognition.
- The local working tree now maps SG `Fixed Coupons` values such as `First Period`,
  `First Two Periods` and positive period counts to canonical DAC while retaining
  `All Periods` as FCN. Unknown free text remains unsupported.
- UBS reply product `VMRAN` now normalizes to canonical DAC; its large trailing Quote ID remains
  metadata and does not shift the formal quote columns.
- BARCLAYS Comet row errors are now attached to the corresponding response rows, so an invalid
  product-name response becomes `ISSUER_REJECTED` with a safe reason instead of `NO_QUOTE`.
  The accepted BARCLAYS DAC outbound product code is still unconfirmed and was not guessed or
  changed; the shared BMJB outbound format remains intact.
- Parser version advances to `issuer-fcn-v3`; affected profile identifiers advance without any
  D1 migration, binding, dependency, lockfile or outbound-email format change.
- Verification completed locally: source/test TypeScript checks passed, the full suite passed
  (16 files / 79 tests), and the Cloudflare Worker dry-run build passed.
- These changes are not committed, pushed or deployed. Existing finalized RFQs are not
  automatically reparsed or reranked; use a new RFQ after deployment unless a separately reviewed,
  versioned reprocessing workflow is implemented.

## Production gaps and cautions

1. A batch marked `SENT` means Cloudflare accepted it; it is not proof of delivery to the bank
   inbox.
2. Cloudflare cannot poll `i14053@firstbank.com.tw`. Issuer replies must be forwarded by the bank
   mailbox to `rfq@yintsun66.com`. The real forwarding/header-preservation chain is not yet fully
   proven end to end.
3. `BMJB` is not an issuer identity. BNP/MS/JPM/BARCLAYS must be distinguished by the preserved
   original sender/domain.
4. Subject/body correlation fallback exists, but some real forwarded messages have reached
   `UNMATCHED_RFQ`. Never guess ownership or trade matching.
5. **GS/CA reply behavior (reviewed 2026-07-23).** GS has never produced an observed inbound
   message — likely no upstream quoting/forwarding, not a parser defect. CA *does* reply and its
   format parses and matches trades correctly (not a format bug like SG was); the issue is speed.
   Correlated CA replies were observed **~12.8 and ~25.4 minutes after send**, measured under the
   old 600s deadline so both landed as `LATE_REPLY`/`TIMEOUT`. The current 900s (15-minute) hard
   deadline would capture the ~13-minute case but not the ~25-minute one; CA has not yet been
   re-tested under 900s. Reliably capturing CA's slow replies would need a longer
   `RFQ_DEADLINE_SECONDS` (e.g. 1800s), which lengthens the wait for every RFQ — a user decision.
   Some CA replies also reached `UNMATCHED_RFQ` (subject-correlation failure, see item 4). Confirm
   upstream/timing before treating a CA timeout as a parser defect.
6. MS is displayed as `MS（OBU不得承做）`, but no approved account-level OBU attribute or blocking
   rule exists. Do not silently exclude or enforce it.
7. Browser Rendering and Cloudflare email/Queue limits need continued observation under real
   concurrent traffic.
8. CITI price comparison uses the approved `100 - Upfront` normalization. Preserve both raw and
   normalized values.
9. Existing artifacts are immutable snapshots. Layout/profile changes require a new RFQ or
   versioned recalculation; do not overwrite historical R2 objects.
10. `main` does not contain the current backend feature branch. Do not merge or copy changes
    between branches without an explicit user request and a clean diff review.
11. **DAC-architecture parsing (fixed 2026-07-24, except SG).** Issuers label the DAC product
    differently — `DRA` (Nomura/DBS/SG/GS/CA/Citi), `WRA` (UBS), `Range Accrual` (MS) — and the
    parser previously recognized only `DAC`, so every non-BNP DAC reply parsed to zero rows. Fixed:
    `product()` now maps DRA/WRA/Range Accrual → canonical DAC, and MS uses a separate DRA column
    map (its Range Accrual reply inserts "Accrual Barrier" and "Fixed Coupon (m)" columns, shifting
    Put Strike/KI/KO/Non-Call/Note Price — MS FCN and DRA genuinely differ per the reference
    workbook). Every other issuer's DAC uses the same columns as FCN (verified via identical reply
    headers in the spec; the spec's shifted data rows are display-compacted, not a real layout
    change). **Still open: SG DAC** — SG derives the product from its "Fixed Coupons = All Periods"
    cell (FCN only) and the spec has no SG DRA layout; it needs a real SG DRA reply sample to map.

## User-owned/untracked work to preserve

- `.claude/settings.local.json` is intentionally untracked and belongs to the user. Do not add,
  modify, delete, or include it in a commit unless the user explicitly requests that exact file.
- `backend/scripts/smoke-outbound-email.ps1` was manually deleted by the user, was never tracked,
  and must not be recreated. A replacement could create a real RFQ and send real bank email.
- Never commit raw `.msg`, MIME, real mail bodies, credentials, Cloudflare tokens, D1 exports,
  R2 content, or unredacted personal data.

## Safe next steps

1. Start by reading `AGENTS.md`, this file, the relevant ADR/contracts, current branch/status, and
   the exact entry point/tests for the requested task.
2. Perform a controlled authenticated browser walkthrough:
   open **我的詢價**, switch filters, reopen an active/completed RFQ, reload a `?rfq=` URL, and
   verify another user receives `404` for ownership-protected resources.
3. For email troubleshooting, use the ADMIN timing/archive views and structured D1 status fields;
   do not expose or commit raw mail. A real outbound RFQ sends bank email and therefore requires
   explicit user authorization.
4. If changing issuer parsing, add an anonymous synthetic regression fixture and preserve raw
   units, normalized units, invalid/no-quote states, and matching rules.
5. If changing schema, bindings, secrets, authentication, email routes, dependencies, or
   production behavior, stop and obtain explicit approval before editing or deploying.
6. Before handback, run the applicable verification baseline, inspect the complete Git diff,
   update this file with exact evidence, and report whether commit, push, migration, and deploy
   each occurred.
7. End-to-end checks still owed for the 2026-07-24 deploy (need an authorized real RFQ): the issuer
   picker on 「發送詢價條件」 and per-issuer sending (BMJB grouping, ADR 0009); the DAC/DRA
   floating-income note on the quote image; and the DAC-alias / MS-DRA parser fix against real
   DAC/DRA replies. Known open items: SG DAC layout needs a real sample (gap 11); CA reply
   latency (gap 5).

## Deployment reminder

Do not deploy unless explicitly requested. The normal source flow is:

```powershell
Set-Location backend
pnpm run build
pnpm run prepare-assets
pnpm exec wrangler deploy
```

Apply a new D1 migration before the Worker only when the reviewed migration/code compatibility
plan explicitly requires that order. After deployment, verify the health/static/API behavior
relevant to the change and record the Worker version here.
