import { requireAdminOrPs, requireCsrf } from "./auth";
import { encryptEmployeeNumber, decryptEmployeeNumber, keyedHash, sha256Text, stableStringify } from "./crypto";
import { auditStatement, insertAudit, newId, nowIso } from "./db";
import { AppError } from "./errors";
import {
  clientAddress,
  jsonResponse,
  readJson,
  requestId,
  requireIdempotencyKey,
  requireSameOrigin
} from "./http";
import type { AppEnv, SessionContext } from "./types";

export const PUBLIC_ORIGINS = new Set([
  "https://app.yintsun66.com",
  "https://yintsun66-tech.github.io"
]);
const PIN_WINDOW_SECONDS = 15 * 60;
const PIN_MAX_FAILURES = 5;
const INTEREST_WINDOW_SECONDS = 10 * 60;
const INTEREST_MAX_REQUESTS = 20;
const MAX_PUBLIC_PRODUCTS = 100;
const MAX_DAILY_INTEREST_ROWS = 1_000;

interface ProductRow {
  id: string;
  product_code: string;
  issuer: string;
  trade_date: string;
  estimated_yield_pct: number;
  public_snapshot_json: string;
  published_at: string;
  expires_at: string | null;
}

interface PublicInterestRow {
  product_code: string;
  branch_code: string;
  branch_name: string;
  employee_number_mask: string;
  amount_value: number;
  currency: string;
  updated_at: string;
}

interface IdempotencyRow {
  request_hash: string;
  response_status: number;
  response_json: string;
}

interface InterestInput {
  productCode: string;
  branchCode: string;
  branchName: string;
  employeeNumber: string;
  amountValue: number;
}

function publicOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && PUBLIC_ORIGINS.has(origin) ? origin : null;
}

export function isPublicFollowBoardPath(path: string): boolean {
  return path === "/api/v1/public/follow-board/manifest"
    || path === "/api/v1/public/follow-board/interests";
}

export function followBoardCorsHeaders(request: Request): Headers {
  const headers = new Headers({
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, idempotency-key, x-follow-board-pin",
    "access-control-max-age": "600",
    vary: "Origin"
  });
  const origin = publicOrigin(request);
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

export function followBoardOptions(request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin && !PUBLIC_ORIGINS.has(origin)) {
    return jsonResponse({ error: { code: "ORIGIN_NOT_ALLOWED", message: "此網站來源不允許存取跟單專區。" } }, 403);
  }
  return new Response(null, { status: 204, headers: followBoardCorsHeaders(request) });
}

function publicJson(request: Request, data: unknown, status = 200): Response {
  return jsonResponse(data, status, followBoardCorsHeaders(request));
}

function requirePublicPostOrigin(request: Request): "APP" | "STATIC" {
  const origin = publicOrigin(request);
  if (!origin) throw new AppError(403, "ORIGIN_NOT_ALLOWED", "此網站來源不允許提交跟單資料。");
  return origin === "https://app.yintsun66.com" ? "APP" : "STATIC";
}

function taipeiDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(422, "VALIDATION_ERROR", "跟單資料格式不正確。");
  }
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value.normalize("NFKC").trim()).slice(0, maximum).join("");
}

function parseInterestInput(value: unknown): InterestInput {
  const input = inputRecord(value);
  const productCode = cleanText(input.productCode, 12).toUpperCase();
  const branchCode = cleanText(input.branchCode, 10).toUpperCase();
  const branchName = cleanText(input.branchName, 40);
  const employeeNumber = cleanText(input.employeeNumber, 5);
  const amountValue = Number(input.amountValue);

  if (!/^[A-Z0-9]{4,12}$/.test(productCode)) {
    throw new AppError(422, "VALIDATION_ERROR", "商品代碼格式不正確。");
  }
  if (!/^[A-Z0-9-]{2,10}$/.test(branchCode)) {
    throw new AppError(422, "VALIDATION_ERROR", "分行代號須為 2 至 10 碼英數字。");
  }
  if (!branchName || /[\u0000-\u001f\u007f]/u.test(branchName)) {
    throw new AppError(422, "VALIDATION_ERROR", "請填寫分行名稱。");
  }
  if (!/^\d{5}$/.test(employeeNumber)) {
    throw new AppError(422, "VALIDATION_ERROR", "行編必須為五碼數字。");
  }
  if (!Number.isSafeInteger(amountValue) || amountValue < 1 || amountValue > 999_999_999_999) {
    throw new AppError(422, "VALIDATION_ERROR", "預計跟單金額須為正整數。");
  }
  return { productCode, branchCode, branchName, employeeNumber, amountValue };
}

async function requestAttemptKey(env: AppEnv, request: Request): Promise<string> {
  return keyedHash(env.EMPLOYEE_LOOKUP_KEY, `FOLLOW_BOARD_REQUEST_V1:${clientAddress(request)}`);
}

async function recentAttemptCount(
  env: AppEnv,
  attemptKeyHash: string,
  kind: "PIN" | "INTEREST",
  windowSeconds: number,
  succeeded?: 0 | 1
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1_000).toISOString();
  const row = succeeded === undefined
    ? await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM follow_board_request_attempts WHERE attempt_key_hash = ? AND kind = ? AND occurred_at >= ?"
    ).bind(attemptKeyHash, kind, since).first<{ count: number }>()
    : await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM follow_board_request_attempts
        WHERE attempt_key_hash = ? AND kind = ? AND succeeded = ? AND occurred_at >= ?`
    ).bind(attemptKeyHash, kind, succeeded, since).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function recordAttempt(
  env: AppEnv,
  attemptKeyHash: string,
  kind: "PIN" | "INTEREST",
  succeeded: boolean
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO follow_board_request_attempts
      (id, attempt_key_hash, kind, succeeded, occurred_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(newId("fba"), attemptKeyHash, kind, succeeded ? 1 : 0, nowIso()).run();
}

async function requireViewPin(request: Request, env: AppEnv): Promise<void> {
  const configured = env.FOLLOW_BOARD_VIEW_PIN?.trim() ?? "";
  if (!/^\d{4}$/.test(configured)) {
    throw new AppError(503, "FOLLOW_BOARD_PIN_NOT_CONFIGURED", "跟單專區尚未設定檢視密碼。");
  }
  const attemptKey = await requestAttemptKey(env, request);
  if (await recentAttemptCount(env, attemptKey, "PIN", PIN_WINDOW_SECONDS, 0) >= PIN_MAX_FAILURES) {
    throw new AppError(429, "FOLLOW_BOARD_PIN_RATE_LIMITED", "密碼錯誤次數過多，請稍後再試。");
  }
  const supplied = request.headers.get("x-follow-board-pin")?.trim() ?? "";
  if (supplied !== configured) {
    await recordAttempt(env, attemptKey, "PIN", false);
    throw new AppError(401, "FOLLOW_BOARD_PIN_INVALID", "四位數檢視密碼不正確。");
  }
}

function safeSnapshot(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function getFollowBoardManifest(request: Request, env: AppEnv): Promise<Response> {
  await requireViewPin(request, env);
  const date = taipeiDate();
  const generatedAt = nowIso();
  const [productsResult, interestsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, product_code, issuer, trade_date, estimated_yield_pct,
              public_snapshot_json, published_at, expires_at
         FROM follow_board_products
        WHERE status = 'PUBLISHED' AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY published_at DESC, product_code
        LIMIT ?`
    ).bind(generatedAt, MAX_PUBLIC_PRODUCTS).all<ProductRow>(),
    env.DB.prepare(
      `SELECT p.product_code, i.branch_code, i.branch_name, i.employee_number_mask,
               i.amount_value, i.currency, i.updated_at
         FROM follow_board_interests i
         JOIN follow_board_products p ON p.id = i.product_id
        WHERE i.submission_date = ? AND p.status = 'PUBLISHED'
          AND (p.expires_at IS NULL OR p.expires_at > ?)
        ORDER BY i.updated_at DESC
        LIMIT ?`
    ).bind(date, generatedAt, MAX_DAILY_INTEREST_ROWS).all<PublicInterestRow>()
  ]);
  const products = productsResult.results.flatMap(row => {
    const snapshot = safeSnapshot(row.public_snapshot_json);
    return snapshot ? [{
      productCode: row.product_code,
      issuer: row.issuer,
      tradeDate: row.trade_date,
      estimatedYieldPct: row.estimated_yield_pct,
      publishedAt: row.published_at,
      expiresAt: row.expires_at,
      card: snapshot
    }] : [];
  });
  const dailyInterests = interestsResult.results.map(row => ({
    productCode: row.product_code,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    employeeNumber: row.employee_number_mask,
    amountValue: row.amount_value,
    currency: row.currency,
    updatedAt: row.updated_at
  }));
  return publicJson(request, {
    schemaVersion: 2,
    generatedAt,
    date,
    products,
    dailyInterests
  });
}

export async function submitFollowBoardInterest(request: Request, env: AppEnv): Promise<Response> {
  const sourceSite = requirePublicPostOrigin(request);
  await requireViewPin(request, env);
  const attemptKey = await requestAttemptKey(env, request);
  if (await recentAttemptCount(env, attemptKey, "INTEREST", INTEREST_WINDOW_SECONDS) >= INTEREST_MAX_REQUESTS) {
    throw new AppError(429, "FOLLOW_BOARD_SUBMISSION_RATE_LIMITED", "跟單資料送出次數過多，請稍後再試。");
  }
  const idempotencyKey = requireIdempotencyKey(request);
  const input = parseInterestInput(await readJson(request, 8_192));
  const requestHash = await sha256Text(stableStringify({ ...input, sourceSite }));
  const existingKey = await env.DB.prepare(
    `SELECT request_hash, response_status, response_json
       FROM follow_board_idempotency_keys WHERE idempotency_key = ?`
  ).bind(idempotencyKey).first<IdempotencyRow>();
  if (existingKey) {
    if (existingKey.request_hash !== requestHash) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "同一筆送出識別碼不可用於不同資料。");
    }
    return publicJson(request, JSON.parse(existingKey.response_json) as unknown, existingKey.response_status);
  }

  const product = await env.DB.prepare(
    `SELECT id, public_snapshot_json FROM follow_board_products
      WHERE product_code = ? COLLATE NOCASE AND status = 'PUBLISHED'
        AND (expires_at IS NULL OR expires_at > ?)`
  ).bind(input.productCode, nowIso()).first<{ id: string; public_snapshot_json: string }>();
  if (!product) throw new AppError(404, "FOLLOW_BOARD_PRODUCT_NOT_FOUND", "找不到可跟單的商品。");
  const snapshot = safeSnapshot(product.public_snapshot_json);
  const currency = typeof snapshot?.currency === "string" ? snapshot.currency : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError(409, "FOLLOW_BOARD_PRODUCT_INVALID", "商品幣別資料不完整，暫時無法登記。");
  }

  const employeeLookupHash = await keyedHash(
    env.EMPLOYEE_LOOKUP_KEY,
    `FOLLOW_BOARD_EMPLOYEE_V1:${input.employeeNumber}`
  );
  const employeeData = await encryptEmployeeNumber(env.EMPLOYEE_DATA_KEY, input.employeeNumber);
  const employeeMask = `${input.employeeNumber.slice(0, 2)}***`;
  const date = taipeiDate();
  const timestamp = nowIso();
  const interestId = newId("fbi");
  const responseBody = {
    status: "RECORDED",
    productCode: input.productCode,
    branchName: input.branchName,
    employeeNumber: employeeMask,
    amountValue: input.amountValue,
    currency,
    submissionDate: date
  };
  const responseJson = JSON.stringify(responseBody);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO follow_board_interests
        (id, product_id, branch_code, branch_name, employee_number_ciphertext,
         employee_number_iv, employee_number_lookup_hash, employee_number_mask,
         amount_value, currency, submission_date, source_site, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, employee_number_lookup_hash) DO UPDATE SET
         branch_code = excluded.branch_code,
         branch_name = excluded.branch_name,
         employee_number_ciphertext = excluded.employee_number_ciphertext,
         employee_number_iv = excluded.employee_number_iv,
         employee_number_mask = excluded.employee_number_mask,
         amount_value = excluded.amount_value,
         currency = excluded.currency,
         submission_date = excluded.submission_date,
         source_site = excluded.source_site,
         updated_at = excluded.updated_at`
    ).bind(
      interestId,
      product.id,
      input.branchCode,
      input.branchName,
      employeeData.ciphertext,
      employeeData.iv,
      employeeLookupHash,
      employeeMask,
      input.amountValue,
      currency,
      date,
      sourceSite,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO follow_board_idempotency_keys
        (id, idempotency_key, request_hash, response_status, response_json, created_at, expires_at)
       VALUES (?, ?, ?, 200, ?, ?, ?)`
    ).bind(newId("fbi"), idempotencyKey, requestHash, responseJson, timestamp, expiresAt),
    env.DB.prepare(
      `INSERT INTO follow_board_request_attempts
        (id, attempt_key_hash, kind, succeeded, occurred_at) VALUES (?, ?, 'INTEREST', 1, ?)`
    ).bind(newId("fba"), attemptKey, timestamp),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'FOLLOW_BOARD_INTEREST_RECORDED', 'FOLLOW_BOARD_PRODUCT', ?, ?, ?, ?)`
    ).bind(
      newId("aud"),
      product.id,
      requestId(request),
      JSON.stringify({ productCode: input.productCode, sourceSite, submissionDate: date }),
      timestamp
    )
  ]);
  return publicJson(request, responseBody);
}

export async function listAdminFollowBoardInterests(
  request: Request,
  env: AppEnv,
  session: SessionContext
): Promise<Response> {
  requireAdminOrPs(session);
  const requestedDate = new URL(request.url).searchParams.get("date")?.trim() ?? taipeiDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new AppError(422, "VALIDATION_ERROR", "日期格式必須為 YYYY-MM-DD。");
  }
  const result = await env.DB.prepare(
    `SELECT i.id, p.product_code, p.status AS product_status, i.branch_code, i.branch_name,
            i.employee_number_ciphertext, i.employee_number_iv, i.amount_value, i.currency,
            i.source_site, i.created_at, i.updated_at
       FROM follow_board_interests i
       JOIN follow_board_products p ON p.id = i.product_id
      WHERE i.submission_date = ?
      ORDER BY p.product_code, i.updated_at`
  ).bind(requestedDate).all<{
    id: string;
    product_code: string;
    product_status: string;
    branch_code: string;
    branch_name: string;
    employee_number_ciphertext: string;
    employee_number_iv: string;
    amount_value: number;
    currency: string;
    source_site: string;
    created_at: string;
    updated_at: string;
  }>();
  const interests = await Promise.all(result.results.map(async row => ({
    id: row.id,
    productCode: row.product_code,
    productStatus: row.product_status,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    employeeNumber: await decryptEmployeeNumber(
      env.EMPLOYEE_DATA_KEY,
      row.employee_number_ciphertext,
      row.employee_number_iv
    ),
    amountValue: row.amount_value,
    currency: row.currency,
    sourceSite: row.source_site,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })));
  await insertAudit(
    env,
    "FOLLOW_BOARD_INTEREST_LIST_VIEWED",
    "FOLLOW_BOARD_INTEREST",
    null,
    session.user.id,
    requestId(request),
    { date: requestedDate, rowCount: interests.length }
  );
  return jsonResponse({ date: requestedDate, interests });
}

export async function archiveFollowBoardProduct(
  request: Request,
  env: AppEnv,
  session: SessionContext,
  productCode: string
): Promise<Response> {
  requireAdminOrPs(session);
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const normalized = productCode.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(normalized)) {
    throw new AppError(404, "FOLLOW_BOARD_PRODUCT_NOT_FOUND", "找不到指定商品。");
  }
  const timestamp = nowIso();
  const result = await env.DB.prepare(
    `UPDATE follow_board_products
        SET status = 'ARCHIVED', archived_at = ?, archived_by_user_id = ?, updated_at = ?
      WHERE product_code = ? COLLATE NOCASE AND status = 'PUBLISHED'`
  ).bind(timestamp, session.user.id, timestamp, normalized).run();
  if (result.meta.changes !== 1) {
    throw new AppError(404, "FOLLOW_BOARD_PRODUCT_NOT_FOUND", "找不到可下架的商品。");
  }
  await insertAudit(
    env,
    "FOLLOW_BOARD_PRODUCT_ARCHIVED",
    "FOLLOW_BOARD_PRODUCT",
    normalized,
    session.user.id,
    requestId(request),
    { productCode: normalized }
  );
  return jsonResponse({ productCode: normalized, status: "ARCHIVED", archivedAt: timestamp });
}

/**
 * Reconstructs an expiry for a product published before ADR 0028 added the removal date.
 *
 * Those subjects used the old `BATCH跟單` form with no date at all, so `expires_at` is NULL and the
 * product would otherwise stay on the public board forever. The stored `subject_date_mmdd` is the
 * deal date, and ADR 0028's rule is that a product stays available through its stated calendar
 * date, so the deal date is the faithful fallback: expiry is 00:00 Asia/Taipei the following day.
 *
 * The year is taken from `published_at` and rolled back when the deal date sits in the next
 * calendar year, which happens for a product published in late December.
 */
export function legacyExpiryAt(subjectDateMmdd: string, publishedAt: string): string | null {
  if (!/^\d{4}$/.test(subjectDateMmdd)) return null;
  const month = Number(subjectDateMmdd.slice(0, 2));
  const day = Number(subjectDateMmdd.slice(2));
  const published = new Date(publishedAt);
  if (!Number.isFinite(published.getTime())) return null;
  let year = Number(taipeiDate(published).slice(0, 4));
  const candidate = new Date(Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1_000);
  if (!Number.isFinite(candidate.getTime())) return null;
  // A deal date more than a month ahead of publication means the year rolled over.
  if (candidate.getTime() - published.getTime() > 31 * 24 * 60 * 60 * 1_000) year -= 1;
  const expiry = new Date(Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1_000);
  return Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null;
}

export async function cleanupFollowBoardOperationalData(env: AppEnv): Promise<void> {
  const now = nowIso();
  const attemptsBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();

  // Backfill legacy products first so they flow through the normal expiry path below instead of
  // living on the board indefinitely. Only NULL expiries are touched; a stored expiry is never
  // rewritten.
  const legacy = await env.DB.prepare(
    `SELECT id, subject_date_mmdd, published_at
       FROM follow_board_products
      WHERE status = 'PUBLISHED' AND expires_at IS NULL
      LIMIT 100`
  ).all<{ id: string; subject_date_mmdd: string; published_at: string }>();
  // One batched write instead of up to 100 sequential round trips. The `expires_at IS NULL` guard
  // is unchanged, so a product that gained an expiry meanwhile is still never rewritten.
  const backfills = legacy.results.flatMap(row => {
    const expiry = legacyExpiryAt(row.subject_date_mmdd, row.published_at);
    return expiry ? [env.DB.prepare(
      "UPDATE follow_board_products SET expires_at = ?, updated_at = ? WHERE id = ? AND expires_at IS NULL"
    ).bind(expiry, now, row.id)] : [];
  });
  if (backfills.length) await env.DB.batch(backfills);
  const expiredProducts = await env.DB.prepare(
    `SELECT id, product_code, expires_at
       FROM follow_board_products
      WHERE status = 'PUBLISHED' AND expires_at IS NOT NULL AND expires_at <= ?
      ORDER BY expires_at
      LIMIT 100`
  ).bind(now).all<{ id: string; product_code: string; expires_at: string }>();
  // Archive in one batch, then audit only the rows this run actually changed. The guarded UPDATE is
  // byte-for-byte the same, so a product archived concurrently still reports zero changes and is
  // not audited twice.
  if (expiredProducts.results.length) {
    const archived = await env.DB.batch(expiredProducts.results.map(product => env.DB.prepare(
      `UPDATE follow_board_products
          SET status = 'ARCHIVED', archived_at = ?, archived_by_user_id = NULL, updated_at = ?
        WHERE id = ? AND status = 'PUBLISHED' AND expires_at IS NOT NULL AND expires_at <= ?`
    ).bind(now, now, product.id, now)));
    const audits = expiredProducts.results.flatMap((product, index) =>
      archived[index]?.meta.changes === 1 ? [auditStatement(
        env,
        "FOLLOW_BOARD_PRODUCT_EXPIRED",
        "FOLLOW_BOARD_PRODUCT",
        product.id,
        null,
        `cron:${now}`,
        { productCode: product.product_code, expiresAt: product.expires_at },
        now
      )] : []
    );
    if (audits.length) await env.DB.batch(audits);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM follow_board_idempotency_keys WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM follow_board_request_attempts WHERE occurred_at < ?").bind(attemptsBefore)
  ]);
}
