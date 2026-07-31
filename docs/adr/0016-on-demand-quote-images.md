# ADR 0016: On-demand quote images

Status: Accepted
Date: 2026-07-27

## Context

Every finalized ranking automatically queued a rank-one image render for every trade of every RFQ.
Rendering runs through Cloudflare Browser Rendering (`env.BROWSER.quickAction("screenshot")`), which
is the only centrally metered, concurrency-limited resource in the pipeline: the
`fcn-image-render` consumer is configured with `max_concurrency: 3`, matching the free-plan
concurrent-browser allowance, on top of a per-day browser-time budget.

Measured production evidence (read-only audit, 2026-07-27):

- 124 artifacts existed for 182 trades, i.e. automatic rendering covered ~0.68 images per trade,
  regardless of whether the image was ever opened.
- 9 of 124 artifacts were `BROWSER_RENDER_FAILED` — a 7.3% failure rate at near-zero concurrency
  (51 RFQs across 6 days, 1–2 active users). `max_retries: 3` means each failure consumes further
  browser time.
- At the requested 30–50 user scale, 3.57 trades per RFQ implies roughly 178 images/day at
  50 RFQs/day and 714 images/day at 200 RFQs/day, against an estimated free-plan capacity of
  150–300 images/day. The ceiling therefore falls at the *bottom* of the target user range, and it
  is a daily-budget ceiling, not only a burst ceiling.

Because RFQs finalize on a fixed 960-second timer, load also arrives in synchronized bursts.

The owner-authorized on-demand render path already existed for economic ranks 1–4 and the custom
fifth issuer (ADR 0015), including its authorization, idempotency and retry behavior. Nothing new
was needed to let a user obtain any permitted image.

## Decision

1. **Rank-one images are no longer rendered automatically.** `processQuoteRankJob` no longer
   inserts a `generated_artifacts` row, an `image_render_jobs` row, or a queue message when a
   ranking run completes.
2. `ranking_results.is_image_winner` still marks the rank-one quote. Only rendering changed;
   ranking, ordering, tie handling and the persisted result set are untouched.
3. **The existing on-demand endpoint is now the only route to an image.** A user requests any
   permitted quote image from the result table, exactly as for ranks 2–4 and the custom fifth.
   Authorization remains server-side; the browser may not nominate an arbitrary quote ID.
4. **A compatibility switch is retained.** The non-secret Worker variable
   `AUTO_RANK_ONE_IMAGE` restores the previous behavior when set to `"1"`. It defaults to `"0"`.
5. **Real demand is now measured.** `downloadArtifact` writes a `QUOTE_IMAGE_DOWNLOADED` audit
   event recording only whether the request was a preview and the issuer — never a quote value,
   correlation code, RFQ identifier beyond the artifact entity id, or personal data. This produces
   the download-rate evidence needed to size rendering capacity against observed use.

## Consequences

- Browser Rendering consumption becomes proportional to images people actually ask for instead of
  to RFQ volume. The 7.3% automatic-render failure rate no longer affects users who never wanted an
  image.
- A user who does want the rank-one image performs one extra click and waits for the render, where
  previously it was often (but not always) pre-rendered.
- R2 growth from `quote-images/v3/` — the largest single category at 36.59 MB of a 94.6 MB bucket —
  falls proportionally.
- This is a mitigation, not the structural fix. Rendering still happens on a metered central
  resource. Moving rasterization to the client (server-authorized HTML or SVG rendered in the
  requesting browser) removes the bottleneck entirely and is tracked separately.
- No D1 migration, schema change, dependency, lockfile, mail format, authentication rule or binding
  change is required.
