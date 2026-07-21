# Claude Code entry point

Before taking any action, read and follow [AGENTS.md](AGENTS.md). It is the shared, canonical instruction set for every coding agent in this repository.

Then read, in this order:

1. [docs/HANDOFF.md](docs/HANDOFF.md)
2. The relevant file in `docs/backend/`, `docs/runbooks/`, or `docs/adr/`
3. Current `git status --short`, branch, and recent commits
4. The entry point and tests related to the requested change

Do not duplicate, override, or silently relax `AGENTS.md`. Work in a separate worktree/branch from other agents, preserve untracked user work, and update `docs/HANDOFF.md` before handing the repository back to another agent.
