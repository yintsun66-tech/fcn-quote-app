import { decryptEmployeeNumber, encryptEmployeeNumber, hashPassword, keyedHash, randomToken, sha256Text, verifyPassword } from "./crypto";
import { addSeconds, insertAudit, loadSession, newId, nowIso } from "./db";
import { AppError } from "./errors";
import { clientAddress, CSRF_COOKIE, csrfCookie, jsonResponse, parseCookies, readJson, requestId, requireSameOrigin, SESSION_COOKIE, sessionCookie } from "./http";
import type { AppEnv, SessionContext } from "./types";
import { normalizeLoginInput, normalizeRegistrationInput } from "./validation";

interface UserAuthRow {
  id: string;
  username_normalized: string;
  display_name: string;
  branch_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  status: string;
  role: "USER" | "ADMIN";
  credential_version: number;
}

function positiveInteger(value: string, fallback: number): number {
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : fallback;
}

async function attemptKey(env: AppEnv, kind: "LOGIN" | "REGISTER", identity: string, request: Request): Promise<string> {
  return keyedHash(env.EMPLOYEE_LOOKUP_KEY, `${kind}:${identity}:${clientAddress(request)}`);
}

async function isRateLimited(env: AppEnv, key: string, kind: "LOGIN" | "REGISTER", seconds: number, maximum: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - seconds * 1000).toISOString();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM auth_attempts
      WHERE attempt_key = ? AND kind = ? AND occurred_at >= ?
        AND (? = 'REGISTER' OR succeeded = 0)`
  ).bind(key, kind, cutoff, kind).first<{ count: number }>();
  return Number(row?.count ?? 0) >= maximum;
}

async function recordAttempt(env: AppEnv, key: string, kind: "LOGIN" | "REGISTER", succeeded: boolean): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO auth_attempts (id, attempt_key, kind, succeeded, occurred_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(newId("att"), key, kind, succeeded ? 1 : 0, nowIso()).run();
}

function genericRegistrationResponse(): Response {
  return jsonResponse({
    status: "PENDING_APPROVAL",
    message: "註冊資料已受理；經管理者核准後才可登入。"
  }, 202);
}

export async function register(request: Request, env: AppEnv): Promise<Response> {
  requireSameOrigin(request);
  const input = normalizeRegistrationInput(await readJson(request));
  const key = await attemptKey(env, "REGISTER", "registration", request);
  if (await isRateLimited(env, key, "REGISTER", 3600, 3)) {
    throw new AppError(429, "AUTH_RATE_LIMITED", "嘗試次數過多，請稍後再試。 ");
  }
  await recordAttempt(env, key, "REGISTER", false);

  const iterations = positiveInteger(env.PASSWORD_PBKDF2_ITERATIONS, 10_000);
  const employeeLookupHash = await keyedHash(env.EMPLOYEE_LOOKUP_KEY, input.employeeNumber);
  const employeeData = await encryptEmployeeNumber(env.EMPLOYEE_DATA_KEY, input.employeeNumber);
  const password = await hashPassword(input.password, iterations, env.EMPLOYEE_LOOKUP_KEY);
  const userId = newId("usr");
  const now = nowIso();

  try {
    await env.DB.prepare(
      `INSERT INTO users
        (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
         employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
         password_algorithm, password_iterations, status, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', 'USER', ?, ?)`
    ).bind(
      userId, input.username, input.displayName, input.branchName, employeeData.ciphertext,
      employeeData.iv, employeeLookupHash, password.hash, password.salt,
      password.algorithm, password.iterations, now, now
    ).run();
    await insertAudit(env, "REGISTRATION_SUBMITTED", "USER", userId, null, requestId(request));
  } catch (error) {
    if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) throw error;
    await insertAudit(env, "REGISTRATION_DUPLICATE", "USER", null, null, requestId(request));
  }
  return genericRegistrationResponse();
}

function loginError(): AppError {
  return new AppError(401, "AUTHENTICATION_FAILED", "帳號、密碼或帳號狀態不正確。 ");
}

export async function login(request: Request, env: AppEnv): Promise<Response> {
  requireSameOrigin(request);
  let input: ReturnType<typeof normalizeLoginInput>;
  try {
    input = normalizeLoginInput(await readJson(request));
  } catch {
    throw loginError();
  }
  const key = await attemptKey(env, "LOGIN", input.username, request);
  const windowSeconds = positiveInteger(env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 900);
  const maximum = positiveInteger(env.AUTH_RATE_LIMIT_MAX_ATTEMPTS, 5);
  if (await isRateLimited(env, key, "LOGIN", windowSeconds, maximum)) {
    throw new AppError(429, "AUTH_RATE_LIMITED", "嘗試次數過多，請稍後再試。 ");
  }

  const user = await env.DB.prepare(
    `SELECT id, username_normalized, display_name, branch_name, password_hash, password_salt,
            password_iterations, status, role, credential_version
       FROM users WHERE username_normalized = ?`
  ).bind(input.username).first<UserAuthRow>();
  const iterations = positiveInteger(env.PASSWORD_PBKDF2_ITERATIONS, 10_000);
  const passwordValid = user
    ? await verifyPassword(input.password, user.password_hash, user.password_salt, user.password_iterations, env.EMPLOYEE_LOOKUP_KEY)
    : (await hashPassword(input.password || "invalid-password", iterations, env.EMPLOYEE_LOOKUP_KEY), false);
  const allowed = Boolean(user && passwordValid && user.status === "ACTIVE");
  await recordAttempt(env, key, "LOGIN", allowed);
  if (!allowed || !user) throw loginError();

  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const sessionId = newId("ses");
  const now = new Date();
  const idleSeconds = positiveInteger(env.SESSION_IDLE_SECONDS, 1800);
  const absoluteSeconds = positiveInteger(env.SESSION_ABSOLUTE_SECONDS, 28_800);
  await env.DB.prepare(
    `INSERT INTO user_sessions
      (id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at,
       absolute_expires_at, credential_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sessionId, user.id, await sha256Text(sessionToken), await sha256Text(csrfToken), now.toISOString(),
    now.toISOString(), addSeconds(now, idleSeconds), addSeconds(now, absoluteSeconds), user.credential_version
  ).run();
  await insertAudit(env, "LOGIN_SUCCEEDED", "USER", user.id, user.id, requestId(request));

  const response = jsonResponse({
    user: {
      id: user.id,
      username: user.username_normalized,
      displayName: user.display_name,
      branchName: user.branch_name,
      role: user.role
    }
  });
  response.headers.append("set-cookie", sessionCookie(sessionToken));
  response.headers.append("set-cookie", csrfCookie(csrfToken));
  return response;
}

export async function requireSession(request: Request, env: AppEnv): Promise<SessionContext> {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token) throw new AppError(401, "AUTHENTICATION_REQUIRED", "請先登入。 ");
  const session = await loadSession(env, token);
  if (!session) throw new AppError(401, "AUTHENTICATION_REQUIRED", "登入已失效，請重新登入。 ");
  return session;
}

export async function requireCsrf(request: Request, session: SessionContext): Promise<void> {
  const headerToken = request.headers.get("x-csrf-token") ?? "";
  const cookieToken = parseCookies(request).get(CSRF_COOKIE) ?? "";
  if (!headerToken || headerToken !== cookieToken || await sha256Text(headerToken) !== session.csrfTokenHash) {
    throw new AppError(403, "CSRF_VALIDATION_FAILED", "安全驗證失敗，請重新整理後再試。 ");
  }
}

export function sessionInfo(session: SessionContext): Response {
  return jsonResponse({ user: session.user });
}

export async function logout(request: Request, env: AppEnv, session: SessionContext): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  await env.DB.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(nowIso(), session.id).run();
  await insertAudit(env, "LOGOUT", "USER", session.user.id, session.user.id, requestId(request));
  const response = jsonResponse({ status: "LOGGED_OUT" });
  response.headers.append("set-cookie", sessionCookie("", true));
  response.headers.append("set-cookie", csrfCookie("", true));
  return response;
}

function requireAdmin(session: SessionContext): void {
  if (session.user.role !== "ADMIN") throw new AppError(403, "ADMIN_REQUIRED", "需要管理者權限。 ");
}

interface PendingUserRow {
  id: string;
  username_normalized: string;
  display_name: string;
  branch_name: string;
  employee_number_ciphertext: string;
  employee_number_iv: string;
  created_at: string;
}

export async function listRegistrations(env: AppEnv, session: SessionContext): Promise<Response> {
  requireAdmin(session);
  const result = await env.DB.prepare(
    `SELECT id, username_normalized, display_name, branch_name, employee_number_ciphertext,
            employee_number_iv, created_at
       FROM users WHERE status = 'PENDING_APPROVAL' ORDER BY created_at ASC LIMIT 100`
  ).all<PendingUserRow>();
  const registrations = await Promise.all(result.results.map(async user => ({
    id: user.id,
    username: user.username_normalized,
    displayName: user.display_name,
    branchName: user.branch_name,
    employeeNumber: await decryptEmployeeNumber(env.EMPLOYEE_DATA_KEY, user.employee_number_ciphertext, user.employee_number_iv),
    createdAt: user.created_at
  })));
  return jsonResponse({ registrations });
}

export async function approveRegistration(request: Request, env: AppEnv, session: SessionContext, userId: string): Promise<Response> {
  requireAdmin(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE users SET status = 'ACTIVE', approved_by_user_id = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND status = 'PENDING_APPROVAL'`
  ).bind(session.user.id, now, now, userId).run();
  if (result.meta.changes !== 1) throw new AppError(404, "REGISTRATION_NOT_FOUND", "找不到待核准的註冊資料。 ");
  await insertAudit(env, "REGISTRATION_APPROVED", "USER", userId, session.user.id, requestId(request));
  return jsonResponse({ status: "ACTIVE", userId });
}

export async function rejectRegistration(request: Request, env: AppEnv, session: SessionContext, userId: string): Promise<Response> {
  requireAdmin(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const body = await readJson(request);
  const rawReason = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : undefined;
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason.length < 1 || reason.length > 500) throw new AppError(422, "VALIDATION_ERROR", "拒絕原因長度必須介於 1 至 500 個字元。 ");
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE users SET status = 'REJECTED', rejected_at = ?, rejection_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'PENDING_APPROVAL'`
  ).bind(now, reason, now, userId).run();
  if (result.meta.changes !== 1) throw new AppError(404, "REGISTRATION_NOT_FOUND", "找不到待核准的註冊資料。 ");
  await insertAudit(env, "REGISTRATION_REJECTED", "USER", userId, session.user.id, requestId(request), { reasonLength: reason.length });
  return jsonResponse({ status: "REJECTED", userId });
}
