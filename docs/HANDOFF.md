# Project handoff

Updated: 2026-07-28 (Asia/Taipei)

Current branch: `feature/subject-branch-correlation`

Latest production implementation commit:
`5d15d08 fix(artifacts): standardize quote-image dimensions`

Production deployment record:
Worker `7e67acfd-f0c2-4d7e-8f4e-687e5ad2b2a2` deployed 2026-07-28 from `5d15d08`
(desktop, laptop, tablet, and phone all use the phone-size 1.5-scale / 4M-pixel profile).
Post-deploy: application index and API health return HTTP 200; the live index references
`backend-client.js?v=backend-v3`; the live client contains `CARD_OUTPUT_CANVAS_PIXELS = 4e6`
and `CARD_OUTPUT_MAX_SCALE = 1.5`, with the device-specific scale branch absent.
Previous: `8f531342-e773-412b-9ba1-c5ffc00730ac` deployed 2026-07-28 from `99d7e9a`
(bounded client/fallback requests, touch-safe canvas budget, responsive preview, and desktop
new-page link). Post-deploy: application index and API health return HTTP 200; the live index
references `backend-client.js?v=backend-v2`; the live client contains
`CARD_RENDER_TOTAL_TIMEOUT_MS`, `CARD_TOUCH_SAFE_CANVAS_PIXELS`, `requestForRender`,
`backend-card-open-link`, and the overlay preview; the live stylesheet contains the responsive
desktop-link rule.
Previous: `b18cba05-bd46-49b5-818e-71d36d9b9d39` deployed 2026-07-28 from `7f1dca3`
(mobile render-hang fix). Post-deploy: API health 200; the live `backend-client.js` carries
`withRenderTimeout`, `CARD_SAFE_CANVAS_PIXELS`, `showCardImage`, `opacity:0` and 「長按圖片」,
and `styles.css` carries `backend-card-preview`.
Earlier: `f887ba53-2af9-4cf6-a493-bfc67cc4f489` from `b7ae5fb` (self-hosted rasterizer;
`https://app.yintsun66.com/vendor/html2canvas-1.4.1.min.js` returns HTTP 200, 198,689 bytes,
SHA-256 matching the vendored file exactly, and no third-party CDN host remains on the live page.
The root page is edge-cached — send `Cache-Control: no-cache` when verifying it, because a query
string alone does not bust it);
`fcf61774-b52b-45a4-ba40-2af46be691df` from `88bdbd9` (client-side quote-card
rasterization, ADR 0017; unauthenticated card endpoint returns 401);
`aa7a0656-bc5b-42b1-a6ae-63f16141de64` from `de9e8d9` (on-demand quote images,
ADR 0016; `AUTO_RANK_ONE_IMAGE ("0")` confirmed in the deployed bindings);
`a485a90c-...` from `98d969c` (ZAR support);
`68c62104-...` from `481c220` (mail grace, versioned late-reply recalculation, and
economic top four plus custom fifth issuer/image);
`6520b77d-...` from `4095b51` (issuer-specific DAC/DRA labels);
`566c7456-...` from `bdd66c1` (first-trade product label);
`02311666-...` from `477b3c9` + `0d77eac` (parser/operations diagnostics);
`cc633dcb-...` from `0bbe159` (ADMIN-only employee-number lookup);
`364a345e-...` from `fd7a380` (duplicate-registration visibility);
`25d32525-...` from `0913f16` (PS tier + migration 0010); `2de5b070-...` from `23c084e`.

Production implementation head when this handoff was updated:
`feature/subject-branch-correlation` at `5d15d08`, pushed to `origin` (local and remote match before
this deployment-record documentation commit).
Resolve the current branch HEAD from Git before making changes. The branch is not merged to
`main`.

Quote-image work landed in this order — read ADR 0016 then 0017 before touching that path:
`de9e8d9` on-demand images → `88bdbd9` client-side rasterization → `b7ae5fb` self-hosted
rasterizer → `7f1dca3` mobile hang fix.

The separate untracked `.claude/settings.local.json` remains user-owned and must stay out of commits.

## On-demand quote images (ADR 0016) — Browser Rendering capacity

Automatic rank-one image rendering is **disabled**. Rendering now happens only when a user asks
for it, through the existing owner-authorized on-demand path.

Why (read-only production audit, 2026-07-27):

- `fcn-image-render` runs at `max_concurrency: 3`, matching the Browser Rendering free-plan
  concurrent-browser allowance, on top of a per-day browser-time budget. It is the only centrally
  metered, concurrency-limited resource in the pipeline.
- 9 of 124 artifacts were `BROWSER_RENDER_FAILED` — a **7.3% failure rate at near-zero
  concurrency** (51 RFQs / 6 days / 1–2 active users), with `max_retries: 3` consuming further
  browser time per failure.
- At 30–50 users (3.57 trades per RFQ) automatic rendering implies ~178 images/day at 50 RFQs/day
  and ~714/day at 200 RFQs/day, against an estimated free-plan capacity of 150–300 images/day.
  **The ceiling falls at the bottom of the target user range**, and it is a daily-budget ceiling,
  not only a burst ceiling. Verify the current plan/limits in the Cloudflare dashboard.

Changes:

- `ranking.ts` no longer inserts `generated_artifacts` / `image_render_jobs` rows or enqueues a
  render when a ranking run completes. `ranking_results.is_image_winner` still marks rank one;
  ranking, ordering, ties and the persisted result set are unchanged.
- New non-secret Worker variable `AUTO_RANK_ONE_IMAGE` (default `"0"`) restores the previous
  behavior when set to `"1"`. Covered by a test.
- `downloadArtifact` writes a `QUOTE_IMAGE_DOWNLOADED` audit event (preview flag + issuer only) so
  **real image demand can be measured**. Query this before sizing any further rendering work.
- Frontend hint text no longer promises automatic rendering; the on-demand buttons already existed
  for ranks 1–4 and the custom fifth.

This was mitigation, not the structural fix. The structural fix follows in ADR 0017.

## Client-side quote-card rasterization (ADR 0017)

The default image path no longer uses Browser Rendering at all.

- New `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/card` and
  `.../trades/:tradeCode/quotes/:quoteId/card` return the rendered card document inside JSON.
- **Authorization is now shared, not duplicated.** `authorizeCardQuote` in `artifacts.ts` is the
  single path used by both the card endpoint and `requestTradeArtifact` (ownership, `COMPLETED`,
  current ranking run, economic ranks 1–4 or custom-fifth candidate). `loadCardTrades` and
  `QUOTE_CARD_WIDTH_PX` are likewise shared, so the client card and the server artifact cannot
  drift apart.
- `backend-client.js` loads the document into an offscreen `sandbox="allow-same-origin"` iframe
  (html2canvas can read the DOM; scripts stay blocked), waits for `document.fonts.ready`,
  rasterizes at `scale: 2` and downloads the PNG. No queue message, no R2 object.
- **Fallback retained:** html2canvas comes from a CDN that some corporate networks block. If
  `window.html2canvas` is missing, the button falls back to the server-rendered artifact.
- Capacity now scales with the number of users instead of three shared browsers, and default-path
  images are not exposed to the 7.3% `BROWSER_RENDER_FAILED` rate.
- Default-path images are **not persisted** (no artifact row, no R2 object, no 90-day expiry). The
  download is the deliverable; the artifact path still exists when an archived copy is needed.

### Mobile/tablet 「產圖中…」 hang — fixed

Reported symptom: on phones and tablets the 下載報價圖 button stayed on 「產圖中…」 indefinitely.

Root cause was structural: `renderCardLocally` had **four unbounded `await`s** (iframe `load`,
`document.fonts.ready`, `html2canvas()`, `canvas.toBlob()`). None could ever reject, so if any one
stalled, the promise never settled and the caller's `catch`/label reset never ran. The frame was
also `visibility:hidden` and positioned offscreen, a configuration mobile WebKit deprioritizes or
skips laying out — and html2canvas creates its *own* nested iframe inside ours and waits for that
frame's `load` event.

Measured in a reproduction harness (`scale: 2`, real vendored html2canvas):

| trades | canvas | pixels | raw bitmap |
| --- | --- | --- | --- |
| 1 (the actual per-trade card) | 1440×2428 | 3.5M | 13 MB |
| 3 | 1440×7076 | 10.2M | 40 MB |
| 6 | 1440×14144 | **20.4M** | **78 MB** |

Desktop Chromium backs canvases up to ~64M pixels, which is why the flow always succeeded there.
**iOS/iPadOS cap canvas area near 16.7M pixels (5M on low-memory devices) and silently return a
blank canvas instead of throwing.** A `display:none` frame measures `scrollHeight` 0; `opacity:0`
in-viewport measures correctly.

Fixes in `backend-client.js`:

- Every step is wrapped in `withRenderTimeout` (12s). The button can no longer stick, whichever
  step stalls, and a local failure now **falls through to the server renderer** so an image is
  still produced. `fonts.ready` timing out is non-fatal — rendering with the fallback face beats
  failing the export.
- The frame is now render-eligible: `opacity:0` inside the viewport behind the page, instead of
  offscreen `visibility:hidden`.
- Scale is clamped to keep the bitmap under a 12M-pixel budget
  (`sqrt(budget / (width × height))`, capped at 2), so tall cards cannot exceed mobile limits.
- Zero measured height is now an explicit error rather than a silent 0×0 canvas.
- The result is shown in a preview dialog with a 長按圖片→儲存影像 hint plus a download link,
  because iOS Safari does not reliably honor `<a download>` for blob URLs — the previous code
  called `link.click()` and assumed it worked.

Verified in-browser: the timeout guard fires on a never-settling promise, and the `opacity:0`
frame rasterizes to 1440×2536 (3.7M px, 1.27 MB PNG) for a single-trade card. **A real
iOS/Android device check is still owed** — the browser pane is desktop Chromium and cannot
reproduce mobile WebKit.

### Mobile/tablet hang follow-up — deployed

The first fix in `7f1dca3` bounded the iframe/font/html2canvas/blob steps, but it did **not**
bound the card-data `fetch`, the server-fallback request, or the result refresh awaited after the
fallback. A stalled network request could therefore still leave the button on 「產圖中…」.
The preview also opened a second native modal `<dialog>` inside the already-open RFQ-results
dialog, which is a fragile nested-modal pattern on iPadOS Safari.

Commit `99d7e9a` contains the follow-up fix in `backend-client.js`, `styles.css`, and `index.html`:

- the complete local-render flow has a 24-second deadline, including the authorized card-data
  request; timed-out fetches are aborted;
- the server-render fallback request has its own 12-second deadline, and the button is restored as
  soon as the fallback job is accepted instead of waiting for a full results refresh;
- touch devices use a 4M-pixel canvas budget and maximum scale 1.5, while desktop retains the
  12M-pixel / scale-2 budget;
- the PNG preview is now a responsive overlay within the existing results dialog rather than a
  second native modal;
- desktop/laptop users receive an additional 「在新頁面檢視」 link; the image remains responsive,
  while mobile/tablet keeps the preview and long-press workflow; and
- `index.html` advances the backend-client cache key from `backend-v1` to `backend-v2`.

Read-only production evidence collected before the patch: all 41 `generated_artifacts` and all 41
completed image jobs were `READY`/completed; after the `7f1dca3` deployment, all 6 server-fallback
jobs completed in 5.34 seconds on average (6.28 seconds maximum). This points to the client
promise/UI lifecycle rather than a stuck Browser Rendering queue.

Verification completed locally: `node --check backend-client.js`, `node --check app.js`,
`pnpm run typecheck`, `pnpm test` (16 files / 103 tests), and `pnpm run build`. A real iPad/tablet
verification remains required. The deployment and live-asset checks succeeded as recorded at the
top of this document.

### Unified quote-image dimensions — deployed

Commit `5d15d08` makes desktop, laptop, tablet, and phone client-rendered PNGs use the
same phone-size output profile: maximum scale 1.5 and maximum canvas area 4M pixels. The
server-render fallback already uses device scale factor 1.5 for the normal single-trade card, so
the normal and fallback outputs now align. Responsive preview sizing is unchanged. `index.html`
advances the backend-client cache key to `backend-v3`. Local verification passed:
`node --check backend-client.js`, `node --check app.js`, `pnpm run typecheck`, `pnpm test`
(16 files / 103 tests), and `pnpm run build`. Deployment and live-asset checks succeeded as
recorded at the top of this document.

### Self-hosted rasterizer (closes the CDN fallback risk)

`index.html` previously loaded html2canvas from `cdn.jsdelivr.net`. Corporate and bank networks
frequently block public CDNs, and when the rasterizer failed to load the button fell back to
server-side Browser Rendering — exactly the metered path ADR 0017 removed. The library is now
vendored at `vendor/html2canvas-1.4.1.min.js` and served from this application's own origin, so the
client path no longer depends on a third-party host. It is published by
`backend/scripts/prepare-assets.mjs` for both runtime modes; no CDN reference remains in the
repository.

Provenance (see `vendor/README.md`): fetched independently from jsdelivr and unpkg, byte-identical,
SHA-256 `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb`, 198,689 bytes, MIT
license header preserved. The bundle makes no third-party network requests. Do not edit the file;
treat a version change as a production dependency change requiring approval.

### Deferred: SVG rendering (**B**)

Server-generated SVG rasterized with the browser's native canvas API — no library at all and much
smaller stored objects. **Deliberately deferred.** After ADR 0017 the default path already avoids
Browser Rendering and writes nothing to R2, and self-hosting removed the CDN risk, so B's remaining
benefit is cross-device pixel consistency. It costs a full re-implementation of the card layout,
because the current design relies on flexbox/grid/`flex-wrap`, which SVG cannot lay out
automatically, and needs a subsetted CJK font embedded as a data URI to stay deterministic.

**Decide with data, not assumption:** ADR 0016 added `QUOTE_IMAGE_DOWNLOADED` audit events. Let
them accumulate for several days, then measure real image demand before committing to B.

## Deployed ZAR currency support

Commit `98d969c` is pushed and deployed as Worker
`a485a90c-56b9-4902-9192-e7b4b7f56eea`.

- The frontend currency selector now offers `ZAR` after `AUD`; the default remains `USD`.
- Server-side RFQ validation accepts `ZAR`, so the Cloudflare application does not reject a
  currency that the browser can select.
- No email table layout, issuer parser, ranking rule, database schema, migration, secret,
  dependency, lockfile or Cloudflare binding changed.
- Local verification passed: `node --check app.js`, `pnpm run typecheck`, `pnpm test`
  (16 files / 103 tests), and `pnpm run build` (Wrangler dry run).
- Post-deploy verification passed: API health and live `app.js` returned HTTP 200; both
  `https://app.yintsun66.com/` and `https://yintsun66-tech.github.io/fcnV2/` exposed `ZAR` in the
  rendered currency selector while retaining `USD` as the initial selection.

## Deployed mail-grace, late-recalculation, and custom-fifth implementation

Commit `481c220` is pushed and deployed as Worker
`68c62104-aa1d-48b9-b391-ff03695224f6`.

- The existing 900-second quote window is followed by a configurable 60-second mail-transport
  grace period. The UI keeps the 15-minute result experience, then displays
  `正在等待最後郵件轉送` until the 960-second hard deadline. Direct early finalization is disabled
  during that grace period.
- Late replies remain stored. An RFQ owner or ADMIN can explicitly create a new immutable
  recalculation version that includes eligible late replies; the existing finalized version is
  never overwritten.
- The public result table now contains economic ranks 1–4 plus a user-selected fifth issuer that
  is not already represented in the top four. The fifth selector offers the best eligible quote
  from each remaining issuer and supports the same owner-authorized image workflow.
- The backend still persists up to five economic results for compatibility/audit history, but
  public automatic ranking and custom-fifth authorization are derived server-side from the new
  ranking policy.
- No D1 migration, dependency, lockfile, secret, mail format, authentication rule, Cloudflare
  binding type, or R2 visibility change is included. `RFQ_MAIL_GRACE_SECONDS=60` is a new
  non-secret Worker variable in `backend/wrangler.jsonc`.
- Local verification passed: `node --check backend-client.js`, `pnpm run typecheck`,
  `pnpm test` (16 files / 102 tests), and `pnpm run build` (Wrangler dry run). The build had to be
  rerun outside the filesystem sandbox after the sandbox could not read the Worker entry point.
  The in-app browser could not reach the host-only localhost server, so an authenticated visual
  walkthrough of the result dialog remains unverified.
- Post-deploy verification passed: API health returned HTTP 200; cache-busted live
  `backend-client.js` contains `backendRecalculate`, `inMailGrace`, `data-custom-fifth-select`, and
  `alternateQuotes`; live `styles.css` contains `custom-fifth-row`.
- Preserve the untracked user-owned `.claude/` directory. The smallest remaining verification is
  an authenticated walkthrough of the grace-state countdown, late-recalculation action, custom
  fifth selector, and custom quote image.

## Production snapshot

- Application: `https://app.yintsun66.com`
- API: `https://api.yintsun66.com`
- Latest verified Cloudflare Worker version:
  `b18cba05-bd46-49b5-818e-71d36d9b9d39` (mobile quote-image render-hang fix, on top of
  client-side rasterization, the self-hosted rasterizer, on-demand images and all earlier
  behavior, deployed 2026-07-28). Post-deploy verification: `GET /api/v1/health` returned
  HTTP 200; live `backend-client.js` contains `withRenderTimeout`, `CARD_SAFE_CANVAS_PIXELS`,
  `showCardImage`, `opacity:0` and 「長按圖片」; live `styles.css` contains
  `backend-card-preview`; the vendored rasterizer is served from this origin with a matching
  SHA-256 and no third-party CDN host remains on the live page.
  Previous verified versions: `f887ba53-...` from `b7ae5fb`; `fcf61774-...` from `88bdbd9`;
  `aa7a0656-...` from `de9e8d9`; `a485a90c-...` from `98d969c`;
  `68c62104-...` from `481c220`;
  `6520b77d-...` from `4095b51`;
  `566c7456-...` from `bdd66c1`; `02311666-...` from `0d77eac`;
  `cc633dcb-...` from `0bbe159`;
  `364a345e-...` from `fd7a380`; `25d32525-...` from `0913f16`;
  `2de5b070-...` from `23c084e`.
- D1 database: `fcn-quote`; migrations applied to remote D1 now run through
  `0010_ps_privilege.sql`. Migration 0010 (additive `users.is_privileged_support` column) was
  applied to remote on 2026-07-25 and verified (`pragma_table_info('users')` shows the column);
  `wrangler d1 migrations list fcn-quote --remote` reports no pending migrations.
- Private R2 bucket: `fcn-quote-private`
- Outbound sender and inbound Email Worker address: `rfq@yintsun66.com`
- Fixed outbound recipient: `i14053@firstbank.com.tw`
- Soft reminder / quote window / mail grace / hard deadline: 420 / 900 / 60 / 960 seconds.
- The live `backend-client.js` and `styles.css` were read back after the latest deployment and
  contain the recoverable RFQ workspace markers.

A successful Worker deployment does not prove that GitHub, the bank mailbox, forwarding rules,
or issuer replies are healthy. Verify each boundary separately.

## GitHub Pages static compatibility deployment

- Public repository: `https://github.com/yintsun66-tech/fcnV2`
- Pages URL: `https://yintsun66-tech.github.io/fcnV2/`
- Deployment source: `main` branch, repository root; Pages status verified `built`.
- Initial static program commit: `2d13926712667d6717126429b18c4ec75cd15750`
  (`feat: publish FCN V2 static snapshot`).
- Current static program commit:
  `3ae50b78fb90ae9563c649ce2c1206a0591cf154`.
- Current static repository HEAD after the public README deployment record:
  `2664d3497cf8b5d0359ddccbb8e218339666217a`.
- Snapshot source: the allowlisted public assets prepared from
  `feature/subject-branch-correlation` at implementation baseline `98d969c`.
- Published files are limited to `index.html`, `styles.css`, `app.js`, `backend-client.js`,
  `guide.html`, `version-status.html`, `交易所查詢0715.csv`,
  `backend/shared/email-formats.js`, and a static-only `README.md`.
- The updated `app.js` returned HTTP 200 after the Pages build. A rendered browser check confirmed
  the static currency selector includes `ZAR`, keeps `USD` selected, and does not activate
  `backendAuth`.
- GitHub Pages is not a backend migration. It has no authentication, D1, Queue, Email Worker, R2,
  ranking, automatic mail, or private artifact service. Never copy secrets, raw mail, D1/R2
  content, personal data, migrations, Worker source, or `.dev.vars` into `fcnV2`.
- The static source allowlist lives in `backend/scripts/prepare-assets.mjs`. Future static syncs
  should use an isolated clone of `fcnV2`, compare exact file hashes, and review its commit
  independently from the Cloudflare Worker deployment.

## Read-only production RFQ audit (reviewed 2026-07-27)

This audit used aggregate/read-only D1 queries. No RFQ, quote, job, mail, artifact, user, secret or
Cloudflare resource was changed. No raw mail, account identifier, RFQ ID, full subject, correlation
code or real quote value was copied into the repository.

- D1 contains 43 RFQs created from 2026-07-21 through 2026-07-24: 31 `COMPLETED` and 12
  `NO_VALID_QUOTE`. There is no RFQ currently stuck in `DRAFT`, `VALIDATED`, `QUEUED`, `SENDING`,
  `WAITING`, `PARTIAL` or `FINALIZING`, and no workflow-level `FAILED` RFQ. There is no RFQ record
  after 2026-07-24 10:45 UTC.
- All 344 outbound batches (43 RFQs × 8 profiles) are `SENT`, each in one attempt; all 344 outbound
  jobs completed. Therefore the observed incomplete outcomes are not caused by an outbound Queue
  or Worker send failure. `SENT` still proves provider acceptance, not bank inbox delivery.
- The first 10 `NO_VALID_QUOTE` RFQs used the former 10-minute deadline and received zero linked
  inbound messages. Separately, 45 early messages on 2026-07-22 are `UNMATCHED_RFQ`; every one
  lacks an RFQ tag/hash in the normalized subject and cannot be uniquely correlated from preserved
  thread headers. They must not be guessed/reassigned to historical RFQs.
- The remaining two `NO_VALID_QUOTE` RFQs used the 15-minute deadline and received 9 and 8
  correlated issuer messages. They contained no finite valid target quote: issuer evidence
  included out-of-range/rejection responses, blank target values, `*Price Unavailable`, and
  `Pls see below`. Their economic outcome is genuinely no valid quote, although several terminal
  labels should be made more accurate.
- SG replies use `At Maturity` for an EKI-style barrier. The current `barrier()` alias set does not
  recognize it, so two out-of-range SG replies became `PARSE_ERROR`/`AMBIGUOUS_TRADE_MATCH` rather
  than issuer rejection/no quote. DBS `*Price Unavailable` and BARCLAYS `Pls see below` are not in
  the current invalid/rejection vocabulary, producing `INVALID_VALUE` instead of a precise
  no-quote/rejection status.
- Forwarded original request tables create large non-quote row noise. Exactly 50% of stored
  BARCLAYS, DBS, JPM and CA rows, and 35.1% of MS rows, are `AMBIGUOUS_TRADE_MATCH`; the dominant
  pattern is a valid/rejected reply table followed by the quoted original request table. Issuer
  profiles should select/exclude tables before trade matching rather than rely on row-consumption
  side effects.
- Across 315 inbound messages, 228 are on-time parsed, 42 are linked late replies and 45 are the
  early untagged unmatched messages. No GS inbound message has ever been observed. CA has only two
  linked late replies and two early unmatched messages; no on-time parsed CA reply is present.
- Under the historical 15-minute cohort before ADR 0015's grace (18 RFQs), valid-reply counts are BNP/MS 15 each, DBS 14,
  JPM 13, UBS 12, NOMURA 10, SG 9, CITI 8, BARCLAYS 7, and CA/GS 0. Keep the 15-minute deadline
  as the issuer reply window while measuring current CA behavior; a longer global reply window
  should not be chosen from the old 10-minute cohort alone. New RFQs also receive the ADR 0015
  sixty-second transport grace.
- Ranking is not stuck: all 43 rank jobs completed. Image rendering is the remaining terminal
  workflow defect: 93 artifacts are `READY`, while 9 artifacts across 6 RFQs/9 trades are
  `FAILED` with `BROWSER_RENDER_FAILED`; none of those trades currently has a ready alternative
  artifact. The stored error loses the Browser Rendering HTTP/error category, so capacity,
  transient service failure and render-content failure cannot yet be distinguished.

## Deployed production-audit repairs (`477b3c9`, `0d77eac`)

The following minimal repairs are committed, pushed and deployed as Worker
`02311666-eefc-40c9-95d7-c446e1c24312`. They did not add a migration, dependency, lockfile,
binding, environment variable or deployment-setting change:

- `issuer-fcn-v4` maps SG `At Maturity` to `EKI`; treats DBS `*Price Unavailable` and BARCLAYS
  `Pls see below` as no-quote target values unless separate issuer error detail proves rejection;
  and excludes exact known forwarded-original BMJB/DBS/CA request header signatures before trade
  matching. It deliberately preserves otherwise identical completed response rows.
- Browser Rendering failures now retain a safe request/HTTP category, add retry jitter and write
  safe retry/failure audit events. The existing owner-authorized idempotent retry endpoint was
  reused rather than recreated; the result UI now exposes **重新產圖** for a failed artifact.
- The existing ADMIN RFQ timeline response/UI now includes a safe seven-day issuer health
  aggregate and alerts for zero inbound, parse error, timeout, unmatched/manual-review mail and
  failed artifacts. It contains no raw mail, subject, token, quote value, message ID or R2 key.
- Verification completed locally: `node --check backend-client.js`; `pnpm run typecheck`;
  targeted Vitest (3 files / 23 tests); full `pnpm test` (16 files / 90 tests); and
  `pnpm run build` (Wrangler dry-run) all passed. The sandboxed Vitest run emitted the known
  non-fatal Worker static-analysis access warning; all tests still passed. A localhost desktop
  and 390×844 mobile browser smoke check loaded the current shell without console errors; the
  mobile page reported no horizontal overflow. The ADMIN-only populated health panel was not
  exercised against production credentials.
- Deployment verification completed against the public health endpoint, unauthenticated ADMIN
  guard and current frontend assets. The ADMIN-only populated health panel still has not been
  exercised with production credentials.
- No D1 mutation or production replay/reclassification was performed. Existing historical
  quote/status rows remain unchanged; the parser changes apply to newly processed replies only.

## Deployed feature: PS tier + account management (committed `0913f16`, migrated, deployed)

Implements the operator request for an ADMIN **所有帳號列表** with last-online times, a `PS`
support tier, and delegated moderation. Committed as `0913f16`, migration `0010` applied to
remote D1, and deployed as Worker `25d32525-71ab-4aa7-9e90-5fefcea00a05` (2026-07-25).
See [ADR 0012](adr/0012-ps-tier-and-account-management.md).

- **Schema:** new migration `backend/migrations/0010_ps_privilege.sql` adds
  `users.is_privileged_support` (a safe `ALTER TABLE ADD COLUMN`; no table rebuild). The stored
  `role` CHECK stays `('USER','ADMIN')`; the Worker derives the effective role
  (`effectiveRole` in `db.ts`) so login/session return `USER | ADMIN | PS`.
- **API (`auth.ts`, `index.ts`):** `GET /api/v1/admin/accounts`; `POST /api/v1/admin/accounts/:id/{promote,demote,disable}`; `requireAdminOrPs` now gates registration review and account listing. Promote/demote are ADMIN-only; disable and registration approve/reject are ADMIN or PS. Guards keep ADMIN/PS accounts un-removable and block self-removal; removal is a soft `status='DISABLED'` + session revoke (RFQ ownership is `ON DELETE RESTRICT`).
- **UI (`backend-client.js`, `styles.css`):** new **所有帳號列表** button + dialog, visible to ADMIN/PS; registration-review button now visible to PS; per-row 升級為PS / 降級為一般 / 剔除 actions with confirmation. Server remains the source of truth.
- **Tests:** `backend/test/auth.test.ts` adds a PS lifecycle test (list, promote, PS approve, PS disable, ADMIN/PS-protection 409s, USER 403s, demote). Suite is **16 files / 85 tests** passing.
- **Verification:** local — `node --check backend-client.js`, `pnpm run typecheck`, `pnpm test` (16 files / 85), `pnpm run build` (dry run) all passed; `worker-configuration.d.ts` no diff. Post-deploy — API health 200; live `backend-client.js` carries all four Chinese action markers plus `/admin/accounts`; unauth `/api/v1/admin/accounts` returns 401.
- **Still owed:** an authenticated browser walkthrough (promote a test USER to PS, confirm PS can approve/剔除 but cannot touch ADMIN/PS rows, and that a disabled user is logged out). Commit/migrate/deploy/push are all complete; no merge to `main`.

## Deployed feature: duplicate-registration visibility (`fd7a380`)

Fixes an operator confusion: a "new" account never appeared in the pending list. Root cause —
a registration whose **login account or employee number already exists** is intentionally
answered with the same generic `202` as a new one (anti-enumeration, [auth.ts](../backend/src/auth.ts)
`register`) and **creates no user row**, so it is invisible.

- `register()` now records the colliding unique field (`employeeNumber` | `username` | `unknown`)
  in the `REGISTRATION_DUPLICATE` audit metadata — the field name only, never the value.
- `GET /api/v1/admin/registrations` also returns `duplicates { windowDays, count, latestAt, byField }`
  (7-day window). The 使用者申請審核 screen shows an amber note explaining blocked duplicates.
  Visible to ADMIN or PS.
- No schema change (reads existing `audit_events`). Deployed as Worker `364a345e-...`.
- **Diagnosed case:** account `99999` — login `99999` does not exist and pending count is 0, so
  its blocked duplicate was an **employee-number (行編) collision**: 行編 `99999` already belongs to
  an existing ACTIVE account under a different login name. Remedy: that person logs in with the
  existing account (or password recovery); the same 行編 cannot be registered twice.
- **Identifying the account (`0bbe159`):** an ADMIN-only 「以行編查詢帳號」 lookup was added to the
  所有帳號列表 dialog (`POST /api/v1/admin/accounts/lookup`, matched by keyed hash, audited without
  the queried value). To find who owns 行編 99999, an ADMIN opens 所有帳號列表, enters `99999`, and
  chooses 查詢.

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
- per-trade persistence of the first five economic ranks for compatibility/audit, with public
  results showing ranks 1–4 plus a server-validated custom fifth issuer;
- Coupon descending and Price/Strike/KO/KI ascending ranking directions;
- seven-minute provisional-result reminder, a fifteen-minute reply window followed by a
  sixty-second mail-transport grace, and an owner-authorized early-finalize action outside grace;
- immutable late replies and owner/ADMIN versioned recalculation;
- deterministic rank-one image generation plus owner-requested images for exact ranks 1–4 or a
  server-validated custom fifth quote;
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
- `backend/src/auth.ts`: registration/login/session, `requireAdmin`/`requireAdminOrPs`, PS
  promote/demote, account list/disable, employee-number lookup, and duplicate-registration
  summary. `backend/src/db.ts`: `loadSession` + `effectiveRole` (USER|ADMIN|PS derivation).
- `backend/src/rfqs.ts`: RFQ create/read/list/validate behavior.
- `backend/src/outbound.ts`: outbound snapshot and Queue processing.
- `backend/src/inbound.ts`, `backend/src/inbound-parser.ts`: MIME intake and correlation/parsing.
- `backend/src/issuer-profiles.ts`: issuer-specific row parsing and units.
- `backend/src/quote-normalize.ts`: canonical quote normalization and expected-issuer terminal
  states.
- `backend/src/rfq-timing.ts`: seven-minute reminder, fifteen-minute reply window, sixty-second
  grace, and combined hard-deadline helpers.
- `backend/src/ranking-policy.ts`: shared normal/recalculation eligibility, economic ranking, and
  custom-fifth candidate policy.
- `backend/src/ranking.ts`, `backend/src/results.ts`: versioned finalization, persisted ranking,
  public result contracts, and owner/ADMIN recalculation.
- `backend/src/artifacts.ts`: image jobs, the shared `authorizeCardQuote` / `loadCardTrades`
  helpers, and the `getTradeCardDocument` endpoint used by client-side rasterization.
  `backend/src/quote-card.ts`: the card template and the exported `QUOTE_CARD_WIDTH_PX`.
- `vendor/`: self-hosted third-party browser assets (currently html2canvas). Do not edit; see
  `vendor/README.md` for provenance, the recorded SHA-256, and the update procedure. `.gitattributes`
  marks `vendor/**` as `-text` so the bytes survive checkout on Windows.
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
node --check app.js
node --check backend-client.js
Set-Location backend
pnpm run typecheck
pnpm test
pnpm run build
```

Results:

- JavaScript syntax: passed.
- TypeScript source and test checks: passed.
- Full test suite: **16 files / 103 tests passed**.
- Cloudflare Worker dry-run build: passed.
- Production health/static readback for Worker
  `b18cba05-bd46-49b5-818e-71d36d9b9d39`: HTTP 200; the live `backend-client.js` contains
  `withRenderTimeout`, `CARD_SAFE_CANVAS_PIXELS`, `showCardImage` and 「長按圖片」; the live
  stylesheet contains `backend-card-preview`. Earlier deployment checks verified the
  quote-card endpoint guard (401 unauthenticated), the self-hosted rasterizer's SHA-256, and the
  PS/account-management, duplicate-registration and 以行編查詢帳號 guards.

`backend/vitest.config.ts` reads migrations with `readD1Migrations("./migrations")`, so a new
migration is exercised by the suite automatically.

Authenticated browser walkthroughs remain outstanding for ADMIN/PS account interactions, ADR 0015's
grace/recalculation/custom-fifth workflow, and — newly — the quote-image download on a **real
iOS/Android device** (see "Safe next steps"). Treat these as UI verification gaps, not evidence
that the verified API/static deployment failed.

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

## Issuer-parser corrections committed and deployed

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
- Implementation commit `ae0c0e2` is deployed as Worker
  `4ca06f90-3bec-43eb-8d03-141c83d454ed` and is pushed. Existing finalized RFQs are not
  automatically reparsed or reranked; use a new RFQ to verify the correction unless a separately
  reviewed, versioned reprocessing workflow is implemented.

## Historical DAC subject-routing marker (deployed, superseded by ADR 0013)

- The ADR 0011 implementation inserted the literal `DAC/DRA` immediately after
  `FCN(T+7)` and before the branch label and correlation tags. FCN-only subjects remain
  unchanged.
- The rule recognizes canonical `DAC` plus the issuer aliases `DRA`, `WRA`, and
  `Range Accrual`. The shared browser/Worker email module owns the rule, while the Worker
  snapshots the product-aware subject into `outbound_email_batches.base_subject`.
- Marker insertion is idempotent, so Queue retries do not duplicate `DAC/DRA`; recipients,
  HTML tables, sender settings, correlation tokens, and inbound parser rules are unchanged.
- The current model still permits mixed FCN/DAC trades in one RFQ. Because an issuer chooses
  one pricing module from one email subject, any mixed request is ambiguous; current behavior
  marks the email as DAC rather than silently omitting the DAC routing signal. A separate
  product-batch design requires explicit approval.
- Verification: shared-module syntax check, TypeScript source/test checks, the full test suite
  (16 files / 84 tests), and the Cloudflare dry-run build passed. Post-deploy health and live
  asset checks returned HTTP 200. Deployment verification itself did not send real mail; the
  subsequent authorized production evidence is recorded below.
- Implementation commit `23c084e` is deployed as Worker
  `2de5b070-6feb-4f1f-bf28-e710a0589793` and pushed to
  `origin/feature/subject-branch-correlation`.

## Authorized production DAC evidence (reviewed 2026-07-25)

- A post-deploy three-trade DAC RFQ sent all eight request batches with
  `FCN(T+7) DAC/DRA <branch> [RFQ:<code>][BATCH:<code>]`; every outbound batch reached `SENT`.
- Eight issuer replies correlated by the short subject code and completed MIME/table parsing.
  BNP, MS, JPM, NOMURA, UBS, DBS, and SG produced valid DAC quotes. The ranking run completed
  with five persisted results per trade, and all three rank-one quote images reached `READY`.
- This proves the deployed SG fixed-period mapping and UBS `VMRAN` alias end to end. It also
  proves that the bank forwarding wrapper can preserve enough original sender/subject evidence
  for those observed issuers. It does not prove behavior for issuers that did not reply.
- Barclays did reply from its allowlisted COMET sender and was correctly identified/correlated.
  Its reply preserved the `DAC/DRA` subject marker but rejected Product=`DAC` on all three rows
  with the safe error `Incorrect product name in "Product" column for Fixed Coupon Note`.
  The backend correctly recorded `ISSUER_REJECTED`; this is not `NO_QUOTE`, `PARSE_ERROR`, or
  missing inbound mail.
- The accepted Barclays DAC product code and exact module-selection subject remain unknown.
  Possible names such as `DRA` or `Range Accrual` are hypotheses only and must not be deployed
  without confirmation from Barclays/bank operations.
- BMJB is one shared request for BNP/MS/JPM/BARCLAYS. Because the same Product=`DAC` request
  produced valid BNP/MS/JPM replies, changing BMJB globally could break three working issuers.

  A Barclays-specific request profile/batch also requires confirmation that the bank forwarding
  workflow can route it separately, followed by an approved API/schema/email-format plan.
- CITI, GS, and CA had no correlated reply before the 15-minute deadline in this observed RFQ
  and ended `TIMEOUT`; this does not change the Barclays diagnosis.
- No raw MIME, full subject token, personal address, RFQ ID, or real quote fixture was committed.

## Deployed first-trade product subject change (`bdd66c1`)

- ADR 0013 supersedes the separate subject marker for newly created requests. The first trade now
  selects `FCN(T+7)` or `DAC(T+7)`, and the literal segment ` DAC/DRA` is removed.
- Only the first row controls the subject in a mixed FCN/DAC RFQ, per the approved requirement.
  Later rows do not change the pricing-module label.
- The shared browser/Worker email-format helper owns the rule. New Worker batches snapshot the
  resulting base subject; the Queue consumer preserves an already saved base-subject snapshot so
  a legacy queued batch is not made unsendable by a code update.
- Sender, recipient, branch label, correlation tags, mail table/body Product values, inbound
  parsing, schema, dependencies, secrets and Cloudflare bindings are unchanged.
- Verification passes: syntax checks for `app.js` and the shared email helper; backend source/test
  typecheck; targeted email-format/outbound tests (2 files / 18 tests); full suite (16 files /
  91 tests); and the Cloudflare dry-run build. Vitest emitted the known non-fatal sandbox
  static-analysis warnings; all tests passed.
- Commit `bdd66c1` is pushed and deployed as Worker
  `566c7456-7e0f-42ac-9341-823c533ead71`. Public health and cache-busted source-asset checks
  passed. No real RFQ was sent as a deployment test, so bank/issuer module routing under the new
  title still requires one separately authorized controlled RFQ.

## Deployed issuer-specific DAC/DRA subject labels (`4095b51`)

- ADR 0014 preserves first-row routing and FCN=`FCN(T+7)`, but maps DAC-family subjects by
  outbound batch: NOMURA/DBS/SG/GS/CA use `DRA(T+7)`; BMJB/UBS/CITI keep `DAC(T+7)`.
- The mapping is stored in the shared email institution profiles, so browser/manual and
  Worker/automatic mail use the same rule. `outbound.ts` snapshots the configured label; the
  Queue consumer still preserves an existing subject snapshot.
- Mail body Product mappings, recipient/sender, branch label, correlation tags, inbound parsing,
  schema, dependencies, lockfile, secrets and Cloudflare bindings are unchanged.
- Verification passes: JavaScript syntax checks; backend source/test typecheck; targeted
  email-format/outbound tests (2 files / 26 tests); full suite (16 files / 99 tests); and the
  Cloudflare dry-run build. Vitest emitted the known non-fatal sandbox static-analysis warnings;
  all tests passed.
- Commit `4095b51` is pushed and deployed as Worker
  `6520b77d-c8a7-4d9d-94d8-37a5a0e6f384`. Public API/static-source verification passed.
  No real RFQ was sent as a deployment test, so issuer module routing still needs one separately
  authorized controlled RFQ.

## Production gaps and cautions

1. A batch marked `SENT` means Cloudflare accepted it; it is not proof of delivery to the bank
   inbox.
2. Cloudflare cannot poll `i14053@firstbank.com.tw`. Issuer replies must be forwarded by the bank
   mailbox to `rfq@yintsun66.com`. Production evidence now proves usable sender/subject
   preservation for eight observed replies, but not for every issuer/template.
3. `BMJB` is not an issuer identity. BNP/MS/JPM/BARCLAYS must be distinguished by the preserved
   original sender/domain.
4. Subject/body correlation fallback exists, but some real forwarded messages have reached
   `UNMATCHED_RFQ`. Never guess ownership or trade matching.
5. **GS/CA reply behavior (reviewed 2026-07-23).** GS has never produced an observed inbound
   message — likely no upstream quoting/forwarding, not a parser defect. CA *does* reply and its
   format parses and matches trades correctly (not a format bug like SG was); the issue is speed.
   Correlated CA replies were observed **~12.8 and ~25.4 minutes after send**, measured under the
   old 600s deadline so both landed as `LATE_REPLY`/`TIMEOUT`. The current 900s reply window plus
   60s grace would capture the ~13-minute case but not the ~25-minute one; CA has not yet been
   re-tested under the current timing. Reliably capturing CA's slow replies would need a longer
   `RFQ_DEADLINE_SECONDS` reply window (e.g. 1800s), which lengthens the wait for every RFQ — a
   user decision.
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
11. **DAC-architecture parsing (updated 2026-07-25).** DRA/WRA/Range Accrual aliases normalize
    to canonical DAC, MS uses its separate shifted DRA layout, UBS reply-only `VMRAN` is recognized,
    and SG derives DAC from validated 1-24 fixed-coupon period values while retaining
    `All Periods` as FCN. An authorized live RFQ proved SG/UBS end to end. Barclays COMET instead
    rejected Product=`DAC` even though the `DAC/DRA` subject marker survived; its accepted DAC
    outbound product code remains unknown. Do not guess or change the shared BMJB format without
    issuer/bank confirmation.
12. **Roles and account management (ADR 0012).** Effective roles are `USER｜PS｜ADMIN`; `PS` is the
    `users.is_privileged_support` flag (migration `0010`), never a stored `role` value —
    always compare against the effective role from `effectiveRole`/the session, not the raw column.
    Account removal is a soft `status='DISABLED'` (RFQ ownership is `ON DELETE RESTRICT`); do not
    hard-delete users. ADMIN/PS accounts are protected by SQL `WHERE` guards, not only the UI.
    Employee numbers stay out of the 所有帳號列表; the ADMIN-only `POST /admin/accounts/lookup`
    matches by keyed hash and must never log the queried 行編. The `register()` duplicate path is
    intentionally silent to the applicant (anti-enumeration); surface duplicates to reviewers only.

## User-owned/untracked work to preserve

- `.claude/settings.local.json` is intentionally untracked and belongs to the user. Do not add,
  modify, delete, or include it in a commit unless the user explicitly requests that exact file.
- `backend/scripts/smoke-outbound-email.ps1` was manually deleted by the user, was never tracked,
  and must not be recreated. A replacement could create a real RFQ and send real bank email.
- Never commit raw `.msg`, MIME, real mail bodies, credentials, Cloudflare tokens, D1 exports,
  R2 content, or unredacted personal data.

## Safe next steps

**Highest-value item right now: the quote-image download on a real phone/tablet.** ADR 0017 moved
rasterization into the requesting browser and `7f1dca3` fixed a hang that only reproduced on mobile
WebKit. The reproduction harness was desktop Chromium, so mobile behavior is reasoned from measured
canvas sizes plus known iOS limits, **not observed on a device**. Ask the operator to press
下載報價圖 on a phone/tablet; the three outcomes and what each means are recorded in the
"Mobile/tablet 「產圖中…」 hang" section. If the message names a timed-out step, that step is the
next thing to fix.

**Second: decide ADR 0017-B with data, not assumption.** `QUOTE_IMAGE_DOWNLOADED` audit events have
been collected since `de9e8d9`. Measure real image demand before investing in the deferred SVG
renderer; after the client-side move and the self-hosted rasterizer, B's only remaining benefit is
cross-device pixel consistency.

Production-audit repair order:

- Run one new controlled RFQ and review it through the ADMIN seven-day health panel. Historical
  rows are intentionally not re-parsed or rewritten automatically.
- Use the ADMIN seven-day health panel to verify whether current GS/CA replies reach the inbound
  route and whether Browser Rendering HTTP failures recur. Do not infer bank delivery from `SENT`.
- MS forwarded-original-table noise remains unproven at a safe header-signature level. Do not add
  a broad table-index or duplicate-row filter without a synthetic fixture derived from a
  production-observed, anonymized MS layout.

1. Start by reading `AGENTS.md`, this file, the relevant ADR/contracts, current branch/status, and
   the exact entry point/tests for the requested task.
2. Perform a controlled authenticated browser walkthrough:
   open **我的詢價**, switch filters, reopen an active/completed RFQ, reload a `?rfq=` URL, and
   verify another user receives `404` for ownership-protected resources.
3. For email troubleshooting, use the ADMIN timing/archive views and structured D1 status fields;
   do not expose or commit raw mail. A real outbound RFQ sends bank email and therefore requires
   explicit user authorization.
4. Before changing Barclays DAC outbound behavior, obtain its accepted Product value and exact
   subject contract. Decide whether bank operations can route a Barclays-specific request. Do
   not globally change BMJB because Product=`DAC` is already proven for BNP/MS/JPM.
5. If changing issuer parsing, add an anonymous synthetic regression fixture and preserve raw
   units, normalized units, invalid/no-quote states, and matching rules.
6. If changing schema, bindings, secrets, authentication, email routes, dependencies, or
   production behavior, stop and obtain explicit approval before editing or deploying.
7. Before handback, run the applicable verification baseline, inspect the complete Git diff,
   update this file with exact evidence, and report whether commit, push, migration, and deploy
   each occurred.
8. End-to-end checks still owed:
   - **Quote-image download on a real iOS/Android device (highest value).** Press 下載報價圖 and
     confirm the preview dialog appears and the image can be long-pressed and saved. A message of
     the form 「本機產圖逾時（步驟）改用伺服器產圖…」 means the hang is fixed but the local path
     still fails on that device — the named step identifies what to fix next.
   - **ADMIN/PS admin walkthrough.** As ADMIN (14053): open
     **所有帳號列表**, confirm last-online times; promote a test USER to PS and confirm that USER
     re-logs-in as PS; as that PS confirm it can 核准/剔除 a regular USER but sees no action on
     ADMIN/PS rows and no 以行編查詢帳號 box; confirm a 剔除'd user is logged out; demote the PS
     back; use 以行編查詢帳號 to resolve a「行編已存在」case; confirm the duplicate-registration
     amber note appears after a duplicate attempt.
   - The ADR 0015 result workflow: observe the 15:00–16:00 grace state, confirm early-finalize is
     unavailable, exercise an owner and ADMIN late-reply recalculation, select a custom fifth
     issuer outside ranks 1–4, and generate/download that issuer's image.
   - Selective per-issuer sending through the issuer picker (especially BMJB grouping), visual
     confirmation of the DAC/DRA floating-income note on a downloaded production image, Barclays
     DAC routing/code, and CA latency under the current fifteen-minute reply window plus
     sixty-second grace.

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
