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
- `feature/subject-branch-correlation` is the previous stable backend ancestor. Current production
  source is `codex/market-analysis-phase2-4`, and neither branch is automatically equivalent to
  `main`.
- Production implementation commit `335a561` is documented by this handoff and
  deployed as Worker `2e32a971-b1e4-482b-b3e4-300b1bb89c50` on 2026-07-30. Resolve the current
  branch HEAD from Git rather than copying a historical handoff hash. The current verification
  baseline is 20 test files / 137 tests. A deployment record is evidence of Worker/static-asset
  publication, not evidence that Alpha Vantage returned usable data or that real bank mail was
  delivered.
- `yintsun66-tech/fcnV2` is a separate public static snapshot repository. Its `main` branch is
  published from the repository root to `https://yintsun66-tech.github.io/fcnV2/`; current static
  program commit `fcd2996` mirrors the approved public asset set with ZAR, market hot lists and
  the Zimbra manual-mail fallback. It contains no Cloudflare
  backend or data. Future static syncs must copy only the allowlisted files from
  `backend/scripts/prepare-assets.mjs`, plus the public status/README documents; never mirror the
  whole backend directory.
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
- ADR 0023 replaces the FRED runtime path with SEC plus Alpha Vantage end-of-day data. Migration
  `0012` and the `ALPHA_VANTAGE_API_KEY` Secret name exist in production, but the first ORCL, TSM
  and market-movers requests returned an Alpha Vantage `Information` envelope and produced no
  normalized payload. Treat the public market panel as non-blocking and verify that the Secret is
  an activated Alpha Vantage key before changing parser, cache, RFQ or ranking code. Never log,
  retrieve or commit the Secret value.
- Late replies remain immutable. Normal ranking excludes them; an RFQ owner or ADMIN may create a
  new version through the existing recalculation endpoint, which admits only finite, matched,
  non-rejected late values. Never rewrite the previous ranking version or original quote status.
- ADR 0025 defines the follow-board boundary. Publication commands are accepted only from the
  three approved First Bank mailboxes with aligned authentication and unique reply/token evidence.
  The issuer and quote terms come only from a uniquely recognized issuer table profile and the
  requested `deal-N` row; never select a follow-board product from an RFQ batch or ranking.
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
  `0012`; migration `0010` remains the role/account-management boundary.

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
