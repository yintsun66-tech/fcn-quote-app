import { describe, expect, it } from "vitest";
import { parseIssuerTables } from "../src/issuer-profiles";
import type { Issuer } from "../src/inbound-parser";

function cells(length: number, values: Record<number, string | number | boolean>): string[] {
  const row = Array.from({ length }, () => "");
  for (const [index, value] of Object.entries(values)) row[Number(index)] = String(value);
  return row;
}

const standardCases: Array<{
  issuer: Issuer;
  row: string[];
  expected: Record<string, unknown>;
}> = [
  {
    issuer: "BNP",
    row: cells(25, { 0: "REF-1", 1: "FCN", 2: "USD", 3: 1, 4: "AAA UW", 9: 80, 10: "Daily Memory", 11: 100, 12: 12.5, 13: 98, 14: 6, 15: "EKI", 16: 70, 17: 1, 18: "Note", 19: 7 }),
    expected: { strikePct: 80, couponPaPct: 12.5, comparablePricePct: 98, guaranteedPeriodsMonths: 1 }
  },
  {
    issuer: "BARCLAYS",
    row: cells(25, { 0: "FCN", 1: "USD", 2: 1, 3: "AAA UW", 8: 80, 9: "Daily", 10: 100, 11: 12.5, 12: 98, 13: 6, 14: "NONE", 15: 0, 16: 1, 17: "Note", 18: 7, 24: "Q-1" }),
    expected: { strikePct: 80, kiBarrierPct: null, quoteReference: "Q-1" }
  },
  {
    issuer: "JPM",
    row: cells(25, { 0: "FCN", 1: "USD", 2: 1, 3: "AAA UW", 8: 80, 9: "Daily Memory", 10: 100, 11: 12.5, 12: 98, 13: 6, 14: "EKI", 15: 70, 16: 1, 17: "Note", 18: 7, 20: "JPM-1" }),
    expected: { quoteReference: "JPM-1", couponPaPct: 12.5 }
  },
  {
    issuer: "NOMURA",
    row: cells(25, { 0: "N-1", 1: "FCN", 2: "USD", 3: 1, 5: "AAA UW", 10: 80, 11: "Daily", 12: 100, 13: 12.5, 14: 98, 15: 6, 16: "NONE", 18: 1, 19: "Note", 21: 7 }),
    expected: { quoteReference: "N-1", tenorMonths: 6 }
  },
  {
    issuer: "DBS",
    row: cells(23, { 0: "FCN", 1: "USD", 2: 1, 3: "AAA UW", 7: 0.8, 8: "Daily Memory", 9: 1, 10: 0.125, 11: 0.98, 12: 6, 13: "NONE", 15: 1, 16: "Note", 22: "DBS-1" }),
    expected: { strikePct: 80, koBarrierPct: 100, couponPaPct: 12.5, comparablePricePct: 98 }
  },
  {
    issuer: "UBS",
    row: cells(19, { 0: "FCN", 1: "USD", 2: 1, 3: "AAA UW", 8: 80, 9: "Daily", 10: 100, 11: 12.5, 12: 98, 13: 6, 14: "NONE", 16: 1, 17: "Note" }),
    expected: { priceSemantics: "COST", comparablePricePct: 98 }
  },
  {
    issuer: "GS",
    row: cells(21, { 0: "FCN", 1: "USD", 2: 1, 3: "AAA UW", 8: 80, 9: "Daily", 10: 100, 11: 12.5, 12: 98, 13: 6, 14: "NONE", 16: 1, 18: 7, 20: "Request accepted" }),
    expected: { priceSemantics: "COST", rejectionReason: null }
  },
  {
    issuer: "CA",
    row: cells(21, { 0: "FCN", 1: "USD", 2: "AAA UW", 6: 80, 7: "Daily", 8: 1, 9: 100, 10: 12.5, 11: 98, 12: 6, 13: "NONE", 15: 1, 16: "Note", 20: "CA-1" }),
    expected: { guaranteedPeriodsMonths: 1, quoteReference: "CA-1" }
  }
];

describe("issuer parser profiles", () => {
  it.each(standardCases)("normalizes $issuer positional fields", ({ issuer, row, expected }) => {
    const parsed = parseIssuerTables(issuer, { tables: [{ index: 0, rows: [row] }] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ issuer, product: "FCN", currency: "USD", underlyings: ["AAA UW"], ...expected });
  });

  it("normalizes MS decimal fractions and memory fields", () => {
    const row = cells(23, { 0: "MS-1", 1: "FCN", 3: "AAA UW", 9: "USD", 10: "6m", 11: "1m", 12: 0.125, 13: 0.8, 14: "NA", 15: "NA", 16: 1, 17: "DAILY", 18: "1m", 19: "Yes", 22: 0.98 });
    const parsed = parseIssuerTables("MS", { tables: [{ index: 0, rows: [row] }] });
    expect(parsed[0]).toMatchObject({
      issuerDisplayName: "MS（OBU不得承做）",
      strikePct: 80,
      koBarrierPct: 100,
      couponPaPct: 12.5,
      comparablePricePct: 98,
      barrierType: "NONE",
      kiBarrierPct: null,
      koType: "Daily Memory",
      // NONE-barrier KI "NA" must not be read as an issuer rejection.
      rejectionReason: null,
      // "m"-suffixed month fields must parse so the row matches its trade (prevents PARSE_ERROR).
      tenorMonths: 6,
      observationFrequencyMonths: 1,
      guaranteedPeriodsMonths: 1
    });
  });

  it("maps current SG headers dynamically when the reply contains fewer than five underlyings", () => {
    const headers = [
      "Strike Date", "Issue Date", "Final Valuation Date", "Maturity Date",
      "Underlying 1", "Underlying 2", "No. of Periods", "Settlement Frequency",
      "Currency", "Quote ?", "Coupon p.a.", "Fixed Coupons", "Non-Call (m)",
      "Put Strike", "AutoCall", "KO Type", "KI Type", "KI", "Offer Price",
      "Funding Spread (Bps)", "Comment"
    ];
    const first = cells(headers.length, {
      4: "TSM UN", 5: "ISRG UW", 6: 12, 7: "Monthly", 8: "USD", 9: "Coupon",
      10: "12.58%", 11: "All Periods", 12: 3, 13: "65%", 14: "100%",
      15: "Daily Memory", 16: "N/A", 17: "N/A", 18: "99.7%", 20: "Accepted"
    });
    const second = cells(headers.length, {
      4: "NVDA UW", 6: 6, 7: "Monthly", 8: "USD", 9: "Coupon",
      10: 0.1447, 11: "All Periods", 12: 1, 13: 0.85, 14: 1,
      15: "Daily Memory", 16: "EKI", 17: 0.7, 18: 0.98
    });
    const parsed = parseIssuerTables("SG", { tables: [{ index: 0, rows: [headers, first, second] }] });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      parserProfile: "SG_FCN_V2",
      product: "FCN",
      currency: "USD",
      tenorMonths: 12,
      guaranteedPeriodsMonths: 3,
      underlyings: ["TSM UN", "ISRG UW"],
      strikePct: 65,
      koBarrierPct: 100,
      couponPaPct: 12.58,
      comparablePricePct: 99.7,
      barrierType: "NONE",
      kiBarrierPct: null,
      warnings: ["SG_HEADER_MAPPED_DYNAMICALLY"]
    });
    expect(parsed[1]).toMatchObject({
      underlyings: ["NVDA UW"],
      strikePct: 85,
      barrierType: "EKI",
      kiBarrierPct: 70
    });
    expect(parsed[1]?.couponPaPct).toBeCloseTo(14.47);
  });

  it("converts CITI Upfront to comparable Note Price and derives KO type", () => {
    const row = cells(32, { 0: "FCA", 2: "USD", 3: 6, 4: 7, 5: "AAA UW", 10: 80, 11: "European", 12: 70, 13: 1, 14: 0, 15: 100, 16: true, 17: true, 18: 12.5, 19: 2, 30: "CITI-1" });
    const parsed = parseIssuerTables("CITI", { tables: [{ index: 0, rows: [row] }] });
    expect(parsed[0]).toMatchObject({
      product: "FCN",
      rawPriceValue: 2,
      priceSemantics: "UPFRONT",
      comparablePricePct: 98,
      guaranteedPeriodsMonths: 1,
      koType: "Daily Memory"
    });
  });

  it("preserves repeated completed CA rows so identical trades can be matched by source order", () => {
    const row = cells(21, { 0: "FCN", 1: "USD", 2: "AAA UW", 6: 80, 7: "Daily", 8: 1, 9: 100, 10: 12.5, 11: 98, 12: 6, 13: "NONE", 15: 1, 16: "Note", 20: "CA-1" });
    const parsed = parseIssuerTables("CA", { tables: [{ index: 0, rows: [row] }, { index: 1, rows: [row] }] });
    expect(parsed).toHaveLength(2);
  });

  it("preserves GS rejection reasons and does not treat N/A as zero", () => {
    const row = cells(21, { 0: "FCN", 1: "USD", 2: 1, 3: "AAA UW", 8: 80, 9: "Daily", 10: 100, 11: "N/A", 12: 98, 13: 6, 14: "NONE", 16: 1, 20: "Rate limit exceeded - reject" });
    const parsed = parseIssuerTables("GS", { tables: [{ index: 0, rows: [row] }] });
    expect(parsed[0]?.couponPaPct).toBeNull();
    expect(parsed[0]?.rejectionReason).toContain("reject");
  });
});
