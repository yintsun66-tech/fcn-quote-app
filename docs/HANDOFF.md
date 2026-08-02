# Project handoff

Updated: 2026-08-01 (Asia/Taipei)

Current branch: `codex/market-analysis-phase2-4`, merged into `main` on 2026-07-31.

## RFQ acceleration deployed (2026-08-01)

Feature commit `48a3b08` (`feat(rfq): accelerate selective quote workflows`) was pushed to
`origin/codex/market-analysis-phase2-4` and deployed to Cloudflare as Worker version
`19765b08-66bd-4d4a-8dbd-634dbe7e07cf`:

- the browser now submits create → validate → send through one additive
  `POST /api/v1/rfqs/submit` call; deterministic child idempotency keys preserve retry safety and
  the old three endpoints remain available;
- provisional ranking, finalized ranking, custom-fifth choices, snapshot quote digest and
  quote-card authorization now admit only issuers in the immutable `rfq_expected_issuers`
  snapshot. Unselected BMJB replies remain stored for audit;
- the issuer picker displays selected institution count and physical mail-batch count; small RFQs
  (up to three selected issuers) cap unchanged polling at eight seconds and highlight early
  completion after the seven-minute soft deadline only when each trade has at least
  `min(2, selected count)` valid quotes;
- the 15-minute reply period, final 60-second transport grace, D1 schema, bindings, secrets and
  dependencies are unchanged.

Verification evidence: root `backend-client.js` syntax check passed; backend type generation and TypeScript
checks completed; all 27 test files / 198 tests passed; Cloudflare Worker dry-run build completed
after rerunning Wrangler outside the filesystem sandbox. The first sandboxed build attempt could not
resolve the Worker entry point; this was an execution-environment restriction, not a source failure.
After deployment, `https://api.yintsun66.com/api/v1/health` and `https://app.yintsun66.com/`
both returned HTTP 200. The live page references `backend-client.js?v=small-rfq-fast-v1`, and the
served client contains the new `/rfqs/submit`, issuer batch-count, small-RFQ fast-close and
eight-second polling logic.

Preserve the user-owned untracked `.claude/` and `output/` directories. The final diff contains no
secret or lockfile change and passes `git diff --check`. No authenticated production RFQ was sent
during verification, because that would create real outbound bank email. Smallest next step: have an
authorized user submit one two- or three-issuer RFQ and confirm the displayed institution/mail-batch
counts and result timing.

## Merged into `main` (2026-08-01, second merge)

`599a31d` merged as `9346760` (`7ef8cd5..9346760`), 12 files, including migration `0017` which was
already applied to remote D1. Checked before merging, as before: the `merge-tree` preview produced a
tree hash identical to the branch tree, `git diff HEAD codex/…` on the merged `main` is empty, the
`FCN V2-main-sg` worktree was clean beforehand, and the outgoing diff carried no key or credential.
`main` shows four commits the branch lacks; all four are merge nodes or the two old `app.js` fixes
already absorbed by content, so nothing was lost.

Re-checked afterwards: GitHub Pages still disabled on this repository (API 404, URL 404 — pushing
`main` did not re-enable it), `fcnV2` 200, `api.` and `app.yintsun66.com` 200.

## Previous close is working in production (verified 2026-08-01)

`TWELVE_DATA_API_KEY` was configured and the Worker deployed as
`7ea7c41e-ae32-4610-92c5-39f879779919`. The operator opened one analysis page, and the cache row was
then read rather than trusted:

```
equity:daily:v2:TSM   status=FRESH   last_error_code=null
provider=TWELVE_DATA  providerAttempts=[]
tradingDate=2026-07-31  closePrice=404.25  priorTradingDate=2026-07-30
```

First choice answered with no fallback. The value was **cross-checked against an independent pull of
the same symbol made earlier in the session from a different provider entirely**, which reported
2026-07-31 → 404.25 and 2026-07-30 → 403.31. Two unrelated sources agreeing on both the price and
the session date is what confirms the New York date handling and the completed-session rule — a
single number in the right shape would not have.

**This closes the manual previous-close entry.** The chain to get here was: the failure could not be
diagnosed because the evidence self-destructed → fix the retention first → then the recorded reasons
eliminated Yahoo and Alpha Vantage in one reading → configure the one provider left.

Still true: Alpha Vantage remains last in the chain and is still broken; nothing depends on it now.

## The diagnostic worked, and it removed Yahoo (2026-08-01)

The first real lookup after the provider chain shipped still produced no price — and for the first
time the reason was recorded rather than erased:

```
equity:daily:v2:TSM  status=ERROR
EQUITY_DAILY_UNAVAILABLE (TWELVE_DATA=TWELVE_DATA_NOT_CONFIGURED,
                          YAHOO=UPSTREAM_RATE_LIMITED,
                          ALPHA_VANTAGE=ALPHA_VANTAGE_RATE_LIMITED)
```

Three facts came out of one row:

- **Yahoo is not usable from a Worker.** The same request returns **HTTP 200 from a residential
  address and 429 from Cloudflare's egress** — measured both ways on the same symbol, minutes apart.
  Yahoo rate-limits shared datacenter IPs. It was recommended and shipped as the keyless fallback on
  the strength of a local `curl`, which did not represent the runtime at all. **A local test of an
  outbound dependency proves nothing about this Worker.** Yahoo has been removed from the chain and
  a comment at the call site records why, so it is not re-added as an easy win.
- **Alpha Vantage's long-standing failure is finally named**: `ALPHA_VANTAGE_RATE_LIMITED`, which is
  how its `Information` response is mapped. The usage counter shows one or two requests a day, far
  below any quota, so the likelier readings are an unactivated key or an endpoint that is no longer
  free — not real over-use. Not worth further investigation; it is last in the chain.
- **Twelve Data is the only remaining path** and needs a key (`TWELVE_DATA_API_KEY`, free tier, 800
  credits/day against a real load of tens of requests). Until it is set, the previous close stays
  manual.

The chain is now Twelve Data → Alpha Vantage. Migration `0017`'s CHECK still lists `YAHOO`, which is
harmless and deliberately left alone: an applied migration is not edited.

Verified after removal: 27 test files / **197 tests**, typecheck clean, dry-run build clean.

## Previous close automated: why it was broken, and a provider chain (deployed 2026-08-01)

The manual entry of US closing prices was traced before anything was replaced, and the finding
changes what the fix had to be.

**The provider was not the whole problem — the diagnosis was.** Production D1 showed
`market_provider_daily_usage` recording Alpha Vantage requests every day, and `public_data_cache`
holding six SEC rows and **not one Alpha Vantage row of any status, including `ERROR`**. The reason:
a failed refresh writes an `ERROR` row with `stale_until = now + 10 minutes`, and
`cleanupExpiredMarketData` — which runs on the **two-minute** cron — deletes any row whose
`stale_until` has passed. Every failure was therefore erased about ten minutes after it happened.
`stale_until` was gating both *when to retry* and *when to delete*, which are not the same question.
That is why the feature could sit broken for weeks with nobody able to say why.

**Swapping providers without fixing that would have reproduced the same blindness**, so it was fixed
first: an `ERROR` row is now kept for seven days (retry timing unchanged), and `last_error_code`
carries per-provider detail rather than a single coarse code.

**Sources were tested, not assumed.** Stooq is dead for this purpose — it now serves a
proof-of-work bot challenge that a Worker cannot pass and that we would not bypass. Yahoo's keyless
chart endpoint and `api.nasdaq.com` both answer today. Free tiers at Twelve Data, Finnhub, Polygon
and EODHD all exceed what this needs: with a 24-hour D1 cache the real volume is on the order of
tens of requests a day.

Two traps were found by measurement and are now guarded:

1. **Yahoo's `meta.chartPreviousClose` is not the previous session's close.** Measured on AAPL: the
   field read 325.89 while 07-30 closed at 333.43 and 07-31 at 308.91. It is the close before the
   *requested range* begins, so a seven-day range reports a week-old price. Only the
   timestamp/close arrays give per-session closes.
2. **A "previous close" convenience field answers the wrong question here.** A Taipei morning is the
   previous New York evening: the session the operator means is dated *today* in New York, so
   Polygon's `/prev` or Finnhub's `pc` would both return the session before it. The implementation
   takes a daily series and selects the last bar whose session has actually closed
   (`isCompletedSession`, 16:15 New York, via the runtime's time-zone database so DST is handled).

What was built: a provider chain **Twelve Data → Yahoo → Alpha Vantage**, first success wins, each
failure carried forward in `providerAttempts` and into the stored diagnostic. One shared validation
gate for every provider's bars, so a new source cannot introduce a zero or a string price into the
derived metrics. Per-provider daily budgets, so a fallback cannot spend the primary's allowance. The
cache key and `source` are provider-independent (`EQUITY_DAILY`), and the payload records which
provider actually answered — surfaced in the UI, because a price whose source is invisible invites
the reader to assume it came from wherever they last configured.

The API gains `marketContext.equityDaily`; `marketContext.alphaVantage` remains as a deprecated
alias because the Worker and the static front end deploy separately.

**Migration `0017` is required and not yet applied** — `source` and `provider` both carry CHECK
constraints that admit only the old provider names, so the new ones cannot be written without it. It
copies rows, adds no financial record and deletes nothing.

Verified: typecheck clean, **27 test files / 197 tests**, dry-run build binds the new limits,
`node --check` on both front-end bundles. New tests pin the session-close rule, the in-progress-bar
exclusion, the fallback order with recorded attempts, and that a recent failure survives the sweep
while an old one does not. **Not deployed, and no real symbol has been fetched from a new provider
in production.**

## First real LINE push was rejected 429 — diagnosis and instrumentation

A real follow-board publication finally happened, so the LINE path ran for the first time. It did
**not** deliver, and the audit trail shows exactly where it stopped:

```
06:03:21.917Z  FOLLOW_BOARD_PRODUCT_PUBLISHED  PBZJ / DBS / expires 2026-07-31
06:03:25.746Z  FOLLOW_BOARD_LINE_PUSHED        {"productCount":1,"status":429,"reason":"HTTP_429"}
```

**The integration works.** The publication committed, the hook fired 3.8 seconds later, and LINE
answered with a definitive status. That rules out the whole first tier of suspects: the flag was on,
the Worker reached the push, the credentials were accepted (a bad token or group id is 401/400, not
429), and nothing timed out. The publication ran on `5abc0baa`, before that day's performance
deployment, so none of the deadline work is implicated.

The operator then confirmed with LINE's quota API that the monthly message allowance was **not**
exhausted — so the obvious explanation for a 429 is wrong, and the remaining causes cannot be told
apart from a status code alone. **That is a gap in our own instrumentation, not in LINE.** The audit
recorded the status and deliberately discarded the response body, and LINE's `message` field is the
only thing that distinguishes a monthly cap from a rate limit.

Two changes followed:

- **`safeProviderMessage` records LINE's explanation.** Only the `message` string from LINE's JSON
  error object, truncated to 200 characters. A body that is not that shape is dropped rather than
  stored verbatim, and any LINE identifier inside the message is redacted to `[id]` first — the
  group id must never reach an audit row, however it arrives. A test pins each of those cases.
- **A 429 or 5xx is retried once**, honouring `Retry-After` up to a five-second cap. The retry
  reuses **the same `x-line-retry-key`**, which is what that header is for: if an attempt reached
  LINE but the response was lost, the retry is de-duplicated instead of delivering twice. A fresh
  key per attempt would have defeated it. Non-429 4xx responses are not retried — they will fail
  identically. Before this, a failed push simply lost the message: the publication had already
  committed and nothing tried again.

The audit now also records `attempts`. Verified: 27 test files / **194 tests**, typecheck clean,
dry-run build clean. Deployed as Worker **`08adb175-d1b1-44eb-8a97-42588ad669d0`** with every
variable unchanged (`LINE_PUSH_ENABLED ("1")`, `LINE_WEBHOOK_ENABLED ("0")`,
`RETENTION_ENABLED ("0")`); post-deploy checks: health 200 on both domains, unauthenticated snapshot
401, manifest without a PIN 401, LINE webhook 404.

**The cause of the 429 is still unknown.** Nothing here fixes it — the change makes the *next* one
explain itself. When the next follow-board publication runs, read `providerMessage` on the
`FOLLOW_BOARD_LINE_PUSHED` event before changing any code:

- a monthly-cap message means the LINE plan is the constraint, not this repository;
- a rate-limit message means the opposite, and would be surprising at five pushes a day;
- `attempts: 2` with a success means the retry did its job and no action is needed.

A read-only `GET /v2/bot/info` against the channel may identify it sooner.

## Current state at a glance

This document is long and append-only: each section records what was true on its own date. **This
block is the only one that claims to describe the present.** Everything below it is history and must
not be edited to match later reality.

| | |
|---|---|
| Source | `codex/market-analysis-phase2-4` (`599a31d`) = `main` (`9346760`), both pushed, trees identical |
| Deployed Worker | `7ea7c41e-ae32-4610-92c5-39f879779919`. **Resolve the live id from `wrangler deployments list`, never from this table** |
| Remote D1 | migrations applied through `0017` |
| Verification | 27 test files / 197 tests; typecheck (source + test) and dry-run build clean |
| GitHub Pages | **disabled** on `fcn-quote-app`; the only sanctioned static site is `fcnV2` |
| Previous close | **working** — Twelve Data, verified in production against an independent source |
| `RETENTION_ENABLED` | `"0"` — deletion is irreversible and needs separate authorization |
| `LINE_PUSH_ENABLED` | `"1"` — live, but never observed delivering |
| `LINE_WEBHOOK_ENABLED` | `"0"` — discovery is done; keep it off |
| `AUTO_RANK_ONE_IMAGE` | `"0"` — quote images are on demand (ADR 0016) |

Secrets configured: `EMPLOYEE_DATA_KEY`, `EMPLOYEE_LOOKUP_KEY`, `FOLLOW_BOARD_VIEW_PIN`,
`TWELVE_DATA_API_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_GROUP_ID`.
`ALPHA_VANTAGE_API_KEY` and `FRED_API_KEY` are still present but nothing working depends on them —
Alpha Vantage is last in the equity chain and still failing, FRED was removed from the runtime by
ADR 0023. Both are harmless; delete during any future secret cleanup.

`main` is **not** a deployment trigger. Cloudflare is published by running `wrangler deploy` from a
working tree, so `main` and the live Worker can diverge at any time.

### What is implemented but never proven in production

Distinguish these from bugs. Each is code that passes tests and has been deployed, but has not yet
run for real:

- **Delivery to the LINE group — the one open problem.** The push path is proven to run: one real
  publication reached LINE, 3.8 seconds after the publication committed. But **no message has ever
  been delivered.** LINE answered 429, and the obvious readings are eliminated: the monthly quota is
  `limited/200` with `totalUsage: 0`, the token and message shape both pass LINE's own validator, and
  a bad token or group id would be 401/400 rather than 429. `chatMode` is `chat`, noted but not
  established as the cause. The next push records LINE's own `message`, which is the field that
  separates a monthly cap from a rate limit — read that before changing any code.
- **Both Browser Rendering deadlines and the follow-board render budget.** No render job has run
  since they were added.
- **The snapshot digest.** No real browser has polled `/snapshot` since the rewrite; it has unit
  coverage only.
- **Scheduled retention.** Implemented and deployed but disabled, so it has deleted nothing. Run
  `applyRetention(env, true)` for a dry-run count before anyone considers enabling it.
- **Quote-image download on a real phone or tablet.** Still never done on a device.

## Branch merged into `main` (2026-07-31)

`codex/market-analysis-phase2-4` was merged into `main` as `748f5d9` and pushed
(`07d0cc1..748f5d9`). `main` had previously carried only the eight-file static set and was 147
commits behind; it now holds the full Cloudflare backend, 153 tracked files.

Checked before merging, not after:

- **Nothing from `main` was lost.** `main` had two `app.js` commits the branch did not have as
  commits — `bef54f6` (SG outbound columns) and `07d0cc1` (NOMURA effective-date offset). Both
  results were already present in the branch content; the actual code was compared across `main`,
  the branch and the merge-tree preview and all three read
  `{ label: "Effective Date Offset", value: () => "7" }`.
- **The merge introduced nothing unverified.** A `git merge-tree` preview produced no conflicts and
  a tree hash — `0b64a771bf66bd5be545862bf3032bb5b1a576f4` — **identical to the branch tree**, which
  the real merge then reproduced. `git diff HEAD codex/…` on the merged `main` is empty. The
  verification that applied to the branch (27 test files / 191 tests, typecheck, dry-run build)
  therefore applies to `main` unchanged, and the suite was not re-run: an identical tree hash is the
  same content.
- The merge ran in the `FCN V2-main-sg` worktree, confirmed clean and in sync first, so the primary
  working tree was never disturbed. `--no-ff` keeps the merge as an event rather than flattening it.
- Pre-push scan found only a deliberately fake test token and the minified vendored html2canvas. No
  `.dev.vars`, `.env`, `settings.local.json`, `output/` or `.msg` file is tracked, and
  `.dev.vars.example` holds blank placeholders only.

Post-push state: `origin/main` = `748f5d9`; GitHub Pages still disabled on this repository (API 404
and the URL 404 — pushing `main` did not re-enable it, which was the point of disabling it first);
`fcnV2` static site 200; `api.` and `app.yintsun66.com` 200.

**`main` is not a deployment trigger.** Cloudflare is published by running `wrangler deploy` from a
working tree, so `main` and the deployed Worker can diverge. Resolve what is live from
`wrangler deployments list`.

## An undocumented third static site was found and disabled (2026-07-31)

Asked whether merging the feature branch into `main` would affect the static release, the answer for
`yintsun66-tech/fcnV2` is **no** — it is a separate repository, synced by copying allowlisted files,
with no Git relationship to this one. But checking turned up something no document mentioned:

**`fcn-quote-app` itself had GitHub Pages enabled**, built from `main` root, public, live at
`https://yintsun66-tech.github.io/fcn-quote-app/`. Because `main` was 147 commits behind, it was
quietly serving a stale static build (`app.js?v=trade-date-today-v1`).

Merging into `main` would have made that URL serve the current application, and three things made
that worse than it sounds:

1. `main` carries `.nojekyll`, so files publish verbatim — `backend/`, `docs/`, `migrations/` and
   `vendor/` would all have become downloadable there. The repository is public, so this exposed no
   secret that was not already public, but it adds an entry point nobody was tracking.
2. `PUBLIC_ORIGINS` in `follow-board.ts` allows the whole host `https://yintsun66-tech.github.io`,
   not a path. That is the **same origin** as the `fcnV2` site, so the copy under
   `/fcn-quote-app/` would have passed follow-board CORS with exactly the same standing as the
   sanctioned static site.
3. `backend-client.js` activates on `app.yintsun66.com` **or** any host with `?backend=1`, so
   `…/fcn-quote-app/?backend=1` would have been a working second login surface.

None of that is an immediate breach — the follow board still requires the PIN and the application
still requires credentials — but it would have been a second front end drifting with `main` and
entirely outside the `prepare-assets.mjs` allowlist that governs what may be published.

**Pages was disabled on `fcn-quote-app` with the owner's explicit approval.** The configuration
before deletion, for restoration: `build_type: legacy`, `source: { branch: "main", path: "/" }`,
`public: true`, `https_enforced: true`, `cname: null`. `GET /repos/.../pages` now returns 404, and
`fcnV2` was re-checked immediately afterwards and is untouched: `status: "built"`, same source, and
its site and follow-board page both return 200.

Teardown was then confirmed by measurement rather than assumed. The GitHub CDN kept serving the
disabled site for about five minutes — four one-minute checks still returned 200, the fifth returned
404 — so a 200 straight after deletion is expected and is not evidence of failure. Final state:
`/fcn-quote-app/`, its `index.html` and its `app.js` all return **404**, while `fcnV2`'s site,
`follow-board.html` and `app.js` all return **200**. Only the intended site was removed.

Do not re-enable it, and check Pages state before merging anything into `main`.

## Performance follow-up and documentation reconciliation (committed, pushed and deployed)

A review of the P0–P3 rollout against production and against the documentation. The rollout itself
verified clean — 27 files / 186 tests, migration `0016` applied, live assets byte-identical to the
repository — and the riskiest item, the in-isolate memoisation of finalized results, was re-derived
and is sound: `rankValidQuotes` admits only `status = 'VALID'` when `includeLateReplies` is false, so
a late reply arriving after finalization cannot change a cached payload, and a recalculation always
advances the version and therefore the key.

Six things were changed on top of it.

- **The LINE push now aborts rather than races.** `withTimeout` left the request in flight, so LINE
  could still deliver a message the audit had already recorded as failed. It uses
  `AbortSignal.timeout` and reports `TIMEOUT` distinctly from `REQUEST_FAILED`.
- **Browser Rendering is bounded by a deadline, not by a per-step timeout.** `artifacts.ts` applied
  60 s to the request *and* 60 s to reading its body, so the real bound was 120 s against a 180 s
  lease. `deadlineAt`/`withDeadline` in `http.ts` give the whole render one budget.
- **The follow-board push has a total render budget** (`FOLLOW_BOARD_RENDER_BUDGET_MS`, 90 s).
  Renders stay sequential — Browser Rendering concurrency is still the constraint — but four cards
  can no longer hold the consumer for four times the per-card timeout after the publication has
  already committed. The budget is checked *before* each call, because bounding a promise cannot
  stop a request that was already issued.
- **`auditStatement` in `db.ts` is now the single audit-write shape.** The batched follow-board
  expiry sweep had a hand-written copy of the INSERT; `insertAudit` is now a thin wrapper over the
  same builder, so the two cannot drift.
- **Independent D1 reads use `batch` instead of `Promise.all`.** Same single wave of latency, but one
  subrequest instead of four or five, and — because a batch is one transaction — one consistent read
  snapshot. Concurrent statements could previously straddle a commit and return a payload mixing
  pre- and post-finalize rows.
- **An unchanged poll is now answered by one statement.** `GET /rfqs/:id/snapshot` is polled every
  four seconds and is almost always unchanged, yet saying so still cost the full status read.
  `snapshotDigest` fingerprints everything the version derives from in a single query, with
  ownership enforced in the same statement.

The digest deliberately does **not** use a `rfqs.revision` counter, which was the obvious design. A
counter has to be bumped by every writer, and a single missed bump would freeze a polling browser on
stale data with nothing to indicate why. The digest instead reads the state itself: per-row issuer
statuses (not a count, which would miss a status flip), an artifact fingerprint, quote and
late-reply counts and timestamps, and the two deadlines derived from environment variables. It is
deliberately coarser than the payload in one place — it covers all artifacts of the RFQ, not only the
current run's — because over-sensitivity costs one redundant fetch while under-sensitivity would be
invisible and wrong. `test/rfqs.test.ts` pins this by asserting the version changes for an
expected-issuer status change, a first quote, and a workflow transition.

The version is always measured **before** the payload is read. If the RFQ changes in between, the
caller gets data newer than the version it stores and simply re-fetches on the next poll; the
reverse order would strand it on stale data.

Documentation corrected in the same pass: `CLAUDE.md`, `README.md`, `version-status.html` and the
market-context runbook all named superseded Workers, commits, migration levels or test counts, and
three places claimed `b26d132c` was serving production when `wrangler deployments list` shows
`ddf8cef7` at 100%. A Cloudflare deployment replaces the whole Worker, so an asset-only publish also
becomes the version that serves the code.

Verified: typecheck clean (source and test), **27 test files / 191 tests**, `node --check` on both
front-end bundles, `prepare-assets` plus dry-run build (18 assets, `LINE_PUSH_ENABLED ("1")`,
`LINE_WEBHOOK_ENABLED ("0")`).

### Rollout evidence (2026-07-31)

- Commit `7abde5d` pushed to `origin/codex/market-analysis-phase2-4` (`16ff86b..7abde5d`), local and
  remote in sync. The outgoing diff was scanned for a group id, bearer token or long base64 secret
  and was clean.
- Deployed as Worker **`ca46deee-da1c-4aab-91e6-17a772181bfd`** with both custom domains, the
  two-minute schedule, all five Queue producers and consumers, and every variable unchanged —
  `RETENTION_ENABLED ("0")`, `AUTO_RANK_ONE_IMAGE ("0")`, `LINE_PUSH_ENABLED ("1")`,
  `LINE_WEBHOOK_ENABLED ("0")`. No migration was needed: nothing in this change touches the schema.
- Post-deploy boundary checks: `/api/v1/health` 200 on both `api.` and `app.`; an unauthenticated
  snapshot request 401; the public follow-board manifest without a PIN 401; the LINE webhook 404
  while disabled. The authorization boundaries the snapshot rewrite touches are therefore intact —
  `snapshotDigest` enforces ownership in its own statement, and the session gate still runs first.
- Because the batched reads changed the scheduled path, production was tailed for five minutes
  across the new versions. **28 events, all `outcome: "ok"`, zero exceptions and zero error logs** —
  three consecutive cron ticks (14:18:10Z, 14:20:10Z, 14:22:10Z) plus the 17 HTTP requests of the
  boundary checks. The batched recovery sweep, the batched follow-board cleanup and the batched
  retention read therefore all run clean in production.
- The status page was then republished with the deployed version id, which necessarily produces a
  further version carrying identical code. **This is why a recorded Worker id ages out immediately:
  resolve what is live from `wrangler deployments list`, not from a document.**

**Not verified by this rollout:** no RFQ was created, sent or polled by a real browser, so the
snapshot digest has unit coverage but no production observation. No follow-board publication was
made, so the LINE push and its new render budget remain unproven end to end, and no Browser
Rendering job ran, so neither render deadline has been observed in production.

## Performance work P0–P3 (committed, pushed, migrated and deployed)

A performance review produced a P0/P1/P2 list. Everything on it is implemented except one item that
was deliberately stopped (see the "Stopped" paragraph). Implementation commit `e90ce53` is pushed to
`origin/codex/market-analysis-phase2-4`, migration `0016` is applied to remote D1, and the code was
deployed as Worker `b26d132c-5a0e-4fdf-b765-dbdda1407d73` — republished unchanged by a later
status-only asset deploy, so `ddf8cef7-ccc2-49d8-91ca-11fdc2b4e0a6` is what serves production.
Deployment evidence is at the end of this section.

**P0**

1. `app.js` `downloadQuoteImage()` had no timeout on either the double `requestAnimationFrame` wait
   or the `html2canvas` call, so 下載報價圖 could sit on 「產圖中…」 forever — the same defect that
   was already fixed in `backend-client.js` and `follow-board.mjs`. Both awaits are now raced
   against a timeout (5 s layout, 20 s draw) that surfaces a message and restores the button.
2. `GET /api/v1/rfqs/:id/snapshot` — polled every four seconds — issued about eleven **sequential**
   D1 queries. After the ownership check nothing depends on anything else, so the reads now go out
   in waves: one for the RFQ row, one wave of four (issuers, late replies, artifacts, provisional
   quote counter), and, only when the snapshot actually changed, one wave for the results and
   artifact payloads. Same SQL, same payload; three round-trip steps instead of eleven.
3. Migration `0016_query_performance_indexes.sql` adds four indexes: `audit_events(action,
   created_at DESC)` for the duplicate-registration summary, `rfqs(user_id, created_at DESC, id
   DESC)` for the owner RFQ list and its cursor, `outbound_email_batches(queued_at DESC, id DESC)`
   for the ADMIN outbound list, and `ranking_exclusions(rfq_id, ranking_run_id, trade_id)` for
   results loading. Indexes only — no table, column, constraint or row changes. The older
   `idx_rfqs_user_created` is now subsumed by the new RFQ index but is deliberately **not** dropped;
   dropping a production index was not in scope. `test/query-plan.test.ts` asserts both that the
   indexes exist and that `EXPLAIN QUERY PLAN` uses them instead of scanning or sorting.
4. Every keystroke in the quote table ran a full draft save (up to ~380 `querySelector` calls) plus
   a full preview re-render. Those are now debounced by 250 ms, with an immediate flush when a field
   loses focus and an explicit cancel in `clearSavedDraft` so a pending save cannot resurrect a
   draft the user just cleared.

**P1**

- `loadRfqResultsPayload` re-scanned the candidate quotes, ranking rows and exclusion rows once per
  trade, and the tie check re-scanned the ranking rows once more per ranking row — quadratic on a
  multi-trade RFQ, on every poll. Each set is now grouped by trade once. A finalized payload is also
  memoised in-isolate (bounded to 32 entries) keyed by RFQ, ranking version, workflow status and
  finalization time. **A `RECALCULATION` run is never memoised**: it admits late replies, and a
  further late reply can change the alternate-quote list without advancing the version.
- `backend-client.js` imported `./market-resources.mjs` while `app.js` imported
  `./market-resources.mjs?v=market-hotlist-v3`. Different URLs mean the browser downloaded and
  instantiated the module twice, and a version bump only busted one copy. Both now use the versioned
  specifier.
- The 74 KB `交易所查詢0715.csv` was fetched on every page load. It is now fetched on first focus of
  a BBG Code field, and normalisation on blur awaits that load — which also removes the pre-existing
  race where a fast typist could blur before the startup fetch finished.
- The analysis page fetched market context for up to five underlyings sequentially; they now run
  together. `marketContextRequest` already de-duplicates a repeated ticker, so no extra upstream
  request is issued, and five concurrent calls sit well inside the 30-per-minute limiter.

**P2/P3**

- `scheduledWorkflowRecovery` sent up to 150 queue messages one at a time; it now reads both job
  tables together and uses `sendBatch` per queue (both limits are inside the 100-message cap).
  `test/scheduled-recovery.test.ts` pins this.
- `cleanupFollowBoardOperationalData` looped row-by-row for the legacy expiry backfill and the
  expiry archive pass. Both are batched, and the audit rows are written only for products whose
  guarded `UPDATE` actually changed — the guard SQL is unchanged, so nothing is archived or audited
  twice.
- `applyRetention` sweeps the two R2 prefix groups together, batches the two pointer-clearing
  updates, and reads the delete candidates and the held count together.
- Browser Rendering had no application-layer timeout in either caller. `withTimeout` in `http.ts`
  now bounds the quote-card render and the follow-board LINE card at 60 s (well inside the
  three-minute job lease, so a timed-out job requeues cleanly as `BROWSER_RENDER_TIMEOUT`), and the
  LINE push itself at 15 s (recorded as reason `TIMEOUT`). The four sequential follow-board card
  renders were left sequential on purpose: Browser Rendering concurrency is the documented
  constraint.

**Stopped and awaiting a decision — caching the public follow-board manifest.** The plan is right
that `GET /api/v1/public/follow-board/manifest` has no caching at all, but every workable cache
conflicts with a documented invariant. ADR 0028 requires expired products to be **hidden
immediately**, ADMIN 下架 is expected to take effect at once, and `follow-board.mjs` reloads the
manifest right after a user submits 我要跟單 so they can see their own row — a cross-isolate TTL
would break at least one of those. A zero-staleness variant still has to query D1 to learn whether
it is stale, so it saves only JSON parsing. Worth noting too: the board is loaded on demand, not
polled, so the hot-path premise is weaker than the plan assumed. If a bounded cache is still wanted,
the safe shape is: cache the product list only, re-apply the `expiresAt > now` filter in memory on
every request (so expiry stays exact), invalidate on publish/archive, and cap the TTL at ~10 s —
accepting that a manual 下架 can lag by that much in another isolate. That trade needs an explicit
decision.

Verification of this work: `node --check` on `app.js`, `backend-client.js`, `market-resources.mjs`,
`market-analysis.mjs` and `follow-board.mjs`; `wrangler types`; source and test typechecks clean;
**27 test files / 186 tests** (was 24 / 176); `prepare-assets` plus the Wrangler dry-run build,
which reported 18 public assets and every existing binding, including `RETENTION_ENABLED ("0")` and
`LINE_PUSH_ENABLED ("1")`.

Two test files needed adjusting because a migration was appended.
`test/follow-board-migration.test.ts` split the migration list by position (`slice(-2)`); it now
finds the `0014_` boundary by name so the legacy rows are still seeded against the pre-0014 schema.
`test/ranking-integration.test.ts` gained a finalized read before the recalculation, so a stale
memoised payload would fail the existing version-2 assertion.

The asset cache token for `index.html` moved to `?v=perf-p0-v1` for `app.js` and
`backend-client.js`, per the recorded rule that a changed versioned asset must get a new token.
`styles.css` did not change and keeps its token.

### Rollout evidence (2026-07-31)

- Implementation commit `e90ce53` pushed to `origin/codex/market-analysis-phase2-4`
  (`c190b8d..e90ce53`), local and remote in sync. The outgoing diff was scanned for tokens, keys and
  the LINE group id and was clean.
- Migration `0016_query_performance_indexes.sql` applied to remote D1 `fcn-quote`: 5 commands
  executed, `migrations list --remote` then returned "No migrations to apply", a direct
  `sqlite_master` read confirmed all four index names exist, and `PRAGMA foreign_key_check` returned
  no rows. Remote D1 is now applied through `0016`.
- Worker `b26d132c-5a0e-4fdf-b765-dbdda1407d73` deployed with both custom domains, the two-minute
  schedule, all five Queue producers and consumers, the Durable Object, Email, D1, R2 and Browser
  bindings, and every environment variable unchanged — including `RETENTION_ENABLED ("0")`,
  `AUTO_RANK_ONE_IMAGE ("0")`, `LINE_PUSH_ENABLED ("1")` and `LINE_WEBHOOK_ENABLED ("0")`. Three
  static assets were uploaded (`index.html`, `app.js`, `backend-client.js`); the other 15 were
  already present.
- Post-deploy checks: `/api/v1/health` returned HTTP 200 on both `api.` and `app.`; the homepage,
  `follow-board.html` and both new asset tokens returned HTTP 200; the public follow-board manifest
  returned HTTP 401 without a PIN. The live index references `?v=perf-p0-v1` for both modules and no
  longer references the previous token. The live `app.js` contains `withRenderTimeout`,
  `scheduleRowChanges` and `ensureBbgLookup`, and no longer calls `loadBbgLookup()` at startup. The
  live `backend-client.js` imports `market-resources.mjs?v=market-hotlist-v3` and maps the
  underlyings for the parallel previous-close fetch.
- Because this change touches the scheduled handler, two consecutive cron ticks were tailed live on
  the new version: both reported `outcome: "ok"` with no exceptions and no error logs, so the
  batched recovery sweep, the batched follow-board cleanup and the batched retention pass all run
  clean in production.

**Anomaly worth recording:** the first `wrangler d1 migrations list --remote` failed with Cloudflare
API error 7403 ("the given account is not valid or is not authorized to access this service") even
though `wrangler whoami` showed the correct account with `d1 (write)`. An immediate retry succeeded
with no configuration change, so treat a single 7403 on the first D1 call of a session as a stale
OAuth access token and simply retry before investigating entitlements.

### GitHub Pages static snapshot synced

The allowlisted public assets were synced to `yintsun66-tech/fcnV2` `main`, which GitHub Pages
publishes from the repository root. Only four files had real content changes — `app.js`,
`backend-client.js`, `index.html` and `README.md` (from `docs/static-release-readme.md`). Static
program commit is **`7af6b6d`**; the follow-up status-document commit is **`cdafc8a`**. No Worker
source, migration, Secret, D1/R2 content or private fixture was copied.

`version-status.html` on the static site had drifted two releases behind (it still named commit
`6d2f3b2` and Worker `23c74ccd`), so this sync also brought it current. The same file was updated in
this repository and published to Cloudflare in a status-only deployment, Worker
**`ddf8cef7-ccc2-49d8-91ca-11fdc2b4e0a6`**, which only had one asset to upload.

**That is the version now serving production.** A Cloudflare deployment replaces the whole Worker,
so an asset-only publish still produces a new version that serves the code as well —
`b26d132c-5a0e-4fdf-b765-dbdda1407d73` is the deployment the feature *arrived* in, not the one
running. Both carry the same code, from `e90ce53`. Resolve "what is live" from
`wrangler deployments list`, which shows `ddf8cef7` at 100%, rather than from the deployment that
introduced a change.

Verification fetched all fifteen allowlisted assets over HTTP from both sites and hashed each
against the repository source. **Both sides are identical to source on all fifteen: zero
mismatches** — GitHub Pages byte-for-byte after LF normalization, Cloudflare likewise once its
injected beacon is removed. Nine of the fifteen are also identical to each other raw. The six raw
differences were measured and are **not** content drift:

- The four HTML files differ by exactly 359 bytes each because Cloudflare injects a
  `static.cloudflareinsights.com` Web Analytics beacon immediately before `</body>`, replacing the
  indentation there. (A canonicalizing regex that eats the whitespace around the tag will leave a
  spurious two-character difference; strip only the tag.)
- `styles.css` and `交易所查詢0715.csv` differ by exactly their CRLF count (82 and 4,625). Cloudflare
  serves the Windows working copy, which still has CRLF for files nobody has rewritten, while GitHub
  Pages serves the git-normalized LF blob.

Live content checks on the static site confirmed the P0/P1 front-end changes are actually being
served: `index.html` references `?v=perf-p0-v1` for both modules and no longer the previous token,
`app.js` contains `withRenderTimeout`, `scheduleRowChanges` and `ensureBbgLookup`,
`backend-client.js` uses the versioned `market-resources.mjs` specifier and the parallel
previous-close fetch, and `version-status.html` names Worker `b26d132c`, source commit `e90ce53` and
static commit `7af6b6d`.

A working tree cloned from `fcnV2` on Windows will show roughly ten files as modified straight after
a sync. That is the stat cache plus line endings, not content: `git diff --numstat` is empty and
`git hash-object --path <file> <file>` returns the blob already stored in `HEAD` for every one of
them. There is nothing further to commit.

**Do not compare the two sites by hashing working-tree files on Windows** — `core.autocrlf=true`
plus the static repository having no `.gitattributes` makes every file look different. Compare over
HTTP, normalize line endings, and ignore the beacon.

**Not verified by this rollout:** no RFQ was created or sent, no real issuer mail was exchanged, no
follow-board publication was made, and therefore the LINE push remains unproven end to end. No
Browser Rendering job ran, so the new 60-second render timeout has unit coverage but no production
observation.

**Smallest safe next step:** decide the follow-board manifest cache question above. Preserve the
user-owned untracked `.claude/` and `output/`.

Current production source: implementation commit `e90ce53`, currently served as Worker
`ca46deee-da1c-4aab-91e6-17a772181bfd` on 2026-07-31 (a later status-only asset republish, if any,
carries a higher id with identical code). Remote D1 migrations are applied through
`0016`. Current branch HEAD may include later documentation-only commits and must be resolved from
Git history.

## Known limitation: a quote sent as an image is never read (confirmed, not fixed)

Inbound parsing reads **only HTML table text**. Nothing in the pipeline decodes an image, whether it
is an inline screenshot in the mail body or a file attachment. `inbound-parser.ts` records
`attachment_count` and stores the raw MIME in R2, but never looks inside an attachment, and
`parseIssuerTables` works purely from the extracted HTML tables. So if an issuer answers with a
quote card or a screenshot instead of a table, the terms simply never reach D1.

What actually happens today, verified against the code rather than assumed:

- `processQuoteNormalizeJob` finds zero rows and writes a `quote_parse_errors` row with
  `NO_QUOTE_ROWS_FOUND`.
- `expectedIssuerStatus([])` returns **`PARSE_ERROR`**, so `rfq_expected_issuers` gets
  `status = 'PARSE_ERROR'`, `terminal_reason = 'NO_QUOTE_ROWS_FOUND'`. That much *is* visible to the
  RFQ owner in the issuer list of the status payload — the reply is not entirely invisible.
- **But the inbound message stays `PARSED`.** The ADMIN health panel counts only `MANUAL_REVIEW` and
  `SENDER_MISMATCH` (`admin-rfq.ts`), so an image-only reply never appears in the manual-review
  queue and nobody is prompted to transcribe it. It also counts as a terminal issuer state, so the
  coordinator will happily finalize the RFQ without those terms.

Net effect: a real, priced reply can be dropped from ranking with no operator prompt. This is a data
capture gap, not a parser bug — there is nothing to fix in the issuer profiles.

**Possible technical path, not started.** Cloudflare Workers AI offers vision models that could read
an attached or inline quote image into the same normalized row shape. Two constraints must be
designed in from the start:

1. **It cannot be trusted automatically.** These are financial terms; a hallucinated coupon or
   strike that flows into ranking is worse than a missing quote. Any such row must land in a
   review state and require explicit human confirmation before it can be ranked — it must not
   short-circuit `matchRows`/`rankValidQuotes`.
2. **Route the message to `MANUAL_REVIEW` first.** The cheapest useful change, independent of any
   model, is to stop treating a zero-row reply from a recognized issuer as a quiet terminal state
   and surface it for transcription. That alone closes the silent-drop problem.

The raw MIME is retained for ten days (ADR 0030), so a message that hit this path recently can still
be reprocessed; after that window the image is gone.

## Evaluated and deferred: on-demand product condition charts

A feature was fully designed and then **deliberately shelved — the user decided not to build it for
now.** Recorded here so a future restart does not repeat the investigation.

**What it was:** an on-demand price chart for a product's underlying, with the product's own terms
drawn over it as horizontal reference lines — strike, KO barrier and KI barrier against the actual
price history, so the distance to each level is visible at a glance.

**Data source options considered:**

- **A — a paid/keyed market data API.** Reliable history and clear licensing, but adds a recurring
  cost and another Secret, and the Alpha Vantage experience recorded elsewhere in this file is a
  warning about relying on a free tier.
- **B — reuse the existing SEC/public cache path.** No new provider, but it carries no price
  history; it would have to be extended, and SEC does not publish quotes.
- **C — a third-party embedded widget.** Zero data plumbing, but no control over the rendering.

**Technical approach if restarted:** fetch the price series from a chosen provider, cache it in the
existing `public_data_cache` shape, and draw the chart as **server-generated SVG with the reference
lines computed from the stored quote terms**. This deliberately mirrors the "Deferred: SVG
rendering (B)" note later in this file — same reasoning about determinism and no rasterizer
dependency — and it keeps the terms server-side rather than trusting a browser-supplied level.

**Phasing that was agreed:** a single underlying and a single quote first, read-only and
owner-scoped like the Phase 1 analysis view; only then multiple underlyings, and only then any
export or sharing.

### TradingView screenshotting: evaluated and rejected

Screenshotting a TradingView widget to obtain the same picture was considered and **rejected on two
independent grounds**:

1. **It cannot do the job.** The free embeddable widgets expose no API for drawing custom horizontal
   lines, and the reference levels are the entire point of the feature. This matches what ADR 0024
   already documents about those widgets ignoring documented parameters.
2. **Redistribution risk.** Capturing a provider's rendered chart and re-serving it to bank staff is
   a licensing question, not a technical one, and the repository's standing rule is that third-party
   market content stays link-only or opt-in embedded, never scraped or re-hosted (ADR 0021/0022).

The conclusion stands: if this feature is ever restarted, use our own price data plus our own SVG.
Do not reopen the screenshot route.

## LINE push for follow-board publications (live)

When a follow-board product is published, the Worker can push it to a private LINE group. The push
runs **after** the publication batch has committed and never throws, so a LINE outage, a revoked
token or a rate limit cannot fail or roll back a publication.

**Two outputs per publication, deliberately split.** LINE fetches an image itself and sends no
credentials, so any image URL must be publicly reachable. 手收 therefore must not appear in the
image. The product-conditions card is rendered server-side (max 5 trades/day, so Browser Rendering
capacity is not a concern) and stored under `follow-board-images/v1/`, addressed by a keyed token
(`keyedHash(EMPLOYEE_LOOKUP_KEY, ...)`, base64url) that leaks neither the product code nor any
identifier. **手收 and 交易日期 travel only in the Flex message text**, inside the private group.
`renderQuoteCardHtml` is called with `comparablePricePct: null` so the card cannot render a fee; a
test asserts 手收 is absent from the rendered HTML and present in the Flex body.

- `LINE_PUSH_ENABLED` is `"1"` as of 2026-07-31. The next follow-board publication will push.
- `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_GROUP_ID` are Secrets (`wrangler secret put`), not vars —
  the group id names a private chat. Neither is ever logged: the `FOLLOW_BOARD_LINE_PUSHED` audit
  records counts and HTTP status only, and a test asserts both strings are absent from it.
- Image objects expire on the 10-day image window (ADR 0030), which also bounds how long the public
  URL stays live.

**Group-id discovery webhook.** LINE never shows a group id in its console; it only appears inside
a webhook event. `POST /api/v1/public/line/webhook` exists solely to capture it:

- 404s unless `LINE_WEBHOOK_ENABLED="1"` **and** `LINE_CHANNEL_SECRET` is set, so it is not a
  standing open endpoint. Both default to off.
- Every request must carry a valid `x-line-signature` (`base64(HMAC-SHA256(channelSecret, rawBody))`
  — standard base64, not base64url) verified by constant-time compare, so only LINE can write to the
  audit trail. A bad signature returns 401 without revealing which part was wrong.
- Records `LINE_SOURCE_DISCOVERED` with `{ sourceType, id }` only. No member id, display name or
  message text is stored. Always returns 200 once the signature is valid, because LINE retries a
  non-2xx.

**Enablement completed on 2026-07-31.** The discovery run is history; the webhook is closed again
and should stay closed. For the record, the sequence was: set `LINE_CHANNEL_SECRET` and
`LINE_CHANNEL_ACCESS_TOKEN` as Secrets → deploy with `LINE_WEBHOOK_ENABLED="1"`
(Worker `30837aa3-e938-415c-a650-08aebe2ed995`) → register the webhook URL in the LINE console →
add the Official Account to the group → read the id from `audit_events` and store it as
`LINE_GROUP_ID` → deploy with the webhook off and the push on
(Worker `5abc0baa-9be0-4021-a90f-d067ed074c0c`).

Two things cost time and are worth recording:

- A LINE Official Account never confirms a group invitation. If the invite sits at 「邀請中」
  forever, the cause is that **允許被加入群組、多人聊天室** is off in LINE Official Account Manager
  (a different site from the Developers Console). LINE reports no error for this.
- The webhook switch exists in **two** places and both must be on: Developers Console → Messaging
  API → **Use webhook**, and Official Account Manager → 回應設定 → **Webhook**. The second one
  defaults to off in chat mode.

Verified in production: `/api/v1/health` 200; the webhook returned 404 without a signature and 401
with a bad one while enabled, and returns 404 for a signed-looking request now that it is off. One
`LINE_SOURCE_DISCOVERED` event was recorded with `sourceType = "group"`. The group id was read
directly into `wrangler secret put` in the operator's own terminal and never entered an agent
session. **No push has been observed yet — the next real follow-board publication is the first
end-to-end proof.**

Verified locally: typecheck clean (`src` and `test`), **24 test files / 176 tests**, deploy binds
`LINE_PUSH_ENABLED ("1")` and `LINE_WEBHOOK_ENABLED ("0")`. `worker-configuration.d.ts` is
gitignored, so run `npx wrangler types` after pulling or the new var will not typecheck.

Git state: pushed to `origin/codex/market-analysis-phase2-4` (`f08561c..957b028`), local and remote
in sync. The outgoing diff was scanned for a real group id or long token before pushing and was
clean — `.dev.vars.example` holds blank placeholders and the tests use a fabricated channel secret.

**Outstanding, in priority order:**

1. **Turn off "Use webhook"** in LINE Developers Console → Messaging API. The endpoint returns 404
   now, so LINE will keep retrying and accumulating delivery errors until this is switched off.
   Push is outbound only and does not need a webhook.
2. **The push itself is still unverified end to end.** What is proven is configuration, endpoint
   behaviour and 176 passing tests — not that a message reached the group. The next real
   follow-board publication is the first proof. If nothing arrives, read the HTTP status from the
   `FOLLOW_BOARD_LINE_PUSHED` audit event; a `4xx` on the group id means `LINE_GROUP_ID` is wrong,
   a `401` means the access token is.
3. `FRED_API_KEY` is still configured as a Secret but ADR 0023 removed FRED from the runtime path,
   so nothing reads it. Harmless; delete it during any future secret cleanup.

## Legacy follow-board products never expired (fixed and deployed)

Products stayed on the public board past their intended removal date. Diagnosis from production:
`PBZK` (published 09:40) carried `expires_at` and archived correctly, while `PBZB`/`PBZD`/`PBZL`
(published 08:11–08:14 the same day) had `expires_at` NULL and remained `PUBLISHED`.

Recovering the original subjects via `inbound_messages.raw_subject` showed the cause: those three
used the pre-ADR-0028 form `0730 Deal-03 PBZL BMJB跟單` — batch code, no issuer, **no removal date
at all**. With nothing to parse, `expires_at` stayed NULL, and both the manifest query and the
expiry job treat NULL as "never expires", so such a product stays public permanently.

- `cleanupFollowBoardOperationalData` now backfills a NULL expiry from the product's stored
  `subject_date_mmdd` before the existing expiry pass. That is the deal date, and ADR 0028's rule
  is that a product stays available through its stated calendar date, so expiry becomes 00:00
  Asia/Taipei the following day. The year comes from `published_at` and rolls back across a
  December boundary. Only NULL expiries are written; a stored expiry is never rewritten.
- Affected products then archive through the normal audited path, so **no manual D1 mutation was
  required**.
- Deployed as Worker `32637625-9b1d-48b9-a806-0f7c366ac723` from `15ff94c`. Verified in production
  after the scheduled tick: `PBZB` and `PBZD` now hold `2026-07-28T16:00:00Z`, `PBZL` holds
  `2026-07-30T16:00:00Z`, and all are `ARCHIVED`. No expired product remains on the board.
- `PBZC` keeps a NULL expiry because it was already archived manually before this fix; the backfill
  only touches `status = 'PUBLISHED'` rows and does not rewrite archived history.
- Verification baseline **at that time** was 23 test files / 168 tests. See "Current state at a
  glance" for the present figure; this section is history and is not updated.

## Scheduled retention implemented, disabled by default (ADR 0030)

Retention was documented since the first backend build but **never implemented** — nothing deleted
an R2 object, so the private bucket only grew. `retention.ts` now applies the approved windows on
the existing two-minute tick: **raw mail 10 days, generated images 10 days, structured results 30
days**.

- **`RETENTION_ENABLED` is `"0"`. Deploying this deletes nothing.** Turning it on is a separate,
  explicitly authorized change; deletion is irreversible with no undo and no backup.
- The operator confirmed this data is an operational convenience tool, not the bank's official
  financial record, which is why a 30-day results window is acceptable.
- Two production defects were caught by the new tests before release:
  1. `inbound_messages.r2_raw_mime_key` is `NOT NULL`. The first implementation cleared it, which
     would have thrown on **every** scheduled run. Only the nullable pointers are cleared now.
  2. `follow_board_products` holds three `ON DELETE RESTRICT` references and `source_rfq_id` is
     nullable, so excluding by that column alone would still let a cascade hit a RESTRICT and abort
     the run. The query now excludes all three paths (rfq, inbound message, outbound batch).
- Verified: typecheck clean, **23 files / 167 tests**, dry-run build shows all four variables bound
  with `RETENTION_ENABLED ("0")`.
- **Deployed disabled** as Worker `1742a8de-583b-43fd-b89d-174a1f0be576` on 2026-07-31 from
  `8cff188`. The live deployment lists `RETENTION_ENABLED ("0")`, API health returned 200, and the
  R2 baseline recorded immediately after the deploy was **1,778 objects / 123 MB** for comparison
  across scheduled ticks.
- **Not done:** no production deletion has occurred, and none will until the flag is enabled. Run
  `applyRetention(env, true)` (dry run) first to see the counts before enabling.

## Alpha Vantage abandoned

The operator has dropped Alpha Vantage; a replacement quote API will be chosen later. Treat
previous-close autofill as an inactive feature rather than an outstanding bug. The Secret name,
migration `0012` and the daily budget guard remain in place and harmless.

## Documentation reconciliation (2026-07-30)

On 2026-07-30, the current code, Git history, deployed Worker evidence, remote D1 state, ADRs,
and runbooks were compared against the handoff documents. These six files were aligned to the
current implementation: `CLAUDE.md`, `README.md`, `docs/HANDOFF.md`,
`docs/backend/market-analysis-roadmap.md`, `docs/runbooks/market-context-operations.md`, and
`version-status.html`.

Current evidence:

- backend implementation baseline: `061fe3b`
- documentation branch HEAD before this local documentation update: `9b39359`
- production Worker version: `32637625-9b1d-48b9-a806-0f7c366ac723` (retention deployed disabled)
- remote migrations: `0001` through `0015`
- backend verification baseline: 23 test files / 168 tests
- static GitHub Pages baseline: `d787aeb`
- read-only production D1 inspection found fresh SEC instrument and filing cache rows for three
  symbols
- the same inspection found no successful Alpha Vantage cache rows; the provider usage ledger
  recorded 10 requests on 2026-07-29
- the old `/api/v1/market/ideas` and automated movers feed are intentionally absent; current idea
  discovery uses five TradingView ranking links for both US and Japan, with embedded hotlists only
  for the US market

This reconciliation is documentation-only. It does not change application code, D1 data,
migrations, bindings, secrets, or deployed resources.

The chronological entries later in this file are retained as historical deployment records. If a
historical section conflicts with this current summary, the current code, ADRs, current runbooks,
Git history, and the summary above are authoritative.

## Follow-board sales-fee display (deployed)

ADR 0029 adds a `手收` line directly below each product's final available date. For non-CITI
profiles the value is `100 - comparablePricePct`; for CITI Upfront quotes it is the raw Upfront.
New publication snapshots persist `salesFeePct` with schema version 3. Existing schema-version-1/2
products remain compatible because the client derives the same value from the already-normalized
comparable NotePrice. Missing or invalid values display an em dash instead of zero. This display
does not change ranking, parsing, D1 schema, the downloadable PNG contents or public endpoints.

Implementation commit `061fe3b` is committed and pushed. Typecheck passed; the complete suite
passed **22 files / 163 tests**; JavaScript syntax validation and the Cloudflare dry-run build
passed with 18 public assets. No dependency, lockfile, migration, binding or Secret changed.

Worker `6429a8bf-a735-47b4-a5ba-5fa3684ec282` serves both custom domains. Post-deploy checks
returned health and application follow-board/assets HTTP 200, exposed the v4 module and sales-fee
code/style, and returned HTTP 401 for a manifest request without the PIN. The three public assets
were separately committed to `yintsun66-tech/fcnV2` `main` as `d787aeb`; GitHub Pages returned
HTTP 200 with the same v4 module and sales-fee assets after propagation.

## Issuer-declared publication, automatic expiry and full-card follow-board (deployed)

Implementation commit `dd8acb8` is committed and pushed to
`origin/codex/market-analysis-phase2-4`. ADR 0028 and migration
`0015_follow_board_expiry.sql` replace the old batch suffix with
`MMDD deal-N PRODUCTCODE ISSUER跟單YYYYMMDD`, for example
`0730 deal-03 PBZL BNP跟單20260730`. Multi-product subjects keep the ADR 0027 list/range rules.
The declared issuer must exactly match the independently recognized issuer table; its legacy
batch is derived only for correlation. The final date is the last available Taiwan date. The
manifest hides the product at 00:00 the next day in `Asia/Taipei`, and the two-minute scheduled
cleanup changes it to `ARCHIVED` without deleting products, publication commands, interests or
audit history. Migrated legacy products have no expiry and remain manually archived.

The product list now renders the same full quote-card DOM used for PNG output. `下載商品圖` opens
a dedicated product preview tab; `下載 PNG` remains an explicit action in that tab. `我要跟單`
first tells the viewer to contact 高資產業務處同事或信託處 through LINE or telephone, then retains
the existing intent form.

Migration `0015` is applied to remote D1. Wrangler reports no pending migration,
`PRAGMA foreign_key_check` returned no rows, and the expected `expires_at`,
`declared_issuer` and `expiry_date_yyyymmdd` columns exist. Source/test typechecks passed;
the complete suite passed **22 files / 162 tests**; JavaScript syntax validation and the
Cloudflare dry-run build passed with 18 public assets. Worker
`a57d7aef-55b8-47ff-bd70-3a693b59cb90` serves both custom domains. Post-deploy checks returned
health HTTP 200, application follow-board/assets HTTP 200, and manifest HTTP 401 without a PIN.

The three changed public assets were separately committed to `yintsun66-tech/fcnV2` `main` as
`db9da04`. GitHub Pages returned HTTP 200 and exposed the new HTML v3 module reference,
preview-mode JavaScript and full-card CSS after propagation. No backend, database or secret was
copied into the static repository.

No real issuer publication email was sent during deployment verification. The first operational
test must use the new issuer-plus-expiry subject, a future expiry date, an approved publisher and
an issuer table that matches the declared issuer. Existing failed commands are not automatically
reprocessed.

## PBZL HTML-entity normalization fix (deployed)

The first post-deploy publication command reached production at `2026-07-30T07:15:06.238Z` with
normalized subject `0730 Deal-03 PBZL BMJB跟單`. Publisher authentication and command parsing
succeeded, but the one complete 25-column BNP table was quarantined as
`FOLLOW_BOARD_ISSUER_TABLE_NOT_RECOGNIZED`. Its sanitized R2 table proves that the mail gateway
preserved escaped non-breaking spaces such as `Coupon p.a. (%)&nbsp;` and `&nbsp;85.00`.
Those tokens prevented both header-signature matching and numeric parsing.

Implementation commit `0a83d65` is committed, pushed and deployed. HTML table extraction and
issuer-profile normalization now remove `&nbsp;`, `&amp;nbsp;`, decimal `&#160;` and
hexadecimal `&#xA0;` whitespace forms before matching or numeric conversion. Parser versions are
advanced to `inbound-mime-v2` and `issuer-fcn-v5`. Synthetic regression tests reproduce the
sanitized PBZL table structure without committing raw mail or real identifiers.

Verification: the targeted inbound/profile/follow-board suite passed **3 files / 48 tests**;
typecheck passed; the complete suite passed **22 files / 160 tests**; and the Wrangler dry-run
build passed with 18 public assets. There is no migration, dependency, lockfile, binding, Secret,
frontend or public API change.

Post-deploy verification returned HTTP 200 from `/api/v1/health` and `/follow-board.html`; the
public manifest returned HTTP 401 without a PIN as expected. The existing PBZL command remains
`MANUAL_REVIEW` and is not automatically reprocessed. Resend the publication command; `PBZL` can
be reused because no product row was created. Do not mutate the failed command or product tables
manually.

## Follow-board quote selection and multi-product publication (deployed)

Implementation commit `ffc116f` is committed and pushed to
`origin/codex/market-analysis-phase2-4`. Production diagnosis of product code `PBZK` proved that
the authorized publisher mail reached the Worker and normalized successfully, but was quarantined with
`FOLLOW_BOARD_MULTIPLE_QUOTE_TABLES`: the forwarded thread contained two identical completed
Barclays quote tables, Barclays disclaimer/layout tables and the original request table.

ADR 0026 changes `deal-N` to compatibility/audit metadata only. Publication version
`follow-board-publication-v5` now excludes incomplete/rejected rows, collapses identical completed
quote copies by canonical terms plus quote reference, and publishes only when exactly one unique
complete quote remains. Different complete quotes and conflicting issuer signatures still fail
closed for a single-product command. New public snapshots no longer copy `deal-N` into `sequence`
or `tradeCode`.

ADR 0027 and migration `0014_follow_board_multi_product_publication.sql` add the approved
multi-product form. The observed mail uses
`0728 deal2~4 PBZB, PBZC, PBZD, BMJB跟單`; the prior hyphen/no-trailing-comma form remains
compatible. The inclusive range is audit/count metadata only. Product codes map in order to the
same number of unique complete quote rows, and the whole command publishes atomically or fails
without partial products. Migration `0014` safely
rebuilds the three related follow-board tables, removes only the one-product-per-inbound-message
constraint, preserves legacy products/interests/commands, extends the command audit snapshot and
adds ordered `follow_board_publication_items`. There is no dependency, lockfile, binding, Secret,
frontend manifest or public API change.

The observed multi-product message contains two copies of the front three-row publication table
followed by the original six-row BNP response. Version v5 first selects an unambiguous table-local
candidate with the exact product-code count, collapses identical candidate copies, and does not mix
the larger historical table into publication. Different same-sized candidates still fail closed.
The real `.msg` remains outside the repository; only a synthetic anonymous regression structure is
tracked.

Verification on the combined local change: typecheck passed; the complete suite passed
**22 files / 158 tests**; and the Wrangler dry-run build passed with 18 public assets. A migration
regression test seeds legacy product, command and interest rows before applying `0014`, verifies
they remain intact, verifies the ordered legacy item backfill and foreign keys, and proves two
products can share one source message. The publication regression fixture reproduces the safe
structure of the observed mail: duplicate completed Barclays tables plus a forwarded 20-column
request table.

Migration `0014` was applied to remote D1 before Worker deployment. Post-migration verification
reported no pending migrations, an empty `PRAGMA foreign_key_check`, and the new
`follow_board_publication_items` table. Worker `61e34517-1bed-42c5-90bb-9dfb639ed51b` serves both
custom domains. Post-deploy checks returned API health HTTP 200, application follow-board HTTP 200,
and manifest HTTP 401 without the PIN. No GitHub Pages publication was needed because no public
asset changed.

The existing `PBZK` command remains `MANUAL_REVIEW`; deployment does not retroactively reprocess
it. Send a new publication command with a unique product code or separately design and review an
idempotent ADMIN reprocess operation. Do not edit D1 rows manually.

## Static follow-board network fallback (committed, pushed and deployed)

A user confirmed that the same follow-board page loads from `app.yintsun66.com` while Edge reports
`Failed to fetch` from GitHub Pages. Remote D1 showed no corresponding PIN-validation attempt, and
direct edge checks confirmed the Worker returns the expected CORS headers, so the failure occurs
before the static browser request reaches the Worker. The local patch makes the static client try
both `app.yintsun66.com` and `api.yintsun66.com`; if both cross-origin requests are blocked, it
shows a precise message and a direct link to the working official follow-board. The PIN is never
placed in a URL. `follow-board-v2` invalidates the previous module cache. Implementation commit
`6d2f3b2` and status commit `59d5069` are pushed. The feature deployment is Worker
`23c74ccd-6acb-4077-9c38-1fb766c39b6d`; the later status-only deployment is Worker
`c58e6ba9-844c-4121-91f7-d63ab639d4e7`. GitHub Pages program commit `0b81740` and current
status-document HEAD `06bbb1e` are live. Remote verification confirmed both sites serve
`follow-board-v2`, the alternate API preflight returns HTTP 204 for the exact GitHub Pages origin,
and the static DOM exposes the official-page fallback link.

## Follow-board implementation (committed, migrated and deployed)

Branch `codex/market-analysis-phase2-4` adds ADR 0025 and D1 migration `0013` for a shared no-registration
follow-board. Approved First Bank publishers (`i14053`, `i97293`, `i11147`) reply to the original
inquiry thread or include an opaque token with `MMDD deal-N PRODUCTCODE BATCH跟單`. Publication
version `follow-board-publication-v2` recognizes the issuer from distinctive table headers,
parses `deal-N` with the existing issuer profile, and never selects terms from an RFQ batch or
ranking. An external-channel reply is allowed when its thread/token evidence is unique. Multiple
issuer signatures, missing rows, incomplete terms or table/BATCH mismatch fail closed. Public
snapshots replace the RFQ reference with the product code and use Coupon as
「預估年化配息率，非保證收益」.

`follow-board.html`, `follow-board.css` and `follow-board.mjs` are copied by the static allowlist
for both application and GitHub Pages modes. Visitors enter a four-digit Worker-verified PIN,
generate PNGs locally (no R2 image), and submit branch code/name, five-digit employee number and
whole-unit intended amount. Complete employee numbers are encrypted; the public table shows only
the branch and masked employee number. ADMIN/PS can view complete rows and archive a product from
the application follow-board page.

Local evidence so far: TypeScript typecheck passed and the full suite passed at **21 test files /
153 tests**. The Cloudflare dry-run build passed with 18 public assets. Implementation commit
`4ede8e4` was first deployed as Worker `354cff3f-7c5b-4f3a-818e-788f9c5111a8`; the later
status-page-only deployment is Worker `a0361916-5522-4090-9135-91f6f86aae33`. The four-digit
`FOLLOW_BOARD_VIEW_PIN` Secret exists and migration `0013_follow_board.sql` is applied to remote
D1. Remote verification returned HTTP 200 for the page and health endpoint, HTTP 401 without a
PIN, and HTTP 204 with the exact GitHub Pages CORS origin. The static assets are published from
`yintsun66-tech/fcnV2` program commit `fdfff4a`; its status-document HEAD is `b7fac5e`. Preserve
user-owned untracked `.claude/` and `output/`.

## Zimbra manual-mail fallback (committed, pushed and deployed)

The static/manual email flow no longer immediately depends on `mailto:`. After issuer validation it
copies the existing HTML table and opens a preparation dialog. The user can either:

- use the existing device-default `mailto:` path; or
- enter the HTTPS address of a Zimbra Web Client already signed in within Edge and open a Zimbra
  compose URL carrying only the fixed recipient and existing subject.

The Zimbra address is stored only in browser `localStorage`, is never sent to the backend and must
not contain credentials. Quote-table HTML remains on the clipboard and is not placed in the Zimbra
URL or browser history. The browser cannot inspect another tab, verify Zimbra login or press Send;
the user still pastes the table and sends the message. If a Zimbra version ignores the compose
parameters, it may open the mailbox instead; the user can select New Message and use the recipient
and subject displayed in the preparation dialog.

Files: `mail-compose.mjs`, `app.js`, `index.html`, `styles.css`,
`backend/scripts/prepare-assets.mjs`, `backend/test/mail-compose.test.ts`, `guide.html`, `README.md`
and `version-status.html`. Syntax checks, TypeScript typecheck, **20 test files / 137 tests**, and
the Cloudflare dry-run build with 15 public assets pass. A local Chromium walkthrough confirmed
HTML clipboard preparation, recipient/subject display and rejection of non-HTTPS Zimbra URLs.
Implementation commit `335a561` is pushed to `origin/codex/market-analysis-phase2-4`. Cloudflare
deployment first published the feature as Worker `5e74d55e-6969-4eae-9486-c871e3c85f5b`; the
final status-page deployment is Worker `2e32a971-b1e4-482b-b3e4-300b1bb89c50`. Cache-busting
verification returned HTTP 200 for the homepage, `app.js`, `mail-compose.mjs` and API health, with
the expected Zimbra markers. No real Zimbra page was opened and no email was sent.

The allowlisted public assets were independently synced to `yintsun66-tech/fcnV2` as commit
`fcd2996d537599d9090fa1a3be932ba5b2bf6e39`. Source/destination SHA-256 comparison had zero
mismatches; no Worker source, migration, Secret, D1/R2 content or private fixture was copied.
GitHub Pages verification returned HTTP 200 for the homepage, `app.js`, `mail-compose.mjs` and
`version-status.html`, with the expected Zimbra/source-commit markers. Preserve
`.claude/settings.local.json`.

## Homepage TradingView hot lists; Alpha Vantage narrowed to previous close (ADR 0024)

Commits `584d33d` (initial), `91a465e` (switch to the working hot-list widget) and `a49fc5e`
(asset-token fix), deployed as Worker `680e77ee-333d-4406-84bd-b71181c31d6d`. No D1 migration,
Secret or binding change.

**Asset-version lesson (cost one bad deploy).** The first hot-list deploy populated the edge cache
key `market-resources.mjs?v=market-hotlist-v1`. The follow-up commit changed that file but reused
the same token, so Cloudflare kept serving the stale 6,614-byte screener build
(`CF-Cache-Status: HIT`) while `backend/public/` held the correct 7,336-byte module — users would
have kept the broken widget. **Bump the `?v=` token whenever a versioned asset's content changes**,
and verify a changed asset by byte size, not only by HTTP 200.

Post-deploy verification on `https://app.yintsun66.com`: API health 200;
`market-resources.mjs?v=market-hotlist-v2` returns the 7,336-byte module containing
`embed-widget/hotlists` and no `embed-widget/screener`; the homepage references
`?v=market-hotlist-v2` throughout and no longer contains `hotlistScreen`; and the loaded panel
renders live rows with the 活躍/漲幅榜/跌幅榜 tabs.

Post-deploy verification: API health 200; `market-resources.mjs` returns HTTP 200 and contains
`hotlistWidgetUrl`, `hotlistDescriptor`, `Object.hasOwn`, `embed-widget/screener` and
`HOTLIST_CONSENT_KEY`; the live homepage contains `hotlistPanel`, `hotlistConsent`,
`hotlistMarket`, `hotlistScreen` and the `market-hotlist-v1` cache key; `app.js` contains
`setupHotlist`. `GET /api/v1/market/ideas` returns 401 at the session gate — the route itself is
gone, so an authenticated caller now receives 404.

Why: the Alpha Vantage market-movers panel never returned a usable payload in production (the
provider answered with an `Information` envelope), and a shared market-wide list is the worst use
of a 24-request daily budget. Hot lists also belong *before* an RFQ exists, not behind a finalized
ranking.

- **Homepage panel mirrors TradingView's own hierarchy.** `index.html` gains a collapsed
  「美股／日股熱門榜」 section above the trade-input workspace: a market selector
  (美股 → NASDAQ, NYSE, NYSE ARCA, OTC ／ 日股 → TSE, NAG, FSE, SAPSE) above five rankings
  (波動最大, 大型股, 現金最多, 成交最活躍, 營收最高). The rankings are links to TradingView's own
  pages and work for **both** markets; 美股 additionally embeds a live hotlists widget inline.
  Client-side only (`app.js` + `market-resources.mjs`), so it works in both runtime modes.
- **The embeddable widgets cannot deliver the rankings or Japan — do not retry them.** Measured
  against the live widgets: `most_volatile` is recognized but returns zero rows; `large_cap`,
  `highest_cash`, `most_active` and `highest_revenue` are not recognized and fall back to an
  unranked 18,057-symbol "General" list; `market: "japan"` is ignored entirely (returns AAPL in
  USD); `hotlists exchange "TSE"` is refused; and `"JP"`/`"JPX"`/`"TYO"` silently return US rows.
  **Do not set the Japan exchange to `JP`/`JPX`/`TYO`** — it looks correct and is wrong. The five
  rankings and the USA/JAPAN grouping exist on TradingView's website only; all ten pages return
  HTTP 200. Full evidence table in ADR 0024.
- **Consent still gates it.** No iframe exists until the user ticks consent (verified in-browser);
  unticking unloads it. Consent is per browser (`HOTLIST_CONSENT_KEY`).
- **The widget URL is built directly** (no TradingView loader script in our origin), and the iframe
  attributes match the already-deployed Phase 2 chart exactly — `referrerPolicy="no-referrer"` plus
  the same sandbox tokens — so it inherits a configuration proven to work in production.
- **Markets/screens are fixed allowlists** checked with `Object.hasOwn`. A plain `map[key]` lookup
  resolved inherited keys such as `__proto__` and let an unlisted value through; a test caught this
  and it is fixed.
- **Removed:** `GET /api/v1/market/ideas` and its route, `fetchAlphaMarketMovers`,
  `normalizeMoverRows`, the `AlphaMarketMover(s)`/`AlphaMoversResponse` types, `cachedEquityIdeas`,
  `percentileScores`, the composite heat score, and the analysis-page ideas UI plus its button and
  handler.
- **Kept:** SEC context and the per-symbol `TIME_SERIES_DAILY` previous close that fills
  「輸入標的參考現價」, unchanged. Migration `0012` and `market_provider_daily_usage` stay; only
  movers cache rows stop being written. No migration, Secret or binding change.
- Asset cache keys bumped to `market-hotlist-v1` for `index.html`, `app.js`, `backend-client.js`
  and `styles.css` (the previous rollout was served stale under an old key).
- Verification: `node --check` on `app.js`, `backend-client.js` and `market-resources.mjs`;
  typecheck; **19 files / 132 tests**; Wrangler dry-run build. In-browser on a local server: a
  fresh visit has consent unticked and creates no iframe; loading without consent is refused;
  美股 loads **live rows** with the 活躍/漲幅榜/跌幅榜 tabs in Chinese; switching to 日股 removes
  the frame and shows the explanation plus the Japan link; unload clears it; no console errors.

## Alpha Vantage end-of-day market ideas (deployed; provider response still unavailable)

The user approved replacing FRED with Alpha Vantage for the proof-of-concept market panel. The
repository implements the change and Cloudflare production now runs it. The source implementation
is commit `c487355` on `codex/market-analysis-phase2-4`; deployment evidence was committed in
`7d903ee`.

Local behavior:

- no runtime code calls FRED and `FRED_API_KEY` is no longer a required Worker Secret;
- authenticated per-symbol context keeps SEC and adds Alpha Vantage
  `TIME_SERIES_DAILY&outputsize=compact`;
- an empty analysis spot automatically receives the provider's latest completed daily close;
  an existing browser-saved manual value is preserved and receives an explicit `套用前收` action;
- one daily `TOP_GAINERS_LOSERS` cache supplies gainers, losers and most-active lists;
- the same cached daily series supplies 20-day annualized historical volatility, relative volume,
  absolute daily move and a labelled composite heat ranking over cached symbols only;
- `GET /api/v1/market/ideas` returned those display-only lists (**removed by ADR 0024**);
- D1 cache rows remain shared across users, while `market_provider_daily_usage` enforces 24
  attempted Alpha Vantage requests per UTC day; and
- ADMIN cache health includes today's provider attempt count without payloads, identities or keys.

Schema/configuration:

- migration `0012_alpha_vantage_market_data.sql` copies the reconstructable public cache into a
  table whose source check also accepts `ALPHA_VANTAGE`, preserves old rows, recreates indexes and
  adds the provider daily-usage table; it was applied successfully to remote D1 on 2026-07-29;
- the new required Secret is `ALPHA_VANTAGE_API_KEY`, entered only through Wrangler's hidden
  prompt and its Secret name is present in production; do not put its value in chat, commands,
  source, logs or Git;
- `ALPHA_VANTAGE_DAILY_REQUEST_LIMIT=24` is the safety cap; and
- the old encrypted FRED Secret is not read. Removing it is a separate remote operation and is not
  required for this rollout.

Verification completed:

- `node --check backend-client.js`;
- `node --check market-resources.mjs`;
- `pnpm run typecheck`;
- `pnpm test` — 19 files / 131 tests;
- targeted market/admin/resource suite — 3 files / 25 tests; and
- `pnpm run build` — Cloudflare dry-run succeeded with 14 static assets and existing bindings.

Wrangler/Vitest printed known filesystem static-analysis warnings inside the managed sandbox, but
all tests passed; the dry-run build was repeated outside that read restriction and passed.

Production rollout evidence:

- remote D1 migration `0012_alpha_vantage_market_data.sql` completed successfully;
- the initial deployment was Worker `6cad336e-856c-44ef-9495-1c1d4812e3ad`;
- authenticated verification found that the page still used the old fixed
  `backend-client.js?v=backend-v5` browser cache key, so `index.html` now uses
  `market-alpha-v1` for both `backend-client.js` and `styles.css`;
- the corrected deployment is Worker `0c63296c-f61f-4a11-a358-30db6e783ac6`;
- public health returned HTTP 200, the new assets returned HTTP 200, and unauthenticated
  `/api/v1/market/ideas` correctly returned HTTP 401; and
- an existing authenticated FCN analysis page loaded the new controls without creating or sending
  a real RFQ.

Provider verification gap:

- the first ORCL, TSM and market-movers requests all reached Alpha Vantage, but the provider
  returned an `Information` response which the current safe parser records as
  `ALPHA_VANTAGE_RATE_LIMITED`;
- remote D1 recorded three attempts for UTC date 2026-07-29 and no market payload;
- both selected endpoints are documented by Alpha Vantage as available to free keys in the
  configured end-of-day/compact form, so verify that the entered Secret is an Alpha Vantage key
  (not a MarketData.app token), is activated and has not been throttled; and
- do not clear cache or usage rows manually. Re-enter a verified Alpha Vantage key through the
  hidden prompt, wait for the ten-minute failed-refresh backoff, then retry one symbol and the
  market-movers panel.

Not yet done:

- no successful normalized Alpha Vantage payload has been observed; and
- no provider licence confirmation has been recorded for broader institutional multi-user use.

Preserve the user-owned untracked `.claude/` directory. The smallest safe next step is to verify
the Alpha Vantage key at its source, replace only that Secret if necessary, wait for the existing
backoff, and repeat the authenticated existing-page check before calling the provider integration
fully operational.

## FRED 400 and TradingView client-block recovery (committed, pushed and deployed)

The post-deployment `MU` load proves that the Cloudflare redirect fix is working: SEC instrument
and filings rows are now `FRESH`, while only `fred:macro:v1` is
`ERROR / UPSTREAM_HTTP_400`. The official FRED API requires a 32-character lowercase
alphanumeric API key. The current production Secret exists, but its value cannot be inspected and
the pre-recovery upstream 400 meant it had to be re-entered or otherwise verified through Wrangler's hidden
prompt.

The same user browser returns `net::ERR_BLOCKED_BY_CLIENT` when opening TradingView's documented
`s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js` loader. In that browser the
official direct chart at `www.tradingview-widget.com/embed-widget/advanced-chart/` loads the `MU`
chart successfully.

The deployed recovery:

- trims harmless leading/trailing whitespace from `FRED_API_KEY`, rejects any nonconforming key
  locally as `FRED_KEY_INVALID_FORMAT`, and never logs or returns the key;
- replaces the client-blocked TradingView loader script with the official direct widget URL;
- keeps the chart in a cross-origin sandboxed iframe, passes only the mapped public ticker, uses
  no referrer, and does not add RFQ, quote, employee, branch or issuer information; and
- adds regression tests for copied-key trimming, invalid-key rejection and the direct widget URL.

Verification:

- root JavaScript syntax checks passed;
- `pnpm test` passed: 19 files / 127 tests;
- `pnpm run typecheck` passed; and
- `pnpm run build` passed with 14 static assets and all existing bindings.

Implementation commit `4896b7f` is pushed to `origin/codex/market-analysis-phase2-4`. The FRED
Secret was re-entered only through Wrangler's hidden prompt; Cloudflare recorded Secret Change
version `2b550fc4-4b29-4842-ac9e-e36c406ebd27` without exposing its value. Worker version
`528cc15e-72c7-41c0-a514-4a0ccb03f696` is deployed with all previous domains, mail, Queue, D1,
R2, Durable Object and schedule bindings intact.

Post-deploy checks confirm API health returns HTTP 200 and the live client/resources contain the
direct `www.tradingview-widget.com` implementation. The final authenticated `MU` click is pending
only because the application session expired; after login, confirm FRED becomes `FRESH` and the
embedded chart renders without the blocked `s3.tradingview.com` loader.

## SEC/FRED first authenticated-load recovery (deployed; final UI check pending login)

The first authenticated production load for `MU` reached the market-context API and rate limiter,
but D1 recorded both SEC and FRED as `ERROR / UPSTREAM_UNAVAILABLE`. A short, redacted production
tail then identified the exact shared failure: Cloudflare's edge runtime rejects
`RequestInit.redirect = "error"` before issuing the request. This affected both official sources;
the SEC URL, FRED secret and response body were not the cause.

The deployed recovery:

- uses Cloudflare-supported `redirect: "manual"` and explicitly rejects every 3xx response with
  `UPSTREAM_REDIRECT_REJECTED`, preserving the security invariant that public-data requests must
  never follow redirects;
- wraps the runtime-provided global `fetch` and calls it as `globalThis.fetch(...)`, preserving the
  Cloudflare runtime receiver instead of passing the raw function as a detached default argument;
- continues to load FRED even when SEC instrument lookup is unavailable;
- keeps first-load error diagnostics for ten minutes without treating the placeholder `{}` as
  stale source data, so scheduled cleanup does not remove the evidence immediately;
- logs only bounded, sanitized diagnostic fields and redacts API keys, URLs and token-like values;
  and
- adds regression coverage for Cloudflare redirect handling, the runtime receiver, SEC/FRED failure
  isolation and diagnostic retention.

Deployment and verification evidence:

- initial recovery commit `affe086` is pushed to `origin/codex/market-analysis-phase2-4`;
- final Worker version `6fbf2c51-66f2-4fd1-ba38-ad4c8091fe98` is deployed with the existing
  domains, D1, R2, Email, Queue, Durable Object and scheduled bindings intact;
- `pnpm test` passed: 19 files / 125 tests;
- `pnpm run typecheck` passed;
- `pnpm run build` passed with 14 static assets and all existing bindings;
- a read-only D1 check after deployment found no residual SEC/FRED error placeholders; and
- the existing `MU UW / TSM UN` production analysis page still renders, but its application session
  expired immediately before the final load action. A fresh authenticated click is therefore the
  only remaining production UI verification; it must not create or send an RFQ.

This change adds no migration, dependency, lockfile, Secret, binding or deployment-configuration
change. Preserve `.claude/settings.local.json`; do not commit it.

## Public market analysis Phases 2–4 (committed, pushed and deployed)

Work moved to branch `codex/market-analysis-phase2-4` from deployed Phase 1 commit `c05d48c`.
The user approved continuation of Phases 2–4 and requested Yahoo Finance and Google Trends in
addition to SEC and FRED.

Implementation commit `71b6226` is pushed to `origin/codex/market-analysis-phase2-4`.
Migration `0011_market_context.sql` was applied to remote D1 `fcn-quote`. Cloudflare Worker version
`88ada066-5770-4417-8dff-66419fb651c4` was deployed on 2026-07-28 with all custom domains,
five Queue producers/consumers and the two-minute schedule intact.

Local Phase 2 changes:

- `market-resources.mjs` strictly maps Bloomberg US-equity suffixes `UW`, `UN` and `UA` to public
  symbols. Unknown or unsafe symbols fail closed.
- The FCN analysis page has a collapsed third-party resource panel. A TradingView widget is
  created only after an explicit checkbox and load-button action, inside a sandboxed `srcdoc`
  iframe with `no-referrer`; only one widget exists at a time.
- Yahoo Finance, Google Trends, Cboe and OIC are ordinary user-initiated external links. No
  content is scraped, cached, persisted or supplied to calculations/ranking.
- ADR 0021 records the privacy/licence boundary. `backend-client.js?v=backend-v5` is the new asset
  cache key, and `market-resources.mjs` is included in the generated asset allowlist.
- Phase 2 adds no D1 write, production dependency or lockfile change.

Local Phase 3/4 changes:

- Migration `0011_market_context.sql` adds only reconstructable `market_instruments`,
  `public_data_cache` and hashed `market_context_rate_limits` tables. It does not change any RFQ,
  mail, quote, ranking, authentication or artifact table.
- Authenticated `GET /api/v1/market/instruments/:symbol/context` normalizes SEC CIK/company/
  exchange/ticker, the latest five 10-K/10-Q/8-K filings, and FRED DGS10/FEDFUNDS/VIXCLS
  latest/prior/change/units/date. It fetches only fixed official SEC/FRED origins.
- Instrument identity uses a 30-day TTL; SEC/FRED context uses 24 hours plus a labelled seven-day
  stale fallback. Same-isolate requests are coalesced and D1 supplies a short cross-isolate refresh
  lease.
- `FRED_API_KEY` is a required Cloudflare Secret and is never returned or logged. The declared SEC
  identity is `FCN Quote App rfq@yintsun66.com`.
- The analysis page loads the official data only when the user presses its button. It displays
  source time/stale status and the required FRED notice. These values never enter spot input,
  scenarios, ranking, mail or quote images.
- ADMIN's RFQ timeline dialog has a separate cache-health panel. A failure in this optional panel
  does not prevent the existing RFQ timeline from loading.
- The existing cron runs idempotent expired-cache/rate-limit cleanup only after RFQ recovery;
  cleanup failure cannot interrupt RFQ recovery.
- ADR 0022 and `docs/runbooks/market-context-operations.md` record the data/security/rollout
  boundary. Yahoo Finance and Google Trends remain link-only.

Evidence completed:

- `node --check backend-client.js`
- `node --check market-resources.mjs`
- `pnpm test` — 19 files, 122 tests passed. This includes 50 distinct concurrent users sharing one
  SEC refresh path, fresh reuse, stale fallback, cleanup, SEC/FRED normalization, ADMIN isolation
  and all existing RFQ/mail/ranking regression tests. Wrangler emitted expected local
  missing-Secret warnings, but the synthetic test bindings were used and Vitest passed.
- `pnpm run typecheck` — passed.
- `pnpm run build` — Cloudflare dry-run build passed; 14 static assets included.
- Read-only production D1 measurement: 10 users, 55 RFQs, 205 trades, 406 inbound messages,
  1,693 issuer quotes, 637 ranking results, 2,488 audit events, 149 artifacts and 6,815,744 bytes.
  The 24-hour D1 counters were 8,228 read queries, 3,416 write queries, 377,492 rows read and
  10,862 rows written.

Production checks:

- `wrangler secret list` confirms `FRED_API_KEY` now exists as encrypted `secret_text`; its value
  was entered by the user through Wrangler's hidden prompt and was never shown or stored here.
- `wrangler d1 migrations list fcn-quote --remote` returns `No migrations to apply`.
- `https://api.yintsun66.com/api/v1/health` returns HTTP 200 with `{"status":"ok"}`.
- The live index references `backend-client.js?v=backend-v5`; the live client contains the
  SEC/FRED load control, FRED attribution notice and ADMIN market-health route.
- `market-resources.mjs` returns HTTP 200 and contains the strict public-symbol mapper.
- Unauthenticated `GET /api/v1/market/instruments/AAPL/context` returns HTTP 401 with
  `AUTHENTICATION_REQUIRED`, confirming the route remains behind application login.

The 2019 article's `yfinance` and `pytrends` examples are research scraping clients, not current
official production API contracts. Do not add either package or call undocumented endpoints.
The remaining verification is an authenticated normal-user load of one SEC/FRED panel and an
ADMIN check of the cache-health panel. This requires an application login and must not create or
send an RFQ. Preserve `.claude/settings.local.json`; do not commit it.

## FCN market and risk analysis Phase 1 (committed, pushed and deployed)

The pre-analysis stable baseline is commit `9b3ba13`, preserved by annotated tag
`stable/pre-market-analysis-2026-07-28`. The tag and branch `codex/market-analysis-phase1` are
pushed to GitHub. Phase 1 implementation commit is `5e662af`.

Cloudflare Worker version `544fce2d-897c-4927-8df8-3ce838c268ea` was deployed on 2026-07-28.
Wrangler returned a non-zero exit after the Worker/assets/custom-domain triggers were deployed
because one Queue-list API request failed. Read-only post-deploy checks confirmed the new Worker
version is current, every production queue still has one producer and one consumer, and no Queue
binding was lost.

Phase 1 adds an owner-scoped, separate analysis route for finalized FCN quotes:

- Result rows for economic ranks 1–4 and the selected custom-fifth candidate can open
  `/?rfq=<id>&view=analysis&trade=<tradeCode>&quote=<quoteId>`.
- `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/quotes/:quoteId/analysis-input` reuses
  `authorizeCardQuote`; an arbitrary browser quote ID or another user's RFQ remains unavailable.
- The response contains one exact canonical issuer quote plus its immutable requested trade. A
  missing non-target term may fall back to that requested trade only, never another issuer.
- User-entered indicative spot/timestamp values stay in browser `localStorage`, keyed by RFQ,
  trade and underlying. Phase 1 makes no D1 write and adds no migration, binding, Secret,
  dependency or lockfile change.
- The view computes indicative strike/KO/KI price levels and fixed worst-of scenarios. NONE, EKI
  and path-dependent AKI are deliberately separated; DAC/DRA is refused in Phase 1.
- ADR 0020 records the public/security/financial semantics.
- `docs/backend/market-analysis-roadmap.md` preserves the approved Phase 2–4 plan for opt-in public
  charts, SEC/FRED shared caching and production capacity/retention work.

Files added/changed for the local Phase 1 work:

- `market-analysis.mjs`
- `backend/src/analysis.ts`
- `backend/src/artifacts.ts`
- `backend/src/index.ts`
- `backend-client.js`
- `styles.css`
- `index.html`
- `backend/scripts/prepare-assets.mjs`
- `backend/test/market-analysis.test.ts`
- `backend/test/ranking-integration.test.ts`
- `docs/adr/0020-owner-scoped-fcn-market-analysis.md`
- `docs/backend/market-analysis-roadmap.md`
- `docs/backend/contracts.md`
- `docs/adr/README.md`
- `README.md`

Verification completed during implementation:

- `node --check backend-client.js`
- `node --check market-analysis.mjs`
- `pnpm run typecheck`
- `pnpm test` — 17 files, 108 tests passed
- `pnpm run build` — Cloudflare dry-run build passed; 13 static assets included
- `https://api.yintsun66.com/api/v1/health` — HTTP 200 with `{"status":"ok"}`
- `https://app.yintsun66.com/` — HTTP 200 and references `backend-client.js?v=backend-v4`
- live `backend-client.js` — contains the analysis module import, analysis view and
  `analysis-input` route
- live `market-analysis.mjs` — HTTP 200 and exports the FCN analysis model
- `wrangler queues list` — five production queues retain one producer and one consumer each

Interactive authenticated analysis-page QA remains unverified. Preserve
`.claude/settings.local.json`; do not include it in this work. The smallest safe next step is to
open one completed FCN result as its owner, select “市場與風險分析”, and verify the expected
issuer/spot/scenario view. Phase 2 must not begin automatically.

## Guarded permanent deletion of empty accounts (deployed; target deletion pending)

Commit `3ace594` adds ADR 0019 and an ADMIN-only permanent-delete control for unused accounts.
It is pushed to `origin/feature/subject-branch-correlation` and deployed as Worker
`29145dcb-e144-4458-ad43-d3cbf0dffe56`.

- `剔除` remains the reversible ADMIN/PS soft-disable operation.
- `永久刪除` is shown only to ADMIN for a disabled plain USER whose `rfqCount` is zero.
- The server independently requires ADMIN, same-origin + CSRF, a disabled non-PS USER, zero RFQs,
  a non-self target, and exact normalized-login confirmation.
- Successful deletion removes the user row; schema cascades remove sessions/idempotency keys.
  Employee-number and login uniqueness are released. Financial records are never deleted, and an
  opaque `ACCOUNT_PERMANENTLY_DELETED` audit event is retained.
- Regression coverage includes PS rejection, confirmation mismatch, session cascade,
  re-registration after deletion, and refusal when an RFQ exists.

Read-only production inspection on 2026-07-28 found the disabled regular account
`9621ewj9s356` has zero RFQs, zero sessions, zero idempotency rows, no users it approved, and no
actor audit rows. Its five entity audit events contain historical opaque linkage and do not block
safe deletion. The account therefore qualifies for the guarded operation, but no production
deletion has been performed yet because an ADMIN application login is still required. Do not
bypass the application endpoint with a direct D1 delete.

Verification completed so far:

- `node --check backend-client.js`
- `pnpm run typecheck`
- `pnpm test` — 16 files, 103 tests passed

Post-deploy checks: `https://api.yintsun66.com/api/v1/health` returned HTTP 200 with
`{"status":"ok"}`; the live `backend-client.js` contains the permanent-delete account control and
`rfqCount` guard. The smallest next step is to authenticate through the ADMIN UI, permanently
delete the account, and verify that the login row is absent. Preserve `.claude/settings.local.json`.

Latest production implementation commit:
`8f34f2f feat(auth): use employee number as login`

Production deployment record:
Worker `9a7535fb-0fa2-4e4b-b11d-1e32ce2ead35` deployed 2026-07-28 from `8f34f2f`
(new registrations use branch name + five-digit employee number + password; the employee number
is assigned server-side as both login and display identity). Post-deploy: the application asset
and API health return HTTP 200; the live registration form contains exactly one `branchName`, one
`employeeNumber`, and one `password` field, contains no `username` or `displayName` field, and
marks the employee-number input as the browser username field.
Previous: `7e67acfd-f0c2-4d7e-8f4e-687e5ad2b2a2` deployed 2026-07-28 from `5d15d08`
(desktop, laptop, tablet, and phone all use the phone-size 1.5-scale / 4M-pixel profile).
Post-deploy: application index and API health return HTTP 200; the live index references
`backend-client.js?v=backend-v3`; the live client contains `CARD_OUTPUT_CANVAS_PIXELS = 4e6`
and `CARD_OUTPUT_MAX_SCALE = 1.5`, with the device-specific scale branch absent.
Previous: `8f531342-e773-412b-9ba1-c5ffc00730ac` deployed 2026-07-28 from `99d7e9a`
(bounded client/fallback requests, touch-safe canvas budget, responsive preview, and desktop
new-page link). Post-deploy: application index and API health return HTTP 200; the live index
references `backend-client.js?v=backend-v2`; the live client contains
`CARD_RENDER_TOTAL_TIMEOUT_MS`, `CARD_TOUCH_SAFE_CANVAS_PIXELS`, `requestForRender`,
`backend-card-open-link`, and the overlay preview; the live stylesheet contains the responsive
desktop-link rule.
Previous: `b18cba05-bd46-49b5-818e-71d36d9b9d39` deployed 2026-07-28 from `7f1dca3`
(mobile render-hang fix). Post-deploy: API health 200; the live `backend-client.js` carries
`withRenderTimeout`, `CARD_SAFE_CANVAS_PIXELS`, `showCardImage`, `opacity:0` and 「長按圖片」,
and `styles.css` carries `backend-card-preview`.
Earlier: `f887ba53-2af9-4cf6-a493-bfc67cc4f489` from `b7ae5fb` (self-hosted rasterizer;
`https://app.yintsun66.com/vendor/html2canvas-1.4.1.min.js` returns HTTP 200, 198,689 bytes,
SHA-256 matching the vendored file exactly, and no third-party CDN host remains on the live page.
The root page is edge-cached — send `Cache-Control: no-cache` when verifying it, because a query
string alone does not bust it);
`fcf61774-b52b-45a4-ba40-2af46be691df` from `88bdbd9` (client-side quote-card
rasterization, ADR 0017; unauthenticated card endpoint returns 401);
`aa7a0656-bc5b-42b1-a6ae-63f16141de64` from `de9e8d9` (on-demand quote images,
ADR 0016; `AUTO_RANK_ONE_IMAGE ("0")` confirmed in the deployed bindings);
`a485a90c-...` from `98d969c` (ZAR support);
`68c62104-...` from `481c220` (mail grace, versioned late-reply recalculation, and
economic top four plus custom fifth issuer/image);
`6520b77d-...` from `4095b51` (issuer-specific DAC/DRA labels);
`566c7456-...` from `bdd66c1` (first-trade product label);
`02311666-...` from `477b3c9` + `0d77eac` (parser/operations diagnostics);
`cc633dcb-...` from `0bbe159` (ADMIN-only employee-number lookup);
`364a345e-...` from `fd7a380` (duplicate-registration visibility);
`25d32525-...` from `0913f16` (PS tier + migration 0010); `2de5b070-...` from `23c084e`.

Production implementation head when this handoff was updated:
`feature/subject-branch-correlation` at `8f34f2f`, pushed to `origin` (local and remote match before
this deployment-record documentation commit).
Resolve the current branch HEAD from Git before making changes. The branch is not merged to
`main`.

Quote-image work landed in this order — read ADR 0016 then 0017 before touching that path:
`de9e8d9` on-demand images → `88bdbd9` client-side rasterization → `b7ae5fb` self-hosted
rasterizer → `7f1dca3` mobile hang fix.

The separate untracked `.claude/settings.local.json` remains user-owned and must stay out of commits.

## Employee-number registration simplification (deployed)

Commit `8f34f2f` and Worker version `9a7535fb-0fa2-4e4b-b11d-1e32ce2ead35` implement:

- New applicants enter only branch name, five-digit employee number, and password.
- `normalizeRegistrationInput` derives both `username` and `displayName` from the employee number
  and ignores client-supplied identity fields. This is a server-side rule, not only a hidden form
  field.
- The branch remains stored and continues through ADR 0002's sanitized outbound-subject label.
- Existing account rows and login names are unchanged; no D1 migration is included. A duplicate
  employee number therefore still resolves through ADMIN's employee-number lookup and the approved
  recovery process rather than a second registration.
- The registration-review UI now shows employee number/login plus branch; it still identifies
  older pending rows whose legacy username differs.
- ADR 0018 and the authentication contract/admin runbook document the compatibility boundary.

Verification completed locally:

- `node --check backend-client.js`
- `pnpm run typecheck`
- `pnpm test` — 16 files, 103 tests passed
- `pnpm run build` — successful Cloudflare dry-run (required sandbox escalation)
- `git diff --check`

No production D1 data, binding, secret, dependency, or lockfile changed. Preserve the separate
untracked `.claude/settings.local.json`.

## On-demand quote images (ADR 0016) — Browser Rendering capacity

Automatic rank-one image rendering is **disabled**. Rendering now happens only when a user asks
for it, through the existing owner-authorized on-demand path.

Why (read-only production audit, 2026-07-27):

- `fcn-image-render` runs at `max_concurrency: 3`, matching the Browser Rendering free-plan
  concurrent-browser allowance, on top of a per-day browser-time budget. It is the only centrally
  metered, concurrency-limited resource in the pipeline.
- 9 of 124 artifacts were `BROWSER_RENDER_FAILED` — a **7.3% failure rate at near-zero
  concurrency** (51 RFQs / 6 days / 1–2 active users), with `max_retries: 3` consuming further
  browser time per failure.
- At 30–50 users (3.57 trades per RFQ) automatic rendering implies ~178 images/day at 50 RFQs/day
  and ~714/day at 200 RFQs/day, against an estimated free-plan capacity of 150–300 images/day.
  **The ceiling falls at the bottom of the target user range**, and it is a daily-budget ceiling,
  not only a burst ceiling. Verify the current plan/limits in the Cloudflare dashboard.

Changes:

- `ranking.ts` no longer inserts `generated_artifacts` / `image_render_jobs` rows or enqueues a
  render when a ranking run completes. `ranking_results.is_image_winner` still marks rank one;
  ranking, ordering, ties and the persisted result set are unchanged.
- New non-secret Worker variable `AUTO_RANK_ONE_IMAGE` (default `"0"`) restores the previous
  behavior when set to `"1"`. Covered by a test.
- `downloadArtifact` writes a `QUOTE_IMAGE_DOWNLOADED` audit event (preview flag + issuer only) so
  **real image demand can be measured**. Query this before sizing any further rendering work.
- Frontend hint text no longer promises automatic rendering; the on-demand buttons already existed
  for ranks 1–4 and the custom fifth.

This was mitigation, not the structural fix. The structural fix follows in ADR 0017.

## Client-side quote-card rasterization (ADR 0017)

The default image path no longer uses Browser Rendering at all.

- New `GET /api/v1/rfqs/:rfqId/trades/:tradeCode/card` and
  `.../trades/:tradeCode/quotes/:quoteId/card` return the rendered card document inside JSON.
- **Authorization is now shared, not duplicated.** `authorizeCardQuote` in `artifacts.ts` is the
  single path used by both the card endpoint and `requestTradeArtifact` (ownership, `COMPLETED`,
  current ranking run, economic ranks 1–4 or custom-fifth candidate). `loadCardTrades` and
  `QUOTE_CARD_WIDTH_PX` are likewise shared, so the client card and the server artifact cannot
  drift apart.
- `backend-client.js` loads the document into an offscreen `sandbox="allow-same-origin"` iframe
  (html2canvas can read the DOM; scripts stay blocked), waits for `document.fonts.ready`,
  rasterizes at `scale: 2` and downloads the PNG. No queue message, no R2 object.
- **Fallback retained:** html2canvas comes from a CDN that some corporate networks block. If
  `window.html2canvas` is missing, the button falls back to the server-rendered artifact.
- Capacity now scales with the number of users instead of three shared browsers, and default-path
  images are not exposed to the 7.3% `BROWSER_RENDER_FAILED` rate.
- Default-path images are **not persisted** (no artifact row, no R2 object, no 90-day expiry). The
  download is the deliverable; the artifact path still exists when an archived copy is needed.

### Mobile/tablet 「產圖中…」 hang — fixed

Reported symptom: on phones and tablets the 下載報價圖 button stayed on 「產圖中…」 indefinitely.

Root cause was structural: `renderCardLocally` had **four unbounded `await`s** (iframe `load`,
`document.fonts.ready`, `html2canvas()`, `canvas.toBlob()`). None could ever reject, so if any one
stalled, the promise never settled and the caller's `catch`/label reset never ran. The frame was
also `visibility:hidden` and positioned offscreen, a configuration mobile WebKit deprioritizes or
skips laying out — and html2canvas creates its *own* nested iframe inside ours and waits for that
frame's `load` event.

Measured in a reproduction harness (`scale: 2`, real vendored html2canvas):

| trades | canvas | pixels | raw bitmap |
| --- | --- | --- | --- |
| 1 (the actual per-trade card) | 1440×2428 | 3.5M | 13 MB |
| 3 | 1440×7076 | 10.2M | 40 MB |
| 6 | 1440×14144 | **20.4M** | **78 MB** |

Desktop Chromium backs canvases up to ~64M pixels, which is why the flow always succeeded there.
**iOS/iPadOS cap canvas area near 16.7M pixels (5M on low-memory devices) and silently return a
blank canvas instead of throwing.** A `display:none` frame measures `scrollHeight` 0; `opacity:0`
in-viewport measures correctly.

Fixes in `backend-client.js`:

- Every step is wrapped in `withRenderTimeout` (12s). The button can no longer stick, whichever
  step stalls, and a local failure now **falls through to the server renderer** so an image is
  still produced. `fonts.ready` timing out is non-fatal — rendering with the fallback face beats
  failing the export.
- The frame is now render-eligible: `opacity:0` inside the viewport behind the page, instead of
  offscreen `visibility:hidden`.
- Scale is clamped to keep the bitmap under a 12M-pixel budget
  (`sqrt(budget / (width × height))`, capped at 2), so tall cards cannot exceed mobile limits.
- Zero measured height is now an explicit error rather than a silent 0×0 canvas.
- The result is shown in a preview dialog with a 長按圖片→儲存影像 hint plus a download link,
  because iOS Safari does not reliably honor `<a download>` for blob URLs — the previous code
  called `link.click()` and assumed it worked.

Verified in-browser: the timeout guard fires on a never-settling promise, and the `opacity:0`
frame rasterizes to 1440×2536 (3.7M px, 1.27 MB PNG) for a single-trade card. **A real
iOS/Android device check is still owed** — the browser pane is desktop Chromium and cannot
reproduce mobile WebKit.

### Mobile/tablet hang follow-up — deployed

The first fix in `7f1dca3` bounded the iframe/font/html2canvas/blob steps, but it did **not**
bound the card-data `fetch`, the server-fallback request, or the result refresh awaited after the
fallback. A stalled network request could therefore still leave the button on 「產圖中…」.
The preview also opened a second native modal `<dialog>` inside the already-open RFQ-results
dialog, which is a fragile nested-modal pattern on iPadOS Safari.

Commit `99d7e9a` contains the follow-up fix in `backend-client.js`, `styles.css`, and `index.html`:

- the complete local-render flow has a 24-second deadline, including the authorized card-data
  request; timed-out fetches are aborted;
- the server-render fallback request has its own 12-second deadline, and the button is restored as
  soon as the fallback job is accepted instead of waiting for a full results refresh;
- touch devices use a 4M-pixel canvas budget and maximum scale 1.5, while desktop retains the
  12M-pixel / scale-2 budget;
- the PNG preview is now a responsive overlay within the existing results dialog rather than a
  second native modal;
- desktop/laptop users receive an additional 「在新頁面檢視」 link; the image remains responsive,
  while mobile/tablet keeps the preview and long-press workflow; and
- `index.html` advances the backend-client cache key from `backend-v1` to `backend-v2`.

Read-only production evidence collected before the patch: all 41 `generated_artifacts` and all 41
completed image jobs were `READY`/completed; after the `7f1dca3` deployment, all 6 server-fallback
jobs completed in 5.34 seconds on average (6.28 seconds maximum). This points to the client
promise/UI lifecycle rather than a stuck Browser Rendering queue.

Verification completed locally: `node --check backend-client.js`, `node --check app.js`,
`pnpm run typecheck`, `pnpm test` (16 files / 103 tests), and `pnpm run build`. A real iPad/tablet
verification remains required. The deployment and live-asset checks succeeded as recorded at the
top of this document.

### Unified quote-image dimensions — deployed

Commit `5d15d08` makes desktop, laptop, tablet, and phone client-rendered PNGs use the
same phone-size output profile: maximum scale 1.5 and maximum canvas area 4M pixels. The
server-render fallback already uses device scale factor 1.5 for the normal single-trade card, so
the normal and fallback outputs now align. Responsive preview sizing is unchanged. `index.html`
advances the backend-client cache key to `backend-v3`. Local verification passed:
`node --check backend-client.js`, `node --check app.js`, `pnpm run typecheck`, `pnpm test`
(16 files / 103 tests), and `pnpm run build`. Deployment and live-asset checks succeeded as
recorded at the top of this document.

### Self-hosted rasterizer (closes the CDN fallback risk)

`index.html` previously loaded html2canvas from `cdn.jsdelivr.net`. Corporate and bank networks
frequently block public CDNs, and when the rasterizer failed to load the button fell back to
server-side Browser Rendering — exactly the metered path ADR 0017 removed. The library is now
vendored at `vendor/html2canvas-1.4.1.min.js` and served from this application's own origin, so the
client path no longer depends on a third-party host. It is published by
`backend/scripts/prepare-assets.mjs` for both runtime modes; no CDN reference remains in the
repository.

Provenance (see `vendor/README.md`): fetched independently from jsdelivr and unpkg, byte-identical,
SHA-256 `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb`, 198,689 bytes, MIT
license header preserved. The bundle makes no third-party network requests. Do not edit the file;
treat a version change as a production dependency change requiring approval.

### Deferred: SVG rendering (**B**)

Server-generated SVG rasterized with the browser's native canvas API — no library at all and much
smaller stored objects. **Deliberately deferred.** After ADR 0017 the default path already avoids
Browser Rendering and writes nothing to R2, and self-hosting removed the CDN risk, so B's remaining
benefit is cross-device pixel consistency. It costs a full re-implementation of the card layout,
because the current design relies on flexbox/grid/`flex-wrap`, which SVG cannot lay out
automatically, and needs a subsetted CJK font embedded as a data URI to stay deterministic.

**Decide with data, not assumption:** ADR 0016 added `QUOTE_IMAGE_DOWNLOADED` audit events. Let
them accumulate for several days, then measure real image demand before committing to B.

## Deployed ZAR currency support

Commit `98d969c` is pushed and deployed as Worker
`a485a90c-56b9-4902-9192-e7b4b7f56eea`.

- The frontend currency selector now offers `ZAR` after `AUD`; the default remains `USD`.
- Server-side RFQ validation accepts `ZAR`, so the Cloudflare application does not reject a
  currency that the browser can select.
- No email table layout, issuer parser, ranking rule, database schema, migration, secret,
  dependency, lockfile or Cloudflare binding changed.
- Local verification passed: `node --check app.js`, `pnpm run typecheck`, `pnpm test`
  (16 files / 103 tests), and `pnpm run build` (Wrangler dry run).
- Post-deploy verification passed: API health and live `app.js` returned HTTP 200; both
  `https://app.yintsun66.com/` and `https://yintsun66-tech.github.io/fcnV2/` exposed `ZAR` in the
  rendered currency selector while retaining `USD` as the initial selection.

## Deployed mail-grace, late-recalculation, and custom-fifth implementation

Commit `481c220` is pushed and deployed as Worker
`68c62104-aa1d-48b9-b391-ff03695224f6`.

- The existing 900-second quote window is followed by a configurable 60-second mail-transport
  grace period. The UI keeps the 15-minute result experience, then displays
  `正在等待最後郵件轉送` until the 960-second hard deadline. Direct early finalization is disabled
  during that grace period.
- Late replies remain stored. An RFQ owner or ADMIN can explicitly create a new immutable
  recalculation version that includes eligible late replies; the existing finalized version is
  never overwritten.
- The public result table now contains economic ranks 1–4 plus a user-selected fifth issuer that
  is not already represented in the top four. The fifth selector offers the best eligible quote
  from each remaining issuer and supports the same owner-authorized image workflow.
- The backend still persists up to five economic results for compatibility/audit history, but
  public automatic ranking and custom-fifth authorization are derived server-side from the new
  ranking policy.
- No D1 migration, dependency, lockfile, secret, mail format, authentication rule, Cloudflare
  binding type, or R2 visibility change is included. `RFQ_MAIL_GRACE_SECONDS=60` is a new
  non-secret Worker variable in `backend/wrangler.jsonc`.
- Local verification passed: `node --check backend-client.js`, `pnpm run typecheck`,
  `pnpm test` (16 files / 102 tests), and `pnpm run build` (Wrangler dry run). The build had to be
  rerun outside the filesystem sandbox after the sandbox could not read the Worker entry point.
  The in-app browser could not reach the host-only localhost server, so an authenticated visual
  walkthrough of the result dialog remains unverified.
- Post-deploy verification passed: API health returned HTTP 200; cache-busted live
  `backend-client.js` contains `backendRecalculate`, `inMailGrace`, `data-custom-fifth-select`, and
  `alternateQuotes`; live `styles.css` contains `custom-fifth-row`.
- Preserve the untracked user-owned `.claude/` directory. The smallest remaining verification is
  an authenticated walkthrough of the grace-state countdown, late-recalculation action, custom
  fifth selector, and custom quote image.

## Production snapshot

- Application: `https://app.yintsun66.com`
- API: `https://api.yintsun66.com`
- Current verified Cloudflare Worker version:
  `6429a8bf-a735-47b4-a5ba-5fa3684ec282`, deployed from implementation commit `061fe3b` on
  2026-07-30. Health, application assets, follow-board assets and the unauthenticated manifest
  guard were verified after deployment.
- Earlier mobile-image Cloudflare Worker version:
  `b18cba05-bd46-49b5-818e-71d36d9b9d39` (mobile quote-image render-hang fix, on top of
  client-side rasterization, the self-hosted rasterizer, on-demand images and all earlier
  behavior, deployed 2026-07-28). Post-deploy verification: `GET /api/v1/health` returned
  HTTP 200; live `backend-client.js` contains `withRenderTimeout`, `CARD_SAFE_CANVAS_PIXELS`,
  `showCardImage`, `opacity:0` and 「長按圖片」; live `styles.css` contains
  `backend-card-preview`; the vendored rasterizer is served from this origin with a matching
  SHA-256 and no third-party CDN host remains on the live page.
  Previous verified versions: `f887ba53-...` from `b7ae5fb`; `fcf61774-...` from `88bdbd9`;
  `aa7a0656-...` from `de9e8d9`; `a485a90c-...` from `98d969c`;
  `68c62104-...` from `481c220`;
  `6520b77d-...` from `4095b51`;
  `566c7456-...` from `bdd66c1`; `02311666-...` from `0d77eac`;
  `cc633dcb-...` from `0bbe159`;
  `364a345e-...` from `fd7a380`; `25d32525-...` from `0913f16`;
  `2de5b070-...` from `23c084e`.
- D1 database: `fcn-quote`; migrations applied to remote D1 run through
  `0015_follow_board_expiry.sql`. The additive follow-board migrations `0013` through `0015`
  support product publication, multi-product command audit, declared issuer and automatic expiry.
  The latest deployment evidence reported no pending remote migration and no foreign-key errors.
- Private R2 bucket: `fcn-quote-private`
- Outbound sender and inbound Email Worker address: `rfq@yintsun66.com`
- Fixed outbound recipient: `i14053@firstbank.com.tw`
- Soft reminder / quote window / mail grace / hard deadline: 420 / 900 / 60 / 960 seconds.
- The live `backend-client.js` and `styles.css` were read back after the latest deployment and
  contain the recoverable RFQ workspace markers.

A successful Worker deployment does not prove that GitHub, the bank mailbox, forwarding rules,
or issuer replies are healthy. Verify each boundary separately.

## GitHub Pages static compatibility deployment

- Public repository: `https://github.com/yintsun66-tech/fcnV2`
- Pages URL: `https://yintsun66-tech.github.io/fcnV2/`
- Deployment source: `main` branch, repository root; Pages status verified `built`.
- Initial static program commit: `2d13926712667d6717126429b18c4ec75cd15750`
  (`feat: publish FCN V2 static snapshot`).
- Current static program commit:
  `d787aeb`.
- Current static repository HEAD:
  `d787aeb`.
- Snapshot source: the allowlisted public assets prepared from
  `codex/market-analysis-phase2-4` at implementation baseline `061fe3b`.
- Published files are limited to `index.html`, `styles.css`, `app.js`, `backend-client.js`,
  `mail-compose.mjs`, `market-analysis.mjs`, `market-resources.mjs`, `follow-board.html`,
  `follow-board.css`, `follow-board.mjs`, `guide.html`,
  `version-status.html`, `交易所查詢0715.csv`, `vendor/html2canvas-1.4.1.min.js`,
  `backend/shared/email-formats.js`, and a static-only `README.md`.
- The current static assets returned HTTP 200 after the Pages build. They include the `ZAR`
  currency option, the v4 follow-board module, automatic-expiry/full-card product display and the
  sales-fee line. Static mode keeps `USD` selected and does not activate `backendAuth`.
- GitHub Pages is not a backend migration. It has no authentication, D1, Queue, Email Worker, R2,
  ranking, automatic mail, or private artifact service. Never copy secrets, raw mail, D1/R2
  content, personal data, migrations, Worker source, or `.dev.vars` into `fcnV2`.
- The static source allowlist lives in `backend/scripts/prepare-assets.mjs`. Future static syncs
  should use an isolated clone of `fcnV2`, compare exact file hashes, and review its commit
  independently from the Cloudflare Worker deployment.

## Read-only production RFQ audit (reviewed 2026-07-27)

This audit used aggregate/read-only D1 queries. No RFQ, quote, job, mail, artifact, user, secret or
Cloudflare resource was changed. No raw mail, account identifier, RFQ ID, full subject, correlation
code or real quote value was copied into the repository.

- D1 contains 43 RFQs created from 2026-07-21 through 2026-07-24: 31 `COMPLETED` and 12
  `NO_VALID_QUOTE`. There is no RFQ currently stuck in `DRAFT`, `VALIDATED`, `QUEUED`, `SENDING`,
  `WAITING`, `PARTIAL` or `FINALIZING`, and no workflow-level `FAILED` RFQ. There is no RFQ record
  after 2026-07-24 10:45 UTC.
- All 344 outbound batches (43 RFQs × 8 profiles) are `SENT`, each in one attempt; all 344 outbound
  jobs completed. Therefore the observed incomplete outcomes are not caused by an outbound Queue
  or Worker send failure. `SENT` still proves provider acceptance, not bank inbox delivery.
- The first 10 `NO_VALID_QUOTE` RFQs used the former 10-minute deadline and received zero linked
  inbound messages. Separately, 45 early messages on 2026-07-22 are `UNMATCHED_RFQ`; every one
  lacks an RFQ tag/hash in the normalized subject and cannot be uniquely correlated from preserved
  thread headers. They must not be guessed/reassigned to historical RFQs.
- The remaining two `NO_VALID_QUOTE` RFQs used the 15-minute deadline and received 9 and 8
  correlated issuer messages. They contained no finite valid target quote: issuer evidence
  included out-of-range/rejection responses, blank target values, `*Price Unavailable`, and
  `Pls see below`. Their economic outcome is genuinely no valid quote, although several terminal
  labels should be made more accurate.
- SG replies use `At Maturity` for an EKI-style barrier. The current `barrier()` alias set does not
  recognize it, so two out-of-range SG replies became `PARSE_ERROR`/`AMBIGUOUS_TRADE_MATCH` rather
  than issuer rejection/no quote. DBS `*Price Unavailable` and BARCLAYS `Pls see below` are not in
  the current invalid/rejection vocabulary, producing `INVALID_VALUE` instead of a precise
  no-quote/rejection status.
- Forwarded original request tables create large non-quote row noise. Exactly 50% of stored
  BARCLAYS, DBS, JPM and CA rows, and 35.1% of MS rows, are `AMBIGUOUS_TRADE_MATCH`; the dominant
  pattern is a valid/rejected reply table followed by the quoted original request table. Issuer
  profiles should select/exclude tables before trade matching rather than rely on row-consumption
  side effects.
- Across 315 inbound messages, 228 are on-time parsed, 42 are linked late replies and 45 are the
  early untagged unmatched messages. No GS inbound message has ever been observed. CA has only two
  linked late replies and two early unmatched messages; no on-time parsed CA reply is present.
- Under the historical 15-minute cohort before ADR 0015's grace (18 RFQs), valid-reply counts are BNP/MS 15 each, DBS 14,
  JPM 13, UBS 12, NOMURA 10, SG 9, CITI 8, BARCLAYS 7, and CA/GS 0. Keep the 15-minute deadline
  as the issuer reply window while measuring current CA behavior; a longer global reply window
  should not be chosen from the old 10-minute cohort alone. New RFQs also receive the ADR 0015
  sixty-second transport grace.
- Ranking is not stuck: all 43 rank jobs completed. Image rendering is the remaining terminal
  workflow defect: 93 artifacts are `READY`, while 9 artifacts across 6 RFQs/9 trades are
  `FAILED` with `BROWSER_RENDER_FAILED`; none of those trades currently has a ready alternative
  artifact. The stored error loses the Browser Rendering HTTP/error category, so capacity,
  transient service failure and render-content failure cannot yet be distinguished.

## Deployed production-audit repairs (`477b3c9`, `0d77eac`)

The following minimal repairs are committed, pushed and deployed as Worker
`02311666-eefc-40c9-95d7-c446e1c24312`. They did not add a migration, dependency, lockfile,
binding, environment variable or deployment-setting change:

- `issuer-fcn-v4` maps SG `At Maturity` to `EKI`; treats DBS `*Price Unavailable` and BARCLAYS
  `Pls see below` as no-quote target values unless separate issuer error detail proves rejection;
  and excludes exact known forwarded-original BMJB/DBS/CA request header signatures before trade
  matching. It deliberately preserves otherwise identical completed response rows.
- Browser Rendering failures now retain a safe request/HTTP category, add retry jitter and write
  safe retry/failure audit events. The existing owner-authorized idempotent retry endpoint was
  reused rather than recreated; the result UI now exposes **重新產圖** for a failed artifact.
- The existing ADMIN RFQ timeline response/UI now includes a safe seven-day issuer health
  aggregate and alerts for zero inbound, parse error, timeout, unmatched/manual-review mail and
  failed artifacts. It contains no raw mail, subject, token, quote value, message ID or R2 key.
- Verification completed locally: `node --check backend-client.js`; `pnpm run typecheck`;
  targeted Vitest (3 files / 23 tests); full `pnpm test` (16 files / 90 tests); and
  `pnpm run build` (Wrangler dry-run) all passed. The sandboxed Vitest run emitted the known
  non-fatal Worker static-analysis access warning; all tests still passed. A localhost desktop
  and 390×844 mobile browser smoke check loaded the current shell without console errors; the
  mobile page reported no horizontal overflow. The ADMIN-only populated health panel was not
  exercised against production credentials.
- Deployment verification completed against the public health endpoint, unauthenticated ADMIN
  guard and current frontend assets. The ADMIN-only populated health panel still has not been
  exercised with production credentials.
- No D1 mutation or production replay/reclassification was performed. Existing historical
  quote/status rows remain unchanged; the parser changes apply to newly processed replies only.

## Deployed feature: PS tier + account management (committed `0913f16`, migrated, deployed)

Implements the operator request for an ADMIN **所有帳號列表** with last-online times, a `PS`
support tier, and delegated moderation. Committed as `0913f16`, migration `0010` applied to
remote D1, and deployed as Worker `25d32525-71ab-4aa7-9e90-5fefcea00a05` (2026-07-25).
See [ADR 0012](adr/0012-ps-tier-and-account-management.md).

- **Schema:** new migration `backend/migrations/0010_ps_privilege.sql` adds
  `users.is_privileged_support` (a safe `ALTER TABLE ADD COLUMN`; no table rebuild). The stored
  `role` CHECK stays `('USER','ADMIN')`; the Worker derives the effective role
  (`effectiveRole` in `db.ts`) so login/session return `USER | ADMIN | PS`.
- **API (`auth.ts`, `index.ts`):** `GET /api/v1/admin/accounts`; `POST /api/v1/admin/accounts/:id/{promote,demote,disable}`; `requireAdminOrPs` now gates registration review and account listing. Promote/demote are ADMIN-only; disable and registration approve/reject are ADMIN or PS. Guards keep ADMIN/PS accounts un-removable and block self-removal; removal is a soft `status='DISABLED'` + session revoke (RFQ ownership is `ON DELETE RESTRICT`).
- **UI (`backend-client.js`, `styles.css`):** new **所有帳號列表** button + dialog, visible to ADMIN/PS; registration-review button now visible to PS; per-row 升級為PS / 降級為一般 / 剔除 actions with confirmation. Server remains the source of truth.
- **Tests:** `backend/test/auth.test.ts` adds a PS lifecycle test (list, promote, PS approve, PS disable, ADMIN/PS-protection 409s, USER 403s, demote). Suite is **16 files / 85 tests** passing.
- **Verification:** local — `node --check backend-client.js`, `pnpm run typecheck`, `pnpm test` (16 files / 85), `pnpm run build` (dry run) all passed; `worker-configuration.d.ts` no diff. Post-deploy — API health 200; live `backend-client.js` carries all four Chinese action markers plus `/admin/accounts`; unauth `/api/v1/admin/accounts` returns 401.
- **Still owed:** an authenticated browser walkthrough (promote a test USER to PS, confirm PS can approve/剔除 but cannot touch ADMIN/PS rows, and that a disabled user is logged out). Commit/migrate/deploy/push are all complete; no merge to `main`.

## Deployed feature: duplicate-registration visibility (`fd7a380`)

Fixes an operator confusion: a "new" account never appeared in the pending list. Root cause —
a registration whose **login account or employee number already exists** is intentionally
answered with the same generic `202` as a new one (anti-enumeration, [auth.ts](../backend/src/auth.ts)
`register`) and **creates no user row**, so it is invisible.

- `register()` now records the colliding unique field (`employeeNumber` | `username` | `unknown`)
  in the `REGISTRATION_DUPLICATE` audit metadata — the field name only, never the value.
- `GET /api/v1/admin/registrations` also returns `duplicates { windowDays, count, latestAt, byField }`
  (7-day window). The 使用者申請審核 screen shows an amber note explaining blocked duplicates.
  Visible to ADMIN or PS.
- No schema change (reads existing `audit_events`). Deployed as Worker `364a345e-...`.
- **Diagnosed case:** account `99999` — login `99999` does not exist and pending count is 0, so
  its blocked duplicate was an **employee-number (行編) collision**: 行編 `99999` already belongs to
  an existing ACTIVE account under a different login name. Remedy: that person logs in with the
  existing account (or password recovery); the same 行編 cannot be registered twice.
- **Identifying the account (`0bbe159`):** an ADMIN-only 「以行編查詢帳號」 lookup was added to the
  所有帳號列表 dialog (`POST /api/v1/admin/accounts/lookup`, matched by keyed hash, audited without
  the queried value). To find who owns 行編 99999, an ADMIN opens 所有帳號列表, enters `99999`, and
  chooses 查詢.

## Implemented system

The repository has two intentionally different runtime modes:

1. The root static FCN/DAC interface remains compatible with GitHub Pages. Its mail action uses
   the existing browser/manual-email workflow.
2. `app.yintsun66.com` serves the root assets through the Cloudflare Worker and activates
   `backend-client.js`, adding authentication, automated RFQ email, results, ADMIN tools, and
   private quote-image downloads.

The Cloudflare backend currently implements:

- approval-based username/password registration and login;
- server-side ownership checks and separate ADMIN authorization;
- RFQs containing 1–20 trades, validation, eight outbound mail batches, and eleven expected
  issuer snapshots;
- outbound mail archival in private R2 and an ADMIN archive viewer;
- inbound RFC822/MIME intake, R2 retention, Queue-based parsing, issuer recognition,
  normalization, trade matching, and audit/error states;
- per-trade persistence of the first five economic ranks for compatibility/audit, with public
  results showing ranks 1–4 plus a server-validated custom fifth issuer;
- Coupon descending and Price/Strike/KO/KI ascending ranking directions;
- seven-minute provisional-result reminder, a fifteen-minute reply window followed by a
  sixty-second mail-transport grace, and an owner-authorized early-finalize action outside grace;
- immutable late replies and owner/ADMIN versioned recalculation;
- on-demand browser image generation for exact ranks 1–4 or a server-validated custom fifth
  quote, with a separately authorized server-rendered/private-R2 fallback;
- portrait, issuer-themed quote cards whose normal browser-generated downloads are not persisted
  to R2;
- a PIN-gated public follow-board shared by the application and static site, with issuer-derived
  full quote cards, product-code publication, automatic expiry, sales-fee display and owner data
  minimization;
- ADMIN registration review, outbound archive, and RFQ timing diagnostics;
- owner-scoped recoverable RFQ workspace.

## Latest feature: recoverable RFQ workspace

The problem was that `backend-client.js` kept the current RFQ only in memory. Closing the dialog,
reloading, or returning later left the D1 result intact but gave the user no route back to it.

Implemented behavior:

- permanent **新增詢價 / 我的詢價** controls and an active-RFQ count badge;
- `GET /api/v1/rfqs?scope=active|completed|all&limit=...&cursor=...`;
- the collection query always filters by the authenticated `user_id`;
- responsive RFQ cards, status filters, cursor pagination, and reopen actions;
- `?rfq=<id>` deep links that survive reload, login recovery, and browser history;
- closing the foreground dialog stops only browser polling; Durable Object/Queue processing
  continues;
- no localStorage copy of terms, rankings, or results—D1 remains authoritative;
- no D1 migration, dependency, lockfile, binding, or deployment-setting change.

See [ADR 0008](adr/0008-recoverable-rfq-workspace.md) and
[API contracts](backend/contracts.md).

## Entry points for the next engineer

- `AGENTS.md`: canonical rules for every coding agent.
- `CLAUDE.md`: Claude Code startup and handback checklist.
- `index.html`, `app.js`, `styles.css`: compatibility UI and root static behavior.
- `backend-client.js`: application-domain authentication, RFQ workspace, result UI, images, and
  ADMIN dialogs. It activates only on `app.yintsun66.com` or with `?backend=1`.
- `backend/src/index.ts`: Worker/Email/Queue/scheduled-event router.
- `backend/src/auth.ts`: registration/login/session, `requireAdmin`/`requireAdminOrPs`, PS
  promote/demote, account list/disable, employee-number lookup, and duplicate-registration
  summary. `backend/src/db.ts`: `loadSession` + `effectiveRole` (USER|ADMIN|PS derivation).
- `backend/src/rfqs.ts`: RFQ create/read/list/validate behavior.
- `backend/src/outbound.ts`: outbound snapshot and Queue processing.
- `backend/src/inbound.ts`, `backend/src/inbound-parser.ts`: MIME intake and correlation/parsing.
- `backend/src/issuer-profiles.ts`: issuer-specific row parsing and units.
- `backend/src/quote-normalize.ts`: canonical quote normalization and expected-issuer terminal
  states.
- `backend/src/rfq-timing.ts`: seven-minute reminder, fifteen-minute reply window, sixty-second
  grace, and combined hard-deadline helpers.
- `backend/src/ranking-policy.ts`: shared normal/recalculation eligibility, economic ranking, and
  custom-fifth candidate policy.
- `backend/src/ranking.ts`, `backend/src/results.ts`: versioned finalization, persisted ranking,
  public result contracts, and owner/ADMIN recalculation.
- `backend/src/artifacts.ts`: image jobs, the shared `authorizeCardQuote` / `loadCardTrades`
  helpers, and the `getTradeCardDocument` endpoint used by client-side rasterization.
  `backend/src/quote-card.ts`: the card template and the exported `QUOTE_CARD_WIDTH_PX`.
- `vendor/`: self-hosted third-party browser assets (currently html2canvas). Do not edit; see
  `vendor/README.md` for provenance, the recorded SHA-256, and the update procedure. `.gitattributes`
  marks `vendor/**` as `-text` so the bytes survive checkout on Windows.
- `backend/src/coordinator.ts`: per-RFQ Durable Object and deadline orchestration.
- `backend/migrations/`: immutable D1 migrations; never edit an applied migration.
- `backend/test/`: Worker, parser, ranking, artifact, auth, and security regressions.
- `backend/wrangler.jsonc`: production bindings and non-secret variables.
- `docs/backend/architecture.md`: current system/data flow.
- `docs/backend/contracts.md`: current HTTP interfaces.
- `docs/backend/phase-5-7-production.md`: parser/ranking/image operational details.
- `docs/runbooks/deploy.md`, `docs/runbooks/admin.md`: deployment and human operations.
- `docs/adr/`: accepted architecture decisions; use Git history for superseded implementation
  chronology.

Generated files—`backend/public/`, `backend/dist/`, and
`backend/worker-configuration.d.ts`—must not be edited or committed.

## Verification baseline

The latest implementation was verified with:

```powershell
node --check app.js
node --check backend-client.js
Set-Location backend
pnpm run typecheck
pnpm test
pnpm run build
```

Results:

- JavaScript syntax: passed.
- TypeScript source and test checks: passed.
- Full test suite: **27 files / 194 tests passed**.
- Cloudflare Worker dry-run build: passed with 18 public assets.
- Current production readback (code deployed as `ca46deee-da1c-4aab-91e6-17a772181bfd`):
  `/api/v1/health` 200 on both `api.` and `app.`; an unauthenticated `/snapshot` 401; the public
  follow-board manifest without a PIN 401; the LINE webhook 404 while disabled. Five minutes of
  live tail covering three consecutive cron ticks: 28 events, all `outcome: "ok"`, zero exceptions.
- Earlier readback for Worker `5abc0baa-9be0-4021-a90f-d067ed074c0c`: health 200, and
  `POST /api/v1/public/line/webhook` 404 with the webhook disabled. While it was briefly enabled
  (Worker `30837aa3-e938-415c-a650-08aebe2ed995`) the same endpoint returned 404 without a
  signature and 401 with an invalid one.
- Earlier production health/static readback for Worker
  `6429a8bf-a735-47b4-a5ba-5fa3684ec282`: health and application/follow-board assets returned
  HTTP 200; a public manifest request without the PIN returned HTTP 401.
- Historical mobile-image production readback for Worker
  `b18cba05-bd46-49b5-818e-71d36d9b9d39`: HTTP 200; the live `backend-client.js` contains
  `withRenderTimeout`, `CARD_SAFE_CANVAS_PIXELS`, `showCardImage` and 「長按圖片」; the live
  stylesheet contains `backend-card-preview`. Earlier deployment checks verified the
  quote-card endpoint guard (401 unauthenticated), the self-hosted rasterizer's SHA-256, and the
  PS/account-management, duplicate-registration and 以行編查詢帳號 guards.

`backend/vitest.config.ts` reads migrations with `readD1Migrations("./migrations")`, so a new
migration is exercised by the suite automatically.

Authenticated browser walkthroughs remain outstanding for ADMIN/PS account interactions, ADR 0015's
grace/recalculation/custom-fifth workflow, and — newly — the quote-image download on a **real
iOS/Android device** (see "Safe next steps"). Treat these as UI verification gaps, not evidence
that the verified API/static deployment failed.

## UI and selective-send changes (2026-07-24)

- AUTOMATED RFQ countdown label: 「硬截止剩餘」 → 「詢價流程剩餘時間」.
- Toolbar button 「確認所有詢價條件」 → 「手動貼郵件詢價」 with a blue-green gradient
  (`.manual-email-button`). It still runs the static mailto/clipboard flow.
- Both quote buttons enforce the Barrier Type / KI Barrier rule before acting: NONE requires a blank
  KI Barrier, and a filled KI Barrier requires EKI/AKI. The static button already did this via
  `validateRow`; the backend send now checks it in `backend-client.js` before creating the RFQ.
- **Selective issuer send (ADR 0009).** 「發送詢價條件」 now opens an issuer checklist (eleven issuers
  + an "all" toggle); only the selected issuers are queried and ranked. `POST /send` accepts an
  optional `{ issuers: [...] }` (absent → all eleven). BMJB is a shared email, so selecting any of
  BNP/MS/JPM/BARCLAYS sends the BMJB batch but ranks only the selected ones.
- Quote image (`quote-card.ts`): for DAC products the card now adds a note under 保證配息期間 —
  「*DAC/DRA第{X+1}個月起為浮動收益」 (X = guaranteed periods). FCN cards are unchanged.
- Verified: `node --check backend-client.js`; `pnpm run typecheck`; `pnpm test` (16 files, 76);
  `pnpm run build` (dry run). Committed (`4a45ad5`, `376f48c`) and deployed 2026-07-24 as Worker
  `c33e0b05-5052-4567-8a82-c87750346630` (health `ok`; live assets carry the new button + picker).

## Efficient RFQ polling (committed, pushed, and deployed)

- Corrects stale architecture/production text: current branch/migrations, selective issuer
  snapshots, rank-one-only automatic image rendering and the latest 76-test baseline.
- Adds owner-scoped `GET /api/v1/rfqs/summary` for the active badge, avoiding the full RFQ-card
  aggregation query.
- Adds owner-scoped `GET /api/v1/rfqs/:rfqId/snapshot?since=<version>` to combine status, results
  and current-ranking artifacts. An unchanged version skips quote/result/artifact-list loading and
  provisional reranking.
- Snapshot invalidation includes safe status/issuer/artifact state plus a provisional quote
  count/latest-created aggregate, so a second quote from an already-terminal issuer is detected.
- Hidden documents stop badge/result timers. Visible unchanged polls back off 4s → 8s → 15s;
  finalization, the last deadline minute and queued/rendering artifacts use 2s.
- Existing status/results/artifacts APIs remain compatible. No migration, dependency, lockfile,
  binding, secret, environment-variable or email-format change.
- Verification: root JavaScript syntax and source/test TypeScript checks passed;
  `backend/test/rfqs.test.ts` passed (1 file / 9 tests); the full suite passed (16 files /
  77 tests); and the Cloudflare Worker dry-run build passed.
- Implementation commit `65a233a` is pushed to
  `origin/feature/subject-branch-correlation` and deployed as Worker
  `66384b5b-42fe-4032-a9c0-79a033b6eb96`.
- Post-deploy verification: API health and the cache-bypassed live client returned HTTP 200; the
  client contains `/rfqs/summary`, `/snapshot`, `document.hidden`, and adaptive-polling markers.
- Not yet verified: an authenticated browser walkthrough and a live 50-user read-path load test.

## Issuer-parser corrections committed and deployed

- A production RFQ diagnostic proved that mail delivery, correlation and Queue processing
  completed, but valid DAC replies from SG and UBS were discarded by product recognition.
- The local working tree now maps SG `Fixed Coupons` values such as `First Period`,
  `First Two Periods` and positive period counts to canonical DAC while retaining
  `All Periods` as FCN. Unknown free text remains unsupported.
- UBS reply product `VMRAN` now normalizes to canonical DAC; its large trailing Quote ID remains
  metadata and does not shift the formal quote columns.
- BARCLAYS Comet row errors are now attached to the corresponding response rows, so an invalid
  product-name response becomes `ISSUER_REJECTED` with a safe reason instead of `NO_QUOTE`.
  The accepted BARCLAYS DAC outbound product code is still unconfirmed and was not guessed or
  changed; the shared BMJB outbound format remains intact.
- Parser version advances to `issuer-fcn-v3`; affected profile identifiers advance without any
  D1 migration, binding, dependency, lockfile or outbound-email format change.
- Verification completed locally: source/test TypeScript checks passed, the full suite passed
  (16 files / 79 tests), and the Cloudflare Worker dry-run build passed.
- Implementation commit `ae0c0e2` is deployed as Worker
  `4ca06f90-3bec-43eb-8d03-141c83d454ed` and is pushed. Existing finalized RFQs are not
  automatically reparsed or reranked; use a new RFQ to verify the correction unless a separately
  reviewed, versioned reprocessing workflow is implemented.

## Historical DAC subject-routing marker (deployed, superseded by ADR 0013)

- The ADR 0011 implementation inserted the literal `DAC/DRA` immediately after
  `FCN(T+7)` and before the branch label and correlation tags. FCN-only subjects remain
  unchanged.
- The rule recognizes canonical `DAC` plus the issuer aliases `DRA`, `WRA`, and
  `Range Accrual`. The shared browser/Worker email module owns the rule, while the Worker
  snapshots the product-aware subject into `outbound_email_batches.base_subject`.
- Marker insertion is idempotent, so Queue retries do not duplicate `DAC/DRA`; recipients,
  HTML tables, sender settings, correlation tokens, and inbound parser rules are unchanged.
- The current model still permits mixed FCN/DAC trades in one RFQ. Because an issuer chooses
  one pricing module from one email subject, any mixed request is ambiguous; current behavior
  marks the email as DAC rather than silently omitting the DAC routing signal. A separate
  product-batch design requires explicit approval.
- Verification: shared-module syntax check, TypeScript source/test checks, the full test suite
  (16 files / 84 tests), and the Cloudflare dry-run build passed. Post-deploy health and live
  asset checks returned HTTP 200. Deployment verification itself did not send real mail; the
  subsequent authorized production evidence is recorded below.
- Implementation commit `23c084e` is deployed as Worker
  `2de5b070-6feb-4f1f-bf28-e710a0589793` and pushed to
  `origin/feature/subject-branch-correlation`.

## Authorized production DAC evidence (reviewed 2026-07-25)

- A post-deploy three-trade DAC RFQ sent all eight request batches with
  `FCN(T+7) DAC/DRA <branch> [RFQ:<code>][BATCH:<code>]`; every outbound batch reached `SENT`.
- Eight issuer replies correlated by the short subject code and completed MIME/table parsing.
  BNP, MS, JPM, NOMURA, UBS, DBS, and SG produced valid DAC quotes. The ranking run completed
  with five persisted results per trade, and all three rank-one quote images reached `READY`.
- This proves the deployed SG fixed-period mapping and UBS `VMRAN` alias end to end. It also
  proves that the bank forwarding wrapper can preserve enough original sender/subject evidence
  for those observed issuers. It does not prove behavior for issuers that did not reply.
- Barclays did reply from its allowlisted COMET sender and was correctly identified/correlated.
  Its reply preserved the `DAC/DRA` subject marker but rejected Product=`DAC` on all three rows
  with the safe error `Incorrect product name in "Product" column for Fixed Coupon Note`.
  The backend correctly recorded `ISSUER_REJECTED`; this is not `NO_QUOTE`, `PARSE_ERROR`, or
  missing inbound mail.
- The accepted Barclays DAC product code and exact module-selection subject remain unknown.
  Possible names such as `DRA` or `Range Accrual` are hypotheses only and must not be deployed
  without confirmation from Barclays/bank operations.
- BMJB is one shared request for BNP/MS/JPM/BARCLAYS. Because the same Product=`DAC` request
  produced valid BNP/MS/JPM replies, changing BMJB globally could break three working issuers.

  A Barclays-specific request profile/batch also requires confirmation that the bank forwarding
  workflow can route it separately, followed by an approved API/schema/email-format plan.
- CITI, GS, and CA had no correlated reply before the 15-minute deadline in this observed RFQ
  and ended `TIMEOUT`; this does not change the Barclays diagnosis.
- No raw MIME, full subject token, personal address, RFQ ID, or real quote fixture was committed.

## Deployed first-trade product subject change (`bdd66c1`)

- ADR 0013 supersedes the separate subject marker for newly created requests. The first trade now
  selects `FCN(T+7)` or `DAC(T+7)`, and the literal segment ` DAC/DRA` is removed.
- Only the first row controls the subject in a mixed FCN/DAC RFQ, per the approved requirement.
  Later rows do not change the pricing-module label.
- The shared browser/Worker email-format helper owns the rule. New Worker batches snapshot the
  resulting base subject; the Queue consumer preserves an already saved base-subject snapshot so
  a legacy queued batch is not made unsendable by a code update.
- Sender, recipient, branch label, correlation tags, mail table/body Product values, inbound
  parsing, schema, dependencies, secrets and Cloudflare bindings are unchanged.
- Verification passes: syntax checks for `app.js` and the shared email helper; backend source/test
  typecheck; targeted email-format/outbound tests (2 files / 18 tests); full suite (16 files /
  91 tests); and the Cloudflare dry-run build. Vitest emitted the known non-fatal sandbox
  static-analysis warnings; all tests passed.
- Commit `bdd66c1` is pushed and deployed as Worker
  `566c7456-7e0f-42ac-9341-823c533ead71`. Public health and cache-busted source-asset checks
  passed. No real RFQ was sent as a deployment test, so bank/issuer module routing under the new
  title still requires one separately authorized controlled RFQ.

## Deployed issuer-specific DAC/DRA subject labels (`4095b51`)

- ADR 0014 preserves first-row routing and FCN=`FCN(T+7)`, but maps DAC-family subjects by
  outbound batch: NOMURA/DBS/SG/GS/CA use `DRA(T+7)`; BMJB/UBS/CITI keep `DAC(T+7)`.
- The mapping is stored in the shared email institution profiles, so browser/manual and
  Worker/automatic mail use the same rule. `outbound.ts` snapshots the configured label; the
  Queue consumer still preserves an existing subject snapshot.
- Mail body Product mappings, recipient/sender, branch label, correlation tags, inbound parsing,
  schema, dependencies, lockfile, secrets and Cloudflare bindings are unchanged.
- Verification passes: JavaScript syntax checks; backend source/test typecheck; targeted
  email-format/outbound tests (2 files / 26 tests); full suite (16 files / 99 tests); and the
  Cloudflare dry-run build. Vitest emitted the known non-fatal sandbox static-analysis warnings;
  all tests passed.
- Commit `4095b51` is pushed and deployed as Worker
  `6520b77d-c8a7-4d9d-94d8-37a5a0e6f384`. Public API/static-source verification passed.
  No real RFQ was sent as a deployment test, so issuer module routing still needs one separately
  authorized controlled RFQ.

## Production gaps and cautions

1. A batch marked `SENT` means Cloudflare accepted it; it is not proof of delivery to the bank
   inbox.
2. Cloudflare cannot poll `i14053@firstbank.com.tw`. Issuer replies must be forwarded by the bank
   mailbox to `rfq@yintsun66.com`. Production evidence now proves usable sender/subject
   preservation for eight observed replies, but not for every issuer/template.
3. `BMJB` is not an issuer identity. BNP/MS/JPM/BARCLAYS must be distinguished by the preserved
   original sender/domain.
4. Subject/body correlation fallback exists, but some real forwarded messages have reached
   `UNMATCHED_RFQ`. Never guess ownership or trade matching.
5. **GS/CA reply behavior (reviewed 2026-07-23).** GS has never produced an observed inbound
   message — likely no upstream quoting/forwarding, not a parser defect. CA *does* reply and its
   format parses and matches trades correctly (not a format bug like SG was); the issue is speed.
   Correlated CA replies were observed **~12.8 and ~25.4 minutes after send**, measured under the
   old 600s deadline so both landed as `LATE_REPLY`/`TIMEOUT`. The current 900s reply window plus
   60s grace would capture the ~13-minute case but not the ~25-minute one; CA has not yet been
   re-tested under the current timing. Reliably capturing CA's slow replies would need a longer
   `RFQ_DEADLINE_SECONDS` reply window (e.g. 1800s), which lengthens the wait for every RFQ — a
   user decision.
   Some CA replies also reached `UNMATCHED_RFQ` (subject-correlation failure, see item 4). Confirm
   upstream/timing before treating a CA timeout as a parser defect.
6. MS is displayed as `MS（OBU不得承做）`, but no approved account-level OBU attribute or blocking
   rule exists. Do not silently exclude or enforce it.
7. Browser Rendering and Cloudflare email/Queue limits need continued observation under real
   concurrent traffic.
8. CITI price comparison uses the approved `100 - Upfront` normalization. Preserve both raw and
   normalized values.
9. Existing artifacts are immutable snapshots. Layout/profile changes require a new RFQ or
   versioned recalculation; do not overwrite historical R2 objects.
10. `main` does not contain the current backend feature branch. Do not merge or copy changes
    between branches without an explicit user request and a clean diff review.
11. **DAC-architecture parsing (updated 2026-07-25).** DRA/WRA/Range Accrual aliases normalize
    to canonical DAC, MS uses its separate shifted DRA layout, UBS reply-only `VMRAN` is recognized,
    and SG derives DAC from validated 1-24 fixed-coupon period values while retaining
    `All Periods` as FCN. An authorized live RFQ proved SG/UBS end to end. Barclays COMET instead
    rejected Product=`DAC` even though the `DAC/DRA` subject marker survived; its accepted DAC
    outbound product code remains unknown. Do not guess or change the shared BMJB format without
    issuer/bank confirmation.
12. **Roles and account management (ADR 0012).** Effective roles are `USER｜PS｜ADMIN`; `PS` is the
    `users.is_privileged_support` flag (migration `0010`), never a stored `role` value —
    always compare against the effective role from `effectiveRole`/the session, not the raw column.
    Account removal is a soft `status='DISABLED'` (RFQ ownership is `ON DELETE RESTRICT`); do not
    hard-delete users. ADMIN/PS accounts are protected by SQL `WHERE` guards, not only the UI.
    Employee numbers stay out of the 所有帳號列表; the ADMIN-only `POST /admin/accounts/lookup`
    matches by keyed hash and must never log the queried 行編. The `register()` duplicate path is
    intentionally silent to the applicant (anti-enumeration); surface duplicates to reviewers only.

## User-owned/untracked work to preserve

- `.claude/settings.local.json` is intentionally untracked and belongs to the user. Do not add,
  modify, delete, or include it in a commit unless the user explicitly requests that exact file.
- `backend/scripts/smoke-outbound-email.ps1` was manually deleted by the user, was never tracked,
  and must not be recreated. A replacement could create a real RFQ and send real bank email.
- Never commit raw `.msg`, MIME, real mail bodies, credentials, Cloudflare tokens, D1 exports,
  R2 content, or unredacted personal data.

## Safe next steps

**The previous close is no longer a next step — it works.** Earlier revisions of this section made
validating Alpha Vantage the highest-value item, and a later one called previous-close autofill an
inactive feature. Both are now out of date: Twelve Data serves it and the result was verified in
production on 2026-08-01. Alpha Vantage remains last in the chain and still fails; nothing depends
on it. Do not spend a session on either.

**Highest-value item right now: let one real follow-board publication happen and watch it.** It is
the single event that proves several unproven paths at once — the LINE push, the server-side card
render, the 90-second render budget and the 15-second push abort. Nothing needs to be built for it;
it just needs to occur.

If no message reaches the group, read `providerMessage` on the `FOLLOW_BOARD_LINE_PUSHED` audit
event **before changing any code**. The previous attempt returned 429 with the plausible causes
already eliminated — quota `limited/200` with `totalUsage: 0`, token and message shape both accepted
by LINE's own validator — so the recorded message is the only remaining evidence. A monthly-cap
message means the LINE plan is the constraint rather than this repository; a rate-limit message
would be surprising at five pushes a day and worth investigating properly; `attempts: 2` with a
success means the retry handled it and nothing needs doing.

**Second: validate quote-image download on a real phone/tablet.** ADR 0017 moved rasterization
into the requesting browser and `7f1dca3` fixed a hang that only reproduced on mobile WebKit. The
reproduction harness was desktop Chromium, so mobile behavior is reasoned from measured canvas
sizes plus known iOS limits, **not observed on a device**. Ask the operator to press 下載報價圖 on
a phone/tablet; the three outcomes and what each means are recorded in the
"Mobile/tablet 「產圖中…」 hang" section. If the message names a timed-out step, that step is the
next thing to fix.

**Third: decide ADR 0017-B with data, not assumption.** `QUOTE_IMAGE_DOWNLOADED` audit events have
been collected since `de9e8d9`. Measure real image demand before investing in the deferred SVG
renderer; after the client-side move and the self-hosted rasterizer, B's only remaining benefit is
cross-device pixel consistency.

Production-audit repair order:

- Run one new controlled RFQ and review it through the ADMIN seven-day health panel. Historical
  rows are intentionally not re-parsed or rewritten automatically.
- Use the ADMIN seven-day health panel to verify whether current GS/CA replies reach the inbound
  route and whether Browser Rendering HTTP failures recur. Do not infer bank delivery from `SENT`.
- MS forwarded-original-table noise remains unproven at a safe header-signature level. Do not add
  a broad table-index or duplicate-row filter without a synthetic fixture derived from a
  production-observed, anonymized MS layout.

1. Start by reading `AGENTS.md`, this file, the relevant ADR/contracts, current branch/status, and
   the exact entry point/tests for the requested task.
2. Perform a controlled authenticated browser walkthrough:
   open **我的詢價**, switch filters, reopen an active/completed RFQ, reload a `?rfq=` URL, and
   verify another user receives `404` for ownership-protected resources.
3. For email troubleshooting, use the ADMIN timing/archive views and structured D1 status fields;
   do not expose or commit raw mail. A real outbound RFQ sends bank email and therefore requires
   explicit user authorization.
4. Before changing Barclays DAC outbound behavior, obtain its accepted Product value and exact
   subject contract. Decide whether bank operations can route a Barclays-specific request. Do
   not globally change BMJB because Product=`DAC` is already proven for BNP/MS/JPM.
5. If changing issuer parsing, add an anonymous synthetic regression fixture and preserve raw
   units, normalized units, invalid/no-quote states, and matching rules.
6. If changing schema, bindings, secrets, authentication, email routes, dependencies, or
   production behavior, stop and obtain explicit approval before editing or deploying.
7. Before handback, run the applicable verification baseline, inspect the complete Git diff,
   update this file with exact evidence, and report whether commit, push, migration, and deploy
   each occurred.
8. End-to-end checks still owed:
   - **Quote-image download on a real iOS/Android device (highest value).** Press 下載報價圖 and
     confirm the preview dialog appears and the image can be long-pressed and saved. A message of
     the form 「本機產圖逾時（步驟）改用伺服器產圖…」 means the hang is fixed but the local path
     still fails on that device — the named step identifies what to fix next.
   - **ADMIN/PS admin walkthrough.** As ADMIN (14053): open
     **所有帳號列表**, confirm last-online times; promote a test USER to PS and confirm that USER
     re-logs-in as PS; as that PS confirm it can 核准/剔除 a regular USER but sees no action on
     ADMIN/PS rows and no 以行編查詢帳號 box; confirm a 剔除'd user is logged out; demote the PS
     back; use 以行編查詢帳號 to resolve a「行編已存在」case; confirm the duplicate-registration
     amber note appears after a duplicate attempt.
   - The ADR 0015 result workflow: observe the 15:00–16:00 grace state, confirm early-finalize is
     unavailable, exercise an owner and ADMIN late-reply recalculation, select a custom fifth
     issuer outside ranks 1–4, and generate/download that issuer's image.
   - Selective per-issuer sending through the issuer picker (especially BMJB grouping), visual
     confirmation of the DAC/DRA floating-income note on a downloaded production image, Barclays
     DAC routing/code, and CA latency under the current fifteen-minute reply window plus
     sixty-second grace.

## Mobile trade-entry navigation — local, not committed or deployed (2026-08-02)

The current working tree adds a mobile-only trade navigator to the shared root interface. At
viewport widths up to 760px, `#1` through `#20` appear in a sticky, horizontally scrollable bar;
clicking a shortcut scrolls to that trade, and scrolling or focusing a field updates the active
trade indicator. Adding, removing, restoring, or clearing trades rebuilds the shortcuts from the
current rows.

On the same mobile breakpoint, the three immutable fields are visually hidden to reduce vertical
input time: Observation Frequency remains `1`, OTC remains `Note`, and Effective Date Offset
remains `7`. The readonly controls stay in the DOM, so draft storage, validation, outbound email,
and backend RFQ payloads retain the existing values. Desktop/tablet table behavior at widths above
760px is unchanged and continues to display those columns.

Files changed: `index.html`, `app.js`, `styles.css`, and this handoff. No API, D1 migration,
Cloudflare binding, dependency, or lockfile changed. Verification completed locally: `node --check
app.js`; Cloudflare Worker dry-run build; browser checks at 390px (hidden fixed cells retain values,
three-row add/switch/remove synchronization) and 1280px (navigator hidden, fixed columns visible,
table layout preserved). Branch remains `codex/market-analysis-phase2-4`; the change is not yet
committed, pushed, or deployed. Preserve the user-owned untracked `.claude/` and `output/`
directories.

## Deployment reminder

Do not deploy unless explicitly requested. The normal source flow is:

```powershell
Set-Location backend
pnpm run build
pnpm run prepare-assets
pnpm exec wrangler deploy
```

Apply a new D1 migration before the Worker only when the reviewed migration/code compatibility
plan explicitly requires that order. After deployment, verify the health/static/API behavior
relevant to the change and record the Worker version here.
