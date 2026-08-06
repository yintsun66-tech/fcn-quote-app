# Claude Code entry point

Before taking any action, read and follow [AGENTS.md](AGENTS.md). It is the shared, canonical
instruction set for Codex, Claude Code, and every other coding agent in this repository.

## Startup checklist

Read and inspect, in this order:

1. [docs/HANDOFF.md](docs/HANDOFF.md) for the current branch, production version, verified
   behavior, known gaps, and next safe step.
2. The relevant architecture, contract, runbook, and accepted ADR under `docs/`.
3. `git branch --show-current`, `git status --short`, staged/unstaged/untracked changes, upstream
   state, and recent commits.
4. The exact entry point, public interface, migration/binding implications, and existing tests for
   the requested change.

Treat current code, Git history, tests, Cloudflare configuration, and the latest handoff as source
of truth. Do not infer current behavior from old chat transcripts or historical “pending” notes.

## Repository-specific cautions

- Work in a separate branch/worktree when another agent may be active. Never let two agents edit
  this working tree concurrently.
- Preserve the user-owned, untracked `.claude/settings.local.json`; do not commit it.
- Do not recreate `backend/scripts/smoke-outbound-email.ps1`. It was manually deleted by the user
  and could send real bank email.
- Do not edit generated `backend/public/`, `backend/dist/`, or
  `backend/worker-configuration.d.ts`.
- A real RFQ, email-route change, D1 mutation, migration, commit, push, merge, or deployment
  requires explicit user authorization.
- `feature/subject-branch-correlation` is the previous stable backend ancestor. The current feature
  source is `codex/market-analysis-phase2-4` at `8165539`; it is merged into `main`, whose current
  HEAD is `f11da30`. Their trees were compared on 2026-08-02 and are byte-identical. Do not assume
  they remain equal: deployment still runs `wrangler deploy` from a working tree, not from `main`,
  so either branch can move independently. Resolve what is deployed from
  `wrangler deployments list`, not from a branch name.
- The current production Worker is `911c5297-4bb9-4384-bfd7-88658e6022fc`, deployed on
  2026-08-05 from feature-branch state recorded by `62949d0`. Note that every `wrangler deploy`
  mints a new version ID even when only static assets changed, so any ID written here goes stale on
  the next deploy — `wrangler deployments list` is the authority, and `version-status.html`
  deliberately records no ID at all because correcting it would itself require a deploy. The
  current verification baseline is
  27 test files / 202 tests, plus root JavaScript syntax checks, typecheck and dry-run build. A
  deployment record proves Worker/static-asset publication, not that real bank mail was delivered.
- Retention (ADR 0030) is implemented but **disabled**: `RETENTION_ENABLED="0"`. Enabling it
  deletes production R2 objects and D1 rows irreversibly and requires explicit authorization. Run
  `applyRetention(env, true)` for a dry-run count first. Never clear
  `inbound_messages.r2_raw_mime_key` — it is `NOT NULL` and doing so aborts every scheduled run.
- **`fcn-quote-app` must not serve GitHub Pages.** It had Pages enabled from `main` root — an
  undocumented third static site at `https://yintsun66-tech.github.io/fcn-quote-app/`, serving a
  147-commit-old build. It was disabled on 2026-07-31. Do not re-enable it, and check before
  merging anything into `main`. Two reasons it matters: `main` carries `.nojekyll`, so a merge
  would publish `backend/`, `docs/` and `migrations/` verbatim; and `PUBLIC_ORIGINS` in
  `follow-board.ts` allows the whole host `https://yintsun66-tech.github.io`, which is the **same
  origin** as the `fcnV2` site — so that copy would pass follow-board CORS, and
  `backend-client.js` activates on any host given `?backend=1`. A second, unvetted front end would
  drift with `main` and bypass the `prepare-assets.mjs` allowlist entirely.
- `yintsun66-tech/fcnV2` is a separate public static snapshot repository. Its `main` branch is
  published from the repository root to `https://yintsun66-tech.github.io/fcnV2/`; current static
  program commit `debea38` (status-document HEAD `d2f94ab`) mirrors the approved public asset set
  with ZAR, market hot lists, the Zimbra manual-mail fallback, the PIN-gated follow-board page with
  API fallback, the mobile trade navigator and the front-end performance fixes. It contains no
  Cloudflare backend or private data. Future static syncs must copy only the allowlisted files from
  `backend/scripts/prepare-assets.mjs`, plus explicitly reviewed public status documents; never
  mirror the whole backend directory. Keep the static repository's purpose-built README and update
  it separately instead of overwriting it with this repository's internal README. Compare the two
  sites over HTTP, not by hashing working-tree files:
  Cloudflare serves the Windows working copy (CRLF for files nobody has rewritten) while GitHub
  Pages serves the git-normalized LF blob, and Cloudflare injects a ~359-byte Web Analytics beacon
  into every HTML response. Normalize line endings and ignore that beacon before calling a
  difference real.
- ADR 0015 is the current timing/ranking contract. `RFQ_DEADLINE_SECONDS=900` is the issuer reply
  window, not the complete hard deadline. `RFQ_MAIL_GRACE_SECONDS=60` extends persisted
  `deadline_at` and the Durable Object alarm to 960 seconds. During the final minute the UI shows
  `正在等待最後郵件轉送`, stays provisional, and must not allow early finalization.
- ADR 0031 makes `rfq_expected_issuers` the ranking and quote-card authorization boundary. Shared
  BMJB replies from unselected issuers remain auditable but must never enter provisional/final
  results, custom-fifth choices or images. `POST /api/v1/rfqs/submit` is the one-round-trip wrapper;
  keep the individual create/validate/send endpoints compatible.
- On viewports up to 760 px, the shared trade-entry UI hides fixed-value fields from the visible
  form while preserving their submitted values, and exposes a sticky trade navigator for 1–20
  trades. Tablet/desktop keep the single-row table layout. Do not remove fixed values from the
  model or outbound mail merely because they are hidden on mobile.
- Public results show economic ranks 1–4 plus a server-returned custom fifth issuer outside those
  ranks. The database still persists the first five economic ranks for compatibility/audit.
  Never authorize an arbitrary quote ID only because the browser submitted it.
- Quote images are **on demand only** (ADR 0016; `AUTO_RANK_ONE_IMAGE="0"`) and are rasterized in
  the requesting browser (ADR 0017), so the default path uses no Browser Rendering and writes
  nothing to R2. `authorizeCardQuote` in `artifacts.ts` is the single authorization path for both
  the card endpoint and the server artifact — do not fork it. Browser Rendering remains the
  fallback and is still capacity-limited (`fcn-image-render` `max_concurrency: 3` plus a per-day
  browser-time budget), so do not reintroduce automatic rendering without re-measuring capacity.
  Client rasterization must keep its per-step timeouts: every await there can stall on mobile
  WebKit, and an unguarded one leaves the button stuck on 「產圖中…」 forever.
- The light/dark appearance is user-selectable. `styles-dark.css` and `follow-board-dark.css` hold
  the dark rules verbatim and are linked with `media="(prefers-color-scheme: dark)"`; a pre-paint
  inline script rewrites that attribute from the `fcn-theme` `localStorage` key. **Do not fold them
  back into `@media (prefers-color-scheme: dark)` blocks** — that silently removes the picker while
  leaving the page looking correct on whichever appearance you happen to be testing. Do not move the
  theme script into `app.js`; it must run during head parsing, and the quoting flow must not gain a
  failure mode from it. The `.download-*` and `.quote-sheet` pinning rules live inside the dark
  sheets deliberately: they exist only to counteract the dark rules, so when the picker forces light
  the sheet is off and the layout is already light. Any new stylesheet must be added to the
  `backend/scripts/prepare-assets.mjs` allowlist or it will 404 in production. When changing any
  stylesheet, bump the `?v=` token in every page that links it — content changes without a token
  bump reach the edge but not the browser.
- `vendor/` holds self-hosted third-party browser assets (html2canvas). Do not edit them, and do
  not restore a CDN `<script>` — bank networks block CDNs, which would push image rendering back
  onto the metered Browser Rendering path. See `vendor/README.md` for provenance and the recorded
  SHA-256; `.gitattributes` keeps `vendor/**` byte-exact on checkout.
- ADR 0023 replaced the FRED runtime path with SEC plus end-of-day equity data; ADR 0024 removed
  movers/rankings and kept only a per-symbol daily series. **The previous close works as of
  2026-08-01** and is served by **Twelve Data** (`TWELVE_DATA_API_KEY`), with Alpha Vantage last in
  the chain and still failing. Earlier revisions of this file said to treat previous-close data as
  unavailable; that is no longer true. `GET /api/v1/market/ideas` no longer exists; do not restore
  movers. Never log, retrieve or commit any provider key.
- Two rules in the equity path exist because breaking them fails **silently**, with a plausible
  number rather than an error. Read `docs/backend/contracts.md` before touching it. (1) Take the
  last bar whose session has actually closed — 16:15 New York, `isCompletedSession`. A Taipei
  morning is the previous New York evening, so the session the operator means is dated *today* in
  New York, and any "previous close" convenience field or previous-calendar-day rule returns the
  session before it. (2) Never use Yahoo's `meta.chartPreviousClose`; it is the close before the
  requested range begins.
- **A local `curl` proves nothing about this Worker.** Yahoo's keyless endpoint was shipped as a
  fallback on the strength of one, and it returns 200 to a residential address and 429 to
  Cloudflare's shared egress — it failed every production request while passing every developer
  test. It has been removed. Measure an outbound dependency from the Worker, or from the recorded
  `last_error_code`, before trusting it.
- Market refresh failures are kept for seven days (`ERROR_RETENTION_SECONDS`) and
  `last_error_code` carries per-provider detail. Do not shorten that or let the cleanup delete
  recent `ERROR` rows: `stale_until` used to gate both the retry and the deletion, so every failure
  was erased ten minutes after it happened and a provider stayed broken for weeks with nothing to
  diagnose. The same principle applies to `FOLLOW_BOARD_LINE_PUSHED`, which now records LINE's own
  message with identifiers redacted.
- Late replies remain immutable. Normal ranking excludes them; an RFQ owner or ADMIN may create a
  new version through the existing recalculation endpoint, which admits only finite, matched,
  non-rejected late values. Never rewrite the previous ranking version or original quote status.
- ADR 0025 through ADR 0029 define the follow-board boundary. Publication commands are accepted
  only from the three approved First Bank mailboxes with aligned authentication and unique
  reply/token evidence. The issuer and quote terms come only from one issuer table profile. Prefer
  an unambiguous table-local candidate with the exact product-code count; use message-wide unique
  complete rows only when no such table exists. `deal-N`/`deal-START~END` are audit/count metadata
  and must never select a row, RFQ batch or ranking. Multi-product publication is atomic. ADR
  0028 requires an exact declared issuer/table issuer match and a future Taiwan removal date;
  expired products are hidden immediately and archived without deletion.
  ADR 0029 displays `手收`: non-CITI uses `100 - comparablePricePct`, while CITI uses raw Upfront.
  Public snapshots must never expose RFQ/correlation/user data. Full follow-interest employee
  numbers stay encrypted and are ADMIN/PS-only; public rows remain masked. Follow-board PNGs are
  browser-rendered and are not written to R2.
- Production evidence proves DAC replies and ranking for BNP, MS, JPM, NOMURA, UBS, DBS, and SG.
  The old run used a `DAC/DRA` subject marker. ADR 0014 keeps the first-trade rule but uses
  `DRA(T+7)` for NOMURA/DBS/SG/GS/CA and `DAC(T+7)` for BMJB/UBS/CITI. Barclays COMET rejected
  body Product=`DAC`; do not guess its DAC code or change the shared BMJB body globally. Read
  ADR 0014 and the latest
  `docs/HANDOFF.md` before proposing any Barclays-specific split.
- Effective roles are `USER｜PS｜ADMIN` (ADR 0012). `PS` is the `users.is_privileged_support`
  flag (migration `0010`, applied to remote D1), never a stored `role` value — gate on the
  effective role from `effectiveRole`/the session. Account removal is a soft `status='DISABLED'`;
  ADR 0035 supersedes the earlier physical-delete boundary: ADMIN/PS may delete identifying data
  from a disabled plain USER while preserving historical RFQs under an anonymous tombstone owner.
  Never transfer or hard-delete those RFQs, and never delete an ADMIN, a PS, or the current actor.
  ADMIN/PS accounts are protected by SQL `WHERE` guards. The ADMIN-only
  `POST /admin/accounts/lookup` must never log the queried 行編, and `register()` stays silent to
  the applicant on duplicates (anti-enumeration). Remote D1 migrations are applied through
  `0018`; the account-recovery and anonymization change is deployed in production.

## Handback checklist

Before returning the repository to Codex or another engineer:

1. Run the applicable syntax, typecheck, test, and dry-run build commands from `AGENTS.md`.
2. Inspect the complete diff, `git diff --check`, current status, and any generated/secret or
   lockfile changes.
3. Update `docs/HANDOFF.md` with exact behavior, tests, blockers, commit/push/migration/deployment
   state, Worker version when applicable, and the smallest safe next step.
4. Clearly distinguish local changes, GitHub state, Cloudflare deployment, and real mail delivery;
   none proves the others.

Do not duplicate, override, or silently relax `AGENTS.md`.
