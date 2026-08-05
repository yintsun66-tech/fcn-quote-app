import { jsonResponse } from "./http";
import { lookupEarnings } from "./earnings-calendar";
import type { AppEnv } from "./types";

/** Caps the fan-out: 20 trades x 5 underlyings is the documented maximum an RFQ can carry. */
const MAX_SYMBOLS = 100;

/**
 * GET /api/v1/market/earnings?symbols=AAPL%20UW,7203%20JT
 *
 * Advisory only, and behind the session because it exists for the entry form, which is only
 * reachable once signed in. It never fails the request: a provider outage returns
 * `available: false` with 200 so the form can say "could not check" instead of silently implying
 * an all-clear.
 */
export async function getEarningsAdvisory(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) {
    return jsonResponse({ available: true, hits: [], unsupported: [], unchecked: [], windowDays: 3 });
  }

  const result = await lookupEarnings(env, symbols, new Date(), 3);

  // A degraded advisory has to be visible from the outside. The project has already lost weeks to a
  // provider that failed quietly, so the outcome is logged whenever it is not a clean success —
  // codes and counts only, never the symbols a user typed and never anything derived from the key.
  // rowsSeen is the one that makes "checked, nothing due" distinguishable from "the upstream
  // calendar came back empty". Without it a zero-hit result reads the same either way, which is the
  // exact ambiguity this advisory exists to avoid.
  const shape = {
    requested: symbols.length,
    hits: result.hits.length,
    unsupported: result.unsupported.length,
    unchecked: result.unchecked.length,
    rowsSeen: result.rowsSeen,
  };
  if (!result.available || result.errorCode) {
    console.warn("earnings_advisory_degraded", {
      available: result.available,
      errorCode: result.errorCode ?? null,
      ...shape,
    });
  } else {
    console.log("earnings_advisory_ok", shape);
  }

  return jsonResponse({
    available: result.available,
    windowDays: 3,
    hits: result.hits,
    unsupported: result.unsupported,
    unchecked: result.unchecked,
    // A code, never the provider's raw message: that can echo the request, and the request
    // carries the API key.
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  });
}
