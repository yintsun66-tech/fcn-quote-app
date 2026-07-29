import { describe, expect, it } from "vitest";
// The production module is a browser-native ES module copied as a static asset.
// @ts-expect-error The root browser module intentionally has no backend TypeScript declaration.
import { hotlistDescriptor, hotlistWidgetUrl, marketResourceDescriptor, tradingViewWidgetSrcdoc, tradingViewWidgetUrl } from "../../market-resources.mjs";

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

  it("builds a direct official widget URL without the client-blocked loader script", () => {
    const url = new URL(tradingViewWidgetUrl(marketResourceDescriptor("MU UW")));
    const settings = JSON.parse(decodeURIComponent(url.hash.slice(1)));
    expect(url.origin).toBe("https://www.tradingview-widget.com");
    expect(url.pathname).toBe("/embed-widget/advanced-chart/");
    expect(url.searchParams.get("locale")).toBe("zh_TW");
    expect(settings.symbol).toBe("NASDAQ:MU");
    expect(url.toString()).not.toMatch(/rfq_|quote_|employee|branch/i);
    expect(url.toString()).not.toContain("s3.tradingview.com");
  });

  it("builds US and Japan hot-list widget URLs from the fixed allowlist", () => {
    for (const [marketKey, expectedMarket] of [["us", "us"], ["japan", "japan"]] as const) {
      const url = new URL(hotlistWidgetUrl(marketKey, "volume_leaders"));
      const settings = JSON.parse(decodeURIComponent(url.hash.slice(1)));
      expect(url.origin).toBe("https://www.tradingview-widget.com");
      expect(url.pathname).toBe("/embed-widget/screener/");
      expect(settings.market).toBe(expectedMarket);
      expect(settings.defaultScreen).toBe("volume_leaders");
      // The hot list is market-wide: no underlying, RFQ or account identifier may travel with it.
      expect(url.toString()).not.toMatch(/rfq_|quote_|employee|branch/i);
      expect(url.toString()).not.toContain("s3.tradingview.com");
    }
  });

  it("fails closed for hot-list markets or screens outside the allowlist", () => {
    expect(hotlistDescriptor("us", "volume_leaders")).toMatchObject({ marketKey: "us" });
    expect(hotlistDescriptor("taiwan", "volume_leaders")).toBeNull();
    expect(hotlistDescriptor("us", "__proto__")).toBeNull();
    expect(() => hotlistWidgetUrl("taiwan", "volume_leaders")).toThrow();
    expect(() => hotlistWidgetUrl("us", "'; alert(1);//")).toThrow();
  });
});
