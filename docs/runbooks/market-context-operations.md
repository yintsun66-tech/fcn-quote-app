# SEC / Alpha Vantage public market-context operations

This runbook applies only after explicit migration/Secret/deployment authorization. It must not be
used to change RFQ, ranking, mail-routing or ownership data.

Current production baseline (2026-07-31): market migration `0012` and the Secret name are present;
all repository migrations through `0016` are applied, and Worker
`ddf8cef7-ccc2-49d8-91ca-11fdc2b4e0a6` is deployed. The Alpha Vantage findings below are from a
read-only check on 2026-07-30 and have not been re-measured since. That check found three fresh
SEC instrument/filing pairs, no Alpha Vantage cache row, and ten provider attempts on 2026-07-29.
Previous-close data is therefore still operationally unavailable. Verify one current symbol and,
if needed, the key's activation/entitlement through the hidden Secret workflow before changing
application logic or clearing cache.

**ADR 0024 scope change.** Alpha Vantage now serves only the per-symbol previous close that fills
「輸入標的參考現價」. Market hot lists moved to the homepage as a TradingView widget and no longer
touch the provider, the D1 cache or the daily budget, so an Alpha Vantage outage no longer affects
them. `GET /api/v1/market/ideas` no longer exists. The daily budget therefore covers per-symbol
daily-series requests only, which materially reduces pressure on the free-tier limit.

## Production prerequisites

1. Confirm `ALPHA_VANTAGE_API_KEY` is available. Enter it only through Cloudflare's encrypted Secret
   prompt or dashboard; never paste it into chat, a shell command, `.dev.vars`, source, logs or
   Git.
2. Confirm the SEC contact identity remains `FCN Quote App rfq@yintsun66.com`.
3. Run typecheck, all tests and the dry-run build.
4. Review migration `0012_alpha_vantage_market_data.sql`. It preserves the reconstructable cache,
   allows `ALPHA_VANTAGE` rows and adds a daily provider-usage counter. It does not modify existing
   financial records.

## Secret rotation or redeployment order

1. Only when replacing the key, securely update the Worker Secret:

   ```powershell
   Set-Location backend
   pnpm exec wrangler secret put ALPHA_VANTAGE_API_KEY
   ```

   Type the value only into Wrangler's hidden prompt.
2. Check migration status. Apply only a reviewed pending migration; do not rerun or edit `0012`:

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
- Current observed state is SEC `FRESH` and Alpha Vantage unavailable; manual reference-spot input
  remains the required fallback until a normalized Alpha Vantage row is observed.
- ADMIN health groups cache rows by source/status and reports expired/stale/rate-limit row counts.
- ADMIN health reports today's Alpha Vantage attempted-request count. The configured safety cap is
  24 per UTC day.
- `GET /api/v1/market/ideas` is intentionally absent. Homepage hot lists must not consume Alpha
  Vantage quota or create D1 market-mover cache rows.
- The scheduled cleanup runs after RFQ recovery. A cleanup exception is logged as
  `market_context_cleanup_failed` and must not interrupt RFQ recovery.

Recommended capacity actions:

- At 70% of the active D1 plan capacity, review growth and the existing financial-record retention
  plan.
- At 85%, set `MARKET_CONTEXT_ENABLED` to `0`, stop nonessential cache expansion, and execute an
  approved archive or plan-upgrade action. Never delete financial records silently.
- Repeated Alpha Vantage throttling: keep stale fallback, verify the daily usage count and API
  entitlement, and do not retry aggressively. Repeated SEC throttling still requires verification
  of the declared SEC identity.

## Incident response

1. Confirm `/api/v1/health` and RFQ functions first. Public-data failure must stay isolated.
2. Inspect safe Worker events and ADMIN cache/provider-usage counts; do not log or retrieve the
   Alpha Vantage key.
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

The old `FRED_API_KEY` Secret may remain encrypted during rollback but is not read by the new
Worker. Delete or rotate any Secret only through Cloudflare Secret management and only with
explicit authorization. `ALPHA_VANTAGE_API_KEY` must also remain encrypted and may be removed only
after rollback is confirmed.
