import { decryptEmployeeNumber, encryptEmployeeNumber, hashPassword, keyedHash, randomToken, sha256Text, verifyPassword } from "./crypto";
import { addSeconds, effectiveRole, insertAudit, loadSession, newId, nowIso } from "./db";
import { AppError } from "./errors";
import { clientAddress, CSRF_COOKIE, csrfCookie, jsonResponse, parseCookies, readJson, requestId, requireSameOrigin, SESSION_COOKIE, sessionCookie } from "./http";
import type { AppEnv, SessionContext } from "./types";
import {
  normalizeLoginInput,
  normalizePasswordChangeInput,
  normalizePasswordResetInput,
  normalizeRegistrationInput
} from "./validation";

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
  is_privileged_support: number;
  credential_version: number;
  password_change_required: number;
  password_reset_expires_at: string | null;
}

const TEMPORARY_RESET_PASSWORD = "000000000000";
const PASSWORD_RESET_LIFETIME_SECONDS = 30 * 60;

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

async function passwordResetAttemptKey(env: AppEnv, identity: string, request: Request): Promise<string> {
  return keyedHash(env.EMPLOYEE_LOOKUP_KEY, `PASSWORD_RESET:${identity}:${clientAddress(request)}`);
}

async function isPasswordResetRateLimited(env: AppEnv, key: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM password_reset_attempts
      WHERE attempt_key = ? AND occurred_at >= ?`
  ).bind(key, cutoff).first<{ count: number }>();
  return Number(row?.count ?? 0) >= 3;
}

async function recordPasswordResetAttempt(env: AppEnv, key: string, succeeded: boolean): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO password_reset_attempts (id, attempt_key, succeeded, occurred_at)
     VALUES (?, ?, ?, ?)`
  ).bind(newId("rst"), key, succeeded ? 1 : 0, nowIso()).run();
}

function genericPasswordResetResponse(): Response {
  return jsonResponse({
    status: "RESET_IF_ELIGIBLE",
    expiresInMinutes: 30,
    message: "若為可自助重置的一般使用者帳號，臨時密碼已設為 12 個 0，請在 30 分鐘內登入並修改密碼。"
  }, 202);
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
    // Record which unique field collided (never the value) so administrators can see whether a
    // blocked duplicate was a re-used employee number or login account. The public response below
    // stays identical for new and duplicate registrations to preserve anti-enumeration.
    const field = /employee_number_lookup_hash/i.test(error.message)
      ? "employeeNumber"
      : /username_normalized/i.test(error.message)
        ? "username"
        : "unknown";
    await insertAudit(env, "REGISTRATION_DUPLICATE", "USER", null, null, requestId(request), { field });
  }
  return genericRegistrationResponse();
}

export async function requestPasswordReset(request: Request, env: AppEnv): Promise<Response> {
  requireSameOrigin(request);
  let username = "invalid";
  try {
    username = normalizePasswordResetInput(await readJson(request)).username;
  } catch {
    return genericPasswordResetResponse();
  }

  const key = await passwordResetAttemptKey(env, username, request);
  if (await isPasswordResetRateLimited(env, key)) {
    throw new AppError(429, "AUTH_RATE_LIMITED", "重置次數過多，請稍後再試或聯絡管理者。 ");
  }

  const target = await env.DB.prepare(
    `SELECT id FROM users
      WHERE username_normalized = ? AND status = 'ACTIVE' AND role = 'USER'
        AND is_privileged_support = 0 AND anonymized_at IS NULL`
  ).bind(username).first<{ id: string }>();
  if (!target) {
    await recordPasswordResetAttempt(env, key, false);
    return genericPasswordResetResponse();
  }

  const now = new Date();
  const nowString = now.toISOString();
  const expiresAt = addSeconds(now, PASSWORD_RESET_LIFETIME_SECONDS);
  const iterations = positiveInteger(env.PASSWORD_PBKDF2_ITERATIONS, 10_000);
  const password = await hashPassword(TEMPORARY_RESET_PASSWORD, iterations, env.EMPLOYEE_LOOKUP_KEY);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, password_algorithm = ?,
          password_iterations = ?, password_change_required = 1,
          password_reset_expires_at = ?, credential_version = credential_version + 1,
          updated_at = ?
        WHERE id = ? AND status = 'ACTIVE' AND role = 'USER'
          AND is_privileged_support = 0 AND anonymized_at IS NULL`
    ).bind(password.hash, password.salt, password.algorithm, password.iterations, expiresAt, nowString, target.id),
    env.DB.prepare(
      `UPDATE user_sessions SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_reset_expires_at = ?)`
    ).bind(nowString, target.id, target.id, expiresAt),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       SELECT ?, NULL, 'SELF_SERVICE_PASSWORD_RESET', 'USER', ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND password_reset_expires_at = ?)`
    ).bind(
      newId("aud"),
      target.id,
      requestId(request),
      JSON.stringify({ expiresInMinutes: 30 }),
      nowString,
      target.id,
      expiresAt
    )
  ]);
  await recordPasswordResetAttempt(env, key, results[0]?.meta.changes === 1);
  return genericPasswordResetResponse();
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
            password_iterations, status, role, is_privileged_support, credential_version,
            password_change_required, password_reset_expires_at
       FROM users WHERE username_normalized = ? AND anonymized_at IS NULL`
  ).bind(input.username).first<UserAuthRow>();
  const iterations = positiveInteger(env.PASSWORD_PBKDF2_ITERATIONS, 10_000);
  const passwordValid = user
    ? await verifyPassword(input.password, user.password_hash, user.password_salt, user.password_iterations, env.EMPLOYEE_LOOKUP_KEY)
    : (await hashPassword(input.password || "invalid-password", iterations, env.EMPLOYEE_LOOKUP_KEY), false);
  const resetWindowValid = !user?.password_change_required || Boolean(
    user.password_reset_expires_at && Date.parse(user.password_reset_expires_at) > Date.now()
  );
  const allowed = Boolean(user && passwordValid && user.status === "ACTIVE" && resetWindowValid);
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
      role: effectiveRole(user.role, user.is_privileged_support),
      credentialVersion: user.credential_version,
      passwordChangeRequired: user.password_change_required === 1,
      passwordResetExpiresAt: user.password_reset_expires_at
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

export async function changePassword(request: Request, env: AppEnv, session: SessionContext): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const input = normalizePasswordChangeInput(await readJson(request));
  if (input.newPassword === TEMPORARY_RESET_PASSWORD) {
    throw new AppError(422, "PASSWORD_TOO_WEAK", "新密碼不得使用 12 個 0。 ");
  }

  const user = await env.DB.prepare(
    `SELECT password_hash, password_salt, password_iterations
       FROM users WHERE id = ? AND status = 'ACTIVE' AND anonymized_at IS NULL`
  ).bind(session.user.id).first<{
    password_hash: string;
    password_salt: string;
    password_iterations: number;
  }>();
  if (!user) throw new AppError(401, "AUTHENTICATION_REQUIRED", "登入已失效，請重新登入。 ");

  const currentValid = await verifyPassword(
    input.currentPassword,
    user.password_hash,
    user.password_salt,
    user.password_iterations,
    env.EMPLOYEE_LOOKUP_KEY
  );
  if (!currentValid) throw new AppError(401, "CURRENT_PASSWORD_INVALID", "目前密碼不正確。 ");
  if (await verifyPassword(
    input.newPassword,
    user.password_hash,
    user.password_salt,
    user.password_iterations,
    env.EMPLOYEE_LOOKUP_KEY
  )) {
    throw new AppError(422, "PASSWORD_UNCHANGED", "新密碼不可與目前密碼相同。 ");
  }

  const iterations = positiveInteger(env.PASSWORD_PBKDF2_ITERATIONS, 10_000);
  const password = await hashPassword(input.newPassword, iterations, env.EMPLOYEE_LOOKUP_KEY);
  const now = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, password_algorithm = ?,
          password_iterations = ?, password_change_required = 0,
          password_reset_expires_at = NULL, credential_version = credential_version + 1,
          updated_at = ? WHERE id = ? AND status = 'ACTIVE' AND anonymized_at IS NULL
          AND credential_version = ?`
    ).bind(
      password.hash,
      password.salt,
      password.algorithm,
      password.iterations,
      now,
      session.user.id,
      session.user.credentialVersion
    ),
    env.DB.prepare(
      `UPDATE user_sessions SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND credential_version = ? AND updated_at = ?)`
    ).bind(now, session.user.id, session.user.id, session.user.credentialVersion + 1, now),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       SELECT ?, ?, 'PASSWORD_CHANGED', 'USER', ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND credential_version = ? AND updated_at = ?)`
    ).bind(
      newId("aud"),
      session.user.id,
      session.user.id,
      requestId(request),
      JSON.stringify({ forcedReset: session.user.passwordChangeRequired }),
      now,
      session.user.id,
      session.user.credentialVersion + 1,
      now
    )
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw new AppError(409, "PASSWORD_CHANGE_CONFLICT", "帳號狀態已變更，請重新登入後再試。 ");
  }

  const response = jsonResponse({ status: "PASSWORD_CHANGED", loginRequired: true });
  response.headers.append("set-cookie", sessionCookie("", true));
  response.headers.append("set-cookie", csrfCookie("", true));
  return response;
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

export function requireAdmin(session: SessionContext): void {
  if (session.user.role !== "ADMIN") throw new AppError(403, "ADMIN_REQUIRED", "需要管理者權限。 ");
}

// ADMIN or PS (privileged support) may review registrations and remove regular accounts.
export function requireAdminOrPs(session: SessionContext): void {
  if (session.user.role !== "ADMIN" && session.user.role !== "PS") {
    throw new AppError(403, "ADMIN_REQUIRED", "需要管理者或 PS 權限。 ");
  }
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
  requireAdminOrPs(session);
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
  const duplicates = await recentDuplicateRegistrations(env);
  return jsonResponse({ registrations, duplicates });
}

// Summarizes recently blocked duplicate registrations (no account was created) so the review
// screen can explain why a fresh "registration" never reached the pending list. Only counts,
// which unique field collided, and timestamps are exposed — never the attempted value.
async function recentDuplicateRegistrations(env: AppEnv): Promise<{
  windowDays: number;
  count: number;
  latestAt: string | null;
  byField: { employeeNumber: number; username: number; unknown: number };
}> {
  const windowDays = 7;
  const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT created_at, safe_metadata_json FROM audit_events
      WHERE action = 'REGISTRATION_DUPLICATE' AND created_at >= ?
      ORDER BY created_at DESC LIMIT 200`
  ).bind(sinceIso).all<{ created_at: string; safe_metadata_json: string }>();
  const byField = { employeeNumber: 0, username: 0, unknown: 0 };
  for (const row of rows.results) {
    let field = "unknown";
    try {
      const parsed = JSON.parse(row.safe_metadata_json || "{}") as { field?: unknown };
      if (parsed.field === "employeeNumber" || parsed.field === "username") field = parsed.field;
    } catch {
      // treat unparseable metadata as unknown
    }
    byField[field as keyof typeof byField] += 1;
  }
  return {
    windowDays,
    count: rows.results.length,
    latestAt: rows.results[0]?.created_at ?? null,
    byField
  };
}

export async function approveRegistration(request: Request, env: AppEnv, session: SessionContext, userId: string): Promise<Response> {
  requireAdminOrPs(session);
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
  requireAdminOrPs(session);
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

interface AccountRow {
  id: string;
  username_normalized: string;
  display_name: string;
  branch_name: string;
  role: "USER" | "ADMIN";
  is_privileged_support: number;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  rfq_count: number;
}

// All accounts plus each account's last-online time (MAX session last_seen_at).
// Employee numbers are intentionally excluded to keep this broader list privacy-minimal.
export async function listAccounts(env: AppEnv, session: SessionContext): Promise<Response> {
  requireAdminOrPs(session);
  const result = await env.DB.prepare(
    `SELECT u.id, u.username_normalized, u.display_name, u.branch_name, u.role,
            u.is_privileged_support, u.status, u.created_at,
            (SELECT MAX(s.last_seen_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen_at,
            (SELECT COUNT(*) FROM rfqs r WHERE r.user_id = u.id) AS rfq_count
       FROM users u WHERE u.anonymized_at IS NULL ORDER BY u.created_at ASC LIMIT 500`
  ).all<AccountRow>();
  const accounts = result.results.map(row => ({
    id: row.id,
    username: row.username_normalized,
    displayName: row.display_name,
    branchName: row.branch_name,
    role: effectiveRole(row.role, row.is_privileged_support),
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    rfqCount: row.rfq_count
  }));
  return jsonResponse({ accounts });
}

// Promote a regular USER account to PS. ADMIN only. Only an ACTIVE plain USER is eligible.
export async function promoteAccount(request: Request, env: AppEnv, session: SessionContext, userId: string): Promise<Response> {
  requireAdmin(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const result = await env.DB.prepare(
    `UPDATE users SET is_privileged_support = 1, updated_at = ?
      WHERE id = ? AND role = 'USER' AND is_privileged_support = 0 AND status = 'ACTIVE'`
  ).bind(nowIso(), userId).run();
  if (result.meta.changes !== 1) throw new AppError(409, "ACCOUNT_NOT_ELIGIBLE", "找不到可升級為 PS 的一般帳號。 ");
  await insertAudit(env, "ACCOUNT_PROMOTED_PS", "USER", userId, session.user.id, requestId(request));
  return jsonResponse({ userId, role: "PS" });
}

// Demote a PS account back to a regular USER. ADMIN only.
export async function demoteAccount(request: Request, env: AppEnv, session: SessionContext, userId: string): Promise<Response> {
  requireAdmin(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const result = await env.DB.prepare(
    `UPDATE users SET is_privileged_support = 0, updated_at = ?
      WHERE id = ? AND role = 'USER' AND is_privileged_support = 1`
  ).bind(nowIso(), userId).run();
  if (result.meta.changes !== 1) throw new AppError(409, "ACCOUNT_NOT_ELIGIBLE", "找不到可降級的 PS 帳號。 ");
  await insertAudit(env, "ACCOUNT_DEMOTED_PS", "USER", userId, session.user.id, requestId(request));
  return jsonResponse({ userId, role: "USER" });
}

// Remove (soft-disable) a regular USER account. ADMIN or PS. ADMIN and PS accounts are
// protected: the guard requires role='USER' AND is_privileged_support=0. Disabling is a
// soft status change (rfqs.user_id is ON DELETE RESTRICT), and active sessions are revoked.
export async function disableAccount(request: Request, env: AppEnv, session: SessionContext, userId: string): Promise<Response> {
  requireAdminOrPs(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  if (userId === session.user.id) throw new AppError(422, "ACCOUNT_SELF_TARGET", "無法剔除自己的帳號。 ");
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE users SET status = 'DISABLED', updated_at = ?
      WHERE id = ? AND role = 'USER' AND is_privileged_support = 0 AND status != 'DISABLED'`
  ).bind(now, userId).run();
  if (result.meta.changes !== 1) throw new AppError(409, "ACCOUNT_NOT_ELIGIBLE", "只能剔除一般帳號；找不到可剔除的帳號。 ");
  await env.DB.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now, userId).run();
  await insertAudit(env, "ACCOUNT_DISABLED", "USER", userId, session.user.id, requestId(request));
  return jsonResponse({ userId, status: "DISABLED" });
}

// Remove the identifying account data of a disabled plain USER while retaining its opaque user
// id as the owner of historical RFQs. Replacing both unique identifiers releases the login and
// employee number for a new registration without deleting financial or audit records.
export async function deleteAccountPermanently(request: Request, env: AppEnv, session: SessionContext, userId: string): Promise<Response> {
  requireAdminOrPs(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  if (userId === session.user.id) throw new AppError(422, "ACCOUNT_SELF_TARGET", "無法永久刪除自己的帳號。 ");

  const body = await readJson(request);
  const rawConfirmation = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).confirmation
    : undefined;
  const confirmation = typeof rawConfirmation === "string" ? rawConfirmation.trim().toLowerCase() : "";

  const target = await env.DB.prepare(
    `SELECT u.username_normalized, u.role, u.is_privileged_support, u.status,
            (SELECT COUNT(*) FROM rfqs r WHERE r.user_id = u.id) AS rfq_count
       FROM users u WHERE u.id = ? AND u.anonymized_at IS NULL`
  ).bind(userId).first<{
    username_normalized: string;
    role: "USER" | "ADMIN";
    is_privileged_support: number;
    status: string;
    rfq_count: number;
  }>();
  if (!target) throw new AppError(404, "ACCOUNT_NOT_FOUND", "找不到指定帳號。 ");
  if (target.role !== "USER" || target.is_privileged_support !== 0) {
    throw new AppError(409, "ACCOUNT_NOT_ELIGIBLE", "不得永久刪除管理者或 PS 帳號。 ");
  }
  if (target.status !== "DISABLED") {
    throw new AppError(409, "ACCOUNT_DELETE_REQUIRES_DISABLED", "請先剔除帳號，再執行永久刪除。 ");
  }
  if (!confirmation || confirmation !== target.username_normalized) {
    throw new AppError(422, "ACCOUNT_DELETE_CONFIRMATION_MISMATCH", "永久刪除確認文字與登入帳號不符。 ");
  }

  const now = nowIso();
  const tombstone = randomToken(18);
  const iterations = positiveInteger(env.PASSWORD_PBKDF2_ITERATIONS, 10_000);
  const unusablePassword = await hashPassword(randomToken(48), iterations, env.EMPLOYEE_LOOKUP_KEY);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET username_normalized = ?, display_name = '已刪除使用者', branch_name = '已刪除',
          employee_number_ciphertext = 'REDACTED', employee_number_iv = 'REDACTED',
          employee_number_lookup_hash = ?, password_hash = ?, password_salt = ?,
          password_algorithm = ?, password_iterations = ?, password_change_required = 0,
          password_reset_expires_at = NULL, rejection_reason = NULL,
          credential_version = credential_version + 1, anonymized_at = ?, updated_at = ?
        WHERE id = ? AND role = 'USER' AND is_privileged_support = 0
          AND status = 'DISABLED' AND anonymized_at IS NULL`
    ).bind(
      `deleted-${tombstone}`,
      `deleted-${tombstone}`,
      unusablePassword.hash,
      unusablePassword.salt,
      unusablePassword.algorithm,
      unusablePassword.iterations,
      now,
      now,
      userId
    ),
    env.DB.prepare(
      `DELETE FROM user_sessions WHERE user_id = ?
        AND EXISTS (SELECT 1 FROM users WHERE id = ? AND anonymized_at = ?)`
    ).bind(userId, userId, now),
    env.DB.prepare(
      `DELETE FROM idempotency_keys WHERE user_id = ?
        AND EXISTS (SELECT 1 FROM users WHERE id = ? AND anonymized_at = ?)`
    ).bind(userId, userId, now),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       SELECT ?, ?, 'ACCOUNT_PERSONAL_DATA_DELETED', 'USER', ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND anonymized_at = ?)`
    ).bind(
      newId("aud"),
      session.user.id,
      userId,
      requestId(request),
      JSON.stringify({ previousStatus: "DISABLED", preservedRfqCount: target.rfq_count }),
      now,
      userId,
      now
    )
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw new AppError(409, "ACCOUNT_DELETE_CONFLICT", "帳號狀態已變更，請重新載入後再試。 ");
  }
  return jsonResponse({ userId, status: "ANONYMIZED", preservedRfqCount: target.rfq_count });
}

// Look up which existing account holds a given employee number. ADMIN only, because it maps the
// employee-number identifier to an account (the linkage deliberately kept out of the PS account
// list). The employee number is matched via its keyed lookup hash, so no employee number is
// decrypted; the queried value is never written to the audit log.
export async function lookupAccountByEmployeeNumber(request: Request, env: AppEnv, session: SessionContext): Promise<Response> {
  requireAdmin(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const body = await readJson(request);
  const raw = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).employeeNumber
    : undefined;
  const employeeNumber = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{5}$/.test(employeeNumber)) throw new AppError(422, "VALIDATION_ERROR", "行編必須為五碼數字。 ");
  const lookupHash = await keyedHash(env.EMPLOYEE_LOOKUP_KEY, employeeNumber);
  const row = await env.DB.prepare(
    `SELECT id, username_normalized, display_name, branch_name, role, is_privileged_support, status, created_at
       FROM users WHERE employee_number_lookup_hash = ? AND anonymized_at IS NULL`
  ).bind(lookupHash).first<{
    id: string;
    username_normalized: string;
    display_name: string;
    branch_name: string;
    role: "USER" | "ADMIN";
    is_privileged_support: number;
    status: string;
    created_at: string;
  }>();
  await insertAudit(env, "ACCOUNT_LOOKUP_BY_EMPLOYEE", "USER", row?.id ?? null, session.user.id, requestId(request), { found: Boolean(row) });
  if (!row) return jsonResponse({ account: null });
  return jsonResponse({
    account: {
      id: row.id,
      username: row.username_normalized,
      displayName: row.display_name,
      branchName: row.branch_name,
      role: effectiveRole(row.role, row.is_privileged_support),
      status: row.status,
      createdAt: row.created_at
    }
  });
}
