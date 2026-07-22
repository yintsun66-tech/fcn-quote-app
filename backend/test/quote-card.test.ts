import { describe, expect, it } from "vitest";
import { renderQuoteCardHtml } from "../src/quote-card";

describe("quote card HTML", () => {
  it("renders the main-app BNP theme in a mobile portrait layout with escaped values", () => {
    const html = renderQuoteCardHtml("BNP", [{
      sequence: 1, tradeCode: "T01", product: "FCN", currency: "USD", issuer: "BNP",
      issuerDisplayName: "BNP <script>alert(1)</script>", tradeDate: "22-Jul-26", tenorMonths: 12,
      guaranteedPeriodsMonths: 1, underlyings: ["AAPL UW", "<img onerror=alert(1)>"],
      couponPaPct: 12.5, strikePct: 80, koBarrierPct: 100, koType: "Daily Memory",
      barrierType: "NONE", kiBarrierPct: null, comparablePricePct: 98
    }], "K7P2R9QTBM");
    expect(html).toContain("body{width:720px");
    expect(html).toContain("#008a4b");
    expect(html).toContain("#0875a8");
    expect(html).toContain("font-size:34px");
    expect(html).toContain("grid-template-columns:1fr 1fr");
    expect(html).toContain(">AAPL</span>");
    expect(html).toContain("FCN 報價");
    expect(html).toContain("年化收益率");
    expect(html).toContain("保證配息期間");
    expect(html).toContain("報價日期：22-Jul-26");
    expect(html).toContain("RFQ 編號：[RFQ:K7P2R9QTBM]");
    expect(html).not.toContain("Upfront / Note Price");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img onerror");
    expect(html).not.toContain("每月調降KO");
  });

  it("uses issuer-specific colors from the main quote image", () => {
    const trade = {
      sequence: 1, tradeCode: "T01", product: "FCN", currency: "USD", issuer: "UBS",
      issuerDisplayName: "UBS", tradeDate: "22-Jul-26", tenorMonths: 6, guaranteedPeriodsMonths: 1,
      underlyings: ["AAPL UW"], couponPaPct: 12, strikePct: 80, koBarrierPct: 100,
      koType: "Daily Memory", barrierType: "NONE", kiBarrierPct: null, comparablePricePct: 98
    };
    const ubs = renderQuoteCardHtml("UBS", [trade]);
    const sg = renderQuoteCardHtml("SG", [{ ...trade, issuer: "SG", issuerDisplayName: "SOCIETE GENERALE" }]);
    expect(ubs).toContain("#d71920");
    expect(ubs).toContain("#8b1d33");
    expect(sg).toContain("#0875b9");
    expect(sg).toContain("#008a73");
  });
});
