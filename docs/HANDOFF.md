# Project handoff

Updated: 2026-07-22 (Asia/Taipei)  
Branch: `feature/subject-branch-correlation`  
Latest relevant commit: `e4c0b7d feat(artifacts): add mobile issuer-switchable quote images`

## What is live

- Application: `https://app.yintsun66.com`
- API: `https://api.yintsun66.com`
- Latest verified Cloudflare Worker version: `6496baa9-8c7c-4c0b-b93e-215af221fc69`
- Current deployment includes the ADMIN user-registration review dialog and the private-R2 outbound-email archive viewer.
- The public API health endpoint returned `{ "status": "ok" }` after the latest deployment. The deployed frontend asset contains the registration-review feature markers.

The Cloudflare deployment and Git remote are separate facts. This branch was committed and deployed locally; check `git status -sb` and the configured upstream before assuming the commit has been pushed to GitHub.

## Current implementation state

- Root static application remains compatibility UI for FCN/DAC and GitHub Pages.
- `app.yintsun66.com` serves the same root application assets through the Cloudflare Worker and activates `backend-client.js`.
- The backend supports registration, application-managed username/password login, ADMIN role checks, RFQ creation/validation/sending, eight outbound mail batches, eleven expected issuers, inbound MIME intake, parsing/normalization, ten-minute finalization, ranking, and private quote-image artifacts.
- Outbound mail is sent from `rfq@yintsun66.com` to the fixed recipient `i14053@firstbank.com.tw` through the Cloudflare email binding.
- Issuer replies must be forwarded from the bank mailbox to `rfq@yintsun66.com`; Cloudflare cannot log into or poll the bank mailbox directly.
- ADMIN controls currently include:
  - **使用者申請審核**: lists pending registrations and approves/rejects them with server-side ADMIN/CSRF checks and audit events.
  - **管理者寄件紀錄**: reads archived outbound subject/HTML/plain text from private R2 using authenticated admin endpoints.

## Important current limitations / known gaps

1. A Cloudflare `SENT` batch indicates provider acceptance, not proven inbox delivery. Earlier RFQs from username `14053` reached `WAITING` and eventually `NO_VALID_QUOTE`; valid issuer replies were not observed before the deadline.
2. The real bank forwarding chain must still be verified with a controlled issuer-style reply. Capture the actual headers/MIME that reach the configured inbound address before treating automatic issuer recognition as fully production-proven.
3. MS remains display-warning only (`MS（OBU不得承做）`). There is no approved account-level OBU attribute or enforcement rule.
4. The true Cloudflare Browser Rendering capacity and email-product limits need observation under real traffic. Queue retries protect workflow progress but do not prove capacity.
5. Several older design documents contain historical language such as “Phase 1 draft” or “no deployment.” Use current code, `wrangler.jsonc`, Git history, this handoff, and live verification for current state; update stale documents only in a scoped documentation task.

## Preserve this user-owned work

- `backend/scripts/smoke-outbound-email.ps1` was previously untracked and explicitly excluded from commits/deployments. On 2026-07-21 it was no longer present in the workspace or the searched `Documents` tree, and it was never Git-tracked.
- Do not recreate it from memory or run a replacement without the user's original source and explicit approval. It was an operational test that could create a real RFQ and send real messages.
- The existing `backend/scripts/prepare-assets.mjs` only deletes and recreates generated `backend/public/`; it does not delete `backend/scripts/`.

## Recent verification evidence

For the current backend branch through commit `ff12ef5`:

- `node --check backend-client.js` passed.
- `pnpm test` passed: 14 test files, 57 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed (Worker deploy dry run).
- Production deployment succeeded and uploaded the SG email-format assets (`app.js` and `backend/shared/email-formats.js`).

## Safe next steps

1. Log in with an account whose application role is `ADMIN`; open **使用者申請審核** and approve/reject a controlled test registration.
2. Verify the bank-mailbox forwarding rule by forwarding a controlled real issuer-style reply to `rfq@yintsun66.com` and inspect its preserved headers through the application’s private intake/audit path.
3. Before changes, follow `AGENTS.md`; after changes, update this file with exact test/deploy evidence.

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
