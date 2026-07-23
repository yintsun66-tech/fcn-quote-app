import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const BASE_URL = "https://api.yintsun66.com";
const PASSWORD = "Correct Horse Battery 123!";
let userA: { cookie: string; csrf: string };
let userB: { cookie: string; csrf: string };

async function api(path: string, init: RequestInit = {}, ip = "203.0.113.10"): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", BASE_URL);
  headers.set("cf-connecting-ip", ip);
  if (init.body) headers.set("content-type", "application/json");
  const context = createExecutionContext();
  const request = new Request(`${BASE_URL}${path}`, { ...init, headers }) as unknown as Request<unknown, IncomingRequestCfProperties>;
  const response = await worker.fetch(request, testEnv, context);
  await waitOnExecutionContext(context);
  return response;
}

function authentication(response: Response): { cookie: string; csrf: string } {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const session = /__Host-fcn_session=([^;,]+)/.exec(setCookie)?.[1];
  const csrf = /__Host-fcn_csrf=([^;,]+)/.exec(setCookie)?.[1];
  if (!session || !csrf) throw new Error("Authentication cookies were not returned");
  return { cookie: `__Host-fcn_session=${session}; __Host-fcn_csrf=${csrf}`, csrf };
}

async function createActiveUser(username: string, employeeNumber: string, ip: string): Promise<{ cookie: string; csrf: string }> {
  await api("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      employeeNumber,
      branchName: "RFQ 測試分行",
      displayName: username,
      username,
      password: PASSWORD
    })
  }, ip);
  await testEnv.DB.prepare("UPDATE users SET status = 'ACTIVE' WHERE username_normalized = ?").bind(username).run();
  const login = await api("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password: PASSWORD })
  }, ip);
  if (login.status !== 200) throw new Error(`Unable to log in test user: ${login.status}`);
  return authentication(login);
}

function trade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: "FCN",
    currency: "USD",
    tradeDate: "21-Jul-26",
    effectiveDateOffsetCalendarDays: 7,
    tenorMonths: 12,
    guaranteedPeriodsMonths: 1,
    underlyings: ["AAPL UW", "MSFT UW"],
    strikePct: 85,
    koType: "Daily Memory",
    koBarrierPct: 110,
    couponPaPct: null,
    upfrontOrNotePricePct: 98,
    barrierType: "NONE",
    kiBarrierPct: null,
    observationFrequencyMonths: 1,
    otc: "Note",
    ...overrides
  };
}

async function createRfq(auth: { cookie: string; csrf: string }, trades: unknown[], key = `idem-${crypto.randomUUID()}`): Promise<Response> {
  return api("/api/v1/rfqs", {
    method: "POST",
    headers: {
      cookie: auth.cookie,
      "x-csrf-token": auth.csrf,
      "idempotency-key": key
    },
    body: JSON.stringify({ trades })
  });
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  userA = await createActiveUser("rfqusera", "22345", "203.0.113.11");
  userB = await createActiveUser("rfquserb", "22346", "203.0.113.12");
});

describe("RFQ API", () => {
  it("creates one to twenty trades and assigns the target field", async () => {
    const response = await createRfq(userA, Array.from({ length: 20 }, (_, index) => trade({ underlyings: [`TEST${index} UW`] })));
    expect(response.status).toBe(201);
    const body = await response.json<{ rfq: { tradeCount: number; trades: Array<{ tradeCode: string; targetField: string }> } }>();
    expect(body.rfq.tradeCount).toBe(20);
    expect(body.rfq.trades[0]).toMatchObject({ tradeCode: "T01", targetField: "COUPON" });
    expect(body.rfq.trades[19]).toMatchObject({ tradeCode: "T20", targetField: "COUPON" });
  });

  it("rejects more than twenty trades and invalid blank-field rules", async () => {
    const tooMany = await createRfq(userA, Array.from({ length: 21 }, () => trade()));
    expect(tooMany.status).toBe(422);
    const multipleBlanks = await createRfq(userA, [trade({ couponPaPct: null, strikePct: null })]);
    expect(multipleBlanks.status).toBe(422);
    const noneWithKi = await createRfq(userA, [trade({ couponPaPct: 15, kiBarrierPct: 65 })]);
    expect(noneWithKi.status).toBe(422);
  });

  it("replays identical idempotent creates and rejects key reuse with different content", async () => {
    const key = `idem-${crypto.randomUUID()}`;
    const first = await createRfq(userA, [trade()], key);
    const second = await createRfq(userA, [trade()], key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json<{ rfq: { id: string } }>();
    const secondBody = await second.json<{ rfq: { id: string } }>();
    expect(secondBody.rfq.id).toBe(firstBody.rfq.id);
    const conflict = await createRfq(userA, [trade({ tenorMonths: 6 })], key);
    expect(conflict.status).toBe(409);
  });

  it("enforces ownership without disclosing another user's RFQ", async () => {
    const created = await createRfq(userA, [trade()]);
    const body = await created.json<{ rfq: { id: string } }>();
    const own = await api(`/api/v1/rfqs/${body.rfq.id}`, { headers: { cookie: userA.cookie } });
    expect(own.status).toBe(200);
    const other = await api(`/api/v1/rfqs/${body.rfq.id}`, { headers: { cookie: userB.cookie } });
    expect(other.status).toBe(404);
  });

  it("lists only the current user's RFQs with scopes and stable pagination", async () => {
    const activeCreated = await createRfq(userA, [trade({ underlyings: ["ACTIVE UW"] })]);
    const activeId = (await activeCreated.json<{ rfq: { id: string } }>()).rfq.id;
    const completedCreated = await createRfq(userA, [trade({ underlyings: ["DONE UW"] })]);
    const completedId = (await completedCreated.json<{ rfq: { id: string } }>()).rfq.id;
    const foreignCreated = await createRfq(userB, [trade({ underlyings: ["FOREIGN UW"] })]);
    const foreignId = (await foreignCreated.json<{ rfq: { id: string } }>()).rfq.id;
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `UPDATE rfqs
            SET workflow_status = 'WAITING', dispatch_status = 'WAITING',
                status = 'VALIDATED', expected_issuer_count = 11,
                created_at = '2099-01-03T00:00:00.000Z'
          WHERE id = ?`
      ).bind(activeId),
      testEnv.DB.prepare(
        `UPDATE rfqs
            SET workflow_status = 'COMPLETED', dispatch_status = 'WAITING',
                status = 'VALIDATED', current_ranking_version = 1,
                created_at = '2099-01-02T00:00:00.000Z',
                finalized_at = '2099-01-02T00:15:00.000Z'
          WHERE id = ?`
      ).bind(completedId),
      testEnv.DB.prepare(
        "UPDATE rfqs SET created_at = '2099-01-04T00:00:00.000Z' WHERE id = ?"
      ).bind(foreignId)
    ]);

    const firstPage = await api("/api/v1/rfqs?scope=all&limit=1", {
      headers: { cookie: userA.cookie }
    });
    expect(firstPage.status).toBe(200);
    const firstBody = await firstPage.json<{
      rfqs: Array<{ id: string; workflowStatus: string; firstTrade: { underlyings: string[] } }>;
      summary: { activeCount: number };
      nextCursor: string | null;
    }>();
    expect(firstBody.rfqs).toEqual([expect.objectContaining({
      id: activeId,
      workflowStatus: "WAITING",
      firstTrade: expect.objectContaining({ underlyings: ["ACTIVE UW"] })
    })]);
    expect(firstBody.summary.activeCount).toBeGreaterThanOrEqual(1);
    expect(firstBody.nextCursor).toBeTruthy();

    const secondPage = await api(
      `/api/v1/rfqs?scope=all&limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      { headers: { cookie: userA.cookie } }
    );
    const secondBody = await secondPage.json<{ rfqs: Array<{ id: string }> }>();
    expect(secondBody.rfqs[0]?.id).toBe(completedId);
    expect(secondBody.rfqs.some(item => item.id === foreignId)).toBe(false);

    const active = await api("/api/v1/rfqs?scope=active&limit=50", {
      headers: { cookie: userA.cookie }
    });
    const activeBody = await active.json<{ rfqs: Array<{ id: string }> }>();
    expect(activeBody.rfqs.some(item => item.id === activeId)).toBe(true);
    expect(activeBody.rfqs.some(item => item.id === completedId)).toBe(false);

    const completed = await api("/api/v1/rfqs?scope=completed&limit=50", {
      headers: { cookie: userA.cookie }
    });
    const completedBody = await completed.json<{ rfqs: Array<{ id: string }> }>();
    expect(completedBody.rfqs.some(item => item.id === completedId)).toBe(true);
    expect(completedBody.rfqs.some(item => item.id === activeId)).toBe(false);

    const invalidCursor = await api("/api/v1/rfqs?cursor=not-a-valid-cursor", {
      headers: { cookie: userA.cookie }
    });
    expect(invalidCursor.status).toBe(400);
    expect(await invalidCursor.json()).toMatchObject({ error: { code: "INVALID_RFQ_LIST_CURSOR" } });
  });

  it("validates and freezes a draft RFQ", async () => {
    const created = await createRfq(userA, [trade()]);
    const body = await created.json<{ rfq: { id: string } }>();
    const validated = await api(`/api/v1/rfqs/${body.rfq.id}/validate`, {
      method: "POST",
      headers: { cookie: userA.cookie, "x-csrf-token": userA.csrf }
    });
    expect(validated.status).toBe(200);
    const result = await validated.json<{ rfq: { status: string; version: number; trades: Array<{ frozenAt: string }> } }>();
    expect(result.rfq.status).toBe("VALIDATED");
    expect(result.rfq.version).toBe(2);
    expect(result.rfq.trades[0]?.frozenAt).toBeTruthy();
  });

  it("requires CSRF protection for mutations", async () => {
    const response = await api("/api/v1/rfqs", {
      method: "POST",
      headers: { cookie: userA.cookie, "idempotency-key": `idem-${crypto.randomUUID()}` },
      body: JSON.stringify({ trades: [trade()] })
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "CSRF_VALIDATION_FAILED" } });
  });

  it("lets the owner close the reply window early and blocks others and wrong states", async () => {
    const created = await createRfq(userA, [trade()]);
    const rfqId = (await created.json<{ rfq: { id: string } }>()).rfq.id;
    const now = new Date().toISOString();
    const deadline = new Date(Date.now() + 600_000).toISOString();
    await testEnv.DB.prepare(
      "UPDATE rfqs SET status = 'VALIDATED', dispatch_status = 'WAITING', workflow_status = 'WAITING', sent_at = ?, deadline_at = ? WHERE id = ?"
    ).bind(now, deadline, rfqId).run();

    const foreign = await api(`/api/v1/rfqs/${rfqId}/finalize`, {
      method: "POST", headers: { cookie: userB.cookie, "x-csrf-token": userB.csrf }
    });
    expect(foreign.status).toBe(404);

    const noCsrf = await api(`/api/v1/rfqs/${rfqId}/finalize`, {
      method: "POST", headers: { cookie: userA.cookie }
    });
    expect(noCsrf.status).toBe(403);

    const finalize = await api(`/api/v1/rfqs/${rfqId}/finalize`, {
      method: "POST", headers: { cookie: userA.cookie, "x-csrf-token": userA.csrf }
    });
    expect(finalize.status).toBe(202);
    expect(await finalize.json()).toMatchObject({ rfq: { id: rfqId, workflowStatus: "FINALIZING" } });
    const row = await testEnv.DB.prepare("SELECT workflow_status FROM rfqs WHERE id = ?").bind(rfqId).first<{ workflow_status: string }>();
    expect(row?.workflow_status).toBe("FINALIZING");
    const jobs = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM quote_rank_jobs WHERE rfq_id = ?").bind(rfqId).first<{ count: number }>();
    expect(Number(jobs?.count)).toBe(1);

    const draft = await createRfq(userA, [trade()]);
    const draftId = (await draft.json<{ rfq: { id: string } }>()).rfq.id;
    const wrongState = await api(`/api/v1/rfqs/${draftId}/finalize`, {
      method: "POST", headers: { cookie: userA.cookie, "x-csrf-token": userA.csrf }
    });
    expect(wrongState.status).toBe(409);
  });
});
