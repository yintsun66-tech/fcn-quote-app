import { keyedHash } from "./crypto";
import { insertAudit, nowIso } from "./db";
import { deadlineAt, withDeadline } from "./http";
import { QUOTE_CARD_WIDTH_PX, renderQuoteCardHtml } from "./quote-card";
import type { AppEnv } from "./types";

const FOLLOW_BOARD_RENDER_TIMEOUT_MS = 60 * 1000;
// Total wall clock for every card of one publication, not per card.
const FOLLOW_BOARD_RENDER_BUDGET_MS = 90 * 1000;
const LINE_PUSH_TIMEOUT_MS = 15 * 1000;
// One retry only. A 429 caused by a monthly cap will never clear on this timescale, so a longer
// ladder would just hold the consumer open for nothing; a rate limit or a transient 5xx does clear.
const MAX_PUSH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2 * 1000;
const RETRY_DELAY_CAP_MS = 5 * 1000;
// LINE's error body is `{ message, details }`. Only `message` is kept, and only this much of it.
const PROVIDER_MESSAGE_MAX = 200;

// Follow-board card images pushed to LINE. LINE fetches an image itself and sends no credentials,
// so the object must be reachable without authentication. Access control is therefore the
// unguessable key: an HMAC of the product code under EMPLOYEE_LOOKUP_KEY. Deriving it removes the
// need for a migration to store a token, and it cannot be enumerated without the secret.
//
// The image intentionally carries product conditions only. `renderQuoteCardHtml` contains no 手收
// (that line is added by the follow-board frontend under ADR 0029), so the sales fee never reaches
// a public URL — it is sent as text inside the designated user's private LINE chat instead.
export const FOLLOW_BOARD_IMAGE_PREFIX = "follow-board-images/v1/";

export async function followBoardImageToken(env: AppEnv, productCode: string): Promise<string> {
  return keyedHash(env.EMPLOYEE_LOOKUP_KEY, `follow-board-image:${productCode.toUpperCase()}`);
}

export function followBoardImageKey(token: string): string {
  return `${FOLLOW_BOARD_IMAGE_PREFIX}${token}.png`;
}

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

/**
 * Renders one product-conditions card server-side and stores it for LINE to fetch.
 *
 * Returns null on any failure so the caller can still push the text message: an image is a
 * convenience, and losing it must not cost the operator the trade date and sales fee.
 */
export async function renderFollowBoardImage(
  env: AppEnv,
  product: FollowBoardPushProduct,
  deadline: number = deadlineAt(FOLLOW_BOARD_RENDER_TIMEOUT_MS)
): Promise<string | null> {
  const publicBase = String(env.FOLLOW_BOARD_PUBLIC_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!publicBase) return null;
  // Checked before the call, not only around it: `withDeadline` can bound a request that is already
  // in flight, but only an early return keeps an exhausted budget from taking a Browser Rendering
  // slot at all.
  if (deadline <= Date.now()) return null;
  try {
    const html = renderQuoteCardHtml(product.issuerDisplayName, [{
      sequence: 1,
      tradeCode: product.productCode,
      product: product.product ?? "FCN",
      currency: product.currency ?? "",
      issuer: product.issuerDisplayName,
      issuerDisplayName: product.issuerDisplayName,
      tradeDate: product.tradeDate,
      tenorMonths: product.tenorMonths,
      guaranteedPeriodsMonths: product.guaranteedPeriodsMonths,
      underlyings: product.underlyings,
      couponPaPct: product.couponPaPct,
      strikePct: product.strikePct,
      koBarrierPct: product.koBarrierPct,
      koType: product.koType,
      barrierType: product.barrierType,
      kiBarrierPct: product.kiBarrierPct,
      // The card renders no 手收; the comparable price is not a sales fee and is required for the
      // DAC floating-income note only.
      comparablePricePct: null
    }], "");
    // This runs after a publication has already committed, so a stalled render must not hold the
    // invocation open; the catch below then pushes the text message without an image.
    const response = await withDeadline(env.BROWSER.quickAction("screenshot", {
      html,
      viewport: { width: QUOTE_CARD_WIDTH_PX, height: 1280, deviceScaleFactor: 1.5 },
      screenshotOptions: { type: "png", fullPage: true },
      gotoOptions: { waitUntil: "networkidle0" }
    }), deadline, "BROWSER_RENDER_TIMEOUT");
    if (!response.ok) return null;
    const bytes = await withDeadline(response.arrayBuffer(), deadline, "BROWSER_RENDER_TIMEOUT");
    const token = await followBoardImageToken(env, product.productCode);
    await env.RAW_MAIL_BUCKET.put(followBoardImageKey(token), bytes, {
      httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=86400" }
    });
    return `${publicBase}/api/v1/public/follow-board/images/${token}.png`;
  } catch {
    return null;
  }
}

/**
 * Serves a follow-board card image to LINE. Deliberately unauthenticated — LINE fetches the image
 * with no credentials — so the unguessable keyed token is the access control. Only a well-formed
 * token is accepted, and nothing about the product is revealed on a miss.
 */
export async function getFollowBoardImage(env: AppEnv, token: string): Promise<Response> {
  // keyedHash returns base64url, so the token alphabet is A-Z a-z 0-9 _ - and never a path
  // separator or dot. Anything else is rejected before it can reach the bucket.
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return new Response("Not found", { status: 404 });
  }
  const object = await env.RAW_MAIL_BUCKET.get(followBoardImageKey(token));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff"
    }
  });
}

/**
 * Verifies a LINE webhook signature: base64(HMAC-SHA256(channelSecret, rawBody)).
 *
 * LINE uses standard base64 here, not the base64url that `keyedHash` produces, so the encoding is
 * done locally. Comparison is length-checked and constant-time to avoid leaking the expected value.
 */
async function verifyLineSignature(secret: string, rawBody: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  let binary = "";
  for (const byte of mac) binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * Temporary discovery endpoint for the LINE group id, which is only ever delivered inside a webhook
 * event — the LINE console does not display it.
 *
 * Off unless `LINE_WEBHOOK_ENABLED="1"` and `LINE_CHANNEL_SECRET` is set, so it is not a standing
 * open endpoint. Every request must carry a valid signature, so only LINE can write to the audit
 * trail. Disable it again once the group id has been captured.
 */
export async function handleLineWebhook(request: Request, env: AppEnv): Promise<Response> {
  if (String(env.LINE_WEBHOOK_ENABLED) !== "1") return new Response("Not found", { status: 404 });
  const secret = String(env.LINE_CHANNEL_SECRET ?? "").trim();
  const signature = request.headers.get("x-line-signature") ?? "";
  if (!secret || !signature) return new Response("Not found", { status: 404 });

  const rawBody = await request.text();
  if (!(await verifyLineSignature(secret, rawBody, signature))) {
    // Never reveal whether the secret or the signature was wrong.
    return new Response("Unauthorized", { status: 401 });
  }

  let sources: Array<{ type?: string; groupId?: string; roomId?: string }> = [];
  try {
    const parsed = JSON.parse(rawBody) as { events?: Array<{ source?: Record<string, unknown> }> };
    sources = (parsed.events ?? []).map(event => (event.source ?? {}) as typeof sources[number]);
  } catch {
    sources = [];
  }
  for (const source of sources) {
    const id = source.groupId ?? source.roomId;
    if (!id) continue;
    // The id is configuration, not personal data: it names a chat, never a member. No user id,
    // display name or message text is recorded.
    await insertAudit(env, "LINE_SOURCE_DISCOVERED", "SYSTEM", null, null, `line-webhook:${nowIso()}`, {
      sourceType: source.type ?? "unknown",
      id
    });
  }
  // LINE retries on a non-2xx, so always acknowledge once the signature is valid.
  return new Response("OK", { status: 200 });
}

/**
 * Extracts LINE's own explanation of a failure, which is the only thing that distinguishes a
 * monthly-cap 429 from a rate-limit 429. A status code alone does not.
 *
 * Only the `message` string is kept, never the whole body, and any LINE identifier inside it is
 * redacted first: the destination user id must never reach an audit row, however it arrives.
 */
export function safeProviderMessage(body: string): string | undefined {
  let message: string;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message !== "string" || !parsed.message) return undefined;
    message = parsed.message;
  } catch {
    // Not LINE's JSON error shape — a proxy page or an empty body. Recording arbitrary bytes from
    // upstream is exactly what this module avoids, so nothing is kept.
    return undefined;
  }
  return message.replace(/\b[CURU][0-9a-f]{32}\b/g, "[id]").slice(0, PROVIDER_MESSAGE_MAX);
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

// LINE may state how long to wait. Honour it, but never longer than the cap, so one push cannot
// stall the queue consumer that already committed the publication.
function retryDelayMs(response: { headers: { get(name: string): string | null } }): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, RETRY_DELAY_CAP_MS);
  return RETRY_DELAY_MS;
}

function configured(env: AppEnv): { token: string; userId: string } | null {
  const token = String(env.LINE_CHANNEL_ACCESS_TOKEN ?? "").trim();
  const userId = String(env.LINE_USER_ID ?? "").trim();
  // Fail closed on a group (C...) or room (R...) id. This route is intentionally personal-only.
  return token && /^U[0-9a-f]{32}$/i.test(userId) ? { token, userId } : null;
}

/**
 * Pushes newly published follow-board products to one configured LINE user's private chat.
 *
 * Never throws: publication has already succeeded and committed by the time this runs, so a LINE
 * outage, a revoked token or a rate limit must not fail or roll back the publication.
 */
export async function pushFollowBoardProducts(
  env: AppEnv,
  products: readonly FollowBoardPushProduct[],
  fetcher: typeof fetch = fetch,
  // Injectable so the retry path can be tested without spending its delay in the suite.
  sleep: (milliseconds: number) => Promise<void> =
    milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
): Promise<{ sent: boolean; status: number | null; reason?: string }> {
  if (String(env.LINE_PUSH_ENABLED) !== "1") return { sent: false, status: null, reason: "DISABLED" };
  if (!products.length) return { sent: false, status: null, reason: "NO_PRODUCTS" };
  const credentials = configured(env);
  if (!credentials) return { sent: false, status: null, reason: "NOT_CONFIGURED" };

  // Product-conditions images first, then one Flex message carrying the trade date and 手收.
  // Keeping the sales fee out of the image is deliberate: the image sits behind a public URL for
  // LINE to fetch, while the text stays inside the private one-to-one chat.
  // The renders stay sequential on purpose — Browser Rendering concurrency is the documented
  // constraint — but they share one budget rather than getting a fresh timeout each. Four products
  // with a per-render timeout could otherwise hold this invocation for four times that number,
  // after the publication has already committed and with the message still unsent. When the budget
  // runs out the remaining cards are simply dropped: the text message carries what matters.
  const images: unknown[] = [];
  const renderBudget = deadlineAt(FOLLOW_BOARD_RENDER_BUDGET_MS);
  for (const product of products.slice(0, MAX_MESSAGES_PER_PUSH - 1)) {
    const perRender = Math.min(deadlineAt(FOLLOW_BOARD_RENDER_TIMEOUT_MS), renderBudget);
    if (perRender <= Date.now()) break;
    const url = await renderFollowBoardImage(env, product, perRender);
    if (url) images.push({ type: "image", originalContentUrl: url, previewImageUrl: url });
  }
  const messages = [...images, buildFollowBoardFlexMessage(products)].slice(0, MAX_MESSAGES_PER_PUSH);
  // One key for the whole push, reused across attempts. That is what it is for: if an attempt
  // actually reached LINE but the response was lost, the retry is de-duplicated rather than
  // delivered twice. A fresh key per attempt would defeat it.
  const retryKey = crypto.randomUUID();
  let status: number | null = null;
  let reason: string | undefined;
  let providerMessage: string | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    status = null;
    reason = undefined;
    providerMessage = undefined;
    let delayMs = RETRY_DELAY_MS;
    try {
      // An AbortSignal actually cancels the request. Racing a timer instead would leave the call in
      // flight, so LINE could still deliver the message while the audit recorded a timeout.
      const response = await fetcher(LINE_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          // The token is only ever placed in this header — never logged, audited or echoed.
          authorization: `Bearer ${credentials.token}`,
          "content-type": "application/json",
          "x-line-retry-key": retryKey
        },
        body: JSON.stringify({ to: credentials.userId, messages }),
        signal: AbortSignal.timeout(LINE_PUSH_TIMEOUT_MS)
      });
      status = response.status;
      if (response.ok) break;
      reason = `HTTP_${response.status}`;
      // Reading the body must never turn a failed push into a thrown one.
      try {
        providerMessage = safeProviderMessage(await response.text());
      } catch {
        providerMessage = undefined;
      }
      if (!retryable(response.status)) break;
      delayMs = retryDelayMs(response);
    } catch (error) {
      // AbortSignal.timeout rejects with TimeoutError; an explicit abort would be AbortError.
      const name = error instanceof Error ? error.name : "";
      reason = name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "REQUEST_FAILED";
    }
    if (attempt < MAX_PUSH_ATTEMPTS) await sleep(delayMs);
  }

  // Counts, a safe status and LINE's own explanation. Never the token, user id, quote value or any
  // RFQ identifier — `safeProviderMessage` redacts an identifier even if LINE echoes one back.
  await insertAudit(env, "FOLLOW_BOARD_LINE_PUSHED", "FOLLOW_BOARD_PRODUCT", null, null, `line:${nowIso()}`, {
    productCount: products.length,
    status,
    ok: !reason,
    attempts,
    ...(reason ? { reason } : {}),
    ...(providerMessage ? { providerMessage } : {})
  });
  return reason ? { sent: false, status, reason } : { sent: true, status };
}
