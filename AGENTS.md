# FCN Quote App — shared agent instructions

These instructions apply to Codex, Claude Code, and any other coding agent working in this repository. They are the canonical collaboration rules; `CLAUDE.md` deliberately points here instead of duplicating them.

## Start every task with evidence

1. Read this file, `CLAUDE.md`, `docs/HANDOFF.md`, the relevant architecture/runbook/ADR files, and any closer `AGENTS.md` or `AGENTS.override.md`.
2. Inspect the current branch, `git status --short`, staged changes, and recent commits before proposing a change.
3. Treat the repository, Git history, deployed configuration, tests, and current code as the source of truth. Chat history is useful context, not a complete specification.
4. Record assumptions as assumptions. Stop and ask when a missing fact changes security, data handling, ranking, email delivery, ownership, or production behavior.

## Repository map

- Root `index.html`, `app.js`, and `styles.css`: compatibility static FCN/DAC interface, still deployable to GitHub Pages.
- Root `backend-client.js`: application-domain login, RFQ workflow, result dialogs, and ADMIN controls. It activates only on `app.yintsun66.com` or with `?backend=1`.
- `backend/`: Cloudflare Worker, D1 migrations, Durable Object, Queue consumers, tests, and deployment configuration.
- `shared/`: shared domain data used by the frontend/backend.
- `docs/backend/`: implemented architecture, API contracts, data model, and phase notes.
- `docs/runbooks/`: human operating procedures.
- `docs/adr/`: enduring architecture decisions. Add a new ADR when a decision changes a security, data, deployment, or public-interface boundary.
- `docs/HANDOFF.md`: current, short operational handoff. Update it whenever a change affects deployment state, known blockers, open work, or how the next engineer should proceed.

## Non-negotiable boundaries

- Keep changes within the user-approved scope. Do not use a task as an opportunity for unrelated refactoring, renaming, formatting, dependency upgrades, or file moves.
- Preserve existing public APIs, D1 schema/migrations, authentication, authorization, environment variables, Cloudflare bindings, deployment settings, and current email HTML formats unless the user explicitly approves the specific change.
- Do not add, remove, or upgrade a production dependency, or change a lockfile, without explicit approval.
- Do not modify generated files. Edit their source and run the existing generation flow. In particular, `backend/public/`, `backend/dist/`, and `backend/worker-configuration.d.ts` are generated/ignored.
- Do not commit secrets, Cloudflare API tokens, passwords, raw MIME, real `.msg` messages, R2 contents, personal data, or unredacted email fixtures. Use synthetic/anonymous fixtures only after approval.
- The private R2 bucket and D1 console are not shortcuts around application authorization. Do not directly alter user status or RFQ data in D1 to solve an application issue.
- Never run destructive Git commands (`reset --hard`, `clean`, forced checkout) or delete data unless the user explicitly asks.

## Security and financial-data rules

- Server-side ownership is authoritative: a user may access only their own RFQs, quotes, results, and artifacts; ADMIN is separately enforced.
- Do not trust mail subjects, display names, requester markers, URLs, or browser-hidden controls as authorization evidence.
- Keep R2 private. Preserve mail/HTML sanitization and do not execute attachments, external links, or remote images from email.
- Do not weaken password/session/CSRF protections to fit a plan tier without an explicit user decision and a documented risk.
- Preserve the issuer parser, percentage normalization, trade matching, ranking, deadline, late-reply, and tie behavior documented in `docs/backend/architecture.md` and `docs/backend/phase-5-7-production.md`.

## Implementation and verification

- Prefer the smallest reviewable patch. Preserve user-owned uncommitted or untracked work that is outside the task.
- Use parameterized D1 queries and existing HTTP/auth helpers. Reuse existing frontend email-format definitions instead of recreating issuer formats.
- Add or update regression tests whenever a changed behavior can be covered by the existing test setup.
- For backend-related changes, run the relevant tests and then, unless scope makes it inapplicable:

  ```powershell
  Set-Location backend
  pnpm run typecheck
  pnpm test
  pnpm run build
  ```

- For root JavaScript changes, also run the available syntax check, for example `node --check backend-client.js`.
- Inspect `git diff --check`, the complete diff, and `git status --short` before handoff. Report tests actually run and anything not verified.

## Git, collaboration, and deployment

- Work in a dedicated branch or worktree. Do not allow two agents to edit the same working tree concurrently.
- Make focused commits with conventional, descriptive messages such as `feat(admin): ...` or `fix(inbound): ...`.
- Do not commit, push, merge, deploy, change Cloudflare secrets, or modify remote resources unless the user explicitly requests that operation.
- Before a deploy, run the build; after a deploy, verify the relevant public asset/API endpoint and record the deployment/verification outcome in `docs/HANDOFF.md`.
- A local commit is not proof that GitHub is current, and a Cloudflare deployment is not proof that mail reached the bank mailbox. State each separately.

## Handoff format

At the end of a non-trivial task, update `docs/HANDOFF.md` with:

- branch and latest relevant commit;
- files/behavior changed;
- test/build/deploy evidence;
- open blockers and known production gaps;
- untracked user-owned files to preserve; and
- the smallest safe next step.
