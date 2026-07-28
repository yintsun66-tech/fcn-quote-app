export const MARKET_RESOURCE_CONSENT_KEY = "fcn-market-resources-consent:v1";

const BLOOMBERG_EXCHANGES = Object.freeze({
  UW: "NASDAQ",
  UN: "NYSE",
  UA: "AMEX"
});

function normalizedUnderlying(value) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
}

function tickerVariants(value) {
  if (!/^[A-Z0-9]{1,8}(?:[./-][A-Z0-9]{1,3})?$/.test(value)) return null;
  return {
    tradingView: value.replace(/[/-]/g, "."),
    yahoo: value.replace(/[/.]/g, "-"),
    cboe: value.replace(/[.-]/g, "/")
  };
}

export function marketResourceDescriptor(underlying) {
  const normalized = normalizedUnderlying(underlying);
  const searchUrl = `https://www.tradingview.com/symbols/?q=${encodeURIComponent(normalized)}`;
  const match = /^(.+)\s+(UW|UN|UA)$/.exec(normalized);
  if (!match) {
    return { underlying: normalized, supported: false, searchUrl };
  }

  const variants = tickerVariants(match[1]);
  const exchange = BLOOMBERG_EXCHANGES[match[2]];
  if (!variants || !exchange) {
    return { underlying: normalized, supported: false, searchUrl };
  }

  const tradingViewSymbol = `${exchange}:${variants.tradingView}`;
  return {
    underlying: normalized,
    supported: true,
    ticker: variants.yahoo,
    exchange,
    tradingViewSymbol,
    links: {
      tradingView: `https://www.tradingview.com/symbols/${exchange}-${variants.tradingView}/`,
      yahooFinance: `https://finance.yahoo.com/quote/${encodeURIComponent(variants.yahoo)}/`,
      googleTrends: `https://trends.google.com/trends/explore?geo=US&q=${encodeURIComponent(variants.yahoo)}`,
      cboe: `https://www.cboe.com/delayed_quotes/${encodeURIComponent(variants.cboe)}/quote_table/`,
      oic: "https://www.optionseducation.org/options-calculator-for-all-investors"
    }
  };
}

export function tradingViewWidgetSrcdoc(descriptor) {
  if (!descriptor?.supported || !/^(NASDAQ|NYSE|AMEX):[A-Z0-9.-]+$/.test(descriptor.tradingViewSymbol)) {
    throw new Error("無法建立未映射標的的外部圖表。");
  }

  const configuration = JSON.stringify({
    autosize: true,
    symbol: descriptor.tradingViewSymbol,
    interval: "D",
    timezone: "exchange",
    theme: "light",
    backgroundColor: "#ffffff",
    gridColor: "rgba(8, 117, 99, 0.08)",
    style: "1",
    locale: "zh_TW",
    allow_symbol_change: false,
    hide_side_toolbar: true,
    save_image: false,
    calendar: false,
    support_host: "https://www.tradingview.com"
  });

  return `<!doctype html><html lang="zh-Hant"><head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>html,body,.tradingview-widget-container{height:100%;width:100%;margin:0;background:#fff}.tradingview-widget-container__widget{height:calc(100% - 28px);width:100%}.tradingview-widget-copyright{height:28px;display:flex;align-items:center;justify-content:center;font:12px system-ui,sans-serif;color:#416b78}.tradingview-widget-copyright a{color:#087966;font-weight:700;text-decoration:none}</style>
  </head><body>
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <div class="tradingview-widget-copyright"><a href="${descriptor.links.tradingView}" rel="noopener nofollow" target="_blank">${descriptor.ticker} 圖表</a>&nbsp;由 TradingView 提供</div>
      <script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" type="text/javascript" referrerpolicy="no-referrer" async>${configuration}</script>
    </div>
  </body></html>`;
}
