# Administrator operations runbook

## Required authority

Most features below require an application account with effective role `ADMIN`. A limited
subset — registration review and removing regular accounts — is also available to the `PS`
(privileged support) tier. The browser UI and the Worker both enforce this; a hidden button or
a direct URL is not authorization.

If the ADMIN/PS controls are not visible after login, the account does not hold that role. Do
not manually update D1 to bypass approval/audit behavior.

## Roles: ADMIN and PS

`PS` is a support tier between `USER` and `ADMIN`, introduced in ADR 0012. It is stored as the
`users.is_privileged_support` flag (migration 0010) and surfaced as an effective role.

| Capability | ADMIN | PS |
| --- | --- | --- |
| 所有帳號列表 (view all accounts + last online) | yes | yes |
| 升級 USER→PS / 降級 PS→USER | yes | no |
| 核准／拒絕 registrations (使用者申請審核) | yes | yes |
| 剔除 (soft-disable) a regular USER | yes | yes |
| 剔除 an ADMIN or PS account | no | no |
| 管理者寄件紀錄 / RFQ 處理時間軸 | yes | no |

Removal is a soft disable (`status='DISABLED'` plus session revocation), never a hard delete,
because RFQ ownership is `ON DELETE RESTRICT`. A disabled account cannot log in and its active
sessions end immediately.

## View all accounts, promote PS, or remove a regular account

1. Log in as an `ADMIN` (full controls) or `PS` (removal + registration review only).
2. In the fixed bottom user bar, choose **所有帳號列表**.
3. The list shows each account's create time, user/login name, branch, role, status, and last
   online time (`MAX` session activity; approximate to ~1 minute). Employee numbers are not
   shown here — use registration review for a pending applicant's employee number.
4. Actions per row:
   - **升級為PS** (ADMIN only, active regular users): confirm the prompt to grant the PS tier.
   - **降級為一般** (ADMIN only, PS rows): return the account to a regular user.
   - **剔除** (ADMIN or PS, regular users only): confirm to disable the account. It becomes
     `已剔除` and cannot log in. ADMIN and PS rows have no 剔除 control.
5. Each change is recorded as an audit event. The list reloads after a successful action.
6. **以行編查詢帳號 (ADMIN only):** the account list has an employee-number lookup box (visible to
   ADMIN, not PS). Enter a five-digit 行編 and choose **查詢** to see which existing account holds
   it (login account, name, branch, role, status), or「查無帳號」if none. Use this to resolve a
   registration that was blocked because「行編已存在」— it identifies the colleague who already has
   an account. The lookup matches by keyed hash (no employee number is decrypted) and never writes
   the queried 行編 to the audit log.

## Approve or reject a user registration

1. Open `https://app.yintsun66.com` and log in as an ADMIN or PS.
2. In the fixed bottom user bar, choose **使用者申請審核**.
3. Review the pending application’s time, five-digit employee number (also the login account),
   and branch name. An older pending application may additionally show its legacy login name.
4. Choose one action:
   - **核准**: confirm the prompt. The account becomes `ACTIVE` and can log in.
   - **拒絕**: enter a reason between 1 and 500 characters. The account becomes `REJECTED` and cannot log in.
5. The Worker records the decision as an audit event. Refreshing the dialog reloads only pending accounts.

Do not capture screenshots or copy employee numbers outside the approved administrative purpose.

### When a new registration never appears in the pending list

The review screen shows a note like「近 7 天有 N 筆重複申請被系統擋下（… 行編已存在 /
登入帳號已存在 …）」when recent duplicate registrations were blocked. A registration whose
five-digit employee number already exists is intentionally answered with the same「已受理」
message as a new one (to avoid revealing which accounts exist) but **creates no account**, so it
never reaches the pending list. If someone reports a "new" account that is missing:

1. Check the duplicate note for a matching time and which field collided.
2. Use the ADMIN-only employee-number lookup to identify the existing account. For accounts
   created under the new flow, the displayed login account is the same five-digit employee number.
3. An older account may still have a legacy login name. Have the user log in with that stored name
   or follow the approved recovery process; do not ask them to register the same employee number
   again.

The note reports only counts, the colliding field, and timestamps — never the attempted value.

## View outbound email records

1. Log in as an ADMIN.
2. Choose **管理者寄件紀錄** in the bottom user bar.
3. Select an entry to inspect the archived final subject and HTML in the sandboxed preview.

The archive is in private R2. It is available to ADMIN through authenticated Worker endpoints, not through a public R2 URL. An archived record proves what the Worker prepared; a `SENT` status proves Cloudflare provider acceptance, not delivery to the bank mailbox.

## Review RFQ and issuer health

1. Log in as an ADMIN and choose **RFQ 處理時間軸**.
2. The top panel summarizes the last seven days by issuer: expected requests, valid replies,
   inbound count, timeouts, parse errors and late replies.
3. Orange alerts identify zero-inbound issuers, parser errors, timeouts, unmatched/manual-review
   mail and failed quote images. These are investigation signals, not automatic proof of an issuer
   or bank outage.
4. Use the per-RFQ cards below the summary to locate the affected workflow. The page intentionally
   excludes raw mail, subjects, correlation tokens, quote values, message IDs and R2 paths.
5. A completed RFQ with a late reply not covered by its current recalculation version shows
   **納入晚到報價重新排名**. Confirming it creates a new immutable ranking version and records the
   ADMIN actor; it never overwrites the earlier result.

## When an RFQ has no result

1. Check the RFQ status and issuer status in the application.
2. Confirm the bank mailbox received the outbound request.
3. Confirm issuer replies were forwarded to `rfq@yintsun66.com`.
4. Interpret the issuer status precisely:
   - **`TIMEOUT`**: no terminal reply reached that expected issuer before the fifteen-minute reply
     window plus sixty-second mail-transport grace ended. It does not prove that the issuer or bank
     never received the request.
   - **`LATE_REPLY`**: a correlated reply arrived after the grace deadline. It is preserved but
     does not overwrite finalized results automatically. The RFQ owner or ADMIN may request a
     versioned recalculation; only finite, matched, non-rejected late values can then participate.
   - **`PARSE_ERROR` / `INVALID_VALUE`**: a reply arrived, but its table, unit or values could not
     be safely normalized. This is not a timeout.
   - **`ISSUER_REJECTED` / `NO_QUOTE`**: the issuer replied and declined or returned an explicit
     non-quote. This is not missing mail.
5. For BARCLAYS DAC requests, a COMET product-name error means BARCLAYS replied but rejected the
   request's Product value. Do not report it as missing mail, guess that `DRA` is accepted, or
   change the shared BMJB body globally; obtain the issuer's exact accepted value first.
6. Treat missing, malformed, rejected, mismatched, or late replies as excluded from ranking; do not
   directly edit quotes or rankings in D1.
7. Escalate parser/forwarding failures with the RFQ ID, timestamps, and safe error codes. Do not
   copy raw mail, full subjects, correlation codes, employee numbers or quote data into public chat
   or Git.
8. If a quote image is `FAILED`, the RFQ owner can open the result and choose **重新產圖**. The
   request reuses the existing idempotent artifact job. Repeated failure codes such as
   `BROWSER_RENDER_HTTP_429` indicate Browser Rendering capacity/service behavior and should be
   investigated before changing Queue concurrency.

Completed RFQs move out of the active waiting list. Use the completed filter and open the
owner-authorized result view; the ADMIN outbound archive shows what was prepared for sending but is
not a substitute for the RFQ result page.

## Emergency boundary

If no ADMIN account remains available, stop before changing D1 manually. Use the approved identity/recovery process and make any emergency access change a separately authorized, audited task.
