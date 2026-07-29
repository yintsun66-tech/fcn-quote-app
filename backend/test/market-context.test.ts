import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import {
  cleanupExpiredMarketData,
  fetchFredContext,
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
    credentialVersion: 1
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
    if (url.hostname === "api.stlouisfed.org" && url.pathname === "/fred/series") {
      const id = url.searchParams.get("series_id");
      return jsonResponse({
        seriess: [{
          id,
          title: `${id} synthetic title`,
          units: id === "VIXCLS" ? "Index" : "Percent",
          units_short: id === "VIXCLS" ? "Index" : "%"
        }]
      });
    }
    if (url.hostname === "api.stlouisfed.org" && url.pathname === "/fred/series/observations") {
      return jsonResponse({
        observations: [
          { date: "2026-07-25", value: "." },
          { date: "2026-07-24", value: "4.25" },
          { date: "2026-07-23", value: "4.10" }
        ]
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("official public market context", () => {
  it("requires an authenticated application session", async () => {
    const response = await worker.fetch(
      new Request("https://api.yintsun66.com/api/v1/market/instruments/AAPL/context"),
      testEnv,
      createExecutionContext()
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTHENTICATION_REQUIRED" } });
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

  it("normalizes FRED latest, prior and change without treating missing observations as zero", async () => {
    const fred = await fetchFredContext(testEnv, publicDataFetcher());
    expect(fred.data.series).toHaveLength(3);
    expect(fred.data.series[0]).toMatchObject({
      observationDate: "2026-07-24",
      value: 4.25,
      previousObservationDate: "2026-07-23",
      previousValue: 4.1
    });
    expect(fred.data.series[0]?.change).toBeCloseTo(0.15);
  });

  it("trims a copied FRED key and rejects an invalid key before any upstream request", async () => {
    let observedKey = "";
    const trimmingFetcher = publicDataFetcher(url => {
      if (url.hostname === "api.stlouisfed.org") observedKey = url.searchParams.get("api_key") ?? "";
    });
    await fetchFredContext(
      { ...testEnv, FRED_API_KEY: "  abcdefghijklmnopqrstuvwxyz123456\r\n" },
      trimmingFetcher
    );
    expect(observedKey).toBe("abcdefghijklmnopqrstuvwxyz123456");

    let requestCount = 0;
    await expect(fetchFredContext(
      { ...testEnv, FRED_API_KEY: "not-a-valid-key" },
      (async () => {
        requestCount += 1;
        return jsonResponse({});
      }) as typeof fetch
    )).rejects.toMatchObject({
      status: 503,
      code: "FRED_KEY_INVALID_FORMAT"
    });
    expect(requestCount).toBe(0);
  });

  it("retries one transient FRED edge failure and avoids parallel upstream requests", async () => {
    const delegate = publicDataFetcher();
    let requestCount = 0;
    let activeRequests = 0;
    let maximumConcurrentRequests = 0;
    const transientFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1;
      activeRequests += 1;
      maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
      try {
        if (requestCount === 1) return new Response("temporary edge failure", { status: 520 });
        return await delegate(input, init);
      } finally {
        activeRequests -= 1;
      }
    }) as typeof fetch;

    const fred = await fetchFredContext(testEnv, transientFetcher);
    expect(fred.data.series).toHaveLength(3);
    expect(requestCount).toBe(7);
    expect(maximumConcurrentRequests).toBe(1);
  });

  it("returns authenticated SEC and FRED context and reuses shared fresh cache", async () => {
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
    expect(firstPayload.marketContext.fred.status).toBe("FRESH");

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
    expect(secondPayload.marketContext.fred.data.series).toHaveLength(3);
  });

  it("keeps FRED available and retains a safe diagnostic when SEC fails", async () => {
    await testEnv.DB.prepare(
      "DELETE FROM public_data_cache WHERE cache_key IN ('sec:instrument:v1:NVDA', 'fred:macro:v1')"
    ).run();
    const delegate = publicDataFetcher();
    let fredRequests = 0;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith("/company_tickers_exchange.json")) {
        throw new TypeError("Illegal invocation: function called with incorrect this reference");
      }
      if (url.hostname === "api.stlouisfed.org") fredRequests += 1;
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
    expect(payload.marketContext.fred.status).toBe("FRESH");
    expect(payload.marketContext.fred.data.series).toHaveLength(3);
    expect(fredRequests).toBe(6);

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
    const stale = await getCachedPublicData(testEnv, {
      cacheKey: "test:stale:v1",
      source: "FRED",
      symbol: null,
      dataType: "TEST",
      ttlSeconds: 60,
      staleSeconds: 60,
      loader: async () => {
        throw new Error("synthetic upstream failure");
      }
    });
    expect(stale).toMatchObject({
      status: "STALE",
      isStale: true,
      errorCode: "UPSTREAM_UNAVAILABLE",
      data: { value: 2 }
    });
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

  it("reports safe health counts and removes only expired cache/rate-limit rows", async () => {
    const expired = new Date(Date.now() - 1_200_000).toISOString();
    await testEnv.DB.prepare(
      `INSERT INTO public_data_cache
        (cache_key, source, symbol, data_type, normalized_payload_json, expires_at,
         stale_until, status, updated_at)
       VALUES ('test:expired:v1', 'SEC', 'OLD', 'TEST', '{}', ?, ?, 'ERROR', ?)`
    ).bind(expired, expired, expired).run();
    await testEnv.DB.prepare(
      `INSERT INTO market_context_rate_limits
        (request_key, scope, window_started_at, request_count, updated_at)
       VALUES ('old-rate-limit', 'IP', ?, 1, ?)`
    ).bind(expired, expired).run();
    const before = await marketContextHealth(testEnv);
    expect(before.expiredRows).toBeGreaterThan(0);
    const cleaned = await cleanupExpiredMarketData(testEnv);
    expect(cleaned.cacheRows).toBeGreaterThan(0);
    expect(cleaned.rateLimitRows).toBeGreaterThan(0);
  });
});
