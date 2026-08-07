# ADR 0036: Lazy frontend modules and outbound performance telemetry

Status: Accepted
Date: 2026-08-07

## Context

The compatibility page previously downloaded `backend-client.js` even on GitHub Pages, although
the file returned immediately there. The Cloudflare application also parsed authentication, RFQ,
ADMIN, market-analysis and quote-image code at startup, and all pages eagerly parsed the vendored
html2canvas library. These costs were most visible on phones and were paid even when the user never
opened those features.

The outbound Queue already accepted selective issuer snapshots and the browser already submitted
create → validate → send in one request (ADR 0031), but production had no safe stage-level
measurement for RFQ creation, first outbound delivery and final outbound delivery. Raising
concurrency without those measurements would make a 10–20 second target impossible to verify.

## Decision

1. `index.html` imports `backend-client.js` only on `app.yintsun66.com` or with the explicit
   development switch `?backend=1`. GitHub Pages does not download any authenticated backend,
   ADMIN, market-analysis or quote-image module.
2. The self-hosted html2canvas file is loaded through one shared, timeout-bounded promise only when
   a user requests a PNG. A load failure resets the promise so a later attempt can retry.
3. `backend-client.js` is the authentication/RFQ/result core. It dynamically imports:
   - `backend-admin.mjs` after an ADMIN/PS management action;
   - `backend-analysis.mjs`, which in turn imports the market-analysis/resources modules, after an
     authorized analysis route is opened; and
   - `backend-image.mjs` after a quote-image button is pressed.
   `follow-board.mjs` remains an independent page module rather than becoming part of the core.
4. Ordinary browser API requests receive explicit timeouts. Earnings advisory requests use a
   normalized underlying-set key, reuse the last successful identical result, suppress duplicate
   in-flight requests and abort a superseded set.
5. The ADMIN-only RFQ diagnostics response adds safe seven-day outbound performance aggregates and
   per-RFQ stage timestamps/durations. It contains no subjects, bodies, tokens, quote values, R2
   keys or message IDs.
6. `fcn-outbound-email` consumer concurrency increases from 5 to 8. Its batch size remains one,
   retries/DLQ/idempotency are unchanged, and no other Queue concurrency changes.
7. RFQs selecting at most three issuers are measured against a 20-second queued-to-last-sent
   target. This is an operational target, not an issuer-response SLA and not a reason to shorten
   the existing reply/deadline rules.

## Consequences

- The authenticated startup core is about 71 KB instead of about 131 KB; ADMIN (~28 KB), analysis
  (~32 KB) and image (~8 KB) code is transferred only when used. Exact transfer size still depends
  on HTTP compression.
- Static users no longer pay for dormant backend code. Every build still shares the public
  earnings advisory and follow-board modules by design.
- PNG generation has a small first-use load cost, but normal page startup no longer parses the
  approximately 200 KB vendored rasterizer.
- ADMIN can distinguish create→queue, queue→first-send, first→last-send and queue→last-send time.
  Real 10–20 second stability must be confirmed from deployed samples; synthetic tests prove the
  calculation and selective-send shape but do not prove bank-mail delivery.
- No D1 migration, public API removal, production dependency, lockfile, authentication rule,
  ranking rule or mail format changes.

## Evidence / implementation links

- `index.html`, `backend-client.js`, `backend-admin.mjs`, `backend-analysis.mjs`,
  `backend-image.mjs`, `html2canvas-loader.mjs`
- `earnings-advisory.mjs`, `follow-board.mjs`, `app.js`
- `backend/src/admin-rfq.ts`, `backend/wrangler.jsonc`
- `backend/test/admin-rfq.test.ts`, `backend/test/outbound.test.ts`
