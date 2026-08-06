import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  cleanupExpiredMarketData,
  fetchEquityDailyContext,
  isCompletedSession,
  fetchSecFilings,
  fetchSecInstrument,
  getCachedPublicData,
  getMarketContext,
  marketContextHealth,
  normalizeMarketSymbol
} from "../src/market-context";
import type { AppEnv, SessionContext } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const session = {
  id: "ses_market_context",
  csrfTokenHash: "csrf",
  absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: {
    id: "usr_market_context",
    username: "market-user",
    displayName: "Market User",
    branchName: "Market Branch",
    role: "USER",
    credentialVersion: 1,
    passwordChangeRequired: false,
    passwordResetExpiresAt: null
  }
} satisfies SessionContext;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function publicDataFetcher(onRequest?: (url: URL) => void): typeof fetch {
  return (async input => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    onRequest?.(url);
    if (url.pathname.endsWith("/company_tickers_exchange.json")) {
      return jsonResponse({
        fields: ["cik", "name", "ticker", "exchange"],
        data: [
          [320193, "Apple Inc.", "AAPL", "Nasdaq"],
          [789019, "Microsoft Corp.", "MSFT", "Nasdaq"]
        ]
      });
    }
    if (url.hostname === "data.sec.gov") {
      return jsonResponse({
        filings: {
          recent: {
            form: ["10-Q", "8-K", "4", "10-K", "8-K", "10-Q", "8-K"],
            filingDate: ["2026-07-25", "2026-07-24", "2026-07-23", "2026-04-30", "2026-04-29", "2026-01-31", "bad"],
            accessionNumber: [
              "0000320193-26-000001",
              "0000320193-26-000002",
              "0000320193-26-000003",
              "0000320193-26-000004",
              "0000320193-26-000005",
              "0000320193-26-000006",
              "bad"
            ],
            primaryDocument: ["a10q.htm", "a8k.htm", "form4.xml", "a10k.htm", "a8k2.htm", "a10q2.htm", "../unsafe"]
          }
        }
      });
    }
    if (url.hostname === "www.alphavantage.co" && url.searchParams.get("function") === "TIME_SERIES_DAILY") {
      const symbol = url.searchParams.get("symbol") ?? "AAPL";
      return jsonResponse({
        "Meta Data": { "2. Symbol": symbol, "3. Last Refreshed": "2026-07-28" },
        "Time Series (Daily)": Object.fromEntries(Array.from({ length: 25 }, (_, index) => {
          const date = new Date(Date.UTC(2026, 6, 28 - index)).toISOString().slice(0, 10);
          const close = 200 - index;
          return [date, {
            "1. open": String(close - 1),
            "2. high": String(close + 2),
            "3. low": String(close - 3),
            "4. close": String(close),
            "5. volume": String(2_000_000 - index * 10_000)
          }];
        }))
      });
    }
    if (url.hostname === "api.twelvedata.com") {
      return jsonResponse({
        status: "ok",
        values: Array.from({ length: 25 }, (_, index) => {
          const date = new Date(Date.UTC(2026, 6, 28 - index)).toISOString().slice(0, 10);
          const close = 300 - index;
          return {
            datetime: date,
            open: String(close - 1),
            high: String(close + 2),
            low: String(close - 3),
            close: String(close),
            volume: String(3_000_000 - index * 10_000)
          };
        })
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

// Only the hosts named here answer; everything else 404s, so a test can force one provider to fail.
function equityFetcher(allowed: ("twelve" | "alpha")[]): typeof fetch {
  const inner = publicDataFetcher();
  return (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const host = url.hostname;
    if (host === "api.twelvedata.com" && !allowed.includes("twelve")) return new Response("no", { status: 500 });
    if (host === "www.alphavantage.co" && !allowed.includes("alpha")) return new Response("no", { status: 500 });
    return inner(input, init);
  }) as typeof fetch;
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("official public market context", () => {
  it("requires an authenticated application session", async () => {
    const contextResponse = await worker.fetch(
      new Request("https://api.yintsun66.com/api/v1/market/instruments/AAPL/context"),
      testEnv,
      createExecutionContext()
    );
    expect(contextResponse.status).toBe(401);
    expect(await contextResponse.json()).toMatchObject({ error: { code: "AUTHENTICATION_REQUIRED" } });
    // ADR 0024 removed the market-ideas endpoint. Unauthenticated callers still stop at the
    // session gate, so the meaningful check is that the admin health route stays ADMIN-gated.
    const healthResponse = await worker.fetch(
      new Request("https://api.yintsun66.com/api/v1/admin/market-context-health"),
      testEnv,
      createExecutionContext()
    );
    expect(healthResponse.status).toBe(401);
    expect(await healthResponse.json()).toMatchObject({ error: { code: "AUTHENTICATION_REQUIRED" } });
  });

  it("normalizes only safe market symbols", () => {
    expect(normalizeMarketSymbol(" brk/b ")).toBe("BRK-B");
    expect(() => normalizeMarketSymbol("AAPL?rfq=private")).toThrowError();
  });

  it("preserves the Cloudflare runtime receiver when using the default fetcher", async () => {
    const delegate = publicDataFetcher();
    let redirectMode: RequestInit["redirect"];
    vi.stubGlobal("fetch", function runtimeAwareFetch(
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect this reference");
      }
      redirectMode = init?.redirect;
      return delegate(input, init);
    });
    try {
      const instrument = await fetchSecInstrument(testEnv, "AAPL");
      expect(instrument.data.ticker).toBe("AAPL");
      expect(redirectMode).toBe("manual");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects upstream redirects without following them", async () => {
    const redirectingFetcher = (async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.com/not-allowed" }
    })) as typeof fetch;
    await expect(fetchSecInstrument(testEnv, "AAPL", redirectingFetcher)).rejects.toMatchObject({
      status: 503,
      code: "UPSTREAM_REDIRECT_REJECTED"
    });
  });

  it("normalizes SEC instrument and the latest five supported filings", async () => {
    const instrument = await fetchSecInstrument(testEnv, "AAPL", publicDataFetcher());
    expect(instrument.data).toMatchObject({
      companyName: "Apple Inc.",
      cik: "0000320193",
      ticker: "AAPL",
      exchange: "Nasdaq"
    });
    const filings = await fetchSecFilings(testEnv, instrument.data, publicDataFetcher());
    expect(filings.data.recentFilings).toHaveLength(5);
    expect(filings.data.recentFilings.map(item => item.form)).toEqual(["10-Q", "8-K", "10-K", "8-K", "10-Q"]);
    expect(filings.data.recentFilings.every(item => item.officialUrl.startsWith("https://www.sec.gov/Archives/"))).toBe(true);
  });

  // A bar for a session still in progress carries the last traded price in its close field. Using it
  // as "the previous close" is the failure this rule exists to prevent, and it would be invisible:
  // the number looks perfectly plausible.
  it("treats a session as closed only after the New York close", () => {
    const duringSession = new Date("2026-07-28T18:00:00.000Z"); // 14:00 New York
    expect(isCompletedSession("2026-07-28", duringSession)).toBe(false);
    expect(isCompletedSession("2026-07-27", duringSession)).toBe(true);

    const afterClose = new Date("2026-07-28T20:30:00.000Z"); // 16:30 New York
    expect(isCompletedSession("2026-07-28", afterClose)).toBe(true);

    // A Taipei morning is the previous New York evening: the session that just closed is dated
    // *today* in New York, which a naive "previous calendar day" rule would skip.
    const taipeiMorning = new Date("2026-07-29T01:00:00.000Z"); // 09:00 Taipei, 21:00 New York 07-28
    expect(isCompletedSession("2026-07-28", taipeiMorning)).toBe(true);
    expect(isCompletedSession("2026-07-29", taipeiMorning)).toBe(false);
  });

  it("never returns an in-progress session as the previous close", async () => {
    // "Now" is inside the 2026-07-28 session, so that bar must be dropped and 07-27 used.
    const equity = await fetchEquityDailyContext(
      testEnv, "AAPL", equityFetcher(["alpha"]), new Date("2026-07-28T18:00:00.000Z")
    );
    expect(equity.data.tradingDate).toBe("2026-07-27");
    expect(equity.data.closePrice).toBe(199);
  });

  it("prefers the keyed provider, and records what the others said when it falls back", async () => {
    // No Twelve Data key is configured in the test environment, so the chain must fall through.
    const fallback = await fetchEquityDailyContext(testEnv, "AAPL", equityFetcher(["alpha"]));
    expect(fallback.data.provider).toBe("ALPHA_VANTAGE");
    expect(fallback.data.closePrice).toBe(200);
    expect(fallback.data.providerAttempts.join(" ")).toContain("TWELVE_DATA=TWELVE_DATA_NOT_CONFIGURED");

    const keyed = { ...testEnv, TWELVE_DATA_API_KEY: "twelvedatatestkey123" } as unknown as AppEnv;
    const viaTwelve = await fetchEquityDailyContext(keyed, "AAPL", equityFetcher(["twelve", "alpha"]));
    expect(viaTwelve.data.provider).toBe("TWELVE_DATA");
    expect(viaTwelve.data.closePrice).toBe(300);
    expect(viaTwelve.data.providerAttempts).toEqual([]);

    // Everything down: the caller gets one stable code, and the per-provider detail travels with it
    // so the stored diagnostic can name each failure instead of only "no price".
    await expect(fetchEquityDailyContext(testEnv, "AAPL", equityFetcher([])))
      .rejects.toMatchObject({ code: "EQUITY_DAILY_UNAVAILABLE" });
  });

  it("normalizes the previous close and derives daily market metrics", async () => {
    const equity = await fetchEquityDailyContext(testEnv, "AAPL", equityFetcher(["alpha"]));
    expect(equity.sourceAsOf).toBe("2026-07-28");
    expect(equity.data).toMatchObject({
      symbol: "AAPL",
      provider: "ALPHA_VANTAGE",
      tradingDate: "2026-07-28",
      closePrice: 200,
      priorTradingDate: "2026-07-27",
      priorClosePrice: 199,
      volume: 2_000_000
    });
    expect(equity.data.dailyChangePct).toBeCloseTo(0.5025);
    expect(equity.data.relativeVolume20d).toBeGreaterThan(1);
    expect(equity.data.realizedVolatility20dPct).toBeGreaterThan(0);
    expect(equity.data.range20dPct).toBeGreaterThan(0);
  });

  it("trims a copied provider key and rejects an invalid one before any upstream request", async () => {
    let observedKey = "";
    const alphaOnly = equityFetcher(["alpha"]);
    const trimmingFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.hostname === "www.alphavantage.co") observedKey = url.searchParams.get("apikey") ?? "";
      return alphaOnly(input, init);
    }) as typeof fetch;
    await fetchEquityDailyContext(
      { ...testEnv, ALPHA_VANTAGE_API_KEY: "  SYNTHETIC12345678\r\n" } as unknown as AppEnv,
      "AAPL",
      trimmingFetcher
    );
    expect(observedKey).toBe("SYNTHETIC12345678");

    // A malformed key must be rejected without ever being put on the wire. Only the provider's own
    // host is counted: the chain legitimately calls the earlier providers first.
    let alphaRequests = 0;
    await expect(fetchEquityDailyContext(
      { ...testEnv, ALPHA_VANTAGE_API_KEY: "not a valid key" } as unknown as AppEnv,
      "AAPL",
      (async input => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
        if (url.hostname === "www.alphavantage.co") alphaRequests += 1;
        return jsonResponse({});
      }) as typeof fetch
    )).rejects.toMatchObject({
      status: 503,
      code: "EQUITY_DAILY_UNAVAILABLE",
      fieldErrors: { providerAttempts: expect.stringContaining("ALPHA_VANTAGE=ALPHA_VANTAGE_KEY_INVALID_FORMAT") }
    });
    expect(alphaRequests).toBe(0);
  });

  it("treats an informational quota response as unavailable data and names the provider", async () => {
    const limitedFetcher = (async () => jsonResponse({
      Information: "Synthetic rate limit response that must not be exposed."
    })) as typeof fetch;
    await expect(fetchEquityDailyContext(testEnv, "AAPL", limitedFetcher)).rejects.toMatchObject({
      status: 503,
      code: "EQUITY_DAILY_UNAVAILABLE",
      fieldErrors: { providerAttempts: expect.stringContaining("ALPHA_VANTAGE=ALPHA_VANTAGE_RATE_LIMITED") }
    });
  });

  it("returns authenticated SEC and Alpha Vantage context and reuses shared fresh cache", async () => {
    const fetcher = publicDataFetcher();
    const first = await getMarketContext(
      new Request("https://api.yintsun66.com/api/v1/market/instruments/AAPL/context", {
        headers: { "cf-connecting-ip": "192.0.2.10" }
      }),
      testEnv,
      session,
      "AAPL",
      fetcher
    );
    const firstPayload = await first.json<Record<string, any>>();
    expect(firstPayload.marketContext.sec.status).toBe("FRESH");
    expect(firstPayload.marketContext.equityDaily.status).toBe("FRESH");
    // No Twelve Data key is configured in tests, so the chain falls through to the last provider.
    expect(firstPayload.marketContext.equityDaily.data.provider).toBe("ALPHA_VANTAGE");
    expect(firstPayload.marketContext.equityDaily.data.closePrice).toBe(200);
    // The deprecated alias must keep pointing at the same envelope until both sides are current.
    expect(firstPayload.marketContext.alphaVantage).toEqual(firstPayload.marketContext.equityDaily);

    const unavailableFetcher = (async () => {
      throw new Error("network must not be used for a fresh cache hit");
    }) as typeof fetch;
    const second = await getMarketContext(
      new Request("https://api.yintsun66.com/api/v1/market/instruments/AAPL/context", {
        headers: { "cf-connecting-ip": "192.0.2.11" }
      }),
      testEnv,
      session,
      "AAPL",
      unavailableFetcher
    );
    const secondPayload = await second.json<Record<string, any>>();
    expect(secondPayload.marketContext.sec.data.company.ticker).toBe("AAPL");
    expect(secondPayload.marketContext.alphaVantage.data.symbol).toBe("AAPL");
  });

  it("keeps Alpha Vantage available and retains a safe diagnostic when SEC fails", async () => {
    await testEnv.DB.prepare(
      "DELETE FROM public_data_cache WHERE cache_key IN ('sec:instrument:v1:NVDA', 'equity:daily:v2:NVDA')"
    ).run();
    const delegate = publicDataFetcher();
    let alphaRequests = 0;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith("/company_tickers_exchange.json")) {
        throw new TypeError("Illegal invocation: function called with incorrect this reference");
      }
      if (url.hostname === "www.alphavantage.co") alphaRequests += 1;
      return delegate(input, init);
    }) as typeof fetch;
    const response = await getMarketContext(
      new Request("https://api.yintsun66.com/api/v1/market/instruments/NVDA/context", {
        headers: { "cf-connecting-ip": "192.0.2.20" }
      }),
      testEnv,
      {
        ...session,
        id: "ses_market_sec_failure",
        user: { ...session.user, id: "usr_market_sec_failure" }
      },
      "NVDA",
      fetcher
    );
    const payload = await response.json<Record<string, any>>();
    expect(payload.marketContext.sec).toMatchObject({
      status: "UNAVAILABLE",
      errorCode: "UPSTREAM_RUNTIME_INVOCATION",
      data: null
    });
    expect(payload.marketContext.equityDaily.status).toBe("FRESH");
    expect(payload.marketContext.equityDaily.data.symbol).toBe("NVDA");
    // With no Twelve Data key configured, the chain reaches its last provider exactly once.
    expect(alphaRequests).toBe(1);

    const beforeCleanup = await testEnv.DB.prepare(
      `SELECT status, fetched_at, stale_until, updated_at
         FROM public_data_cache WHERE cache_key = 'sec:instrument:v1:NVDA'`
    ).first<{ status: string; fetched_at: string | null; stale_until: string; updated_at: string }>();
    expect(beforeCleanup).toMatchObject({ status: "ERROR", fetched_at: null });
    expect(Date.parse(beforeCleanup?.stale_until ?? "")).toBeGreaterThan(Date.parse(beforeCleanup?.updated_at ?? ""));

    await cleanupExpiredMarketData(testEnv);
    const afterCleanup = await testEnv.DB.prepare(
      "SELECT status FROM public_data_cache WHERE cache_key = 'sec:instrument:v1:NVDA'"
    ).first<{ status: string }>();
    expect(afterCleanup?.status).toBe("ERROR");
  });

  it("coalesces concurrent cache misses and falls back to stale data", async () => {
    let loaderCount = 0;
    const requests = Array.from({ length: 50 }, () => getCachedPublicData(testEnv, {
      cacheKey: "test:coalesce:v1",
      source: "SEC" as const,
      symbol: "TEST",
      dataType: "TEST",
      ttlSeconds: 60,
      staleSeconds: 60,
      loader: async () => {
        loaderCount += 1;
        await Promise.resolve();
        return { data: { value: 1 }, sourceAsOf: "2026-07-28" };
      }
    }));
    const results = await Promise.all(requests);
    expect(loaderCount).toBe(1);
    expect(results.every(item => item.status === "FRESH")).toBe(true);

    const now = Date.now();
    await testEnv.DB.prepare(
      `INSERT INTO public_data_cache
        (cache_key, source, symbol, data_type, normalized_payload_json, source_as_of,
         fetched_at, expires_at, stale_until, status, updated_at)
       VALUES (?, 'FRED', NULL, 'TEST', ?, '2026-07-27', ?, ?, ?, 'FRESH', ?)`
    ).bind(
      "test:stale:v1",
      JSON.stringify({ value: 2 }),
      new Date(now - 120_000).toISOString(),
      new Date(now - 60_000).toISOString(),
      new Date(now + 60_000).toISOString(),
      new Date(now - 120_000).toISOString()
    ).run();
    let staleRefreshAttempts = 0;
    const staleOptions = {
      cacheKey: "test:stale:v1",
      source: "FRED" as const,
      symbol: null,
      dataType: "TEST",
      ttlSeconds: 60,
      staleSeconds: 60,
      loader: async () => {
        staleRefreshAttempts += 1;
        throw new Error("synthetic upstream failure");
      }
    };
    const stale = await getCachedPublicData(testEnv, staleOptions);
    expect(stale).toMatchObject({
      status: "STALE",
      isStale: true,
      errorCode: "UPSTREAM_UNAVAILABLE",
      data: { value: 2 }
    });
    const staleAgain = await getCachedPublicData(testEnv, staleOptions);
    expect(staleAgain.status).toBe("STALE");
    expect(staleRefreshAttempts).toBe(1);
  });

  it("serves 50 concurrent users from one shared SEC refresh path", async () => {
    let secRequests = 0;
    const fetcher = publicDataFetcher(url => {
      if (url.hostname.endsWith("sec.gov")) secRequests += 1;
    });
    const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => {
      const concurrentSession = {
        ...session,
        id: `ses_market_load_${index}`,
        user: { ...session.user, id: `usr_market_load_${index}` }
      };
      return getMarketContext(
        new Request("https://api.yintsun66.com/api/v1/market/instruments/MSFT/context", {
          headers: { "cf-connecting-ip": `198.51.100.${index + 1}` }
        }),
        testEnv,
        concurrentSession,
        "MSFT",
        fetcher
      );
    }));
    const payloads = await Promise.all(responses.map(response => response.json<Record<string, any>>()));
    expect(payloads).toHaveLength(50);
    expect(payloads.every(payload => payload.marketContext.sec.data.company.ticker === "MSFT")).toBe(true);
    expect(secRequests).toBe(2);
  });

  it("stops before the provider request when the configured daily Alpha Vantage budget is exhausted", async () => {
    const usageDate = new Date().toISOString().slice(0, 10);
    await testEnv.DB.prepare(
      `INSERT INTO market_provider_daily_usage
        (provider, usage_date, request_count, updated_at)
       VALUES ('ALPHA_VANTAGE', ?, 2, ?)
       ON CONFLICT(provider, usage_date) DO UPDATE SET
         request_count = 2,
         updated_at = excluded.updated_at`
    ).bind(usageDate, new Date().toISOString()).run();
    let alphaRequests = 0;
    await expect(fetchEquityDailyContext(
      { ...testEnv, ALPHA_VANTAGE_DAILY_REQUEST_LIMIT: "2" } as unknown as AppEnv,
      "AAPL",
      (async input => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
        if (url.hostname === "www.alphavantage.co") alphaRequests += 1;
        return jsonResponse({});
      }) as typeof fetch
    )).rejects.toMatchObject({
      status: 503,
      code: "EQUITY_DAILY_UNAVAILABLE",
      fieldErrors: {
        providerAttempts: expect.stringContaining("ALPHA_VANTAGE=ALPHA_VANTAGE_DAILY_BUDGET_EXHAUSTED")
      }
    });
    // The budget is consulted before the request, so an exhausted day costs no upstream call.
    expect(alphaRequests).toBe(0);
    await testEnv.DB.prepare(
      "UPDATE market_provider_daily_usage SET request_count = 0 WHERE provider = 'ALPHA_VANTAGE' AND usage_date = ?"
    ).bind(usageDate).run();
  });

  it("enforces the configured per-user request limit without storing the raw user or IP", async () => {
    const limitedSession = {
      ...session,
      id: "ses_market_limited",
      user: { ...session.user, id: "usr_market_limited" }
    };
    for (let index = 0; index < 30; index += 1) {
      const response = await getMarketContext(
        new Request("https://api.yintsun66.com/api/v1/market/instruments/AAPL/context", {
          headers: { "cf-connecting-ip": `203.0.113.${index + 1}` }
        }),
        testEnv,
        limitedSession,
        "AAPL",
        publicDataFetcher()
      );
      expect(response.status).toBe(200);
    }
    await expect(getMarketContext(
      new Request("https://api.yintsun66.com/api/v1/market/instruments/AAPL/context", {
        headers: { "cf-connecting-ip": "203.0.113.99" }
      }),
      testEnv,
      limitedSession,
      "AAPL",
      publicDataFetcher()
    )).rejects.toMatchObject({
      status: 429,
      code: "MARKET_CONTEXT_RATE_LIMITED"
    });
    const rawIdentity = await testEnv.DB.prepare(
      "SELECT request_key FROM market_context_rate_limits WHERE request_key LIKE ? OR request_key LIKE ?"
    ).bind("%usr_market_limited%", "%203.0.113.%").all();
    expect(rawIdentity.results).toEqual([]);
  });

  it("reports safe health counts, and keeps a recent failure while removing an old one", async () => {
    const expired = new Date(Date.now() - 1_200_000).toISOString();
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
    await testEnv.DB.batch([
      // A failure recorded twenty minutes ago. Its retry window has passed, so the old sweep would
      // have deleted it — and that is precisely how a provider could fail for weeks while leaving
      // nothing to diagnose.
      testEnv.DB.prepare(
        `INSERT INTO public_data_cache
          (cache_key, source, symbol, data_type, normalized_payload_json, expires_at,
           stale_until, status, last_error_code, updated_at)
         VALUES ('test:recent-error:v1', 'EQUITY_DAILY', 'NEW', 'TEST', '{}', ?, ?, 'ERROR', 'EQUITY_DAILY_UNAVAILABLE (TWELVE_DATA=TWELVE_DATA_RATE_LIMITED)', ?)`
      ).bind(expired, expired, expired),
      // A failure old enough that keeping it serves no one.
      testEnv.DB.prepare(
        `INSERT INTO public_data_cache
          (cache_key, source, symbol, data_type, normalized_payload_json, expires_at,
           stale_until, status, updated_at)
         VALUES ('test:expired:v1', 'SEC', 'OLD', 'TEST', '{}', ?, ?, 'ERROR', ?)`
      ).bind(longAgo, longAgo, longAgo),
      testEnv.DB.prepare(
        `INSERT INTO market_context_rate_limits
          (request_key, scope, window_started_at, request_count, updated_at)
         VALUES ('old-rate-limit', 'IP', ?, 1, ?)`
      ).bind(expired, expired)
    ]);
    const before = await marketContextHealth(testEnv);
    expect(before.expiredRows).toBeGreaterThan(0);
    expect(before.providerUsageToday).toEqual(expect.any(Array));

    const cleaned = await cleanupExpiredMarketData(testEnv);
    expect(cleaned.cacheRows).toBeGreaterThan(0);
    expect(cleaned.rateLimitRows).toBeGreaterThan(0);

    const kept = await testEnv.DB.prepare(
      "SELECT last_error_code FROM public_data_cache WHERE cache_key = 'test:recent-error:v1'"
    ).first<{ last_error_code: string }>();
    // The whole point: the reason survives long enough to be read.
    expect(kept?.last_error_code).toContain("TWELVE_DATA=TWELVE_DATA_RATE_LIMITED");
    const dropped = await testEnv.DB.prepare(
      "SELECT cache_key FROM public_data_cache WHERE cache_key = 'test:expired:v1'"
    ).first();
    expect(dropped).toBeNull();
  });
});
