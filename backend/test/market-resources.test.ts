import { describe, expect, it } from "vitest";
// The production module is a browser-native ES module copied as a static asset.
// @ts-expect-error The root browser module intentionally has no backend TypeScript declaration.
import { marketResourceDescriptor, tradingViewWidgetSrcdoc } from "../../market-resources.mjs";

describe("public market resource mapping", () => {
  it("maps supported Bloomberg US exchange suffixes to strict third-party symbols", () => {
    expect(marketResourceDescriptor(" aapl uw ")).toMatchObject({
      supported: true,
      ticker: "AAPL",
      exchange: "NASDAQ",
      tradingViewSymbol: "NASDAQ:AAPL"
    });
    expect(marketResourceDescriptor("IBM UN")).toMatchObject({
      supported: true,
      exchange: "NYSE",
      tradingViewSymbol: "NYSE:IBM"
    });
  });

  it("fails closed for unknown exchanges or unsafe ticker text", () => {
    expect(marketResourceDescriptor("7203 JT").supported).toBe(false);
    expect(marketResourceDescriptor("</script> UW").supported).toBe(false);
    expect(marketResourceDescriptor("AAPL UW?rfq=rfq_private").supported).toBe(false);
  });

  it("creates public links containing only the normalized market symbol", () => {
    const descriptor = marketResourceDescriptor("BRK/B UN");
    expect(descriptor).toMatchObject({
      supported: true,
      ticker: "BRK-B",
      tradingViewSymbol: "NYSE:BRK.B"
    });
    expect(Object.values(descriptor.links).join(" ")).not.toContain("rfq_");
    expect(descriptor.links.yahooFinance).toContain("BRK-B");
    expect(descriptor.links.googleTrends).toContain("BRK-B");
  });

  it("builds one isolated TradingView loader without application identifiers", () => {
    const html = tradingViewWidgetSrcdoc(marketResourceDescriptor("AAPL UW"));
    expect((html.match(/<script /g) ?? [])).toHaveLength(1);
    expect(html).toContain("NASDAQ:AAPL");
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).not.toMatch(/rfq_|quote_|employee|branch/i);
  });
});
