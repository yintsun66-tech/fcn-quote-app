# ADR 0001: Repository governance and multi-agent handoff

Status: Accepted  
Date: 2026-07-21

## Context

The project is maintained by the user and more than one coding agent. Chat history is incomplete across sessions, while the application contains sensitive quote conditions, mail-derived data, authentication, and Cloudflare infrastructure boundaries. A handoff must be reliable without sharing credentials or allowing an agent to infer production authority.

## Decision

1. Git repository state, current code/configuration, tests, documented ADRs, and deployment evidence are the source of truth. Conversation context is secondary.
2. `AGENTS.md` is the single shared rule set. `CLAUDE.md` is a short Claude Code entry point that requires reading it.
3. `docs/HANDOFF.md` records the current deployment state, known gaps, local/untracked work to preserve, verification evidence, and next safe actions.
4. Concurrent agents use separate branches/worktrees and do not edit one worktree simultaneously.
5. Commits, pushes, deployments, Cloudflare configuration changes, real email sends, and secret changes require explicit user authorization.
6. Secrets, raw mail, real user information, private R2 objects, and unredacted fixtures are not committed.

## Consequences

- Every material task has a small documentation cost: update the handoff and create an ADR when an enduring boundary changes.
- An agent must stop rather than guessing at a missing security, financial-ranking, or production-delivery fact.
- A deployment may proceed without a Git push only when explicitly requested; documentation must distinguish the two states.
- The project can be handed between Codex and Claude Code by sharing the repository rather than credentials or chat logs.

## Evidence / implementation links

- [Shared instructions](../../AGENTS.md)
- [Claude Code entry point](../../CLAUDE.md)
- [Current handoff](../HANDOFF.md)
- [Backend architecture](../backend/architecture.md)
