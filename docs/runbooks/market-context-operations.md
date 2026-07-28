# SEC / FRED public market-context operations

This runbook applies only after explicit migration/Secret/deployment authorization. It must not be
used to change RFQ, ranking, mail-routing or ownership data.

## Production prerequisites

1. Confirm `FRED_API_KEY` is available. Enter it only through Cloudflare's encrypted Secret
   prompt or dashboard; never paste it into chat, a shell command, `.dev.vars`, source, logs or
   Git.
2. Confirm the SEC contact identity remains `FCN Quote App rfq@yintsun66.com`.
3. Run typecheck, all tests and the dry-run build.
4. Review migration `0011_market_context.sql`. It adds reconstructable cache/rate-limit tables
   only and does not modify existing financial records.

## First deployment order

1. Securely create the Worker Secret:

   ```powershell
   Set-Location backend
   pnpm exec wrangler secret put FRED_API_KEY
   ```

   Type the value only into Wrangler's hidden prompt.
2. Apply the migration:

   ```powershell
   pnpm exec wrangler d1 migrations apply fcn-quote --remote
   ```

3. Deploy the Worker only after the two previous steps succeed.
4. Verify the public health endpoint and static asset version.
5. Sign in as a normal test user and load one supported SEC/FRED panel. Do not create or send a
   real RFQ merely to test this panel.
6. Sign in as ADMIN and verify the RFQ time-axis dialog shows the separate public-cache health
   panel without source payloads or Secrets.

## Normal health

- User context response returns `FRESH`, or `STALE` during a bounded upstream outage.
- `UNAVAILABLE` affects only the public reference panel.
- ADMIN health groups cache rows by source/status and reports expired/stale/rate-limit row counts.
- The scheduled cleanup runs after RFQ recovery. A cleanup exception is logged as
  `market_context_cleanup_failed` and must not interrupt RFQ recovery.

Recommended capacity actions:

- At 70% of the active D1 plan capacity, review growth and the existing financial-record retention
  plan.
- At 85%, set `MARKET_CONTEXT_ENABLED` to `0`, stop nonessential cache expansion, and execute an
  approved archive or plan-upgrade action. Never delete financial records silently.
- Repeated SEC/FRED throttling: keep stale fallback, lengthen TTL in a reviewed change, and verify
  the declared SEC identity. Do not retry aggressively.

## Incident response

1. Confirm `/api/v1/health` and RFQ functions first. Public-data failure must stay isolated.
2. Inspect safe Worker events and ADMIN cache counts; do not log or retrieve the FRED key.
3. If the public provider is unstable, set `MARKET_CONTEXT_ENABLED=0` and deploy that binding
   change. Phase 1 analysis and RFQ workflows remain available.
4. If stale rows must be removed, allow the scheduled cleanup to expire them. Any manual remote
   mutation requires separate explicit authorization and a reviewed, narrowly scoped query.
5. Record the incident, Worker version, affected source, safe error code, time window and recovery
   verification in `docs/HANDOFF.md`.

## Rollback

Worker rollback uses the standard deployment runbook. Migration `0011` is additive; leave its
empty/reconstructable tables in place during a Worker rollback. Dropping tables is destructive,
unnecessary for functional rollback and requires a separately reviewed migration plus explicit
authorization.

The `FRED_API_KEY` Secret may remain encrypted while the old Worker is active. Delete or rotate it
only through Cloudflare Secret management and only with explicit authorization.
