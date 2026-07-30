import { insertAudit, nowIso } from "./db";
import type { AppEnv } from "./types";

// LINE Messaging API push endpoint. Bound exactly so a misconfigured variable can never redirect
// product data to an arbitrary host.
const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

// LINE accepts at most five message objects per push request.
const MAX_MESSAGES_PER_PUSH = 5;

// One product per bubble; a carousel holds up to twelve.
const MAX_BUBBLES_PER_CAROUSEL = 12;

export interface FollowBoardPushProduct {
  productCode: string;
  issuerDisplayName: string;
  product: string | null;
  currency: string | null;
  tradeDate: string;
  expiresAt: string | null;
  couponPaPct: number | null;
  salesFeePct: number | null;
  tenorMonths: number | null;
  guaranteedPeriodsMonths: number | null;
  underlyings: string[];
  strikePct: number | null;
  koBarrierPct: number | null;
  koType: string | null;
  barrierType: string | null;
  kiBarrierPct: number | null;
}

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${Number(value.toFixed(4))}%`;
}

function months(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value} 個月`;
}

function taipeiDay(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return "—";
  // The stored expiry is 00:00 Taipei the day after the last available date, so step back one
  // minute to report the last day the product is actually available.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(parsed.getTime() - 60_000));
}

function row(label: string, value: string, emphasize = false) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#58747b", flex: 4 },
      {
        type: "text",
        text: value,
        size: emphasize ? "lg" : "sm",
        weight: "bold",
        color: emphasize ? "#08745c" : "#153445",
        align: "end",
        flex: 6,
        wrap: true
      }
    ]
  };
}

function bubble(product: FollowBoardPushProduct) {
  const terms = [
    row("交易日期", product.tradeDate),
    row("預估年化", percent(product.couponPaPct), true),
    row("手收", percent(product.salesFeePct), true),
    row("期間", months(product.tenorMonths)),
    row("保證配息", months(product.guaranteedPeriodsMonths)),
    row("連結標的", product.underlyings.length ? product.underlyings.join("、") : "—"),
    row("執行價", percent(product.strikePct)),
    row("提前出場價", `${percent(product.koBarrierPct)}${product.koType ? `（${product.koType}）` : ""}`),
    row("觸及生效價", `${percent(product.kiBarrierPct)}${product.barrierType ? `（${product.barrierType}）` : ""}`),
    row("可跟單至", taipeiDay(product.expiresAt))
  ];
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#0b5c73",
      paddingAll: "14px",
      contents: [
        { type: "text", text: `${product.productCode}｜${product.issuerDisplayName}`, color: "#ffffff", weight: "bold", size: "md", wrap: true },
        { type: "text", text: `${product.product ?? "—"}／${product.currency ?? "—"}`, color: "#cfeae6", size: "xs" }
      ]
    },
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px", contents: terms },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        { type: "text", text: "預估年化配息率，非保證收益；實際條件以發行機構最終文件為準。", size: "xxs", color: "#8a5a00", wrap: true }
      ]
    }
  };
}

export function buildFollowBoardFlexMessage(products: readonly FollowBoardPushProduct[]): unknown {
  const bubbles = products.slice(0, MAX_BUBBLES_PER_CAROUSEL).map(bubble);
  const codes = products.map(item => item.productCode).join("、");
  return {
    type: "flex",
    // The alt text is what shows in the chat list and in push notifications.
    altText: `跟單商品上架：${codes}`.slice(0, 400),
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles }
  };
}

function configured(env: AppEnv): { token: string; groupId: string } | null {
  const token = String(env.LINE_CHANNEL_ACCESS_TOKEN ?? "").trim();
  const groupId = String(env.LINE_GROUP_ID ?? "").trim();
  return token && groupId ? { token, groupId } : null;
}

/**
 * Pushes newly published follow-board products to the configured LINE group.
 *
 * Never throws: publication has already succeeded and committed by the time this runs, so a LINE
 * outage, a revoked token or a rate limit must not fail or roll back the publication.
 */
export async function pushFollowBoardProducts(
  env: AppEnv,
  products: readonly FollowBoardPushProduct[],
  fetcher: typeof fetch = fetch
): Promise<{ sent: boolean; status: number | null; reason?: string }> {
  if (String(env.LINE_PUSH_ENABLED) !== "1") return { sent: false, status: null, reason: "DISABLED" };
  if (!products.length) return { sent: false, status: null, reason: "NO_PRODUCTS" };
  const credentials = configured(env);
  if (!credentials) return { sent: false, status: null, reason: "NOT_CONFIGURED" };

  const messages = [buildFollowBoardFlexMessage(products)].slice(0, MAX_MESSAGES_PER_PUSH);
  let status: number | null = null;
  let reason: string | undefined;
  try {
    const response = await fetcher(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        // The token is only ever placed in this header — never logged, audited or echoed.
        authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json",
        // Lets LINE de-duplicate if we retry the same publication.
        "x-line-retry-key": crypto.randomUUID()
      },
      body: JSON.stringify({ to: credentials.groupId, messages })
    });
    status = response.status;
    if (!response.ok) reason = `HTTP_${response.status}`;
  } catch {
    reason = "REQUEST_FAILED";
  }

  // Counts and a safe status only: no token, group id, quote value or RFQ identifier.
  await insertAudit(env, "FOLLOW_BOARD_LINE_PUSHED", "FOLLOW_BOARD_PRODUCT", null, null, `line:${nowIso()}`, {
    productCount: products.length,
    status,
    ok: !reason,
    ...(reason ? { reason } : {})
  });
  return reason ? { sent: false, status, reason } : { sent: true, status };
}
