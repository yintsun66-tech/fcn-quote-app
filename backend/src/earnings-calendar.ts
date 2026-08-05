import type { AppEnv } from "./types";

/**
 * Earnings-date advisory for quote underlyings.
 *
 * Advisory only. Nothing here may gate validation, dispatch, ranking or the quote image — a
 * provider outage must never stop someone sending an RFQ. The one thing it must not do is fail
 * silently: an operator who sees no warning has to be able to tell "no earnings in the window"
 * apart from "we could not find out", so the response distinguishes the two and the UI says which.
 *
 * One upstream request serves everyone. Finnhub's calendar returns every company in a date range
 * rather than one symbol at a time, so the window is fetched once, cached at the edge, and then
 * filtered per symbol. That keeps a 20-trade RFQ with 100 underlyings at one upstream call.
 */

const FINNHUB_BASE = "https://finnhub.io/api/v1/calendar/earnings";
const FETCH_TIMEOUT_MS = 8_000;
const EDGE_CACHE_SECONDS = 6 * 60 * 60;

/** Bloomberg exchange suffixes that trade on a US venue and use a bare Finnhub ticker. */
const US_SUFFIXES = new Set(["UN", "UW", "UA", "UP", "UQ", "UR", "UV", "UF"]);
/** Suffixes Finnhub can express, mapped to its symbol form. Anything absent is reported as
 *  unsupported rather than treated as "no earnings". */
const SUFFIX_TO_FINNHUB: Record<string, { suffix: string; market: EarningsMarket }> = {
  JT: { suffix: ".T", market: "JP" },
};

export type EarningsMarket = "US" | "JP";

export interface EarningsSymbol {
  bbgCode: string;
  ticker: string;
  finnhubSymbol: string;
  market: EarningsMarket;
}

export interface EarningsHit {
  bbgCode: string;
  finnhubSymbol: string;
  market: EarningsMarket;
  /** Announcement date as reported, YYYY-MM-DD in the listing market's local calendar. */
  date: string;
  /** "bmo" before market open, "amc" after market close, "dmh" during hours, or "" if unknown. */
  hour: string;
}

export interface EarningsLookup {
  /** False when the provider could not be reached or is not configured. Never conflate with []. */
  available: boolean;
  hits: EarningsHit[];
  /** BBG codes whose exchange this provider cannot express at all, e.g. HK, FP, GY. */
  unsupported: string[];
  /**
   * BBG codes that map cleanly but whose market window failed, so nothing is known about them.
   * Kept apart from `unsupported` because the two need different answers: an unsupported exchange
   * will never work through this provider, whereas these would work on a plan that includes the
   * market. Reporting them together would make a billing problem look permanent.
   */
  unchecked: string[];
  /** Rows the provider returned for the windows that succeeded, before symbol matching. Lets an
   *  empty result be told apart from an empty upstream calendar. */
  rowsSeen: number;
  errorCode?: string;
}

/**
 * Splits a BBG code into a Finnhub symbol. `AAPL UW` -> `AAPL`; `7203 JT` -> `7203.T`.
 * A bare ticker with no suffix is assumed US, which matches what the entry form produces before
 * the exchange lookup has run.
 */
export function toEarningsSymbol(bbgCode: string): EarningsSymbol | null {
  const raw = String(bbgCode ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const [ticker, suffix] = raw.split(" ");
  if (!ticker) return null;
  if (!suffix || US_SUFFIXES.has(suffix)) {
    return { bbgCode: raw, ticker, finnhubSymbol: ticker, market: "US" };
  }
  const mapped = SUFFIX_TO_FINNHUB[suffix];
  if (!mapped) return null;
  return { bbgCode: raw, ticker, finnhubSymbol: `${ticker}${mapped.suffix}`, market: mapped.market };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Today's calendar date in a listing market, which is the whole point of doing this per market.
 * A Taipei morning is still the previous evening in New York, so a server-side date would put a US
 * underlying a day ahead and silently miss or invent a warning — the same class of mistake the
 * previous-close path already had to be corrected for.
 */
export function marketToday(market: EarningsMarket, now: Date): string {
  const timeZone = market === "JP" ? "Asia/Tokyo" : "America/New_York";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Inclusive window: today plus the following two days, in the market's own calendar. */
export function marketWindow(market: EarningsMarket, now: Date, days = 3): { from: string; to: string } {
  const from = marketToday(market, now);
  return { from, to: addDays(from, days - 1) };
}

interface FinnhubEarningsRow {
  date?: unknown;
  symbol?: unknown;
  hour?: unknown;
}

function normalizeRows(payload: unknown): Map<string, { date: string; hour: string }> {
  const out = new Map<string, { date: string; hour: string }>();
  const rows = (payload as { earningsCalendar?: unknown })?.earningsCalendar;
  if (!Array.isArray(rows)) return out;
  for (const row of rows as FinnhubEarningsRow[]) {
    const symbol = typeof row?.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    const date = typeof row?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : "";
    if (!symbol || !date) continue;
    const hour = typeof row?.hour === "string" ? row.hour : "";
    // A symbol can appear more than once across a window; the earliest date is the one that matters.
    const seen = out.get(symbol);
    if (!seen || date < seen.date) out.set(symbol, { date, hour });
  }
  return out;
}

/**
 * Fetches one calendar window. Cached at the edge so that repeated lookups across a session, and
 * across users, cost one upstream request per window per TTL.
 *
 * The cache key deliberately excludes the API key: it is a URL, and a URL that carried the token
 * would be a token written into a cache the whole account can read.
 */
async function fetchWindow(
  env: AppEnv,
  from: string,
  to: string,
  international: boolean,
): Promise<Map<string, { date: string; hour: string }>> {
  const token = String(env.FINNHUB_API_KEY ?? "").trim();
  if (!token) throw new Error("NOT_CONFIGURED");

  const cacheKey = new Request(
    `https://earnings-cache.internal/${international ? "intl" : "us"}/${from}/${to}`,
    { method: "GET" },
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return normalizeRows(await cached.json());

  const url = new URL(FINNHUB_BASE);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  if (international) url.searchParams.set("international", "true");
  url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const body = await response.text();

  await cache.put(
    cacheKey,
    new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${EDGE_CACHE_SECONDS}`,
      },
    }),
  );
  return normalizeRows(JSON.parse(body));
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message === "NOT_CONFIGURED") return "NOT_CONFIGURED";
  if (/^HTTP_\d+$/.test(message)) return message;
  if (/timed? ?out|abort/i.test(message)) return "TIMEOUT";
  return "FETCH_FAILED";
}

/**
 * Resolves the advisory for a set of BBG codes.
 *
 * Japanese symbols need Finnhub's `international` flag, which may not be included in every plan.
 * When the international window fails but the US one succeeds the US answer is still returned and
 * the Japanese codes are reported as unsupported — a partial answer beats discarding both, as long
 * as the caller can see which half is missing.
 */
export async function lookupEarnings(
  env: AppEnv,
  bbgCodes: string[],
  now: Date,
  days = 3,
): Promise<EarningsLookup> {
  const unsupported: string[] = [];
  const wanted: EarningsSymbol[] = [];
  for (const code of bbgCodes) {
    const parsed = toEarningsSymbol(code);
    if (!parsed) {
      const raw = String(code ?? "").trim().toUpperCase();
      if (raw) unsupported.push(raw);
      continue;
    }
    wanted.push(parsed);
  }
  if (!wanted.length) return { available: true, hits: [], unsupported, unchecked: [], rowsSeen: 0 };

  const markets = new Set(wanted.map(item => item.market));
  const hits: EarningsHit[] = [];
  const unchecked: string[] = [];
  let anyWindowSucceeded = false;
  let rowsSeen = 0;
  let lastError = "";

  for (const market of markets) {
    const { from, to } = marketWindow(market, now, days);
    try {
      const rows = await fetchWindow(env, from, to, market !== "US");
      anyWindowSucceeded = true;
      rowsSeen += rows.size;
      for (const item of wanted) {
        if (item.market !== market) continue;
        const row = rows.get(item.finnhubSymbol.toUpperCase());
        if (!row) continue;
        if (row.date < from || row.date > to) continue;
        hits.push({
          bbgCode: item.bbgCode,
          finnhubSymbol: item.finnhubSymbol,
          market,
          date: row.date,
          hour: row.hour,
        });
      }
    } catch (error) {
      lastError = failureCode(error);
      for (const item of wanted) {
        if (item.market === market) unchecked.push(item.bbgCode);
      }
    }
  }

  if (!anyWindowSucceeded) {
    return {
      available: false,
      hits: [],
      unsupported,
      unchecked,
      rowsSeen: 0,
      errorCode: lastError || "FETCH_FAILED",
    };
  }
  return {
    available: true,
    hits,
    unsupported,
    unchecked,
    rowsSeen,
    ...(lastError ? { errorCode: lastError } : {}),
  };
}
