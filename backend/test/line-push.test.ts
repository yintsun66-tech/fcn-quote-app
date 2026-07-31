import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildFollowBoardFlexMessage,
  getFollowBoardImage,
  handleLineWebhook,
  pushFollowBoardProducts,
  renderFollowBoardImage,
  safeProviderMessage
} from "../src/line-push";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

const PRODUCT = {
  productCode: "PBZL",
  issuerDisplayName: "BNP",
  product: "FCN",
  currency: "USD",
  tradeDate: "2026-07-21",
  expiresAt: "2026-07-30T16:00:00.000Z",
  couponPaPct: 15.46,
  salesFeePct: 2,
  tenorMonths: 12,
  guaranteedPeriodsMonths: 1,
  underlyings: ["TSM UN"],
  strikePct: 85,
  koBarrierPct: 110,
  koType: "Daily Memory",
  barrierType: "NONE",
  kiBarrierPct: null
};

function lineEnv(overrides: Record<string, unknown> = {}): AppEnv {
  return {
    ...testEnv,
    LINE_PUSH_ENABLED: "1",
    LINE_CHANNEL_ACCESS_TOKEN: "test-token-must-never-be-logged",
    LINE_GROUP_ID: "Cgroup123",
    ...overrides
  } as unknown as AppEnv;
}

describe("LINE follow-board push", () => {
  it("stays off until explicitly enabled and configured", async () => {
    let called = false;
    const spy = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;

    expect(await pushFollowBoardProducts(lineEnv({ LINE_PUSH_ENABLED: "0" }), [PRODUCT], spy))
      .toMatchObject({ sent: false, reason: "DISABLED" });
    expect(await pushFollowBoardProducts(lineEnv({ LINE_CHANNEL_ACCESS_TOKEN: "" }), [PRODUCT], spy))
      .toMatchObject({ sent: false, reason: "NOT_CONFIGURED" });
    expect(await pushFollowBoardProducts(lineEnv({ LINE_GROUP_ID: "" }), [PRODUCT], spy))
      .toMatchObject({ sent: false, reason: "NOT_CONFIGURED" });
    expect(called).toBe(false);
  });

  it("posts to the bound LINE endpoint with the trade date and sales fee", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await pushFollowBoardProducts(lineEnv(), [PRODUCT], spy);
    expect(result).toMatchObject({ sent: true, status: 200 });
    expect(seen!.url).toBe("https://api.line.me/v2/bot/message/push");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-token-must-never-be-logged");
    expect(headers["x-line-retry-key"]).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(String(seen!.init.body));
    expect(body.to).toBe("Cgroup123");
    expect(body.messages).toHaveLength(1);
    const rendered = JSON.stringify(body.messages[0]);
    expect(rendered).toContain("PBZL");
    expect(rendered).toContain("手收");
    expect(rendered).toContain("2%");
    expect(rendered).toContain("交易日期");
    expect(rendered).toContain("2026-07-21");
    // The public snapshot only: no RFQ, correlation or account identifier may travel to LINE.
    expect(rendered).not.toMatch(/rfq_|usr_|employee|branch|correlation/i);
  });

  it("never throws and never records the token when LINE fails", async () => {
    const failing = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const result = await pushFollowBoardProducts(lineEnv(), [PRODUCT], failing);
    expect(result).toMatchObject({ sent: false, reason: "REQUEST_FAILED" });

    const rejecting = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    expect(await pushFollowBoardProducts(lineEnv(), [PRODUCT], rejecting))
      .toMatchObject({ sent: false, status: 429, reason: "HTTP_429" });

    const audits = await testEnv.DB.prepare(
      `SELECT safe_metadata_json FROM audit_events
        WHERE action = 'FOLLOW_BOARD_LINE_PUSHED' ORDER BY created_at DESC LIMIT 5`
    ).all<{ safe_metadata_json: string }>();
    expect(audits.results.length).toBeGreaterThan(0);
    for (const audit of audits.results) {
      expect(audit.safe_metadata_json).not.toContain("test-token-must-never-be-logged");
      expect(audit.safe_metadata_json).not.toContain("Cgroup123");
    }
  });

  // Production returned 429 on the first real publication (PBZJ, 2026-07-31) and the audit recorded
  // only the status, which cannot distinguish a monthly cap from a rate limit. These pin the fix.
  it("records LINE's own explanation of a failure, with any identifier redacted", async () => {
    const bodies = [
      // The real shape: LINE's JSON error object.
      { body: JSON.stringify({ message: "You have reached your monthly limit." }), expected: "You have reached your monthly limit." },
      // An identifier echoed back must not survive into the audit row.
      { body: JSON.stringify({ message: "Invalid to: C0123456789abcdef0123456789abcdef" }), expected: "Invalid to: [id]" },
      // Anything that is not LINE's shape is dropped rather than stored verbatim.
      { body: "<html>gateway error</html>", expected: undefined },
      { body: "", expected: undefined }
    ];
    for (const item of bodies) {
      expect(safeProviderMessage(item.body)).toBe(item.expected);
    }
    // Long messages are truncated rather than stored whole.
    const long = JSON.stringify({ message: "x".repeat(500) });
    expect(safeProviderMessage(long)!.length).toBe(200);
  });

  it("retries a 429 once with the same retry key, and audits the reason", async () => {
    const keys: string[] = [];
    let calls = 0;
    let slept = 0;
    const flaky = (async (_url: string, init: RequestInit) => {
      calls += 1;
      keys.push(String((init.headers as Record<string, string>)["x-line-retry-key"]));
      if (calls === 1) {
        return new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
          status: 429, headers: { "retry-after": "1" }
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await pushFollowBoardProducts(lineEnv(), [PRODUCT], flaky, async ms => { slept = ms; });
    expect(result).toMatchObject({ sent: true, status: 200 });
    expect(calls).toBe(2);
    // The same key both times: that is what lets LINE de-duplicate rather than deliver twice.
    expect(keys[0]).toBe(keys[1]);
    // Retry-After is honoured.
    expect(slept).toBe(1_000);

    const audit = await testEnv.DB.prepare(
      `SELECT safe_metadata_json FROM audit_events
        WHERE action = 'FOLLOW_BOARD_LINE_PUSHED' ORDER BY created_at DESC LIMIT 1`
    ).first<{ safe_metadata_json: string }>();
    expect(audit?.safe_metadata_json).toContain('"attempts":2');
    expect(audit?.safe_metadata_json).toContain('"ok":true');
  });

  it("stops after the retry and records why, without retrying a rejection", async () => {
    let capped = 0;
    const capping = (async () => {
      capped += 1;
      return new Response(JSON.stringify({ message: "You have reached your monthly limit." }), { status: 429 });
    }) as unknown as typeof fetch;
    expect(await pushFollowBoardProducts(lineEnv(), [PRODUCT], capping, async () => {}))
      .toMatchObject({ sent: false, status: 429, reason: "HTTP_429" });
    expect(capped).toBe(2);

    const audit = await testEnv.DB.prepare(
      `SELECT safe_metadata_json FROM audit_events
        WHERE action = 'FOLLOW_BOARD_LINE_PUSHED' ORDER BY created_at DESC LIMIT 1`
    ).first<{ safe_metadata_json: string }>();
    expect(audit?.safe_metadata_json).toContain("monthly limit");
    expect(audit?.safe_metadata_json).toContain('"attempts":2');

    // A 4xx that is not 429 is the caller's fault and will fail identically, so it is not retried.
    let rejected = 0;
    const rejecting = (async () => {
      rejected += 1;
      return new Response(JSON.stringify({ message: "The request body has 1 error(s)" }), { status: 400 });
    }) as unknown as typeof fetch;
    expect(await pushFollowBoardProducts(lineEnv(), [PRODUCT], rejecting, async () => {}))
      .toMatchObject({ sent: false, status: 400, reason: "HTTP_400" });
    expect(rejected).toBe(1);
  });

  it("aborts a stalled push and records it as a timeout, not a generic failure", async () => {
    // AbortSignal.timeout actually cancels the request, so LINE cannot still deliver a message the
    // audit has written off. The reason must stay distinguishable from a refused connection.
    let sawSignal = false;
    const aborting = (async (_url: string, init: RequestInit) => {
      sawSignal = init.signal instanceof AbortSignal;
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;

    expect(await pushFollowBoardProducts(lineEnv(), [PRODUCT], aborting))
      .toMatchObject({ sent: false, reason: "TIMEOUT" });
    expect(sawSignal).toBe(true);
  });

  it("skips a card once the shared render budget is spent", async () => {
    let renders = 0;
    const budgetEnv = {
      ...lineEnv(),
      FOLLOW_BOARD_PUBLIC_ORIGIN: "https://api.yintsun66.com",
      BROWSER: { async quickAction() { renders += 1; throw new Error("unreachable"); } }
    } as unknown as AppEnv;

    // An exhausted deadline must stop the render before it reaches Browser Rendering: the renders
    // are sequential by design, so without a shared budget four cards could hold the invocation for
    // four times the per-render timeout, after the publication has already committed.
    expect(await renderFollowBoardImage(budgetEnv, PRODUCT, Date.now() - 1)).toBeNull();
    expect(renders).toBe(0);
  });

  it("reports the last available day in Taipei, not the stored UTC expiry instant", () => {
    // expires_at is 00:00 Taipei the following day, so the last usable day is 2026-07-30.
    const rendered = JSON.stringify(buildFollowBoardFlexMessage([PRODUCT]));
    expect(rendered).toContain("2026-07-30");
  });

  it("keeps 手收 out of the public image and serves it only as private LINE text", async () => {
    const stored: Record<string, ArrayBuffer> = {};
    let renderedHtml = "";
    const imageEnv = {
      ...lineEnv(),
      FOLLOW_BOARD_PUBLIC_ORIGIN: "https://api.yintsun66.com",
      BROWSER: {
        async quickAction(_action: string, options: { html: string }) {
          renderedHtml = options.html;
          return { ok: true, async arrayBuffer() { return new Uint8Array([137, 80, 78, 71]).buffer; } };
        }
      },
      RAW_MAIL_BUCKET: {
        async put(key: string, bytes: ArrayBuffer) { stored[key] = bytes; },
        async get(key: string) {
          return stored[key] ? { body: stored[key] } : null;
        }
      }
    } as unknown as AppEnv;

    let body: Record<string, any> = {};
    const spy = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await pushFollowBoardProducts(imageEnv, [PRODUCT], spy);
    expect(result.sent).toBe(true);

    // The rendered card must carry product conditions but never the sales fee. The card shortens a
    // Bloomberg code to its ticker, so "TSM UN" renders as "TSM".
    expect(renderedHtml).toContain("TSM");
    expect(renderedHtml).toContain("15.46");
    expect(renderedHtml).not.toContain("手收");

    // An image message plus the Flex text, in that order.
    expect(body.messages[0].type).toBe("image");
    expect(body.messages[0].originalContentUrl).toMatch(
      /^https:\/\/api\.yintsun66\.com\/api\/v1\/public\/follow-board\/images\/[A-Za-z0-9_-]{32,128}\.png$/
    );
    // 手收 travels only inside the private group message.
    expect(JSON.stringify(body.messages[1])).toContain("手收");

    // The public URL must not leak the product code or any identifier.
    expect(body.messages[0].originalContentUrl).not.toContain("PBZL");

    const token = String(body.messages[0].originalContentUrl).split("/").pop()!.replace(".png", "");
    const served = await getFollowBoardImage(imageEnv, token);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    // A malformed or unknown token reveals nothing.
    expect((await getFollowBoardImage(imageEnv, "../../etc/passwd")).status).toBe(404);
    expect((await getFollowBoardImage(imageEnv, "short")).status).toBe(404);
    expect((await getFollowBoardImage(imageEnv, "a".repeat(64))).status).toBe(404);
  });

  it("still sends the trade date and 手收 when image rendering fails", async () => {
    const brokenEnv = {
      ...lineEnv(),
      FOLLOW_BOARD_PUBLIC_ORIGIN: "https://api.yintsun66.com",
      BROWSER: { async quickAction() { throw new Error("browser rendering down"); } },
      RAW_MAIL_BUCKET: { async put() { /* unreachable */ } }
    } as unknown as AppEnv;
    let body: Record<string, any> = {};
    const spy = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await pushFollowBoardProducts(brokenEnv, [PRODUCT], spy);
    expect(result.sent).toBe(true);
    expect(body.messages).toHaveLength(1);
    expect(JSON.stringify(body.messages[0])).toContain("手收");
  });

  it("only accepts a correctly signed webhook and records the group id", async () => {
    const secret = "channel-secret-for-tests";
    const body = JSON.stringify({
      events: [{ type: "join", source: { type: "group", groupId: "Cabcdef1234567890" } }]
    });
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
    let binary = "";
    for (const byte of mac) binary += String.fromCharCode(byte);
    const signature = btoa(binary);

    const call = (env: AppEnv, headers: Record<string, string>) =>
      handleLineWebhook(new Request("https://api.yintsun66.com/api/v1/public/line/webhook", {
        method: "POST", headers, body
      }), env);

    const enabled = { ...testEnv, LINE_WEBHOOK_ENABLED: "1", LINE_CHANNEL_SECRET: secret } as unknown as AppEnv;

    // Disabled by default, so it is not a standing open endpoint.
    expect((await call({ ...testEnv, LINE_WEBHOOK_ENABLED: "0" } as unknown as AppEnv,
      { "x-line-signature": signature })).status).toBe(404);
    // A wrong or missing signature is rejected, and the reason is never disclosed.
    expect((await call(enabled, { "x-line-signature": "AAAA" })).status).toBe(401);
    expect((await call(enabled, {})).status).toBe(404);
    // A valid signature is acknowledged so LINE stops retrying.
    expect((await call(enabled, { "x-line-signature": signature })).status).toBe(200);

    const audit = await testEnv.DB.prepare(
      `SELECT safe_metadata_json FROM audit_events
        WHERE action = 'LINE_SOURCE_DISCOVERED' ORDER BY created_at DESC LIMIT 1`
    ).first<{ safe_metadata_json: string }>();
    expect(audit?.safe_metadata_json).toContain("Cabcdef1234567890");
    // The chat id is configuration; no member identity or message text is stored.
    expect(audit?.safe_metadata_json).not.toContain(secret);
  });

  it("renders one bubble per product as a carousel", () => {
    const single = buildFollowBoardFlexMessage([PRODUCT]) as { contents: { type: string } };
    expect(single.contents.type).toBe("bubble");
    const many = buildFollowBoardFlexMessage([PRODUCT, { ...PRODUCT, productCode: "PBZM" }]) as {
      contents: { type: string; contents: unknown[] };
    };
    expect(many.contents.type).toBe("carousel");
    expect(many.contents.contents).toHaveLength(2);
  });
});
