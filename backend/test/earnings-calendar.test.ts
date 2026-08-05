import { describe, expect, it } from "vitest";
import { marketToday, marketWindow, toEarningsSymbol } from "../src/earnings-calendar";

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
    expect(marketWindow("US", taipeiEarlyMorning)).toEqual({ from: "2026-08-05", to: "2026-08-07" });
    expect(marketWindow("JP", taipeiEarlyMorning)).toEqual({ from: "2026-08-06", to: "2026-08-08" });
  });

  it("includes today and the following two days", () => {
    const noonNewYork = new Date("2026-08-06T16:00:00Z");
    const window = marketWindow("US", noonNewYork);
    expect(window.from).toBe("2026-08-06");
    expect(window.to).toBe("2026-08-08");
  });

  it("crosses a month boundary without arithmetic drift", () => {
    const endOfMonth = new Date("2026-08-31T16:00:00Z");
    expect(marketWindow("US", endOfMonth)).toEqual({ from: "2026-08-31", to: "2026-09-02" });
  });
});
