# SEC / Twelve Data public market-context operations

This runbook applies only after explicit migration/Secret/deployment authorization. It must not be
used to change RFQ, ranking, mail-routing or ownership data.

Current production baseline (2026-08-02): all repository migrations through `0017` are applied,
Wrangler reports no pending remote migration, and Worker
`088fb054-3e52-48d0-b409-6b486d2db44f` is deployed. SEC company/filing context and Twelve Data
previous closes are operational. On 2026-08-01, TSM returned a fresh Twelve Data row for the
completed 2026-07-31 New York session at 404.25, with no fallback, and the session/value matched an
independent source. Alpha Vantage remains last in the chain but has not returned a usable production
payload; the working path does not depend on it. Yahoo is not in the runtime chain because it
returned HTTP 429 from Cloudflare egress.

**ADR 0024 scope change.** The provider chain serves only the per-symbol previous close that fills
「輸入標的參考現價」. Market hot lists live on the homepage as TradingView links/widget and do not
touch the Worker provider, D1 cache or daily budgets. `GET /api/v1/market/ideas` no longer exists.
The provider budgets therefore cover per-symbol daily-series requests only.

## Production prerequisites

1. Confirm `TWELVE_DATA_API_KEY` is available. Enter it only through Cloudflare's encrypted Secret
   prompt or dashboard; never paste it into chat, a shell command, `.dev.vars`, source, logs or
   Git. `ALPHA_VANTAGE_API_KEY` is optional fallback state and is not required for normal service.
2. Confirm the SEC contact identity remains `FCN Quote App rfq@yintsun66.com`.
3. Run typecheck, all tests and the dry-run build.
4. Review migrations `0012_alpha_vantage_market_data.sql` and
   `0017_equity_daily_providers.sql`. They preserve reconstructable cache/provider usage and do not
   modify existing RFQ economics. Never edit an applied migration.

## Secret rotation or redeployment order

1. Only when replacing the key, securely update the Worker Secret:

   ```powershell
   Set-Location backend
   pnpm exec wrangler secret put TWELVE_DATA_API_KEY
   ```

   Type the value only into Wrangler's hidden prompt.
2. Check migration status. Apply only a reviewed pending migration; do not rerun or edit an applied
   migration:

   ```powershell
   pnpm exec wrangler d1 migrations apply fcn-quote --remote
   ```

3. Deploy the Worker after any required Secret/migration action succeeds.
4. Verify the public health endpoint and static asset version.
5. Sign in as a normal test user and open one existing FCN analysis page. Confirm an empty
   reference-spot field receives the previous trading day's close. Do not create or send a real RFQ
   merely to test this feature.
6. On the homepage, open 「美股／日股熱門榜」. Confirm all five ranking links exist for both
   markets; after consent, 美股 may render the embedded live hotlists rows. 日股 must remain
   link-only with an explicit explanation. Confirm no frame is created before consent is ticked,
   and never use `JP`, `JPX` or `TYO` as a widget exchange.
7. Sign in as ADMIN and verify the RFQ time-axis dialog shows the separate public-cache health
   panel without source payloads or Secrets.

## Normal health

- User context response returns `FRESH`, or `STALE` during a bounded upstream outage.
- `UNAVAILABLE` affects only the public reference panel.
- Current observed state is SEC `FRESH` and Twelve Data equity-daily `FRESH`. Manual reference-spot
  input remains available when either source is unavailable.
- ADMIN health groups cache rows by source/status and reports expired/stale/rate-limit row counts.
- ADMIN health reports today's per-provider attempted-request counts. Twelve Data is the primary
  source; Alpha Vantage's smaller budget applies only if fallback is attempted.
- `GET /api/v1/market/ideas` is intentionally absent. Homepage hot lists must not consume provider
  quota or create D1 market-mover cache rows.
- The scheduled cleanup runs after RFQ recovery. A cleanup exception is logged as
  `market_context_cleanup_failed` and must not interrupt RFQ recovery.

Recommended capacity actions:

- At 70% of the active D1 plan capacity, review growth and the existing financial-record retention
  plan.
- At 85%, set `MARKET_CONTEXT_ENABLED` to `0`, stop nonessential cache expansion, and execute an
  approved archive or plan-upgrade action. Never delete financial records silently.
- Repeated Twelve Data throttling: keep stale/manual fallback, verify the per-provider usage count
  and account entitlement, and do not retry aggressively. Repeated SEC throttling still requires
  verification of the declared SEC identity.

## Incident response

1. Confirm `/api/v1/health` and RFQ functions first. Public-data failure must stay isolated.
2. Inspect safe Worker events, `last_error_code` and ADMIN cache/provider-usage counts; do not log
   or retrieve any provider key. Failure rows remain for seven days specifically for diagnosis.
3. If the public provider is unstable, set `MARKET_CONTEXT_ENABLED=0` and deploy that binding
   change. Phase 1 analysis and RFQ workflows remain available.
4. If stale rows must be removed, allow the scheduled cleanup to expire them. Any manual remote
   mutation requires separate explicit authorization and a reviewed, narrowly scoped query.
5. Record the incident, Worker version, affected source, safe error code, time window and recovery
   verification in `docs/HANDOFF.md`.

## Rollback

Worker rollback uses the standard deployment runbook. Migrations `0011` and `0012` contain only
public-reference/cache structures; leave their empty or reconstructable tables in place during a
Worker rollback. Dropping tables is destructive, unnecessary for functional rollback and requires
a separately reviewed migration plus explicit authorization.

The old `FRED_API_KEY` Secret may remain encrypted during rollback but is not read by the current
Worker. `ALPHA_VANTAGE_API_KEY` is an optional final fallback and may also remain encrypted. Delete
or rotate any Secret only through Cloudflare Secret management and only with explicit
authorization. Keep `TWELVE_DATA_API_KEY` available for the normal production path unless the
market-context feature is deliberately disabled or rolled back.
