# FCN Quote Backend Architecture

Status: Phase 1–7 implementation baseline (2026-07-21)
Target domain: `yintsun66.com`  
Repository branch at drafting time: `feature/backend-foundation`

## Scope

This document defines the implemented Cloudflare backend boundary for the existing static FCN/DAC quote application. Migrations 0001–0007, the API/Email Worker, five Queues, one RFQ Durable Object class, private R2 storage, Browser Rendering and the application-domain frontend are implemented on `feature/backend-foundation`.

The existing root-level static site remains unchanged during the backend build. Its current form validation, eight issuer email layouts, BBG lookup behavior, responsive layout, browser draft storage, and client-side quote image behavior remain compatibility constraints until a later phase explicitly replaces them.

## Approved decisions

| Decision | Approved value |
| --- | --- |
| Application domain | `yintsun66.com` |
| Outbound sender | `rfq@yintsun66.com` |
| Inbound route | `rfq@yintsun66.com` |
| Bank mailbox forwarding | `i14053@firstbank.com.tw` can forward replies to the inbound route |
| User authentication | Application-managed username and password |
| Registration | Approval required; collect five-digit employee number, branch name, user name, username, and password |
| CITI price normalization | Preserve raw Upfront and calculate `notePriceEquivalent = 100 - upfrontPct` |
| Equal quotes | Preserve equal economic rank; use earliest valid receipt as the deterministic image winner |
| MS OBU handling | Display warning only until an explicit OBU attribute and enforcement rule exist |
| Retention starting point | Raw mail 30 days, generated images 90 days, structured results 365 days |
| Test fixtures | Anonymous fixtures are allowed in a private repository |
| Correlation token | Allowed, but never use `##` |
| Generated subject prefixes | Do not generate `Re:`, `RE:`, `Fw:`, `FW:`, `Fwd:` or equivalent prefixes |
| Quote images | One image per trade — the trade's rank-1 winner; linked from the winning issuer name in results (ADR 0005, supersedes the earlier per-issuer grouping) |

Mail systems may add reply or forwarding prefixes to inbound messages. The inbound parser must normalize such prefixes for matching while retaining the raw subject. The application itself must never add them to an outbound subject.

## Architecture overview

```mermaid
flowchart LR
    U[Authenticated user] --> P[Cloudflare Pages]
    P --> A[API Worker]
    A --> D[(D1)]
    A --> Q1[Outbound email queue]
    Q1 --> E[Email send binding]
    E --> F[i14053@firstbank.com.tw]
    F --> I[Issuer workflows]
    I --> F
    F --> R[rfq@yintsun66.com]
    R --> EW[Email Worker]
    EW --> B[(Private R2 raw MIME)]
    EW --> Q2[Parse and normalize queue]
    Q2 --> D
    Q2 --> O[RFQ Durable Object]
    O --> Q3[Ranking queue]
    O -->|15-minute hard alarm| Q3
    Q3 --> D
    U -->|request one trade image| A
    A --> Q4[Image render queue]
    Q4 --> BR[Browser Rendering]
    BR --> B
    D --> A
    B --> A
```

## Component responsibilities

### Cloudflare static assets

- Worker static assets host the existing application and RFQ/result views on `app.yintsun66.com`; GitHub Pages remains the compatibility deployment.
- Does not decide ownership, rank quotes, or expose private R2 objects directly.
- Uses relative static asset paths until an approved migration changes the current GitHub Pages-compatible layout.

### Application API Worker

- Implements application registration, login, session validation, authorization, and RFQ APIs.
- Creates immutable RFQ and expected-issuer snapshots.
- Validates that each RFQ contains 1 to 20 trades and each trade has exactly one target field.
- Enforces `rfq.user_id === authenticated_user.id` for all user-facing reads and writes.
- Enqueues work rather than performing mail, parsing, ranking, or rendering synchronously.

### Cloudflare Access

The approved end-user model is application-managed username/password authentication, not Cloudflare Access identity-provider login. Cloudflare Access is therefore reserved for infrastructure and administration boundaries such as internal diagnostics and `/admin`, with the application admin role still checked by the Worker.

### Outbound email worker/consumer

- Reuses the existing eight email format definitions rather than inventing new column orders.
- Sends all request emails to `i14053@firstbank.com.tw` from `rfq@yintsun66.com` after Cloudflare verification.
- Adds an opaque token without personal data, for example `[RFQ:7B41...][BATCH:BMJB]`.
- Never adds `##` or a reply/forward prefix to the generated subject.
- Records a content hash and idempotency key before sending.

Eight request batches produce an immutable expectation of up to eleven issuer replies:

- BMJB: BNP, MS, JPM, BARCLAYS
- NOMURA
- UBS
- DBS
- SG
- CITI
- GS
- CA

### Email Worker

- Receives RFC822/MIME forwarded to `rfq@yintsun66.com`.
- Performs only quick envelope/header checks in the email event.
- Stores the original message in private R2 and metadata in D1.
- Enqueues parsing and returns without executing attachments, fetching links, or loading remote images.
- Treats uploaded Outlook `.msg` files as development references only; production input is RFC822/MIME.

### Queues

Implemented logical queues:

- `outbound-email`
- `email-parse`
- `quote-normalize`
- `quote-rank`
- `image-render`

Every consumer must be idempotent, record attempts and terminal errors, and have a dead-letter path. A failure for one issuer or RFQ must not block another RFQ.
Consumers use one-message, one-second batches with bounded per-queue concurrency to reduce
batch-wait latency without creating unbounded parallel work.

### Durable Object per RFQ

- Coordinates issuer completion state for one RFQ.
- Exposes a seven-minute soft reminder to the UI and sets one hard alarm at `sent_at + 15 minutes`.
- Requests finalization when all expected issuers are terminal or the alarm fires.
- Treats alarm and queue delivery as at-least-once operations.
- Uses a finalization idempotency key and ranking version to prevent duplicate results or images.

### D1

D1 is the structured source of truth for users, RFQs, trades, mail metadata, normalized quotes, ranking snapshots, jobs, artifacts, parser versions, and audit events. Excel is a mapping reference and must not be run as a production database or calculation engine.

### R2

Private R2 stores raw MIME, approved attachments, sanitized parser artifacts, generated PNG files, and the generated subject/HTML/plain-text archive for each outbound request email. Outbound archives use the `raw-email/outbound/` prefix and the same 30-day private mail retention policy. Downloads pass through an authenticated Worker or a short-lived signed URL. The bucket is never public.

### Browser Rendering

- Renders an internal deterministic quote-card route from a finalized ranking snapshot.
- Uses fixed viewport, device scale, fonts, background, and animation-disabled styling.
- Creates a mobile-portrait image only after the owner requests that trade's rank-1 winner
  (ADR 0006). A trade with no valid quote produces no image.
- Uses the same issuer-specific color palette as the compatibility frontend, themed by each trade's winning issuer.
- Uses the request trade date and displays the same complete `[RFQ:<10-character-code>]` reference carried by the outbound email subject. The displayed code is informational and is never accepted as authorization evidence.
- Stores PNG output in private R2.

## End-to-end flow

### 1. Registration and approval

1. User submits employee number, branch, name, username, and password.
2. Server validates the employee number as exactly five decimal digits and normalizes the other fields.
3. Registration becomes `PENDING_APPROVAL`; no authenticated session is issued.
4. An authorized administrator approves or rejects it with an audit reason.
5. Only an `ACTIVE` account may log in.

### 2. RFQ creation and sending

1. Authenticated user creates 1 to 20 trades.
2. Server assigns an RFQ ID and immutable trade IDs `T01` to `T20`.
3. Server validates the target field and all non-target conditions.
4. Server snapshots the expected eleven issuers and eight outbound batches.
5. An idempotent send request queues the eight emails.
6. On successful dispatch, the UI reminder becomes `sent_at + 7 minutes`; the RFQ hard deadline
   becomes `sent_at + 15 minutes`, and its Durable Object alarm is set.

### 3. Reply ingestion

1. The bank mailbox forwards issuer replies to `rfq@yintsun66.com`.
2. Email Worker stores raw MIME and rejects exact duplicates by message ID/content hash.
3. Parser identifies issuer from verified sender evidence, not from subject label alone.
4. Parser correlates the opaque RFQ token, message thread evidence, and D1 ownership. If forwarding
   removed the subject tag, exactly one matching tag in sanitized body content may be used;
   conflicting tags require manual review.
5. Parsed rows are matched to immutable trade IDs and normalized into canonical quotes.
6. Unknown, conflicting, or ambiguous evidence is quarantined for manual review and excluded from ranking.

### 4. Finalization and ranking

Finalization begins at the earlier of:

- all expected issuers reaching a terminal state; or
- the fifteen-minute hard deadline.

Ranking occurs independently for every trade. Only valid, comparable quotes are considered. The first three economic ranks are persisted as a versioned snapshot. Late replies are stored as `LATE_REPLY` and do not overwrite a finalized result without an explicit recalculation.

### 5. Results and images

- The user result page loads only RFQs owned by that authenticated user. During
  `WAITING`/`PARTIAL`/`FINALIZING`, it computes a non-persistent provisional top three with the
  exact production ranking function.
- It shows issuer status, top three quotes, invalid/no-quote reasons, countdown/final status, and artifacts.
- Each trade's winning issuer offers an explicit **產出報價圖** action. The action creates or
  reuses one idempotent, owner-scoped image job for that trade.
- Server-rendered quote cards use a fixed portrait viewport so browser zoom and scroll do not affect the PNG.
- Ties retain the same economic rank; the earliest valid receipt is selected only where a single deterministic image winner is required.

## RFQ lifecycle

`DRAFT -> VALIDATED -> QUEUED -> SENDING -> SENT -> WAITING/PARTIAL -> FINALIZING -> COMPLETED | NO_VALID_QUOTE | FAILED`

`CANCELLED` is terminal. `LATE_REPLY` is a quote/message status, not a reason to reopen a completed RFQ automatically.

## Compatibility invariants

- Preserve the current 1-to-20 trade limit.
- Preserve current field defaults, fixed values, and email-time validation.
- Preserve the eight subjects and issuer-specific column orders before appending the opaque token.
- Preserve the trailing empty HTML email cell workaround.
- Keep Trade Date out of restored browser draft data.
- Keep current responsive mobile/desktop behavior until the result UI phase is separately approved.
- Do not publish raw mail, private artifacts, or user data through Pages.

## Known production gates

- A real forwarded bank reply must still prove which original headers survive the bank forwarding rule.
- MS OBU remains warning-only because no account-level OBU attribute has been defined.
- CITI uses the approved `100 - Upfront` conversion and preserves raw Upfront separately.
- Browser Rendering free-plan capacity must be observed under real completion bursts; image jobs are queued and retryable.
- Raw `.msg` and Excel files are references only and are not committed; repository fixtures remain synthetic/anonymized.

## Remaining prerequisites for Phase 2+

- Name the initial registration-approval administrator accounts.
- Define username rules and whether users can reset their own passwords.
- Confirm the exact forwarded-message header/MIME preservation with a test message.
- Verify `rfq@yintsun66.com` and `i14053@firstbank.com.tw` in the selected Cloudflare email product.
- Confirm the Cloudflare plan and Browser Rendering concurrency before the load test.
