import { describe, expect, it } from "vitest";
import { quoteTargetValue, rankValidQuotes } from "../src/ranking";

function quote(id: string, value: number | null, receivedAt: string, status = "VALID") {
  return {
    id, trade_id: "trd_1", issuer: id.toUpperCase(), status, received_at: receivedAt,
    strike_pct: value, ko_barrier_pct: value, coupon_pa_pct: value,
    comparable_price_pct: value, ki_barrier_pct: value
  };
}

describe("quote ranking", () => {
  it("ranks Coupon descending and preserves equal economic rank", () => {
    const ranked = rankValidQuotes([
      quote("a", 12, "2026-07-21T00:00:02Z"),
      quote("b", 15, "2026-07-21T00:00:03Z"),
      quote("c", 15, "2026-07-21T00:00:01Z"),
      quote("d", 10, "2026-07-21T00:00:04Z")
    ], "COUPON");
    expect(ranked.map(item => [item.quote.id, item.economicRank])).toEqual([
      ["c", 1], ["b", 1], ["a", 2], ["d", 3]
    ]);
  });

  it.each(["PRICE", "STRIKE", "KO_BARRIER", "KI_BARRIER"] as const)("ranks %s ascending", field => {
    const ranked = rankValidQuotes([
      quote("a", 98, "2026-07-21T00:00:01Z"),
      quote("b", 97, "2026-07-21T00:00:02Z"),
      quote("c", 99, "2026-07-21T00:00:03Z")
    ], field);
    expect(ranked.map(item => item.value)).toEqual([97, 98, 99]);
  });

  it("excludes null, invalid and rejected values", () => {
    const ranked = rankValidQuotes([
      quote("valid", 10, "2026-07-21T00:00:01Z"),
      quote("null", null, "2026-07-21T00:00:02Z"),
      quote("rejected", 99, "2026-07-21T00:00:03Z", "ISSUER_REJECTED")
    ], "COUPON");
    expect(ranked.map(item => item.quote.id)).toEqual(["valid"]);
    expect(quoteTargetValue(quote("x", 12, "2026-07-21T00:00:00Z"), "PRICE")).toBe(12);
  });

  it("keeps the first five economic ranks, including every quote tied at rank five", () => {
    const ranked = rankValidQuotes([
      quote("a", 15, "2026-07-21T00:00:01Z"),
      quote("b", 14, "2026-07-21T00:00:02Z"),
      quote("c", 13, "2026-07-21T00:00:03Z"),
      quote("d", 12, "2026-07-21T00:00:04Z"),
      quote("e", 11, "2026-07-21T00:00:05Z"),
      quote("f", 11, "2026-07-21T00:00:06Z"),
      quote("g", 10, "2026-07-21T00:00:07Z")
    ], "COUPON");
    expect(ranked.map(item => [item.quote.id, item.economicRank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
      ["f", 5]
    ]);
  });
});
