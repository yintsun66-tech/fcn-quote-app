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

const THEMES: Record<string, { primary: string; dark: string; accent: string }> = {
  BNP: { primary: "#007a73", dark: "#073b4c", accent: "#3ac6a7" },
  BARCLAYS: { primary: "#0076a8", dark: "#00395d", accent: "#42c4df" },
  MS: { primary: "#1261a0", dark: "#0b2d4d", accent: "#2bb5a3" },
  JPM: { primary: "#145f82", dark: "#0a324b", accent: "#35b993" },
  NOMURA: { primary: "#075c8e", dark: "#092e49", accent: "#31b89a" },
  UBS: { primary: "#0c6388", dark: "#073348", accent: "#2ab29b" },
  DBS: { primary: "#14748b", dark: "#0c3f56", accent: "#42bd8f" },
  SG: { primary: "#0e6683", dark: "#06344b", accent: "#39be94" },
  CITI: { primary: "#075f98", dark: "#073553", accent: "#3cc1a0" },
  GS: { primary: "#176585", dark: "#0c344a", accent: "#55c6a2" },
  CA: { primary: "#087269", dark: "#063f48", accent: "#4bc58e" }
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

export function renderQuoteCardHtml(issuer: string, trades: QuoteCardTrade[]): string {
  const theme = THEMES[issuer] ?? THEMES.BNP!;
  const issuerName = trades[0]?.issuerDisplayName ?? issuer;
  const rows = trades.map(trade => `
    <article class="trade-card">
      <div class="trade-heading">
        <span class="trade-number">${escapeHtml(trade.tradeCode || `T${String(trade.sequence).padStart(2, "0")}`)}</span>
        <strong>${escapeHtml(trade.product)} · ${escapeHtml(trade.currency)} · ${escapeHtml(trade.tenorMonths)}M</strong>
      </div>
      <div class="underlyings">${trade.underlyings.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</div>
      <div class="metrics">
        <div><small>Coupon p.a.</small><b>${percent(trade.couponPaPct)}</b></div>
        <div><small>Strike</small><b>${percent(trade.strikePct)}</b></div>
        <div><small>KO Barrier</small><b>${percent(trade.koBarrierPct)}</b></div>
        <div><small>KI Barrier</small><b>${percent(trade.kiBarrierPct)}</b></div>
        <div><small>Note Price</small><b>${percent(trade.comparablePricePct)}</b></div>
      </div>
      <div class="terms">
        <span>KO：${escapeHtml(trade.koType || "—")}</span>
        <span>KI：${escapeHtml(trade.barrierType || "—")}</span>
        <span>Guaranteed：${escapeHtml(trade.guaranteedPeriodsMonths ?? "—")}M</span>
      </div>
    </article>`).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} html,body{margin:0;background:#fff;color:#082f43;font-family:Arial,"Noto Sans TC",sans-serif}
    body{width:1400px;padding:44px;background:linear-gradient(135deg,#f1fbfc 0%,#fff 48%,#edf8f5 100%)}
    .sheet{border:2px solid ${theme.primary};border-radius:24px;overflow:hidden;background:#fff;box-shadow:0 18px 46px rgba(5,55,76,.14)}
    header{padding:30px 36px;background:linear-gradient(115deg,${theme.dark},${theme.primary});color:#fff;display:flex;justify-content:space-between;align-items:end}
    header small{display:block;margin-bottom:7px;font-size:18px;letter-spacing:2px;color:#c8f5ec} header h1{margin:0;font-size:40px;letter-spacing:.5px}
    header strong{padding:12px 20px;border:1px solid rgba(255,255,255,.45);border-radius:999px;font-size:21px;background:rgba(255,255,255,.1)}
    main{display:grid;gap:20px;padding:28px}.trade-card{border:1px solid #9fd7d1;border-left:9px solid ${theme.accent};border-radius:16px;padding:22px 24px;background:linear-gradient(100deg,#fff,#f3fbfa)}
    .trade-heading{display:flex;gap:16px;align-items:center;font-size:23px}.trade-number{background:${theme.dark};color:#fff;border-radius:9px;padding:7px 12px;font-weight:800}
    .underlyings{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}.underlyings span{font-size:27px;font-weight:900;color:${theme.dark};background:#e3f6f3;border:1px solid #8bd4c8;border-radius:11px;padding:10px 16px}
    .metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.metrics div{background:#fff;border:1px solid #b4d9e2;border-radius:11px;padding:13px;text-align:center}.metrics small{display:block;font-size:16px;color:#396578}.metrics b{display:block;margin-top:5px;font-size:25px;color:${theme.primary}}
    .terms{display:flex;gap:22px;margin-top:17px;padding-top:15px;border-top:1px solid #c9e3e4;font-size:19px;font-weight:700;color:#245568}
    footer{padding:18px 34px;background:#e8f7f5;color:#426776;font-size:15px} @media print{body{padding:0}.sheet{box-shadow:none}}
  </style></head><body><section class="sheet"><header><div><small>STRUCTURED NOTE · INDICATIVE QUOTATION</small><h1>${escapeHtml(issuerName)}</h1></div><strong>FCN QUOTE</strong></header><main>${rows}</main><footer>Indicative terms for reference only. Final terms remain subject to issuer confirmation.</footer></section></body></html>`;
}
