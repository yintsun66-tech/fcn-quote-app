# Security and Deployment Prerequisites

Status: Current security and deployment baseline (2026-07-25).

## Trust boundaries

1. Public browser to Pages/API Worker
2. Application session to user-owned RFQ data
3. Application administrator to registration and manual-review functions
4. Worker to D1, R2, Queues, Durable Objects, email, and Browser Rendering bindings
5. `rfq@yintsun66.com` to `i14053@firstbank.com.tw`
6. Bank mailbox forwarding to `rfq@yintsun66.com`
7. Forwarded mail to original issuer evidence
8. Browser Rendering to the internal render route

No data crossing a boundary is trusted solely because it contains a known subject, display name, email marker, or opaque-looking URL.

## Application authentication

### Registration

Registration is permit-based. The user supplies:

- five-digit employee number
- branch name
- display/user name
- username
- password

Server-side validation and normalization are mandatory. A new account is `PENDING_APPROVAL` and cannot log in until an authorized administrator approves it.

The initial administrator bootstrap has been completed. The formal administrator recovery process
remains an operational gap. There must be no public endpoint that promotes the first caller to
administrator.

### Password handling

- Never log, return, email, or store plaintext passwords.
- Use a reviewed password hashing construction supported safely in Workers, with a unique cryptographic salt and stored algorithm parameters.
- Free-tier deployment decision (2026-07-21): use 10,000 PBKDF2-HMAC-SHA256 iterations followed by a domain-separated HMAC-SHA256 pepper held in the existing employee-lookup Cloudflare Secret. This is a deliberate reduction from the originally approved 600,000 iterations to fit the Workers Free 10 ms CPU ceiling. Upgrade the work factor and rehash credentials after login if the account moves to Workers Paid.
- Preserve the deployed work factor in configuration and benchmark an upgrade before increasing it
  or moving to a paid Workers CPU tier.
- Support credential-version upgrades and forced session revocation after reset.
- Password reset must use a short-lived, single-use server-side token and an approved identity-verification channel.
- Compare authentication material without revealing timing or account-existence details where practical.

Any new password/MIME/security dependency requires a separate production-dependency approval before installation.

### Sessions and CSRF

- Generate high-entropy random session tokens.
- Store only a token hash in D1.
- Cookie flags: `Secure`, `HttpOnly`, `SameSite=Strict` unless a documented flow requires otherwise.
- Rotate the session on login and privilege change.
- Revoke sessions on logout, password reset, suspension, and credential-version change.
- Apply CSRF protection to state-changing requests in addition to SameSite cookies.
- Enforce the deployed 1,800-second idle and 28,800-second absolute expiry values server-side.

### Login protection

- Rate-limit by normalized username and privacy-preserving network key.
- Add progressive delay or temporary lockout without allowing easy denial of service against a known user.
- Return generic login/registration messages.
- Audit approval, rejection, suspension, password reset, repeated login failure, and admin actions.

## Cloudflare Access role

Because end users require application-managed usernames and passwords, Cloudflare Access is not the end-user identity provider in this design. It should protect administration/diagnostic endpoints and deployment access. The Worker must still enforce the application `ADMIN` role; Access alone does not grant business authorization.

## User-data protection

- Treat employee number, branch, name, username, mail content, transaction conditions, and quote results as sensitive.
- Encrypt employee number for necessary administrative display and use a keyed lookup hash for uniqueness.
- Keep encryption and HMAC keys in Cloudflare Secrets.
- Avoid storing full IP addresses unless a reviewed security requirement justifies them.
- Redact raw subjects, email addresses, correlation tokens, and quote data from general logs.
- Use request IDs and safe error codes for troubleshooting.
- Enforce ownership on the server for every RFQ, quote, ranking, and artifact operation.

## Email security

### Outbound

- Sender: `rfq@yintsun66.com`
- Fixed recipient: `i14053@firstbank.com.tw`
- Preserve existing eight base subjects and HTML column formats.
- Append the deterministic 10-character `[RFQ:...][BATCH:...]` correlation code; store its
  dedicated correlation value as a hash and never embed personal data.
- Preserve the ADR 0013 subject order selected from the first trade:
  `<FCN|DAC>(T+7) <branch?> [RFQ:...][BATCH:...]`; never append the legacy ` DAC/DRA` marker.
- Never use `##`.
- Never generate reply/forward prefixes such as `Re:`, `RE:`, `Fw:`, `FW:`, or `Fwd:`.
- Enforce recipient allowlisting server-side; never accept an arbitrary recipient from the browser.
- Record idempotency/content hashes before dispatch.

### Inbound

- Route `rfq@yintsun66.com` to an Email Worker.
- Preserve raw MIME in private R2 before parsing.
- Verify envelope sender, original `From`, `Return-Path`, DKIM evidence, and forwarding wrapper.
- Normalize mail-system-added reply/forward prefixes only for matching and retain the raw subject.
- Treat BMJB as ambiguous until sender evidence selects BNP, MS, JPM, or BARCLAYS.
- Quarantine sender mismatch, unknown sender, unmatched RFQ, and ambiguous trade matches.
- Do not execute attachments, follow links, or load remote images.
- Sanitize HTML before any preview or parser-debug display.
- Use message ID and content hash to prevent duplicate quotes.

### Forwarding verification evidence and remaining checks

Production evidence from one authorized DAC RFQ includes eight issuer replies forwarded through the
bank mailbox and correlated by the Email Worker. Seven produced valid normalized quotes; BARCLAYS
was safely classified as issuer-rejected because its response rejected Product=`DAC`. This proves
the observed route preserved enough sender/correlation/table evidence for those messages, but it
does not prove every optional header or every issuer template.

For new or changed issuer templates, capture a controlled message through the actual forwarding
rule and confirm preservation or rewriting of:

- original `From`
- Return-Path
- DKIM result/header domain
- Message-ID
- In-Reply-To
- References
- subject and encoding
- HTML table
- plain-text alternative
- attachments

Parser trust rules must be based on production forwarding evidence and anonymous regression
fixtures, not on the original `.msg` samples alone. BARCLAYS' accepted DAC-family Product value is
still unknown and must not be guessed or applied globally to the shared BMJB body.

## RFQ and ranking integrity

- Generate opaque RFQ and trade identifiers server-side.
- Freeze trade conditions after send.
- Match replies to the RFQ token, thread evidence, sender evidence, and trade matching key.
- Never compare quotes across different immutable trades.
- Keep raw and normalized percentage/price values.
- Apply the approved CITI conversion `100 - upfrontPct` and preserve the raw Upfront.
- Exclude all invalid/no-quote/ambiguous/late values from automatic ranking.
- Preserve equal economic rank and use earliest valid receipt only as a deterministic image winner.
- MS remains visible with `OBU不得承做`; there is no automatic OBU exclusion until an approved account attribute exists.

## R2 and artifact security

- Buckets remain private.
- Object keys are random/opaque and not authorization controls.
- Download through an authenticated ownership-checking Worker or short-lived signed URL.
- Do not expose raw R2 keys to the browser.
- Render routes require an internal single-use or short-lived token and finalized snapshot ID.
- Browser Rendering must not have access to arbitrary external URLs or user-provided HTML.

## Secrets and configuration

Current non-secret configuration and bindings are declared in `backend/wrangler.jsonc`:

- `APP_DOMAIN=yintsun66.com`
- `SESSION_IDLE_SECONDS=1800`
- `SESSION_ABSOLUTE_SECONDS=28800`
- `PASSWORD_PBKDF2_ITERATIONS=10000`
- `OUTBOUND_FROM=rfq@yintsun66.com`
- `OUTBOUND_TO=i14053@firstbank.com.tw`
- `INBOUND_ADDRESS=rfq@yintsun66.com`
- D1 binding `DB`
- private R2 binding `RAW_MAIL_BUCKET`
- five Queue producer/consumer bindings
- Durable Object binding `RFQ_COORDINATOR`
- Browser Rendering binding `BROWSER`
- required Cloudflare Secrets `EMPLOYEE_DATA_KEY` and `EMPLOYEE_LOOKUP_KEY`

Secrets must be created through Cloudflare secret management and never committed, printed, placed in client JavaScript, or copied into example files.

## Retention and deletion

Approved initial retention:

- raw email: 30 days
- generated images: 90 days
- structured RFQ/quote/ranking records: 365 days

Session expiry is enforced by the deployed configuration. Audit retention and automated deletion
of structured records still require an explicit, reviewed policy and implementation. Any deletion
job must be scoped, idempotent, observable, and tested against non-expired data.

## Current deployment controls and remaining verification

The domain, Email Routing address, verified sender/destination, D1, private R2, Queues with DLQs,
Durable Object, cron recovery and Browser Rendering binding are deployed. The bank forwarding path
has produced correlated issuer replies. Remaining operational work is:

1. Define and test administrator recovery and end-user password reset.
2. Confirm and document the Cloudflare Access policy for infrastructure diagnostics and any
   separately protected administration boundary.
3. Load-test 50 concurrent users, 20 trades per RFQ, eleven expected issuers, the seven-minute
   reminder and the fifteen-minute hard deadline.
4. Continue observing Queue/Browser Rendering capacity and DLQs under real completion bursts.
5. Complete the structured-record/audit retention and deletion policy.
6. Keep incident response, backup/export and rollback procedures current as resources change.

## Threats requiring explicit tests

- Cross-user RFQ/artifact access
- Username enumeration and credential stuffing
- Registration spam and unauthorized approval
- Session theft/fixation and CSRF
- Forged requester marker or subject token
- Forged display sender and forwarding-wrapper confusion
- Duplicate/replayed mail and queue delivery
- HTML/script injection through mail or transaction fields
- Spreadsheet-formula injection in any later export
- Malicious attachments and external tracking assets
- Ambiguous BMJB issuer identity
- Incorrect percentage scaling or CITI price conversion
- Durable Object alarm/queue duplicate finalization
- Guessable or permanent artifact URLs
- Sensitive-data leakage in logs and errors

## Deployment status

The backend is deployed on Cloudflare with the resources documented in
`docs/backend/phase-5-7-production.md`. Deployment status and the current Worker version are
recorded in `docs/HANDOFF.md`; this document does not itself authorize a new deployment or secret
change.
