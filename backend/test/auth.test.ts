import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const BASE_URL = "https://api.yintsun66.com";

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function api(path: string, init: RequestInit = {}, ip = "198.51.100.10"): Promise<Response> {
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

function registration(attemptedUsername: string, employeeNumber: string): Record<string, string> {
  return {
    employeeNumber,
    branchName: "測試分行",
    displayName: `測試 ${attemptedUsername}`,
    username: attemptedUsername,
    password: "Correct Horse Battery 123!"
  };
}

function authentication(response: Response): { cookie: string; csrf: string } {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const session = /__Host-fcn_session=([^;,]+)/.exec(setCookie)?.[1];
  const csrf = /__Host-fcn_csrf=([^;,]+)/.exec(setCookie)?.[1];
  if (!session || !csrf) throw new Error("Authentication cookies were not returned");
  return { cookie: `__Host-fcn_session=${session}; __Host-fcn_csrf=${csrf}`, csrf };
}

describe("registration and authentication", () => {
  it("rejects malformed employee numbers", async () => {
    const response = await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("invalid1", "1234"))
    }, "198.51.100.11");
    expect(response.status).toBe(422);
    const body = await response.json<{ error: { fieldErrors: Record<string, string> } }>();
    expect(body.error.fieldErrors.employeeNumber).toBeDefined();
  });

  it("derives the login identity from the employee number and does not store it in plaintext", async () => {
    const response = await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        employeeNumber: "12345",
        branchName: "測試分行",
        password: "Correct Horse Battery 123!"
      })
    }, "198.51.100.12");
    expect(response.status).toBe(202);
    const row = await testEnv.DB.prepare(
      "SELECT status, username_normalized, display_name, employee_number_ciphertext FROM users WHERE username_normalized = '12345'"
    ).first<{ status: string; username_normalized: string; display_name: string; employee_number_ciphertext: string }>();
    expect(row?.status).toBe("PENDING_APPROVAL");
    expect(row?.username_normalized).toBe("12345");
    expect(row?.display_name).toBe("12345");
    expect(row?.employee_number_ciphertext).not.toContain("12345");
  });

  it("does not allow a pending user to log in", async () => {
    await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("pending2", "12346"))
    }, "198.51.100.13");
    const response = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12346", password: "Correct Horse Battery 123!" })
    }, "198.51.100.14");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTHENTICATION_FAILED" } });
  });

  it("allows an administrator to approve a user and supports logout", async () => {
    await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("admin01", "12347"))
    }, "198.51.100.15");
    await testEnv.DB.prepare("UPDATE users SET status = 'ACTIVE', role = 'ADMIN' WHERE username_normalized = '12347'").run();
    const adminLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12347", password: "Correct Horse Battery 123!" })
    }, "198.51.100.16");
    expect(adminLogin.status).toBe(200);
    const adminAuth = authentication(adminLogin);

    await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("approved1", "12348"))
    }, "198.51.100.17");
    const pending = await testEnv.DB.prepare("SELECT id FROM users WHERE username_normalized = '12348'").first<{ id: string }>();
    expect(pending?.id).toBeDefined();

    const listResponse = await api("/api/v1/admin/registrations", {
      headers: { cookie: adminAuth.cookie }
    });
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json<{ registrations: Array<{ username: string; employeeNumber: string }> }>();
    expect(list.registrations).toContainEqual(expect.objectContaining({ username: "12348", employeeNumber: "12348" }));

    const approveResponse = await api(`/api/v1/admin/registrations/${pending?.id}/approve`, {
      method: "POST",
      headers: { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf }
    });
    expect(approveResponse.status).toBe(200);

    const userLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12348", password: "Correct Horse Battery 123!" })
    }, "198.51.100.18");
    expect(userLogin.status).toBe(200);
    const userAuth = authentication(userLogin);

    const sessionResponse = await api("/api/v1/auth/session", { headers: { cookie: userAuth.cookie } });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({ user: { username: "12348", role: "USER" } });

    const logoutResponse = await api("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: userAuth.cookie, "x-csrf-token": userAuth.csrf }
    });
    expect(logoutResponse.status).toBe(200);
    const expiredSession = await api("/api/v1/auth/session", { headers: { cookie: userAuth.cookie } });
    expect(expiredSession.status).toBe(401);
  });

  it("allows an administrator to reject a pending registration with an audit reason", async () => {
    await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("rejected1", "12349"))
    }, "198.51.100.21");
    const pending = await testEnv.DB.prepare("SELECT id FROM users WHERE username_normalized = '12349'").first<{ id: string }>();
    expect(pending?.id).toBeDefined();

    const adminLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12347", password: "Correct Horse Battery 123!" })
    }, "198.51.100.22");
    const adminAuth = authentication(adminLogin);
    const rejectResponse = await api(`/api/v1/admin/registrations/${pending?.id}/reject`, {
      method: "POST",
      headers: { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf },
      body: JSON.stringify({ reason: "分行資料待補" })
    });
    expect(rejectResponse.status).toBe(200);
    expect(await rejectResponse.json()).toMatchObject({ status: "REJECTED", userId: pending?.id });

    const user = await testEnv.DB.prepare(
      "SELECT status, rejection_reason FROM users WHERE id = ?"
    ).bind(pending?.id).first<{ status: string; rejection_reason: string }>();
    expect(user).toEqual({ status: "REJECTED", rejection_reason: "分行資料待補" });
  });

  it("manages the PS tier: promote, PS approvals/removals, guards, and demote", async () => {
    async function activate(username: string, role: "USER" | "ADMIN" = "USER"): Promise<string> {
      await testEnv.DB.prepare("UPDATE users SET status = 'ACTIVE', role = ? WHERE username_normalized = ?")
        .bind(role, username).run();
      const row = await testEnv.DB.prepare("SELECT id FROM users WHERE username_normalized = ?").bind(username).first<{ id: string }>();
      if (!row?.id) throw new Error(`missing user ${username}`);
      return row.id;
    }
    async function login(username: string, ip: string): Promise<{ cookie: string; csrf: string }> {
      const response = await api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password: "Correct Horse Battery 123!" })
      }, ip);
      expect(response.status).toBe(200);
      return authentication(response);
    }

    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("psadm01", "22001")) }, "203.0.113.1");
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("psusr01", "22002")) }, "203.0.113.2");
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("psusr02", "22003")) }, "203.0.113.3");
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("psusr03", "22004")) }, "203.0.113.4");
    const adminId = await activate("22001", "ADMIN");
    const promoteId = await activate("22002");
    const disableId = await activate("22003");
    const plainId = await activate("22004");

    const adminAuth = await login("22001", "203.0.113.11");

    // ADMIN can list every account with an approximate last-online value.
    const accountsResponse = await api("/api/v1/admin/accounts", { headers: { cookie: adminAuth.cookie } });
    expect(accountsResponse.status).toBe(200);
    const accounts = (await accountsResponse.json<{ accounts: Array<{ id: string; username: string; role: string; status: string; lastSeenAt: string | null }> }>()).accounts;
    expect(accounts.find(item => item.username === "22002")).toMatchObject({ role: "USER", status: "ACTIVE" });
    expect(accounts.find(item => item.username === "22001")).toMatchObject({ role: "ADMIN" });
    expect(accounts.some(item => "lastSeenAt" in item)).toBe(true);

    // A regular USER cannot reach account management at all.
    const userAuth = await login("22004", "203.0.113.12");
    expect((await api("/api/v1/admin/accounts", { headers: { cookie: userAuth.cookie } })).status).toBe(403);
    expect((await api(`/api/v1/admin/accounts/${disableId}/disable`, {
      method: "POST",
      headers: { cookie: userAuth.cookie, "x-csrf-token": userAuth.csrf }
    })).status).toBe(403);

    // ADMIN promotes a USER to PS.
    const promoteResponse = await api(`/api/v1/admin/accounts/${promoteId}/promote`, {
      method: "POST",
      headers: { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf }
    });
    expect(promoteResponse.status).toBe(200);
    expect(await promoteResponse.json()).toMatchObject({ userId: promoteId, role: "PS" });

    // The promoted account now authenticates as PS.
    const psAuth = await login("22002", "203.0.113.13");
    const psSession = await api("/api/v1/auth/session", { headers: { cookie: psAuth.cookie } });
    expect(await psSession.json()).toMatchObject({ user: { username: "22002", role: "PS" } });

    // PS can approve a pending registration.
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("psusr04", "22005")) }, "203.0.113.5");
    const pending = await testEnv.DB.prepare("SELECT id FROM users WHERE username_normalized = '22005'").first<{ id: string }>();
    const pendingId = pending?.id as string;
    const psApprove = await api(`/api/v1/admin/registrations/${pendingId}/approve`, {
      method: "POST",
      headers: { cookie: psAuth.cookie, "x-csrf-token": psAuth.csrf }
    });
    expect(psApprove.status).toBe(200);

    // PS can remove (soft-disable) a regular USER; that USER can no longer log in.
    const psDisable = await api(`/api/v1/admin/accounts/${disableId}/disable`, {
      method: "POST",
      headers: { cookie: psAuth.cookie, "x-csrf-token": psAuth.csrf }
    });
    expect(psDisable.status).toBe(200);
    expect(await psDisable.json()).toMatchObject({ userId: disableId, status: "DISABLED" });
    const disabledLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "22003", password: "Correct Horse Battery 123!" })
    }, "203.0.113.14");
    expect(disabledLogin.status).toBe(401);

    // PS cannot promote, cannot remove an ADMIN, and cannot remove another PS.
    expect((await api(`/api/v1/admin/accounts/${plainId}/promote`, {
      method: "POST",
      headers: { cookie: psAuth.cookie, "x-csrf-token": psAuth.csrf }
    })).status).toBe(403);
    expect((await api(`/api/v1/admin/accounts/${adminId}/disable`, {
      method: "POST",
      headers: { cookie: psAuth.cookie, "x-csrf-token": psAuth.csrf }
    })).status).toBe(409);
    expect((await api(`/api/v1/admin/accounts/${promoteId}/disable`, {
      method: "POST",
      headers: { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf }
    })).status).toBe(409);

    // ADMIN can demote the PS account back to a regular USER.
    const demoteResponse = await api(`/api/v1/admin/accounts/${promoteId}/demote`, {
      method: "POST",
      headers: { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf }
    });
    expect(demoteResponse.status).toBe(200);
    expect(await demoteResponse.json()).toMatchObject({ userId: promoteId, role: "USER" });
    const demotedFlag = await testEnv.DB.prepare("SELECT is_privileged_support FROM users WHERE id = ?").bind(promoteId).first<{ is_privileged_support: number }>();
    expect(demotedFlag?.is_privileged_support).toBe(0);
  });

  it("surfaces blocked duplicate registrations to reviewers without creating a user", async () => {
    // First registration creates a pending user.
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("dupbase1", "41001")) }, "203.0.113.41");
    // Client-supplied identity fields are ignored; a different employee number creates its own account.
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("dupbase1", "41002")) }, "203.0.113.42");
    // Re-using an employee number is blocked regardless of client-supplied identity fields.
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("dupbase9", "41001")) }, "203.0.113.43");

    const accounts = await testEnv.DB.prepare(
      "SELECT username_normalized, display_name FROM users WHERE username_normalized IN ('41001', '41002') ORDER BY username_normalized"
    ).all<{ username_normalized: string; display_name: string }>();
    expect(accounts.results).toEqual([
      { username_normalized: "41001", display_name: "41001" },
      { username_normalized: "41002", display_name: "41002" }
    ]);

    const adminLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12347", password: "Correct Horse Battery 123!" })
    }, "203.0.113.44");
    const adminAuth = authentication(adminLogin);
    const listResponse = await api("/api/v1/admin/registrations", { headers: { cookie: adminAuth.cookie } });
    expect(listResponse.status).toBe(200);
    const body = await listResponse.json<{
      duplicates: { windowDays: number; count: number; latestAt: string | null; byField: { employeeNumber: number; username: number; unknown: number } };
    }>();
    expect(body.duplicates.count).toBeGreaterThanOrEqual(1);
    expect(body.duplicates.byField.employeeNumber + body.duplicates.byField.username).toBeGreaterThanOrEqual(1);
    expect(body.duplicates.latestAt).toBeTruthy();
  });

  it("looks up an existing account by employee number for administrators only", async () => {
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("lookupu1", "51001")) }, "203.0.113.51");
    await testEnv.DB.prepare("UPDATE users SET status='ACTIVE' WHERE username_normalized='51001'").run();
    await api("/api/v1/auth/register", { method: "POST", body: JSON.stringify(registration("lookupu2", "51002")) }, "203.0.113.52");
    await testEnv.DB.prepare("UPDATE users SET status='ACTIVE' WHERE username_normalized='51002'").run();

    const adminLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12347", password: "Correct Horse Battery 123!" })
    }, "203.0.113.53");
    const adminAuth = authentication(adminLogin);
    const adminHeaders = { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf };

    const found = await api("/api/v1/admin/accounts/lookup", { method: "POST", headers: adminHeaders, body: JSON.stringify({ employeeNumber: "51001" }) });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ account: { username: "51001", status: "ACTIVE" } });

    const missing = await api("/api/v1/admin/accounts/lookup", { method: "POST", headers: adminHeaders, body: JSON.stringify({ employeeNumber: "50000" }) });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ account: null });

    const badInput = await api("/api/v1/admin/accounts/lookup", { method: "POST", headers: adminHeaders, body: JSON.stringify({ employeeNumber: "999" }) });
    expect(badInput.status).toBe(422);

    const userLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "51002", password: "Correct Horse Battery 123!" })
    }, "203.0.113.54");
    const userAuth = authentication(userLogin);
    const forbidden = await api("/api/v1/admin/accounts/lookup", {
      method: "POST",
      headers: { cookie: userAuth.cookie, "x-csrf-token": userAuth.csrf },
      body: JSON.stringify({ employeeNumber: "51001" })
    });
    expect(forbidden.status).toBe(403);
  });

  it("rate-limits repeated failed logins without counting successful logins", async () => {
    const ip = "198.51.100.19";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "12347", password: `Wrong Password ${attempt}!` })
      }, ip);
      expect(failed.status).toBe(401);
    }
    const limited = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12347", password: "Correct Horse Battery 123!" })
    }, ip);
    expect(limited.status).toBe(429);

    const differentNetwork = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "12347", password: "Correct Horse Battery 123!" })
    }, "198.51.100.20");
    expect(differentNetwork.status).toBe(200);
  });
});
