import { AppError } from "./errors";

export const SESSION_COOKIE = "__Host-fcn_session";
export const CSRF_COOKIE = "__Host-fcn_csrf";

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

export function jsonResponse(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("content-type", "application/json; charset=utf-8");
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function emptyResponse(status = 204, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(SECURITY_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  }
  return new Response(null, { status, headers });
}

export async function readJson(request: Request, maxBytes = 65_536): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type 必須為 application/json。 ");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError(413, "REQUEST_TOO_LARGE", "請求內容超過允許大小。 ");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new AppError(413, "REQUEST_TOO_LARGE", "請求內容超過允許大小。 ");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError(400, "INVALID_JSON", "JSON 格式不正確。 ");
  }
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new AppError(403, "INVALID_ORIGIN", "無法驗證請求來源。 ");
  }
}

export function parseCookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

export function sessionCookie(value: string, expired = false): string {
  return `${SESSION_COOKIE}=${expired ? "" : value}; Path=/; Secure; HttpOnly; SameSite=Strict${expired ? "; Max-Age=0" : ""}`;
}

export function csrfCookie(value: string, expired = false): string {
  return `${CSRF_COOKIE}=${expired ? "" : value}; Path=/; Secure; SameSite=Strict${expired ? "; Max-Age=0" : ""}`;
}

export function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 必須為 16 至 128 個安全字元。 ");
  }
  return key;
}

export function requestId(request: Request): string {
  return request.headers.get("cf-ray")?.split("-")[0] || crypto.randomUUID();
}
