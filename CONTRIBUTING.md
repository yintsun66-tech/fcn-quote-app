# Collaboration workflow

This project is maintained by people and multiple coding agents. Git and the repository documentation are the shared handoff mechanism.

## Before changing code

1. Read `AGENTS.md`, `CLAUDE.md`, and `docs/HANDOFF.md`.
2. Check branch, working-tree state, and the latest commits.
3. Read the relevant architecture, ADR, runbook, code, and tests.
4. State the smallest proposed file set and the verification plan when the task affects production behavior.

## Branch and worktree policy

- Use one feature/fix branch per bounded task, for example `feature/admin-approval-history` or `fix/ubs-mail-cell`.
- Use separate Git worktrees or separate clones for concurrent agents. Do not let two tools edit one worktree at once.
- Do not overwrite staged, unstaged, or untracked changes you did not create. Ask if the work overlaps.
- Keep commits focused. A commit should be easy to revert without reverting unrelated work.

## Review checklist

- Scope matches the approved task.
- No secret, token, password, raw bank email, real customer data, R2 object, or unredacted attachment is present in the diff.
- No unapproved dependency, lockfile, migration, binding, secret, infrastructure, or public API change is included.
- Relevant tests, type checks, and builds have passed.
- `git diff --check` passes and the final diff contains no unrelated formatting.
- `docs/HANDOFF.md` reflects material changes or new operational knowledge.

## Commit and deployment boundaries

- Commit only when the user explicitly asks, or when their request expressly includes a commit.
- Push, merge, deploy, change Cloudflare configuration, or invoke a real email send only with explicit user approval.
- Treat a successful Worker send as provider acceptance, not proof of delivery to `i14053@firstbank.com.tw` or of an issuer reply.
- After deployment, verify both the public asset/API and the intended behavior; document any limitation in `docs/HANDOFF.md`.

## Documentation ownership

- `AGENTS.md`: shared agent rules.
- `CLAUDE.md`: Claude Code entry point only; do not duplicate policy here.
- `docs/HANDOFF.md`: current operational state, not a long design document.
- `docs/adr/`: decisions that should not be rediscovered in chat.
- `docs/runbooks/`: repeatable human operations.
- `docs/backend/`: architecture and implementation contracts.
