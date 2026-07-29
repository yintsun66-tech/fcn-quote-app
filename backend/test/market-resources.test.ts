import { describe, expect, it } from "vitest";
// The production module is a browser-native ES module copied as a static asset.
// @ts-expect-error The root browser module intentionally has no backend TypeScript declaration.
import { hotlistDescriptor, hotlistScreenUrl, hotlistWidgetUrl, marketResourceDescriptor, tradingViewWidgetSrcdoc, tradingViewWidgetUrl } from "../../market-resources.mjs";

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

  it("builds the US hot-list widget URL without a loader script or page address", () => {
    const url = new URL(hotlistWidgetUrl("us"));
    const settings = JSON.parse(decodeURIComponent(url.hash.slice(1)));
    expect(url.origin).toBe("https://www.tradingview-widget.com");
    expect(url.pathname).toBe("/embed-widget/hotlists/");
    expect(settings.exchange).toBe("US");
    // The upstream loader appends page-uri/utm_* fields; the embed must not carry a page address.
    expect(Object.keys(settings)).not.toContain("page-uri");
    expect(url.toString()).not.toMatch(/utm_|page-uri/i);
    // The hot list is market-wide: no underlying, RFQ or account identifier may travel with it.
    expect(url.toString()).not.toMatch(/rfq_|quote_|employee|branch/i);
    expect(url.toString()).not.toContain("s3.tradingview.com");
  });

  it("refuses to embed a market TradingView does not actually serve", () => {
    // "JP"/"JPX"/"TYO" are accepted upstream but silently return US rows, so Japan must never be
    // embedded — it would show US stocks under a Japan label.
    expect(hotlistDescriptor("japan")).toMatchObject({ marketKey: "japan", embeddable: false });
    expect(() => hotlistWidgetUrl("japan")).toThrow();
  });

  it("links the five TradingView rankings for both markets", () => {
    const expected = ["most_volatile", "large_cap", "highest_cash", "most_active", "highest_revenue"];
    for (const [marketKey, marketPath] of [["us", "stocks-usa"], ["japan", "stocks-japan"]] as const) {
      const descriptor = hotlistDescriptor(marketKey);
      expect(descriptor.screens.map((screen: { screenKey: string }) => screen.screenKey)).toEqual(expected);
      for (const screen of descriptor.screens as Array<{ url: string }>) {
        const url = new URL(screen.url);
        expect(url.origin).toBe("https://www.tradingview.com");
        expect(url.pathname).toContain(`/markets/${marketPath}/market-movers-`);
        expect(url.toString()).not.toMatch(/rfq_|quote_|employee|branch/i);
      }
    }
    expect(hotlistScreenUrl("japan", "highest_revenue"))
      .toBe("https://www.tradingview.com/markets/stocks-japan/market-movers-highest-revenue/");
  });

  it("fails closed for hot-list markets or rankings outside the allowlist", () => {
    expect(hotlistDescriptor("us")).toMatchObject({ marketKey: "us", embeddable: true });
    expect(hotlistDescriptor("taiwan")).toBeNull();
    expect(hotlistDescriptor("__proto__")).toBeNull();
    expect(() => hotlistWidgetUrl("taiwan")).toThrow();
    expect(() => hotlistWidgetUrl("'; alert(1);//")).toThrow();
    expect(() => hotlistScreenUrl("taiwan", "large_cap")).toThrow();
    expect(() => hotlistScreenUrl("us", "__proto__")).toThrow();
    expect(() => hotlistScreenUrl("us", "../../evil")).toThrow();
  });
});
