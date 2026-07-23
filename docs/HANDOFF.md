# Project handoff

Updated: 2026-07-23 (Asia/Taipei)

Current branch: `feature/subject-branch-correlation`

Latest production implementation commit:
`61c07c7 feat(rfq): add recoverable quote workspace`

Production deployment record commit:
`016bd28 docs: record recoverable RFQ deployment`

Branch remote state when this handoff was updated: synchronized with
`origin/feature/subject-branch-correlation`; not merged to `main`.

This documentation refresh is limited to `CLAUDE.md`, `README.md`, and this file. The separate
untracked `.claude/settings.local.json` remains user-owned and must stay out of commits.

## Production snapshot

- Application: `https://app.yintsun66.com`
- API: `https://api.yintsun66.com`
- Latest verified Cloudflare Worker version:
  `49fbfd94-552b-4130-a562-0aba54e9345c`
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
- Full test suite: 16 files / 72 tests passed.
- Cloudflare Worker dry-run build: passed.
- Production static-asset readback: HTTP 200 for `backend-client.js` and `styles.css`, with the
  new workspace markers present.

An authenticated browser walkthrough of every new workspace interaction was not performed after
the deployment. Treat that as the smallest remaining UI verification task.

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
