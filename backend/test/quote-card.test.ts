import { describe, expect, it } from "vitest";
import { renderQuoteCardHtml } from "../src/quote-card";

describe("quote card HTML", () => {
  it("renders blue-green financial styling, larger underlyings and escaped values", () => {
    const html = renderQuoteCardHtml("BNP", [{
      sequence: 1, tradeCode: "T01", product: "FCN", currency: "USD", issuer: "BNP",
      issuerDisplayName: "BNP <script>alert(1)</script>", tenorMonths: 12,
      guaranteedPeriodsMonths: 1, underlyings: ["AAPL UW", "<img onerror=alert(1)>"],
      couponPaPct: 12.5, strikePct: 80, koBarrierPct: 100, koType: "Daily Memory",
      barrierType: "NONE", kiBarrierPct: null, comparablePricePct: 98
    }]);
    expect(html).toContain("#007a73");
    expect(html).toContain("font-size:27px");
    expect(html).toContain("AAPL UW");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img onerror");
    expect(html).not.toContain("每月調降KO");
  });
});
