# Project handoff

Updated: 2026-07-21 (Asia/Taipei)  
Branch: `feature/backend-foundation`  
Latest relevant commit: `dfb4bf9 feat(admin): add registration approval console`

## What is live

- Application: `https://app.yintsun66.com`
- API: `https://api.yintsun66.com`
- Latest verified Cloudflare Worker version: `b3b0330f-4b6d-4c97-a6a2-87cbb7e39682`
- Current deployment includes the ADMIN user-registration review dialog and the private-R2 outbound-email archive viewer.
- The public API health endpoint returned `{ "status": "ok" }` after the latest deployment. The deployed frontend asset contains the registration-review feature markers.

The Cloudflare deployment and Git remote are separate facts. This branch was committed and deployed locally; check `git status -sb` and the configured upstream before assuming the commit has been pushed to GitHub.

## Current implementation state

- Root static application remains compatibility UI for FCN/DAC and GitHub Pages.
- `app.yintsun66.com` serves the same root application assets through the Cloudflare Worker and activates `backend-client.js`.
- The backend supports registration, application-managed username/password login, ADMIN role checks, RFQ creation/validation/sending, eight outbound mail batches, eleven expected issuers, inbound MIME intake, parsing/normalization, ten-minute finalization, ranking, and private quote-image artifacts.
- Outbound mail is sent from `rfq@yintsun66.com` to the fixed recipient `i14053@firstbank.com.tw` through the Cloudflare email binding.
- Issuer replies must be forwarded from the bank mailbox to `reply@yintsun66.com`; Cloudflare cannot log into or poll the bank mailbox directly.
- ADMIN controls currently include:
  - **使用者申請審核**: lists pending registrations and approves/rejects them with server-side ADMIN/CSRF checks and audit events.
  - **管理者寄件紀錄**: reads archived outbound subject/HTML/plain text from private R2 using authenticated admin endpoints.

## Important current limitations / known gaps

1. A Cloudflare `SENT` batch indicates provider acceptance, not proven inbox delivery. Earlier RFQs from username `14053` reached `WAITING` and eventually `NO_VALID_QUOTE`; valid issuer replies were not observed before the deadline.
2. The real bank forwarding chain must still be verified with a controlled issuer-style reply. Capture the actual headers/MIME that reach `reply@yintsun66.com` before treating automatic issuer recognition as fully production-proven.
3. MS remains display-warning only (`MS（OBU不得承做）`). There is no approved account-level OBU attribute or enforcement rule.
4. The true Cloudflare Browser Rendering capacity and email-product limits need observation under real traffic. Queue retries protect workflow progress but do not prove capacity.
5. Several older design documents contain historical language such as “Phase 1 draft” or “no deployment.” Use current code, `wrangler.jsonc`, Git history, this handoff, and live verification for current state; update stale documents only in a scoped documentation task.

## Preserve this user-owned work

- `backend/scripts/smoke-outbound-email.ps1` is currently **untracked** and explicitly excluded from the last commits/deployments at the user's request.
- It is an operational test that creates a real RFQ and can send real messages. Do not commit, run, modify, or delete it without explicit approval.

## Recent verification evidence

For commit `dfb4bf9`:

- `node --check backend-client.js` passed.
- `pnpm test` passed: 14 test files, 56 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed (Worker deploy dry run).
- Production deployment succeeded and uploaded `backend-client.js` and `styles.css`.

## Safe next steps

1. Log in with an account whose application role is `ADMIN`; open **使用者申請審核** and approve/reject a controlled test registration.
2. Verify the bank-mailbox forwarding rule by forwarding a controlled real issuer-style reply to `reply@yintsun66.com` and inspect its preserved headers through the application’s private intake/audit path.
3. Before changes, follow `AGENTS.md`; after changes, update this file with exact test/deploy evidence.
