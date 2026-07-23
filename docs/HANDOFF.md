# Project handoff

Updated: 2026-07-23 (Asia/Taipei)
Branch: `feature/subject-branch-correlation`  
Latest implementation commit: `31100ce feat(results): add top-five quote image choices`

## What is live

- Application: `https://app.yintsun66.com`
- API: `https://api.yintsun66.com`
- Latest verified Cloudflare Worker version: `f2e4ea60-5cd0-4bb0-979e-28f1b86e9a5f`
- Current deployment includes the ADMIN user-registration review dialog and the private-R2 outbound-email archive viewer.
- The public API health endpoint returned `{ "status": "ok" }` after the latest deployment. The deployed frontend asset contains the registration-review feature markers.

The Cloudflare deployment and Git remote are separate facts. This branch was committed and deployed locally; check `git status -sb` and the configured upstream before assuming the commit has been pushed to GitHub.

## Current implementation state

- Root static application remains compatibility UI for FCN/DAC and GitHub Pages.
- `app.yintsun66.com` serves the same root application assets through the Cloudflare Worker and activates `backend-client.js`.
- The backend supports registration, application-managed username/password login, ADMIN role checks, RFQ creation/validation/sending, eight outbound mail batches, eleven expected issuers, inbound MIME intake, parsing/normalization, ranking, and private quote-image artifacts.
- Outbound mail is sent from `rfq@yintsun66.com` to the fixed recipient `i14053@firstbank.com.tw` through the Cloudflare email binding.
- Issuer replies must be forwarded from the bank mailbox to `rfq@yintsun66.com`; Cloudflare cannot log into or poll the bank mailbox directly.
- ADMIN controls currently include:
  - **使用者申請審核**: lists pending registrations and approves/rejects them with server-side ADMIN/CSRF checks and audit events.
  - **管理者寄件紀錄**: reads archived outbound subject/HTML/plain text from private R2 using authenticated admin endpoints.

### Top-five ranking and selectable issuer images (committed, pushed, and deployed)

- Ranking now retains the first five economic ranks and every quote tied at rank five.
- Finalization creates and queues only the deterministic rank-one image for each trade.
- Every other persisted top-five row has an owner-scoped action to create that exact quote's
  issuer-themed image. The previous per-trade endpoint remains a rank-one compatibility shortcut.
- Migration `0009_top_five_quote_artifacts.sql` expands the ranking constraint from 1–3 to 1–5
  and keys artifacts/jobs by `ranking_run_id + trade_code + quote_id`. Existing migration-0008
  artifacts are mapped to their persisted rank-one quote and retained.
- The artifact list adds `quoteId`, `rank`, and `isDefault`; R2 object keys include `quoteId` so
  images for two issuers on one trade cannot overwrite each other.
- Local verification: root JavaScript syntax check passed; backend typecheck passed; focused
  ranking/artifact tests passed (3 files / 9 tests); full suite passed (16 files / 71 tests);
  Cloudflare dry-run build passed outside the managed filesystem sandbox. The sandboxed build
  attempt failed only because Wrangler could not traverse the parent profile directory.
- Migration 0009 was applied to remote D1 before the matching Worker/assets deployment. Remote
  verification reports no pending migrations, `ranking_results` permits ranks 1–5, and all 32
  preserved `generated_artifacts` / `image_render_jobs` rows have a non-null `quote_id`.
- Production verification: API health returned HTTP 200 with `{"status":"ok"}` and the
  cache-bypassed application asset contains `allTradesHaveFiveValidQuotes`,
  `data-artifact-quote`, and the quote-specific artifact route. Deployed Worker version:
  `f2e4ea60-5cd0-4bb0-979e-28f1b86e9a5f`.

### Recoverable user RFQ workspace (implemented locally; not committed/deployed)

- Adds owner-scoped `GET /api/v1/rfqs` with active/completed/all scopes, bounded cursor
  pagination, safe status summaries and `activeCount`.
- Adds permanent **新增詢價 / 我的詢價** controls, an active badge, responsive RFQ cards, filters,
  load-more pagination and direct reopen actions.
- The selected result is represented by `?rfq=<id>` so reload, browser history and login recovery
  return to the same RFQ. D1 remains authoritative; no terms/results are stored in the browser.
- Closing the foreground result stops its polling but does not alter the server-side workflow.
  Existing status/results/artifact APIs continue to enforce ownership.
- No D1 migration, dependency, lockfile, binding or deployment-config change. Existing
  `rfqs(user_id, created_at)` supports the list ordering. See ADR 0008.
- Verification: root JavaScript syntax, TypeScript checks, the full test suite (16 files /
  72 tests), and the Cloudflare Worker dry-run build all passed.

### Phase A–E acceleration work (committed, pushed, and deployed)

- SG parser maps current reply tables by normalized headers and variable Underlying columns.
- Inbound correlation may recover one RFQ tag from sanitized body content when the subject lost
  it; conflicting tags go to `MANUAL_REVIEW`.
- ADMIN has an RFQ timing view with safe counts/statuses/durations only.
- Waiting RFQs expose non-persistent provisional top-three rankings.
- Seven-minute soft reminder and fifteen-minute hard deadline (`420`/`900` seconds).
- Queue consumers use one-message, one-second batches with their existing bounded concurrency.
- Finalization no longer generates every image. Owners request one finalized trade image at a
  time through an idempotent, CSRF- and ownership-protected endpoint.
- No migration, dependency, lockfile, secret, or mailbox-address change.
- Local verification: `node --check backend-client.js`; `pnpm run typecheck`; `pnpm test`
  (16 files / 70 tests); `pnpm run build` (Wrangler dry-run) all passed.
- Production verification: `GET https://api.yintsun66.com/api/v1/health` returned HTTP 200 with
  `{"status":"ok"}`; cache-bypassed `backend-client.js` contains the ADMIN timeline, provisional
  ranking, and on-demand artifact markers. Deployed from `83209d4` as Worker version
  `149c8fd9-c50f-48fc-9c33-d7435609b499`.

## Important current limitations / known gaps

1. A Cloudflare `SENT` batch indicates provider acceptance, not proven inbox delivery. Earlier RFQs from username `14053` reached `WAITING` and eventually `NO_VALID_QUOTE`; valid issuer replies were not observed before the deadline.
2. The real bank forwarding chain must still be verified with a controlled issuer-style reply. Capture the actual headers/MIME that reach the configured inbound address before treating automatic issuer recognition as fully production-proven.
3. MS remains display-warning only (`MS（OBU不得承做）`). There is no approved account-level OBU attribute or enforcement rule.
4. The true Cloudflare Browser Rendering capacity and email-product limits need observation under real traffic. Queue retries protect workflow progress but do not prove capacity.
5. Several older design documents contain historical language such as “Phase 1 draft” or “no deployment.” Use current code, `wrangler.jsonc`, Git history, this handoff, and live verification for current state; update stale documents only in a scoped documentation task.
6. **Issuer reply timing (observed 2026-07-23).** Many issuer replies arrive ~11–14 minutes after send. The deployed Phase A–E change raises the hard deadline from 600s to 900s and adds a 420s soft reminder. Existing RFQs retain their previously snapshotted deadline; the new timing applies to RFQs sent after deployment.
7. **Issuer-specific reply gaps (observed 2026-07-23).** Triage method: `inbound_messages.status` = `PARSED` (on time), `LATE_REPLY` (after deadline), or absent (no reply); `normalized_quote_count = 0` means the reply was received but parsed to zero rows (format mismatch).
   - **SG** replies use variable Underlying columns. The deployed parser maps SG by normalized headers and includes a two-underlying regression fixture; confirm it against the next real forwarded SG reply.
   - **GS** has never appeared in `inbound_messages` — no GS reply ever reached the inbound address. Upstream matter (GS not quoting via this forward chain, or the bank mailbox not forwarding GS), not a parser bug.
   - **CA** replies rarely and has never succeeded (late or `UNMATCHED_RFQ`); effectively the same upstream/forwarding gap as GS.
   - A notable share of otherwise-valid replies land as `UNMATCHED_RFQ` (correlation failed); worth a separate look at whether the subject correlation code survives the bank forward chain.

## Preserve this user-owned work

- `backend/scripts/smoke-outbound-email.ps1` was previously untracked and explicitly excluded from commits/deployments. On 2026-07-21 it was no longer present in the workspace or the searched `Documents` tree, and it was never Git-tracked.
- Do not recreate it from memory or run a replacement without the user's original source and explicit approval. It was an operational test that could create a real RFQ and send real messages.
- The existing `backend/scripts/prepare-assets.mjs` only deletes and recreates generated `backend/public/`; it does not delete `backend/scripts/`.

## Recent verification evidence

For the current backend branch through implementation commit `83209d4`:

- `node --check backend-client.js` passed.
- `pnpm test` passed: 16 test files, 70 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed (Worker deploy dry run).
- Production deployment succeeded and uploaded the SG email-format assets (`app.js` and `backend/shared/email-formats.js`).

## Safe next steps

1. Log in with an account whose application role is `ADMIN`; open **使用者申請審核** and approve/reject a controlled test registration.
2. Verify the bank-mailbox forwarding rule by forwarding a controlled real issuer-style reply to `rfq@yintsun66.com` and inspect its preserved headers through the application’s private intake/audit path.
3. Consider raising `RFQ_DEADLINE_SECONDS` (~900–1200) to capture late-but-valid issuer replies (JPM/CITI/late SG); weigh the longer per-RFQ wait first (known gap 6).
4. After release, confirm the header-aware SG parser against a newly forwarded production reply.
5. Confirm with the desk whether GS/CA actually quote and forward through this chain; if yes, obtain a sample and fix their parser mapping — otherwise their `TIMEOUT` is upstream, not a code issue.
6. Before changes, follow `AGENTS.md`; after changes, update this file with exact test/deploy evidence.

## Subject-line correlation change (implemented on `feature/subject-branch-correlation`)

- **What & why** — see [ADR 0002](adr/0002-subject-correlation-and-branch-label.md) (Accepted).
  Correctly formatted RFQs were delivered but received no issuer reply; the working hypothesis
  is bank-side filtering of the long opaque subject token.
- New subject shape: `SG[詢價]FCBKTPE: FCN(T+7) {sanitized branch}分行 [RFQ:{10-char code}][BATCH:{code}]`.
  Example: `SG[詢價]FCBKTPE: FCN(T+7) 營業部分行 [RFQ:K7P2R9QTBM][BATCH:SG]`. The issuer base subject is
  unchanged; the correlation reference stays in the subject (not the body) as a short deterministic
  Crockford base32 code; the branch label is sanitized (CJK/digits only) and appends 「分行」 only
  when absent. The email body/table is unchanged.
- Confirmed choices: (a) branch sanitization keeps CJK+digits and strips ASCII letters (the user's
  branches contain no latin); (b) 「分行」 is appended only if the name does not already end with it.
- No D1 migration, binding, email-address, or public-API change. The branch label rides inside the
  existing per-send `base_subject` snapshot. Inbound `correlationTags` length relaxed to `{10,128}`
  so in-flight long tokens still correlate during rollout.
- Files: `backend/shared/email-formats.js` (+ `.d.ts`), `backend/src/crypto.ts` (new `keyedShortCode`),
  `backend/src/outbound.ts`, `backend/src/inbound-parser.ts`, and tests in `email-formats`, `crypto`,
  `outbound`, `inbound-parser`.
- **Verification (local):** `node --check backend-client.js` passed; `pnpm run typecheck` passed;
  `pnpm test` passed (14 files, 61 tests); `pnpm run build` (deploy dry run) passed.
- **Deploy:** deployed to Cloudflare on 2026-07-22 — Worker version
  `e1d9ab8b-de52-4b52-a1d2-19c752446ec2`. Verified `GET https://api.yintsun66.com/api/v1/health`
  → `{"status":"ok"}` and `https://app.yintsun66.com/backend-client.js` → 200. Committed as
  `8b781da` and pushed to `origin/feature/subject-branch-correlation` (not merged to `main`).
- Not yet proven: that the shorter subject actually clears the bank filter. Confirm with a real
  forwarded issuer reply before treating automatic recognition as production-proven.

## Quote-turnaround tuning (implemented, not yet committed/deployed)

Five changes to reduce time-to-quote and per-request cost — see [ADR 0003](adr/0003-quote-turnaround-tuning.md).

- **P1 configurable deadline** — `outbound.ts` now reads `RFQ_DEADLINE_SECONDS` (default `"600"`,
  added to `wrangler.jsonc`); behavior unchanged at the default. Lets the reply window be tuned
  without a code change.
- **P2 faster ranking** — `fcn-quote-rank` queue `max_batch_timeout` lowered 5→2 in `wrangler.jsonc`,
  shaving the post-finalization tail before the ranking appears.
- **P3 adaptive polling** — `backend-client.js` polls results every 2s once the deadline has passed
  (4s during the long wait); surfaces the completed quote sooner.
- **P4 coalesced session writes** — `db.ts` `loadSession` skips the sliding-expiry `UPDATE` unless the
  expiry advances by >60s, removing ~95% of per-request D1 writes (idle-timeout preserved to ~60s
  granularity). Touches session/auth — recorded in ADR 0003.
- **P5 instant progress feedback** — `backend-client.js` opens the progress dialog immediately on
  submit instead of after the three create/validate/send round trips.
- **Verification (local):** `node --check backend-client.js` passed; `pnpm run typecheck` passed;
  `pnpm test` passed (14 files, 63 tests); `pnpm run build` (dry run) passed.
- **Status:** committed `88ae57d`, pushed to `origin/feature/subject-branch-correlation` (not merged
  to `main`). Deployed to Cloudflare on 2026-07-22 — Worker version
  `9ce5e3b8-4e1e-4877-9dd6-05fce6aef806`. Verified `GET https://api.yintsun66.com/api/v1/health` →
  `{"status":"ok"}` and the deployed `backend-client.js` carries the new polling code. The default
  `RFQ_DEADLINE_SECONDS=600` keeps the window at 10 minutes; lower it to shorten the "some issuers
  silent" wait.

## Early-finalize button (implemented, not yet committed/deployed)

- New owner-scoped endpoint `POST /api/v1/rfqs/:rfqId/finalize` lets a user close the reply window
  early and rank immediately, instead of waiting out `RFQ_DEADLINE_SECONDS`. See
  [ADR 0004](adr/0004-user-early-finalize.md) and `docs/backend/contracts.md`.
- Accepted only in `WAITING`/`PARTIAL`; same-origin + CSRF + ownership enforced (`404`/`403`/`409`).
  Reuses the `DEADLINE` finalization trigger (idempotent with the deadline alarm on the same
  ranking version) — no new trigger value, no D1 migration. User actor captured in a
  `RFQ_EARLY_FINALIZE_REQUESTED` audit event.
- Frontend: a "提早結束並比價" button in the RFQ progress dialog, shown only while waiting; confirms
  before finalizing, then refreshes results. Non-responding issuers are excluded from that ranking,
  exactly as at a natural deadline.
- Files: `backend/src/results.ts`, `backend/src/index.ts`, `backend-client.js`,
  `backend/test/rfqs.test.ts`, `docs/backend/contracts.md`, ADR 0004.
- **Verification (local):** `node --check backend-client.js` passed; `pnpm run typecheck` passed;
  `pnpm test` passed (14 files, 64 tests); `pnpm run build` (dry run) passed.
- **Status:** committed `c4a2851`, pushed to `origin/feature/subject-branch-correlation` (not merged
  to `main`). Deployed on 2026-07-22 — Worker version `59815984-0172-4256-b295-408d7d352ce1`.
  Verified `GET /api/v1/health` → `{"status":"ok"}` and the live `backend-client.js` (26275 bytes)
  contains the `backendFinalizeNow` button and `/finalize` call.

## Per-trade quote images (implemented; migration + deploy pending)

- **One image per trade** (the trade's rank-1 winner), replacing per-issuer grouping. Each trade's
  winning issuer name in the results view links to that trade's image; a per-trade download list
  replaces the issuer-switcher gallery. See [ADR 0005](adr/0005-per-trade-quote-images.md).
- **DB migration `0008_trade_artifacts.sql`** rebuilds `generated_artifacts` and `image_render_jobs`
  keyed by `trade_code` (`UNIQUE(ranking_run_id, trade_code)`). It **drops** the prior
  issuer-grouped tables — old artifact rows do not map to the per-trade model and are regenerable
  via recalculation; their R2 objects expire under the 90-day lifecycle.
- Files: `migrations/0008_trade_artifacts.sql`, `src/ranking.ts`, `src/artifacts.ts`,
  `src/results.ts`, `src/types.ts`, `backend-client.js`, `test/ranking-integration.test.ts`,
  ADR 0005, `docs/backend/architecture.md`, `docs/backend/contracts.md`.
- API: artifacts now carry `tradeCode` (status + list); `isDefault` removed. Up to 20 render jobs
  per RFQ — Browser Rendering free-plan capacity remains a watch item under real bursts.
- **Verification (local):** `node --check backend-client.js`; `pnpm run typecheck`; `pnpm test`
  (14 files, 64 tests); `pnpm run build` (dry run) — all passed.
- ⚠️ **Deploy order:** apply migration 0008 to remote D1 **then** deploy the Worker immediately
  (the new code requires `trade_code`; the old code cannot insert into the new schema). There is a
  brief window during which finalization would fail — deploy when no RFQ is mid-finalization.
- **Status:** committed `00d1a1f`, pushed to `origin/feature/subject-branch-correlation` (not merged
  to `main`). Migration 0008 applied to remote D1 on 2026-07-23 (`Executed 9 commands`); the first
  `apply` attempt returned a transient Cloudflare `7403` and succeeded on retry. Worker deployed —
  version `93a4f2d2-0603-4d41-916f-0233dca2e23c`.
- **Verified:** `GET /api/v1/health` → `{"status":"ok"}`; remote `generated_artifacts` now has the
  `trade_code` column; the deployed `backend-client.js` carries the per-trade rendering
  (`renderArtifactSummary`, `artifactByTrade`).
- Not yet exercised end-to-end: a real RFQ producing per-trade images and the inline links.
  Confirm with an authorized test RFQ (this sends real bank email).

## MS inbound parse fix (implemented; deploy pending)

- **Symptom:** MS replies almost always showed `PARSE_ERROR`. **Root cause:** MS's "Non-Call (m)"
  column (guaranteed periods) arrives as e.g. `"1m"`, but `msRow` parsed it with `integer()`, which
  rejects the `m` suffix → `guaranteedPeriodsMonths = null` → every MS row failed `matchesTrade` →
  all rows `AMBIGUOUS_TRADE_MATCH` → the whole issuer became `PARSE_ERROR`. The other MS columns
  matched the real layout (verified against a user-supplied MS `.msg`; not committed).
- **Fix:** `backend/src/issuer-profiles.ts` `msRow` now parses the guaranteed column with `months()`
  (accepts `"1m"`, `"1"`, `"1 months"`), like tenor/observation. One line.
- Partial extraction already works by design: bad rows are skipped and any `VALID` row →
  `VALID_REPLY`. So once MS rows match, valid quotes are captured, and rows that genuinely cannot
  quote (`NA`) are recorded as `NO_QUOTE` without failing the reply — this covers the
  "capture the rows that do have quotes" requirement (not MS-specific).
- Regression: `backend/test/issuer-profiles.test.ts` MS case now asserts `guaranteedPeriodsMonths`
  and the other `m`-suffixed month fields.
- No migration / schema / API change. **Verified:** `pnpm run typecheck`; `pnpm test` (14 files, 64).
- **Status:** committed `ed4e684`, pushed to `origin/feature/subject-branch-correlation` (not merged
  to `main`). Deployed on 2026-07-23 — Worker version `df57226e-69d3-4d0f-b05a-896749df216f`;
  `GET /api/v1/health` → `{"status":"ok"}`. Re-test with a real MS reply to confirm it now parses.

## MS ISSUER_REJECTED fix (follow-up; deploy pending)

- After the parse fix, MS then showed `ISSUER_REJECTED`. **Root cause:** `rejection()` scanned all
  five pricing cells for invalid values, and MS's NONE-barrier products correctly report **KI Barrier
  = "NA"** (no knock-in). That legitimate "NA" was misread as a rejection, so every MS row →
  `ISSUER_REJECTED`.
- **Fix:** `backend/src/issuer-profiles.ts` `rejection()` no longer scans the KI Barrier cell when
  the barrier type is NONE (KI is legitimately absent there). Real rejections (a "reject"/"limit"/
  "無法報價" comment, or an invalid value in an applicable cell) are still detected.
- Regression: the MS test now asserts `rejectionReason: null`; the GS rejection test (triggered by a
  real "reject" comment) still passes.
- No migration / schema / API change. **Verified:** `pnpm run typecheck`; `pnpm test` (14 files, 64).
- **Status:** committed `a66ea8c`, pushed to `origin/feature/subject-branch-correlation` (not merged
  to `main`). Deployed on 2026-07-23 — Worker version `2c2e3f57-aa7c-4d8c-9cc3-39eca663eb0a`;
  `GET /api/v1/health` → `{"status":"ok"}`. Re-test with a real MS reply: NONE-barrier rows should
  now be `VALID` (or `NO_QUOTE` when genuinely unquoted), not `ISSUER_REJECTED`.

## Latest SG outgoing-email table update

The SG table update is committed on both branches:

- appended `OTC` with fixed value `Note`;
- appended `Funding Spread (bps)` with an intentionally blank, rendered table cell; and
- appended `Effective Date Offset(Calendar Days)` with fixed value `7`.

- `feature/backend-foundation`: `ff12ef5`; includes `backend/shared/email-formats.js`, compatibility `app.js`, and the email-format regression test.
- `main`: `bef54f6`; includes the static-site `app.js` format definition.
- The focused issuer-format test passed (5 tests), both branch/main `app.js` files passed JavaScript syntax checking, and Cloudflare deployment version `47f94c36-1496-4143-973a-32f096c862d0` is live.

## Latest Nomura outgoing-email default update

- Nomura `Effective Date Offset` now always renders `7`, independent of the source row value.
- `feature/subject-branch-correlation`: `206b01f`; includes the backend shared generator, compatibility `app.js`, and a regression test.
- `main`: `07d0cc1`; includes the GitHub Pages `app.js` update.
- Verification passed: both `app.js` syntax checks, 14 test files / 62 tests, typecheck, and Cloudflare dry-run build.
- Cloudflare deployment version `b299861e-c569-4d64-9afe-22808c3802d8` is live. The health endpoint returned `{"status":"ok"}`, and cache-bypassed checks confirmed both deployed generator assets contain the fixed value. GitHub Pages also serves the updated `app.js`.

## Unified mailbox route (live)

- Outbound sender and inbound Email Worker address are both `rfq@yintsun66.com`; the fixed outbound recipient remains `i14053@firstbank.com.tw`.
- Implemented in `b19da0e`, with the inbound fixtures and operational documentation updated to the same address.
- Verification passed: 14 test files / 62 tests, typecheck, Cloudflare dry-run build, deployment listing, and `GET https://api.yintsun66.com/api/v1/health` → `{"status":"ok"}`.
- Cloudflare Worker version `71b1a0ba-70e0-4e6a-b341-54ddc938ecf6` is deployed at 100%. The deploy accepted `INBOUND_ADDRESS=rfq@yintsun66.com` and the configured Email Worker address trigger.
- Email Routing rule `e5c5b106730a444b9bcf2a71aef4c5c3` was explicitly updated and verified after deployment: enabled, priority 1, literal matcher `to = rfq@yintsun66.com`, action `worker:fcn-quote-api`. A Worker deploy alone did not update the pre-existing `reply@yintsun66.com` routing rule.
- End-to-end inbound delivery is not proven until the bank forwards a controlled issuer reply to `rfq@yintsun66.com`. Exclude messages originally sent by `rfq@yintsun66.com` from the bank forwarding rule so outbound RFQs are not re-ingested as unrelated inbound mail.

## Mobile quote-image and issuer switching (deployed)

- Backend quote images now use a fixed 720 CSS-pixel portrait layout at 1.5 device scale, larger underlying text, and the same eleven issuer palettes as the main compatibility quote image.
- A finalized ranking now queues one artifact for every issuer with a valid quote, including valid `OUTSIDE_TOP_THREE` quotes recorded in that same snapshot. Rank-one issuer groups remain the default; the authenticated result dialog can switch to another valid issuer, preview its private-R2 PNG inline, and download it.
- The artifact API now returns `isDefault` and an authenticated `previewUrl`; the existing download URL remains attachment-oriented. No D1 migration, binding, secret, mail format, ranking direction, or authentication change was made.
- Local verification: `node --check backend-client.js` passed; direct source/test TypeScript checks passed; focused quote-card/ranking integration tests passed (2 files, 3 tests); the full suite passed (14 files, 63 tests); and the Cloudflare dry-run build passed after rerunning outside the filesystem sandbox. The sandboxed Wrangler attempt failed only because it could not traverse the parent profile directory.
- Implementation commit `e4c0b7d` is pushed to `origin/feature/subject-branch-correlation` and deployed to Cloudflare as Worker version `6496baa9-8c7c-4c0b-b93e-215af221fc69`.
- Post-deploy verification: API health returned HTTP 200 with `{"status":"ok"}`; cache-bypassed application asset checks returned HTTP 200 and contained `backendArtifactIssuer`, `previewUrl`, and `backend-artifact-preview-frame` markers.
- Existing finalized RFQs retain their previous artifact set; create a new RFQ or run a versioned recalculation to generate the mobile v2 artifacts. Preserve the untracked `.claude/` directory.

## Reference-style quote card and full RFQ code (deployed)

- The mobile quote card now follows the supplied reference image: product/currency/issuer hero, tenor and annual coupon, ticker-only underlyings, strike/KI, guaranteed period/KO, issuer and trade date footer.
- The bottom line displays the exact full email subject reference as `[RFQ:<10-character-code>]`, generated by the same `rfqCorrelationCode` helper used by outbound mail; internal `rfq_...` IDs are not exposed.
- Render profile/object prefix advance to `quote-card-reference-v3` / `quote-images/v3`. Existing artifacts remain immutable and require a new RFQ or versioned recalculation.
- Local verification passed: source/test TypeScript checks, focused tests (4 files / 11 tests), the full suite (14 files / 63 tests), and the Cloudflare dry-run build. A headless Edge sample was visually compared with the supplied reference image.
- Implementation commit `6cef771` is pushed to `origin/feature/subject-branch-correlation` and deployed to Cloudflare as Worker version `6f690a4b-a177-445b-9ed4-158e6089b715`.
- Post-deploy verification: `https://api.yintsun66.com/api/v1/health` returned HTTP 200 with `{"status":"ok"}`, and `https://app.yintsun66.com/` returned HTTP 200 with an HTML document.
- Preserve the untracked `.claude/` directory.
