# Administrator operations runbook

## Required authority

Only an application account with role `ADMIN` can use the following features. The browser UI and the Worker both enforce this; a hidden button or a direct URL is not authorization.

If the ADMIN controls are not visible after login, the account is not an application ADMIN. Do not manually update D1 to bypass approval/audit behavior.

## Approve or reject a user registration

1. Open `https://app.yintsun66.com` and log in as an ADMIN.
2. In the fixed bottom user bar, choose **使用者申請審核**.
3. Review the pending application’s time, five-digit employee number, branch, user name, and login account.
4. Choose one action:
   - **核准**: confirm the prompt. The account becomes `ACTIVE` and can log in.
   - **拒絕**: enter a reason between 1 and 500 characters. The account becomes `REJECTED` and cannot log in.
5. The Worker records the decision as an audit event. Refreshing the dialog reloads only pending accounts.

Do not capture screenshots or copy employee numbers outside the approved administrative purpose.

## View outbound email records

1. Log in as an ADMIN.
2. Choose **管理者寄件紀錄** in the bottom user bar.
3. Select an entry to inspect the archived final subject and HTML in the sandboxed preview.

The archive is in private R2. It is available to ADMIN through authenticated Worker endpoints, not through a public R2 URL. An archived record proves what the Worker prepared; a `SENT` status proves Cloudflare provider acceptance, not delivery to the bank mailbox.

## When an RFQ has no result

1. Check the RFQ status and issuer status in the application.
2. Confirm the bank mailbox received the outbound request.
3. Confirm issuer replies were forwarded to `rfq@yintsun66.com`.
4. Understand what an issuer `TIMEOUT` means — it has three distinct causes, which are treated the same for ranking but need different follow-up:
   - **No reply** reached the inbound address before finalization.
   - **Late reply** — the issuer replied, but after the 10-minute deadline (`LATE_REPLY`); the quote was valid but not counted. Frequent, because some issuers reply ~11–14 minutes after send. See `docs/HANDOFF.md` known gap 6 (`RFQ_DEADLINE_SECONDS`).
   - **Unrecognized format** — the reply arrived and correlated, but parsed to zero rows because the issuer's template no longer matches its parser profile. See `docs/HANDOFF.md` known gap 7 (currently SG).
5. Treat missing, malformed, rejected, mismatched, or late replies as excluded from ranking; do not directly edit quotes or rankings in D1.
6. Escalate parser/forwarding failures with the RFQ ID, timestamps, and safe error codes. Do not copy raw mail into public chat or Git.

## Emergency boundary

If no ADMIN account remains available, stop before changing D1 manually. Use the approved identity/recovery process and make any emergency access change a separately authorized, audited task.
