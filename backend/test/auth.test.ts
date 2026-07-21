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

function registration(username: string, employeeNumber: string): Record<string, string> {
  return {
    employeeNumber,
    branchName: "測試分行",
    displayName: `測試 ${username}`,
    username,
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

  it("stores a pending registration without plaintext employee number", async () => {
    const response = await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("pending1", "12345"))
    }, "198.51.100.12");
    expect(response.status).toBe(202);
    const row = await testEnv.DB.prepare(
      "SELECT status, employee_number_ciphertext FROM users WHERE username_normalized = 'pending1'"
    ).first<{ status: string; employee_number_ciphertext: string }>();
    expect(row?.status).toBe("PENDING_APPROVAL");
    expect(row?.employee_number_ciphertext).not.toContain("12345");
  });

  it("does not allow a pending user to log in", async () => {
    await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("pending2", "12346"))
    }, "198.51.100.13");
    const response = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "pending2", password: "Correct Horse Battery 123!" })
    }, "198.51.100.14");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTHENTICATION_FAILED" } });
  });

  it("allows an administrator to approve a user and supports logout", async () => {
    await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("admin01", "12347"))
    }, "198.51.100.15");
    await testEnv.DB.prepare("UPDATE users SET status = 'ACTIVE', role = 'ADMIN' WHERE username_normalized = 'admin01'").run();
    const adminLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin01", password: "Correct Horse Battery 123!" })
    }, "198.51.100.16");
    expect(adminLogin.status).toBe(200);
    const adminAuth = authentication(adminLogin);

    await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(registration("approved1", "12348"))
    }, "198.51.100.17");
    const pending = await testEnv.DB.prepare("SELECT id FROM users WHERE username_normalized = 'approved1'").first<{ id: string }>();
    expect(pending?.id).toBeDefined();

    const listResponse = await api("/api/v1/admin/registrations", {
      headers: { cookie: adminAuth.cookie }
    });
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json<{ registrations: Array<{ username: string; employeeNumber: string }> }>();
    expect(list.registrations).toContainEqual(expect.objectContaining({ username: "approved1", employeeNumber: "12348" }));

    const approveResponse = await api(`/api/v1/admin/registrations/${pending?.id}/approve`, {
      method: "POST",
      headers: { cookie: adminAuth.cookie, "x-csrf-token": adminAuth.csrf }
    });
    expect(approveResponse.status).toBe(200);

    const userLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "approved1", password: "Correct Horse Battery 123!" })
    }, "198.51.100.18");
    expect(userLogin.status).toBe(200);
    const userAuth = authentication(userLogin);

    const sessionResponse = await api("/api/v1/auth/session", { headers: { cookie: userAuth.cookie } });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({ user: { username: "approved1", role: "USER" } });

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
    const pending = await testEnv.DB.prepare("SELECT id FROM users WHERE username_normalized = 'rejected1'").first<{ id: string }>();
    expect(pending?.id).toBeDefined();

    const adminLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin01", password: "Correct Horse Battery 123!" })
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

  it("rate-limits repeated failed logins without counting successful logins", async () => {
    const ip = "198.51.100.19";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await api("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin01", password: `Wrong Password ${attempt}!` })
      }, ip);
      expect(failed.status).toBe(401);
    }
    const limited = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin01", password: "Correct Horse Battery 123!" })
    }, ip);
    expect(limited.status).toBe(429);

    const differentNetwork = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin01", password: "Correct Horse Battery 123!" })
    }, "198.51.100.20");
    expect(differentNetwork.status).toBe(200);
  });
});
