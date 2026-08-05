# ADR 0034: Earnings-date advisory on the entry form

- Status: Accepted
- Date: 2026-08-06

## Context

An underlying that reports earnings inside the quote window prices differently, and issuers may
decline to quote it at all. Operators were checking this by hand, or not at all.

## Decision

`GET /api/v1/market/earnings?symbols=...` returns, for each underlying, whether its earnings date
falls between yesterday and the day after tomorrow, in that listing market's own calendar. The entry
form asks after each BBG code resolves and shows an advisory. It is advisory only: nothing in
validation, dispatch, ranking or the quote image consults it, and a provider outage cannot stop an
RFQ.

### The window is asymmetric around today, and that is the point

`LOOKBACK_DAYS = 1`, `LOOKAHEAD_DAYS = 2`, reported to the client as `{ back, forward }` so the
shape is stated once rather than hard-coded on both sides.

It began as today plus the next two days, which quietly failed to cover what the warning text
already promised — 財報日前**後**. The day *after* an announcement is when a gap reprices the
underlying, so an underlying that reported last night is at least as risky to quote as one
reporting tomorrow, and it was invisible. Live check when the window widened: `AMD UW` returned
`2026-08-04`, `dayOffset -1`, `hour amc` — a result the original window could not see at all.

Each hit carries `dayOffset` (-1 yesterday through 2), and the form labels it
昨日已發布／今日／明日／後日. With the window reaching backwards, an announcement already made and
one still to come call for different decisions, and a bare date leaves the operator to work that out
against a market calendar that is not the one on their wall — the US date is a day behind Taipei for
much of the day.

`dayOffset` compares calendar dates parsed at UTC midnight instead of subtracting local times. A
daylight-saving boundary makes a local-time difference 23 or 25 hours, which rounds to the wrong
day; a test pins 2026-11-01.

### Provider: Finnhub, and what its free tier does not include

Measured rather than assumed, from the Worker:

| Provider | US | Japan | Verdict |
| --- | --- | --- | --- |
| Twelve Data (key already held) | yes | unknown | `/earnings_calendar` returns 403 below the *grow* plan |
| Finnhub free | yes | **no** | `international=true` returns **HTTP 401** on the same key that succeeds without it |
| Nasdaq keyless endpoint | yes | no | Undocumented internal endpoint; rejected, see below |
| J-Quants (JPX official, free) | no | **none** | Free tier serves 12 weeks ago back to 2y12w — it cannot see the future at all |

The Japanese failure is a plan boundary, not a broken key: the same key, the same endpoint and the
same window succeed without `international=true` and 401 with it.

J-Quants is worth spelling out because it looks like the obvious Japanese answer and is not. It is
JPX's own API and its free tier does include the earnings-date endpoint — but the free window runs
from twelve weeks ago backwards. It cannot answer a question about the days around today at all, so
it is not partial coverage for this feature; it is none. Its other limits (next business day only,
and only 3月期/9月期 companies) never come into play. A paid J-Quants tier would remove the delay
and would be the authoritative Japanese source if this is ever funded.

Japanese underlyings are therefore reported as **unchecked**, kept separate from **unsupported**.
They are different answers — an unsupported exchange (HK, FP, GY) will never work through this
provider, whereas an unchecked one only needs a plan covering that market. Merging them would make
a billing problem look permanent.

### Caching at the edge, not in D1

Finnhub's calendar returns every company in a date range, so one upstream request answers every
symbol. A 20-trade RFQ with 100 underlyings costs one call; the Cache API then serves the window
for six hours. `public_data_cache` was not extended: its `source` CHECK constraint would need a
migration, and the call volume does not justify a schedule, a table and a cleanup path.

Revisit if the window grows well beyond a few days, if earnings dates are wanted for audit, or if
peak-season payloads make the first lookup slow. The trigger would be latency, not quota — the free
tier allows 60 calls a minute and this design uses a handful a day.

### The Nasdaq endpoint was rejected on principle

`api.nasdaq.com/api/calendar/earnings` needs no key and returned real data from a developer
machine. That is exactly the shape of the Yahoo failure this repository already recorded: 200 to a
residential address, 429 to Cloudflare's shared egress, so every local test passed and every
production request failed. An undocumented internal endpoint with no service commitment is not a
dependency worth taking for an advisory.

## Consequences

- Windows are computed per market: `America/New_York` for US listings, `Asia/Tokyo` for Japanese
  ones. A Taipei morning is the previous evening in New York, so a server-side date would shift the
  US window by a day and silently invent or miss a warning — the same class of error the
  previous-close path was corrected for. Tests pin one instant producing two different windows
  (`2026-08-04..07` for US, `2026-08-05..08` for Japan) and month boundaries in both directions.
- Silence must never be ambiguous. `rowsSeen` reports how many companies the upstream calendar held
  before symbol matching, so "checked, nothing due" is distinguishable from "the calendar came back
  empty". A failed lookup says so on screen rather than showing nothing, because an operator reads
  an empty advisory as an all-clear.
- Both builds have this, and run the same client (`earnings-advisory.mjs`, loaded unconditionally
  by `index.html`). Putting it in `backend-client.js` was tried first and rejected: that file only
  activates in Cloudflare mode, so the static build would have shipped the code and never run it —
  a feature that is present and permanently silent is worse than one that is absent, because an
  empty advisory reads as an all-clear.
- Serving the static build meant a session-free endpoint: `GET /api/v1/public/market/earnings`,
  ahead of `requireSession`, CORS limited to `PUBLIC_ORIGINS`. That CORS is not access control — it
  stops another site's browser JavaScript and nothing else, and a scripted caller with no `Origin`
  header gets a normal 200. The endpoint is public in practice, which holds only while the response
  stays public market data with an upstream cost bounded by the edge cache. If it ever returns
  anything derived from an RFQ, an account or a quote, it goes back behind the session.
- `FINNHUB_API_KEY` is optional. Absent, the advisory reports itself unavailable instead of
  reporting "no earnings".

## Operational note

`wrangler secret put` does not prompt when stdin is not a TTY — it reads stdin and will happily
store an **empty** secret, reporting success. Running it from a non-interactive shell can therefore
overwrite a live key with an empty string and look like it worked. Set secrets from a real terminal.
