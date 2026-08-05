import { jsonResponse } from "./http";
import { LOOKAHEAD_DAYS, LOOKBACK_DAYS, lookupEarnings } from "./earnings-calendar";
import { PUBLIC_ORIGINS } from "./follow-board";
import type { AppEnv } from "./types";

/** Caps the fan-out: 20 trades x 5 underlyings is the documented maximum an RFQ can carry. */
const MAX_SYMBOLS = 100;

export const EARNINGS_PUBLIC_PATH = "/api/v1/public/market/earnings";

/** Reported so the form can describe the window it is showing without hard-coding it twice. */
const WINDOW = { back: LOOKBACK_DAYS, forward: LOOKAHEAD_DAYS };

/**
 * CORS for the static build, which has no backend of its own and must call this across origins.
 *
 * Worth being honest about what this does and does not do: it stops another site's browser
 * JavaScript from reading the response, and stops nothing else — any scripted caller can request
 * this directly. The endpoint is public in practice, which is acceptable only because of what it
 * is: public earnings dates, carrying no RFQ, quote or user data, and with upstream cost bounded by
 * the edge cache rather than by caller volume.
 */
export function earningsCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin && PUBLIC_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  return headers;
}

export function earningsOptions(request: Request): Response {
  return new Response(null, { status: 204, headers: earningsCorsHeaders(request) });
}

/**
 * GET /api/v1/market/earnings?symbols=AAPL%20UW,7203%20JT
 *
 * Advisory only, and behind the session because it exists for the entry form, which is only
 * reachable once signed in. It never fails the request: a provider outage returns
 * `available: false` with 200 so the form can say "could not check" instead of silently implying
 * an all-clear.
 */
export async function getEarningsAdvisory(request: Request, env: AppEnv): Promise<Response> {
  const cors = earningsCorsHeaders(request);
  const url = new URL(request.url);
  const raw = url.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) {
    return jsonResponse(
      { available: true, hits: [], unsupported: [], unchecked: [], window: WINDOW },
      200,
      cors,
    );
  }

  const result = await lookupEarnings(env, symbols, new Date());

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
    window: WINDOW,
    hits: result.hits,
    unsupported: result.unsupported,
    unchecked: result.unchecked,
    // A code, never the provider's raw message: that can echo the request, and the request
    // carries the API key.
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
  }, 200, cors);
}
