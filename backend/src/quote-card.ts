export interface QuoteCardTrade {
  sequence: number;
  tradeCode: string;
  product: string;
  currency: string;
  issuer: string;
  issuerDisplayName: string;
  tenorMonths: number | null;
  guaranteedPeriodsMonths: number | null;
  underlyings: string[];
  couponPaPct: number | null;
  strikePct: number | null;
  koBarrierPct: number | null;
  koType: string | null;
  barrierType: string | null;
  kiBarrierPct: number | null;
  comparablePricePct: number | null;
}

interface QuoteCardTheme {
  primary: string;
  accent: string;
  soft: string;
}

// Keep the server-rendered quote images aligned with the issuer themes in the main frontend.
const THEMES: Record<string, QuoteCardTheme> = {
  BNP: { primary: "#008a4b", accent: "#0875a8", soft: "#e7f8ef" },
  BARCLAYS: { primary: "#0077a8", accent: "#008b73", soft: "#e7f6fb" },
  MS: { primary: "#006f80", accent: "#00855d", soft: "#e5f7f6" },
  JPM: { primary: "#174d85", accent: "#00806c", soft: "#e8f3fb" },
  NOMURA: { primary: "#b51f36", accent: "#7d1730", soft: "#fbecee" },
  UBS: { primary: "#d71920", accent: "#8b1d33", soft: "#fcebed" },
  DBS: { primary: "#d31245", accent: "#9e1638", soft: "#fbe9ef" },
  SG: { primary: "#0875b9", accent: "#008a73", soft: "#e8f5fb" },
  CITI: { primary: "#056dae", accent: "#d23449", soft: "#e9f4fb" },
  GS: { primary: "#1f6fb2", accent: "#16866c", soft: "#e9f4fb" },
  CA: { primary: "#1b5aa6", accent: "#168064", soft: "#e9f1fb" }
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/gu, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Number(value.toFixed(4))}%`;
}

function months(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value}M`;
}

export function renderQuoteCardHtml(issuer: string, trades: QuoteCardTrade[]): string {
  const theme = THEMES[issuer] ?? THEMES.BNP!;
  const issuerName = trades[0]?.issuerDisplayName ?? issuer;
  const rows = trades.map(trade => `
    <article class="trade-card">
      <div class="trade-heading">
        <div>
          <span class="trade-number">${escapeHtml(trade.tradeCode || `T${String(trade.sequence).padStart(2, "0")}`)}</span>
          <strong>${escapeHtml(trade.product)} · ${escapeHtml(trade.currency)}</strong>
        </div>
        <span class="issuer-label">${escapeHtml(issuerName)}</span>
      </div>
      <section class="summary">
        <div><small>Tenor</small><b>${months(trade.tenorMonths)}</b></div>
        <div><small>Guaranteed Period</small><b>${months(trade.guaranteedPeriodsMonths)}</b></div>
      </section>
      <section class="underlying-block">
        <small>連結標的 Underlyings</small>
        <div class="underlyings">${trade.underlyings.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</div>
      </section>
      <section class="metrics">
        <div><small>Coupon p.a.</small><b>${percent(trade.couponPaPct)}</b></div>
        <div><small>Strike</small><b>${percent(trade.strikePct)}</b></div>
        <div><small>KO Barrier</small><b>${percent(trade.koBarrierPct)}</b></div>
        <div><small>KI Barrier</small><b>${percent(trade.kiBarrierPct)}</b></div>
        <div class="price"><small>Upfront / Note Price</small><b>${percent(trade.comparablePricePct)}</b></div>
      </section>
      <section class="terms">
        <span><small>KO Type</small><b>${escapeHtml(trade.koType || "—")}</b></span>
        <span><small>Barrier Type</small><b>${escapeHtml(trade.barrierType || "—")}</b></span>
      </section>
    </article>`).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}html,body{margin:0;background:#fff;color:#16313d;font-family:Arial,"Microsoft JhengHei","Noto Sans TC",sans-serif}
    body{width:720px;padding:20px;background:linear-gradient(145deg,${theme.soft} 0%,#fff 34%,#eff7fb 100%)}
    .sheet{overflow:hidden;border:2px solid ${theme.primary};border-radius:22px;background:#fff;box-shadow:0 16px 42px rgba(10,57,78,.16)}
    header{padding:28px 30px 25px;border-bottom:5px solid ${theme.primary};background:linear-gradient(145deg,${theme.soft},#fff 70%);color:#246075}
    header small{display:block;margin-bottom:7px;font-size:14px;font-weight:800;letter-spacing:1.8px}header h1{margin:0;color:${theme.primary};font-size:36px;line-height:1.12;letter-spacing:.3px}
    header .header-note{display:inline-block;margin-top:14px;padding:7px 13px;border-radius:999px;background:linear-gradient(125deg,${theme.primary},${theme.accent});color:#fff;font-size:16px;font-weight:800}
    main{display:grid;gap:20px;padding:22px}.trade-card{overflow:hidden;border:1px solid #b9d8df;border-radius:15px;background:#fff;box-shadow:0 5px 15px rgba(10,103,128,.12)}
    .trade-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:72px;padding:14px 17px;background:linear-gradient(125deg,${theme.primary},${theme.accent});color:#fff}
    .trade-heading>div{display:flex;align-items:center;gap:12px}.trade-heading strong{font-size:25px}.trade-number{display:inline-block;padding:7px 10px;border:1px solid rgba(255,255,255,.48);border-radius:8px;background:rgba(255,255,255,.12);font-size:16px;font-weight:900}
    .issuer-label{max-width:230px;text-align:right;font-size:15px;font-weight:800;line-height:1.25;letter-spacing:.3px}
    .summary{display:grid;grid-template-columns:1fr 1fr;background:${theme.soft}}.summary div{padding:13px 17px}.summary div+div{border-left:1px solid #b9d8df}.summary small,.metrics small,.terms small,.underlying-block>small{display:block;color:#286174;font-size:15px;font-weight:700}.summary b{display:block;margin-top:4px;color:${theme.primary};font-size:24px}
    .underlying-block{padding:16px 17px;border-top:1px solid #d4e7e9}.underlyings{display:flex;flex-wrap:wrap;gap:8px 10px;margin-top:9px}.underlyings span{padding:7px 11px;border:1px solid #9bcfd2;border-radius:7px;background:${theme.soft};color:${theme.primary};font-size:30px;font-weight:900;line-height:1.15}
    .metrics{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #d4e7e9}.metrics div{min-height:84px;padding:13px 17px;border-bottom:1px solid #d4e7e9}.metrics div:nth-child(odd):not(.price){border-right:1px solid #d4e7e9}.metrics b{display:block;margin-top:5px;color:${theme.primary};font-size:27px}.metrics .price{grid-column:1/-1;min-height:88px;text-align:center;background:linear-gradient(120deg,${theme.soft},#fff)}.metrics .price b{font-size:31px}
    .terms{display:grid;grid-template-columns:1fr 1fr}.terms span{padding:13px 17px}.terms span+span{border-left:1px solid #d4e7e9}.terms b{display:block;margin-top:4px;color:#173f51;font-size:19px}
    footer{padding:16px 24px;background:${theme.soft};color:#426776;font-size:13px;line-height:1.45;text-align:right}@media print{body{padding:0}.sheet{box-shadow:none}}
  </style></head><body><section class="sheet"><header><small>STRUCTURED PRODUCT INDICATIVE QUOTATION</small><h1>${escapeHtml(issuerName)}</h1><span class="header-note">FCN QUOTE · ${trades.length} 筆</span></header><main>${rows}</main><footer>本報價僅供參考，最終條件以發行機構正式報價及相關文件為準。</footer></section></body></html>`;
}
