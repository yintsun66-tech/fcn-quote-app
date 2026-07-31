# FCN Quote Backend Architecture

Status: Current production baseline (2026-07-30)
Target domain: `yintsun66.com`  
Current backend branch: `codex/market-analysis-phase2-4`

## Scope

This document defines the implemented Cloudflare backend boundary for the existing static FCN/DAC
quote application. Migrations 0001–0015, the API/Email Worker, five Queues, one RFQ Durable Object
class, private R2 storage, Browser Rendering and the application-domain frontend are implemented
on `codex/market-analysis-phase2-4`. `feature/subject-branch-correlation` is the previous stable
ancestor; neither branch is automatically equivalent to `main`.

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
| Retention | Raw mail 10 days, generated images 10 days, structured results 30 days (ADR 0030). Implemented in `retention.ts` on the scheduled tick and **off by default** (`RETENTION_ENABLED="0"`); enabling it is a separate, explicitly authorized action. This data is an operational convenience tool, not the bank's official financial record |
| Test fixtures | Anonymous fixtures are allowed in a private repository |
| Correlation token | Allowed, but never use `##` |
| Generated subject prefixes | Do not generate `Re:`, `RE:`, `Fw:`, `FW:`, `Fwd:` or equivalent prefixes |
| Quote images | **On demand only.** Automatic rank-one rendering is disabled (`AUTO_RANK_ONE_IMAGE="0"`, ADR 0016). Ranks 1–4 and a server-validated custom fifth issuer are rendered when requested (ADR 0015), rasterized in the requesting browser (ADR 0017) with Browser Rendering as the fallback. Do not re-enable automatic rendering without re-measuring Browser Rendering capacity |

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
    O -->|15-minute window + 60-second grace| Q3
    Q3 --> D
    U -->|request another ranked quote image| A
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
- Provides an authenticated **我的詢價** workspace backed by `GET /api/v1/rfqs`. A stable
  `?rfq=<id>` locator restores the selected result after reload/login; the ID never replaces
  server-side ownership authorization (ADR 0008).
- Uses a lightweight owner-scoped summary endpoint for the active badge and one versioned
  status/results/artifacts snapshot endpoint for the open RFQ. Hidden documents stop application
  polling; unchanged foreground snapshots progressively back off and skip provisional reranking
  (ADR 0010).

### Application API Worker

- Implements application registration, login, session validation, authorization, and RFQ APIs.
- Creates immutable RFQ and selected expected-issuer snapshots.
- Validates that each RFQ contains 1 to 20 trades and each trade has exactly one target field.
- Enforces `rfq.user_id === authenticated_user.id` for all user-facing reads and writes.
- Enqueues work rather than performing mail, parsing, ranking, or rendering synchronously.

### Cloudflare Access

The approved end-user model is application-managed username/password authentication, not Cloudflare Access identity-provider login. Cloudflare Access is therefore reserved for infrastructure and administration boundaries such as internal diagnostics and `/admin`, with the application admin role still checked by the Worker.

The application recognizes three effective roles: `USER`, `PS` (privileged support), and `ADMIN`. `PS` is a delegated support tier stored as the `users.is_privileged_support` flag (migration 0010) and derived into an effective role by the Worker (`effectiveRole`), keeping the stored `role` column `USER`/`ADMIN`. `PS` may review registrations and remove (soft-disable) regular accounts; only `ADMIN` may promote/demote `PS` and view outbound/timeline diagnostics; `ADMIN` and `PS` accounts cannot be removed. See ADR 0012 and `docs/runbooks/admin.md`.

### Outbound email worker/consumer

- Reuses the existing eight email format definitions rather than inventing new column orders.
- Sends all request emails to `i14053@firstbank.com.tw` from `rfq@yintsun66.com` after Cloudflare verification.
- Appends a deterministic 10-character correlation code without personal data, for example
  `[RFQ:K7P2R9QTBM][BATCH:BMJB]`; only its hash is stored as the dedicated correlation value.
- Uses the first trade's product for the T+7 label: FCN always uses `FCN(T+7)`; DAC-family
  requests use `DRA(T+7)` for NOMURA/DBS/SG/GS/CA and `DAC(T+7)` for BMJB/UBS/CITI. It never
  appends the legacy ` DAC/DRA` marker (ADR 0014).
- Never adds `##` or a reply/forward prefix to the generated subject.
- Records a content hash and idempotency key before sending.

Up to eight request batches produce an immutable expectation of up to eleven issuer replies.
The send API defaults to all eleven issuers but can snapshot and send only the user-selected
subset (ADR 0009):

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
- Exposes a seven-minute soft reminder, a fifteen-minute reply-window marker, and sets the hard
  alarm after an additional sixty-second mail-transport grace.
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
- Creates a mobile-portrait image for the deterministic rank-one winner immediately after
  finalization. The owner can request a rank 1–4 or custom-fifth quote image (ADR 0015).
  A trade with no valid quote produces no image.
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
4. Server snapshots the selected expected issuers and their required outbound batches; an absent
   selection defaults to all eleven issuers and all eight batches.
5. An idempotent send request queues only those batches. Selecting any BNP/MS/JPM/BARCLAYS issuer
   still queues the shared BMJB batch, while only explicitly selected issuers enter ranking.
6. On successful dispatch, the UI reminder becomes `sent_at + 7 minutes`; the RFQ hard deadline
   becomes `sent_at + 15 minutes`, and its Durable Object alarm is set.

### 3. Reply ingestion

1. The bank mailbox forwards issuer replies to `rfq@yintsun66.com`.
2. Email Worker stores raw MIME and rejects exact duplicates by message ID/content hash.
3. Parser identifies issuer from verified sender evidence, not from subject label alone.
4. Parser correlates the short RFQ code, message thread evidence, and D1 ownership. If forwarding
   removed the subject tag, exactly one matching tag in sanitized body content may be used;
   conflicting tags require manual review.
5. Before trade matching, the parser excludes forwarded original request tables only when their
   header matches a known outbound BMJB/DBS/CA signature; it does not deduplicate completed quote
   rows merely because their values are identical.
6. Parsed rows are matched to immutable trade IDs and normalized into canonical quotes. Known
   issuer aliases include SG `At Maturity` → `EKI`; explicit unavailable phrases remain no-quote
   values unless separate issuer error detail proves rejection.
7. Unknown, conflicting, or ambiguous evidence is quarantined for manual review and excluded from ranking.

### 4. Finalization and ranking

Finalization begins at the earlier of:

- all expected issuers reaching a terminal state; or
- the sixteen-minute finalization deadline (fifteen-minute reply window plus sixty-second
  mail-transport grace).

Ranking occurs independently for every trade. Only valid, comparable quotes are considered. The
first five economic ranks remain persisted for compatibility/audit, while the public result view
shows ranks 1–4 plus a user-selected issuer outside those ranks. Late replies are stored as
`LATE_REPLY` and do not overwrite a finalized result. An explicit owner/ADMIN recalculation creates
a new version and may admit only finite, matched, non-rejected late values.

### 5. Results and images

- The user can leave the waiting view without affecting the Durable Object, Queue or ranking
  workflow. Active/completed RFQs remain discoverable from the owner-scoped workspace.
- The open result view reads a combined opaque-versioned snapshot. If status, issuer, artifact and
  provisional quote-version state are unchanged, the backend skips full quote loading/ranking and
  the UI keeps its last rendered data.
- The user result page loads only RFQs owned by that authenticated user. During
  `WAITING`/`PARTIAL`/`FINALIZING`, it computes non-persistent ranks 1–4 and custom-fifth
  candidates with the exact production ranking function.
- At fifteen minutes the page remains provisional and displays **正在等待最後郵件轉送** until the
  sixty-second grace ends.
- It shows issuer status, the first four economic ranks, a fifth issuer selector, invalid/no-quote
  reasons, countdown/final status, and artifacts.
- Each trade's deterministic rank-one image is queued automatically. Ranks 1–4 and the selected
  fifth issuer can create or reuse one idempotent, owner-scoped image job for that exact quote.
- A failed image exposes an owner-only **重新產圖** action. Reusing the same endpoint resets and
  re-enqueues the existing idempotent job; Browser Rendering failures retain only a safe
  request/HTTP category and never the response body.
- Server-rendered quote cards use a fixed portrait viewport so browser zoom and scroll do not affect the PNG.
- Ties retain the same economic rank; the earliest valid receipt is selected only where a single deterministic image winner is required.

## RFQ lifecycle

`DRAFT -> VALIDATED -> QUEUED -> SENDING -> SENT -> WAITING/PARTIAL -> FINALIZING -> COMPLETED | NO_VALID_QUOTE | FAILED`

`CANCELLED` is terminal. `LATE_REPLY` is a quote/message status, not a reason to reopen a completed RFQ automatically.

## Compatibility invariants

- Preserve the current 1-to-20 trade limit.
- Preserve current field defaults, fixed values, and email-time validation.
- Preserve the eight issuer-specific prefixes and column orders. First-trade product label,
  institution naming, branch label and correlation tags must follow ADR 0014 and the subject
  contract.
- BMJB is shared by BNP, MS, JPM and BARCLAYS. Do not change its table Product value globally to
  solve one issuer's module-routing rule without separately proving the other three remain valid.
- Preserve the trailing empty HTML email cell workaround.
- Keep Trade Date out of restored browser draft data.
- Keep current responsive mobile/desktop behavior until the result UI phase is separately approved.
- Do not publish raw mail, private artifacts, or user data through Pages.

## Known production gates

- The observed production forwarding path preserved enough sender and correlation evidence to
  classify eight issuer replies in one controlled DAC RFQ. This evidence does not prove every
  issuer template or every optional header will always survive forwarding.
- In that RFQ, BNP, MS, JPM, NOMURA, UBS, DBS and SG produced valid DAC quotes. BARCLAYS replied
  from its allowlisted sender but COMET rejected Product=`DAC` with a product-name error. The
  accepted BARCLAYS DAC-family Product value and any required subject/module variation remain
  unconfirmed; do not guess `DRA` or alter the shared BMJB body globally.
- MS OBU remains warning-only because no account-level OBU attribute has been defined.
- CITI uses the approved `100 - Upfront` conversion and preserves raw Upfront separately.
- Browser Rendering free-plan capacity must be observed under real completion bursts; image jobs are queued and retryable.
- Raw `.msg` and Excel files are references only and are not committed; repository fixtures remain synthetic/anonymized.

## Remaining operational prerequisites

- Confirm the exact BARCLAYS DAC-family Product value and whether the bank forwarding workflow can
  support a separate BARCLAYS request batch if its body must differ from the shared BMJB batch.
- Verify forwarding/header behavior for issuer templates not covered by the observed production
  evidence and keep sender mismatch/manual-review behavior fail-closed.
- Define and exercise the approved administrator recovery and user password-reset process.
- Confirm Browser Rendering concurrency and Queue capacity with the expected-load test.

## Public follow-board

Migration `0013` and ADR 0025 add an email-published follow-board shared by the application and
GitHub Pages compatibility site. Approved First Bank publishers reply to the original inquiry
thread or include an opaque token. ADR 0028 and migration `0015` replace the old batch suffix with
a strict `MMDD deal-N PRODUCTCODE ISSUER跟單YYYYMMDD` subject. `ISSUER` must be one of the eleven
canonical issuers and must exactly match the issuer independently recognized from the quote table.
The declared issuer determines the compatibility batch used for correlation; it never selects an
RFQ ranking or overrides table evidence. The final date is the last available date in
`Asia/Taipei`: the product is hidden at 00:00 the following day and is then non-destructively
archived by the scheduled cleanup.

The Email Worker stores the raw MIME as usual; the parse consumer recognizes the command, validates
aligned sender authentication and unique reply/token evidence, extracts the HTML tables, and
identifies the issuer from distinctive headers such as `Client Ref`, `MS ID`, `Nomura ID`,
`ISSUER PROD REF`, `Memory Autocall`, or `System Remark`. It parses rows with the existing issuer
profile, excludes incomplete or rejected rows, and selects the one unique complete quote after
collapsing identical forwarded copies. `deal-N` remains audit metadata and does not select a row.
BATCH is only a consistency check and never selects a ranked quote. Multiple issuer signatures,
different complete quotes or missing complete terms are quarantined for manual review.

ADR 0027 and migration `0014` additionally support multiple products; under ADR 0028 the form is
`MMDD deal-START~END CODE1, CODE2, ... ISSUER跟單YYYYMMDD`. The range validates only the expected item
count. Product codes map in list order to the same number of unique complete rows in their first
source order. The observed no-hyphen/trailing-comma form
`MMDD dealSTART~END CODE1, CODE2, ..., ISSUER跟單YYYYMMDD` is also accepted. When the forwarded thread
contains a front publication table plus a larger historical issuer table, the parser selects an
unambiguous table-local candidate with the exact expected count; different same-sized candidates
remain manual review. One command links to all products through
`follow_board_publication_items`, and the entire D1 batch succeeds or fails atomically.

The shared `follow-board.html` client requests a PIN-protected manifest and renders the same full
quote-card DOM used for PNG output. Its download action opens a dedicated preview tab, where the
viewer explicitly creates the PNG locally with the vendored html2canvas. Follow-board PNGs are not
stored in R2. ADR 0029 displays `手收` below the availability date: non-CITI profiles use
`100 - comparablePricePct`, while CITI uses its raw Upfront. New snapshots persist the derived
public-safe percentage; legacy snapshots use the economically equivalent comparable-price
fallback. Public
interest rows contain only masked employee numbers; authenticated ADMIN/PS requests can retrieve
the encrypted full values through the dedicated support endpoint.
