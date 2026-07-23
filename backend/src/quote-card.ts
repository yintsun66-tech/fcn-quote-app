export interface QuoteCardTrade {
  sequence: number;
  tradeCode: string;
  product: string;
  currency: string;
  issuer: string;
  issuerDisplayName: string;
  tradeDate: string | null;
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
  return value === null || !Number.isFinite(value) ? "—" : `${value} 個月`;
}

// DAC/DRA pays a fixed coupon only for the guaranteed periods; from month X+1 it accrues (floats).
function dacFloatingNote(trade: QuoteCardTrade): string {
  if (trade.product !== "DAC" || trade.guaranteedPeriodsMonths === null || !Number.isFinite(trade.guaranteedPeriodsMonths)) return "";
  return `<em class="dac-note">*DAC/DRA第${trade.guaranteedPeriodsMonths + 1}個月起為浮動收益</em>`;
}

function underlyingLabel(value: string): string {
  return value.trim().split(/\s+/u)[0] || value;
}

export function renderQuoteCardHtml(issuer: string, trades: QuoteCardTrade[], rfqCode = ""): string {
  const theme = THEMES[issuer] ?? THEMES.BNP!;
  const cards = trades.map(trade => `
    <article class="trade-card">
      <header class="card-hero">
        <span class="trade-index">#${escapeHtml(trade.sequence)}</span>
        <div class="hero-row">
          <div><h1>${escapeHtml(trade.product)} 報價</h1><p>（${escapeHtml(trade.currency)} 本金）</p></div>
          <strong>${escapeHtml(trade.issuer)}</strong>
        </div>
      </header>
      <section class="summary pair">
        <div><small>期間</small><b>${months(trade.tenorMonths)}</b></div>
        <div><small>年化收益率</small><b class="highlight">${percent(trade.couponPaPct)}</b></div>
      </section>
      <section class="underlying-block">
        <small>連結標的</small>
        <div class="underlyings">${trade.underlyings.map(value => `<span>${escapeHtml(underlyingLabel(value))}</span>`).join("")}</div>
      </section>
      <section class="pair terms-row">
        <div><small>執行價</small><b>${percent(trade.strikePct)}</b></div>
        <div><small>觸及生效價 KI</small><b>${percent(trade.kiBarrierPct)}</b><em>${escapeHtml(trade.barrierType || "—")}</em></div>
      </section>
      <section class="pair terms-row">
        <div><small>保證配息期間</small><b>${months(trade.guaranteedPeriodsMonths)}</b>${dacFloatingNote(trade)}</div>
        <div><small>提前出場價 KO</small><b>${percent(trade.koBarrierPct)}</b><em>${escapeHtml(trade.koType || "—")}</em></div>
      </section>
      <footer>
        <div class="footer-meta"><span>發行機構：${escapeHtml(trade.issuerDisplayName)}</span><span>報價日期：${escapeHtml(trade.tradeDate || "—")}</span></div>
        <div class="rfq-reference">RFQ 編號：${escapeHtml(rfqCode ? `[RFQ:${rfqCode}]` : "—")}</div>
      </footer>
    </article>`).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}html,body{margin:0;background:#fff;color:#153445;font-family:Arial,"Microsoft JhengHei","Noto Sans TC",sans-serif}
    body{width:720px;padding:18px;background:linear-gradient(160deg,#f6fafb,#edf5f6)}main{display:grid;gap:22px}
    .trade-card{overflow:hidden;border:1px solid #b8d3da;border-radius:22px;background:#fff;box-shadow:0 10px 28px rgba(13,69,88,.14)}
    .card-hero{min-height:200px;padding:26px 32px;background:linear-gradient(130deg,${theme.primary},${theme.accent});color:#fff}.trade-index{font-size:27px;font-weight:900}.hero-row{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:20px}.hero-row h1{margin:0;font-size:48px;line-height:1.05;letter-spacing:.5px}.hero-row p{margin:14px 0 0;font-size:29px}.hero-row>strong{font-size:31px;letter-spacing:.5px;text-align:right}
    .pair{display:grid;grid-template-columns:1fr 1fr}.pair>div{padding:28px 32px}.pair>div+div{border-left:1px solid #bdd7de}.pair small,.underlying-block>small{display:block;color:#286174;font-size:25px;line-height:1.25}.pair b{display:block;margin-top:18px;color:#153445;font-size:40px;line-height:1.1}.pair b.highlight{color:${theme.primary};font-size:44px}
    .summary{min-height:174px;background:${theme.soft};border-bottom:1px solid #bdd7de}.underlying-block{min-height:188px;padding:30px 32px;border-bottom:1px solid #c8dce1}.underlyings{display:flex;flex-wrap:wrap;gap:14px 16px;margin-top:24px}.underlyings span{padding:10px 18px;border-radius:9px;background:#e7f2f4;color:#153f54;font-size:34px;font-weight:900;line-height:1.15}
    .terms-row{min-height:184px;border-bottom:1px solid #c8dce1}.terms-row em{display:block;margin-top:13px;color:${theme.primary};font-size:26px;font-style:normal}.dac-note{display:block;margin-top:12px;color:#b45309;font-size:20px;font-style:normal;font-weight:700;line-height:1.3}
    footer{background:linear-gradient(120deg,${theme.soft},#eef6f7);color:#286174}.footer-meta{display:flex;justify-content:space-between;gap:18px;padding:24px 32px;font-size:20px}.footer-meta span:last-child{text-align:right}.rfq-reference{padding:17px 32px;border-top:1px solid #bdd7de;font-size:19px;font-weight:800;letter-spacing:.35px;overflow-wrap:anywhere}
    @media print{body{padding:0}.trade-card{box-shadow:none}}
  </style></head><body><main>${cards}</main></body></html>`;
}
