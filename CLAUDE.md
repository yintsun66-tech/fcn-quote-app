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
- `feature/subject-branch-correlation` contains the current backend work and is not automatically
  equivalent to `main`.

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
