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
- `feature/subject-branch-correlation` is the previous stable backend ancestor. Production source is
  `codex/market-analysis-phase2-4`, **merged into `main` again on 2026-08-01** (`9346760`) with a
  tree byte-identical to the branch, so `main` carries the full Cloudflare backend rather than the
  old static-only set. Do not assume the two stay equal: deployment still runs `wrangler deploy`
  from a working tree, not from `main`, so the branch can move ahead again. Resolve what is
  deployed from `wrangler deployments list`, not from a branch name.
- Production implementation commit `599a31d` is documented by this handoff and
  currently served by Worker `7ea7c41e-ae32-4610-92c5-39f879779919` on 2026-08-01. Resolve the
  current branch HEAD from Git rather than copying a historical handoff hash. The current
  verification baseline is 27 test files / 197 tests. A deployment record is evidence of
  Worker/static-asset publication, not evidence that real bank mail was delivered.
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
  program commit `7af6b6d` (status-document HEAD `cdafc8a`) mirrors the approved public asset set
  with ZAR, market hot lists, the Zimbra manual-mail fallback, the PIN-gated follow-board page with
  API fallback, and the front-end performance fixes. It contains no Cloudflare
  backend or data. Future static syncs must copy only the allowlisted files from
  `backend/scripts/prepare-assets.mjs`, plus the public status/README documents; never mirror the
  whole backend directory. Compare the two sites over HTTP, not by hashing working-tree files:
  Cloudflare serves the Windows working copy (CRLF for files nobody has rewritten) while GitHub
  Pages serves the git-normalized LF blob, and Cloudflare injects a ~359-byte Web Analytics beacon
  into every HTML response. Normalize line endings and ignore that beacon before calling a
  difference real.
- ADR 0015 is the current timing/ranking contract. `RFQ_DEADLINE_SECONDS=900` is the issuer reply
  window, not the complete hard deadline. `RFQ_MAIL_GRACE_SECONDS=60` extends persisted
  `deadline_at` and the Durable Object alarm to 960 seconds. During the final minute the UI shows
  `正在等待最後郵件轉送`, stays provisional, and must not allow early finalization.
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
  ADR 0019 additionally permits ADMIN-only permanent deletion of a disabled plain USER with zero
  RFQs after exact-login confirmation. Never hard-delete an account with RFQs, an ADMIN, a PS, or
  the current ADMIN. ADMIN/PS accounts are protected by SQL `WHERE` guards. The ADMIN-only
  `POST /admin/accounts/lookup` must never log the queried 行編, and `register()` stays silent to
  the applicant on duplicates (anti-enumeration). Remote D1 migrations are applied through
  `0015`; migration `0010` remains the role/account-management boundary.

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
