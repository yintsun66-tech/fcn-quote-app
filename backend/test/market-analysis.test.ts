import { describe, expect, it } from "vitest";
// The production module is a browser-native ES module copied as a static asset.
// @ts-expect-error The root browser module intentionally has no backend TypeScript declaration.
import { buildFcnAnalysis, parseIndicativeSpot, spotStorageKey } from "../../market-analysis.mjs";

const baseTerms = {
  product: "FCN",
  underlyings: ["AAPL UW"],
  strikePct: 85,
  koBarrierPct: 100,
  barrierType: "NONE",
  kiBarrierPct: null
};

describe("FCN / DAC market analysis model", () => {
  it("calculates reference prices and fixed worst-of scenarios without treating blank KI as zero", () => {
    const analysis = buildFcnAnalysis(baseTerms, { "AAPL UW": 200 });
    expect(analysis.referenceLevels[0]).toEqual({
      underlying: "AAPL UW",
      spot: 200,
      strikePrice: 170,
      koPrice: 200,
      kiPrice: null
    });
    expect(analysis.metrics).toEqual({ koRequiredMovePct: 0, kiBufferPct: null });
    expect(analysis.scenarios.map((row: { changePct: number }) => row.changePct))
      .toEqual([-50, -40, -30, -20, -10, 0, 10, 20]);
    expect(analysis.scenarios[0].kiAssessment).toBe("不適用（無 KI）");
  });

  it("keeps EKI terminal observation separate from AKI path-dependent branches", () => {
    const eki = buildFcnAnalysis({
      ...baseTerms,
      barrierType: "EKI",
      kiBarrierPct: 70
    }, { "AAPL UW": 100 });
    expect(eki.metrics.kiBufferPct).toBe(30);
    expect(eki.scenarios.find((row: { changePct: number }) => row.changePct === -40)?.kiAssessment)
      .toContain("到期位於或低於");
    expect(eki.akiBranches).toEqual([]);

    const aki = buildFcnAnalysis({
      ...baseTerms,
      barrierType: "AKI",
      kiBarrierPct: 70
    }, { "AAPL UW": 100 });
    expect(aki.scenarios[0].kiAssessment).toContain("兩條路徑");
    expect(aki.akiBranches.map((branch: { key: string }) => branch.key)).toEqual(["NO_TOUCH", "TOUCHED"]);
  });

  it("supports multiple underlyings and leaves missing or invalid spot values blank", () => {
    const analysis = buildFcnAnalysis({
      ...baseTerms,
      underlyings: ["AAPL UW", "MSFT UW"]
    }, {
      "AAPL UW": "190.5",
      "MSFT UW": "-1"
    });
    expect(analysis.referenceLevels.map((row: { spot: number | null }) => row.spot)).toEqual([190.5, null]);
    expect(analysis.scenarios[0].projectedPrices.map((row: { price: number | null }) => row.price))
      .toEqual([95.25, null]);
    expect(parseIndicativeSpot("")).toBeNull();
    expect(parseIndicativeSpot("not-a-number")).toBeNull();
  });

  it("uses RFQ, trade and normalized symbol in a stable browser-only storage key", () => {
    expect(spotStorageKey("rfq_1", "T01", " aapl uw "))
      .toBe(spotStorageKey("rfq_1", "T01", "AAPL UW"));
    expect(spotStorageKey("rfq_1", "T01", "AAPL UW"))
      .not.toBe(spotStorageKey("rfq_1", "T02", "AAPL UW"));
  });

  it.each(["DAC", "DRA", "WRA", "Range Accrual"])(
    "supports the DAC-family alias %s and applies the all-underlyings-above-strike interest rule",
    product => {
      const analysis = buildFcnAnalysis({
        ...baseTerms,
        product,
        guaranteedPeriodsMonths: 3
      }, { "AAPL UW": 100 });
      expect(analysis.product).toBe("DAC");
      expect(analysis.dacAccrualCondition).toMatchObject({
        guaranteedPeriodsMonths: 3,
        strikePct: 85,
        rule: "ALL_UNDERLYINGS_ABOVE_STRIKE"
      });
      expect(analysis.dacAccrualCondition?.description)
        .toContain("所有連結標的必須全部大於執行價，才會有利息");
      expect(analysis.scenarios.find((row: { changePct: number }) => row.changePct === -10)?.accrualAssessment)
        .toContain("均高於執行價");
      expect(analysis.scenarios.find((row: { changePct: number }) => row.changePct === -20)?.accrualAssessment)
        .toContain("不符合利息條件");
      const exactlyAtStrike = buildFcnAnalysis({
        ...baseTerms,
        product,
        guaranteedPeriodsMonths: 3
      }, { "AAPL UW": 100 }, [-15]);
      expect(exactlyAtStrike.scenarios[0]?.accrualAssessment)
        .toContain("不符合利息條件");
    }
  );

  it("still rejects unsupported products", () => {
    expect(() => buildFcnAnalysis({ ...baseTerms, product: "BEN" }, { "AAPL UW": 100 }))
      .toThrow("僅支援 FCN、DAC／DRA");
  });
});
