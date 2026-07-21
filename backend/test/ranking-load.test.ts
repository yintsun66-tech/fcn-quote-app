import { describe, expect, it } from "vitest";
import { rankValidQuotes } from "../src/ranking";

describe("ranking capacity baseline", () => {
  it("ranks 50 users x 20 trades x 11 issuers deterministically", () => {
    const started = Date.now();
    let resultCount = 0;
    for (let user = 0; user < 50; user += 1) {
      for (let trade = 0; trade < 20; trade += 1) {
        const quotes = Array.from({ length: 11 }, (_, issuer) => ({
          id: `q-${user}-${trade}-${issuer}`, trade_id: `t-${user}-${trade}`,
          issuer: `I${issuer}`, status: "VALID", received_at: `2026-07-21T00:00:${String(issuer).padStart(2, "0")}Z`,
          strike_pct: 80 + issuer / 10, ko_barrier_pct: 90 + issuer / 10,
          coupon_pa_pct: 10 + issuer / 10, comparable_price_pct: 97 + issuer / 10,
          ki_barrier_pct: 60 + issuer / 10
        }));
        const ranked = rankValidQuotes(quotes, trade % 2 ? "COUPON" : "PRICE");
        expect(ranked).toHaveLength(3);
        resultCount += ranked.length;
      }
    }
    expect(resultCount).toBe(3_000);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
