# ADR 0034: Earnings-date advisory on the entry form

- Status: Accepted
- Date: 2026-08-06

## Context

An underlying that reports earnings inside the quote window prices differently, and issuers may
decline to quote it at all. Operators were checking this by hand, or not at all.

## Decision

`GET /api/v1/market/earnings?symbols=...` returns, for each underlying, whether it reports earnings
today or in the following two days, in that listing market's own calendar. The entry form asks
after each BBG code resolves and shows an advisory. It is advisory only: nothing in validation,
dispatch, ranking or the quote image consults it, and a provider outage cannot stop an RFQ.

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
from twelve weeks ago backwards. It cannot answer a question about the next three days at all, so
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

Revisit if the window grows well beyond three days, if earnings dates are wanted for audit, or if
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
  previous-close path was corrected for. Tests pin one instant producing two different windows.
- Silence must never be ambiguous. `rowsSeen` reports how many companies the upstream calendar held
  before symbol matching, so "checked, nothing due" is distinguishable from "the calendar came back
  empty". A failed lookup says so on screen rather than showing nothing, because an operator reads
  an empty advisory as an all-clear.
- Only the Cloudflare mode has this. The static build has no backend to ask, and the advisory is
  absent there rather than silently inert.
- `FINNHUB_API_KEY` is optional. Absent, the advisory reports itself unavailable instead of
  reporting "no earnings".

## Operational note

`wrangler secret put` does not prompt when stdin is not a TTY — it reads stdin and will happily
store an **empty** secret, reporting success. Running it from a non-interactive shell can therefore
overwrite a live key with an empty string and look like it worked. Set secrets from a real terminal.
