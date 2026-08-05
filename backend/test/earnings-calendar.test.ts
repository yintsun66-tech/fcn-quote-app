import { describe, expect, it } from "vitest";
import { dayOffset, marketToday, marketWindow, toEarningsSymbol } from "../src/earnings-calendar";

describe("earnings symbol mapping", () => {
  it("maps US Bloomberg suffixes to a bare Finnhub ticker", () => {
    for (const suffix of ["UN", "UW", "UA", "UP", "UQ", "UR", "UV", "UF"]) {
      const parsed = toEarningsSymbol(`AAPL ${suffix}`);
      expect(parsed).toMatchObject({ finnhubSymbol: "AAPL", market: "US" });
    }
  });

  it("maps a Tokyo listing to Finnhub's .T form", () => {
    expect(toEarningsSymbol("7203 JT")).toMatchObject({ finnhubSymbol: "7203.T", market: "JP" });
  });

  it("treats a bare ticker as US, which is what the form holds before the exchange lookup runs", () => {
    expect(toEarningsSymbol("msft")).toMatchObject({ finnhubSymbol: "MSFT", market: "US" });
  });

  it("returns null for exchanges this provider cannot express, rather than guessing", () => {
    // These exist in the exchange lookup file, so they will be entered. Guessing a symbol for them
    // would produce a confident "no earnings" for a stock we never actually checked.
    for (const code of ["0700 HK", "MC FP", "SAP GY"]) {
      expect(toEarningsSymbol(code)).toBeNull();
    }
  });

  it("ignores blank input", () => {
    expect(toEarningsSymbol("")).toBeNull();
    expect(toEarningsSymbol("   ")).toBeNull();
  });
});

describe("market-local dates", () => {
  // 2026-08-06 01:30 Taipei is 2026-08-05 13:30 in New York: the same instant is a different
  // calendar date in the two listing markets. Using a server-side date here would shift a US
  // underlying's window by a day and either invent or miss a warning — the same failure the
  // previous-close path had to be corrected for.
  const taipeiEarlyMorning = new Date("2026-08-05T17:30:00Z");

  it("resolves the US date from New York, not from UTC or the server", () => {
    expect(marketToday("US", taipeiEarlyMorning)).toBe("2026-08-05");
  });

  it("resolves the Japanese date from Tokyo", () => {
    expect(marketToday("JP", taipeiEarlyMorning)).toBe("2026-08-06");
  });

  it("puts the two markets on different windows for the same instant", () => {
    expect(marketWindow("US", taipeiEarlyMorning))
      .toEqual({ from: "2026-08-04", to: "2026-08-07", today: "2026-08-05" });
    expect(marketWindow("JP", taipeiEarlyMorning))
      .toEqual({ from: "2026-08-05", to: "2026-08-08", today: "2026-08-06" });
  });

  it("reaches back one day and forward two, inclusive", () => {
    const noonNewYork = new Date("2026-08-06T16:00:00Z");
    // Yesterday matters because the day after an announcement is when a gap reprices the underlying.
    expect(marketWindow("US", noonNewYork))
      .toEqual({ from: "2026-08-05", to: "2026-08-08", today: "2026-08-06" });
  });

  it("crosses a month boundary in both directions without arithmetic drift", () => {
    expect(marketWindow("US", new Date("2026-08-31T16:00:00Z")))
      .toEqual({ from: "2026-08-30", to: "2026-09-02", today: "2026-08-31" });
    expect(marketWindow("US", new Date("2026-09-01T16:00:00Z")))
      .toEqual({ from: "2026-08-31", to: "2026-09-03", today: "2026-09-01" });
  });
});

describe("day offsets", () => {
  it("labels each day of the window relative to that market's today", () => {
    const today = "2026-08-06";
    expect(dayOffset("2026-08-05", today)).toBe(-1);
    expect(dayOffset("2026-08-06", today)).toBe(0);
    expect(dayOffset("2026-08-07", today)).toBe(1);
    expect(dayOffset("2026-08-08", today)).toBe(2);
  });

  it("stays correct across a month boundary", () => {
    expect(dayOffset("2026-08-31", "2026-09-01")).toBe(-1);
    expect(dayOffset("2026-09-01", "2026-08-31")).toBe(1);
  });

  it("is unaffected by daylight saving, because both sides are plain calendar dates", () => {
    // 2026-11-01 is the US DST change. A local-time subtraction would give 24.x or 23.x hours here
    // and round to the wrong day; comparing date strings at UTC midnight cannot.
    expect(dayOffset("2026-10-31", "2026-11-01")).toBe(-1);
    expect(dayOffset("2026-11-02", "2026-11-01")).toBe(1);
  });
});
