import { requireAdmin } from "./auth";
import { insertAudit, nowIso } from "./db";
import { AppError } from "./errors";
import { jsonResponse, requestId } from "./http";
import type { AppEnv, MailBatchCode, SessionContext } from "./types";

// This remains under the existing private raw-email retention policy (30 days).
const OUTBOUND_ARCHIVE_PREFIX = "raw-email/outbound/v1/";
const MAX_LIST_LIMIT = 100;

export interface OutboundEmailArchiveInput {
  batchId: string;
  rfqId: string;
  batchCode: MailBatchCode;
  sender: string;
  recipient: string;
  subject: string;
  html: string;
  plainText: string;
  contentHash: string;
}

interface OutboundEmailArchive {
  schemaVersion: 1;
  batchId: string;
  rfqId: string;
  batchCode: MailBatchCode;
  sender: string;
  recipient: string;
  subject: string;
  html: string;
  plainText: string;
  contentHash: string;
  generatedAt: string;
}

interface OutboundArchiveListRow {
  id: string;
  rfq_id: string;
  batch_code: MailBatchCode;
  sender: string;
  recipient: string;
  base_subject: string;
  status: "QUEUED" | "SENDING" | "SENT" | "FAILED";
  attempt_count: number;
  queued_at: string;
  sent_at: string | null;
  last_error_code: string | null;
  username_normalized: string;
  display_name: string;
  trade_count: number;
}

export function outboundArchiveKey(batchId: string): string {
  return `${OUTBOUND_ARCHIVE_PREFIX}${batchId}.json`;
}

export async function archiveOutboundEmail(env: AppEnv, input: OutboundEmailArchiveInput): Promise<void> {
  const archive: OutboundEmailArchive = {
    schemaVersion: 1,
    ...input,
    generatedAt: nowIso()
  };
  await env.RAW_MAIL_BUCKET.put(outboundArchiveKey(input.batchId), JSON.stringify(archive), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      artifactType: "outbound-email",
      batchCode: input.batchCode,
      contentHash: input.contentHash
    }
  });
}

function listLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return 50;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_LIMIT) {
    throw new AppError(422, "INVALID_LIST_LIMIT", `limit 必須介於 1 到 ${MAX_LIST_LIMIT}。`);
  }
  return value;
}

function validBatchId(batchId: string): boolean {
  return /^obm_[0-9a-f-]{36}$/i.test(batchId);
}

function isArchive(value: unknown): value is OutboundEmailArchive {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1
    && typeof candidate.batchId === "string"
    && typeof candidate.rfqId === "string"
    && typeof candidate.batchCode === "string"
    && typeof candidate.sender === "string"
    && typeof candidate.recipient === "string"
    && typeof candidate.subject === "string"
    && typeof candidate.html === "string"
    && typeof candidate.plainText === "string"
    && typeof candidate.contentHash === "string"
    && typeof candidate.generatedAt === "string";
}

export async function listAdminOutboundEmails(request: Request, env: AppEnv, session: SessionContext): Promise<Response> {
  requireAdmin(session);
  const limit = listLimit(request);
  const rows = await env.DB.prepare(
    `SELECT b.id, b.rfq_id, b.batch_code, b.sender, b.recipient, b.base_subject, b.status,
            b.attempt_count, b.queued_at, b.sent_at, b.last_error_code,
            u.username_normalized, u.display_name, r.trade_count
       FROM outbound_email_batches b
       JOIN rfqs r ON r.id = b.rfq_id
       JOIN users u ON u.id = r.user_id
      ORDER BY b.queued_at DESC, b.id DESC
      LIMIT ?`
  ).bind(limit).all<OutboundArchiveListRow>();
  await insertAudit(env, "ADMIN_OUTBOUND_EMAIL_LIST_VIEWED", "OUTBOUND_EMAIL_BATCH", null, session.user.id, requestId(request), {
    count: rows.results.length
  });
  return jsonResponse({
    records: rows.results.map(row => ({
      id: row.id,
      rfqId: row.rfq_id,
      batchCode: row.batch_code,
      sender: row.sender,
      recipient: row.recipient,
      baseSubject: row.base_subject,
      status: row.status,
      attemptCount: row.attempt_count,
      queuedAt: row.queued_at,
      sentAt: row.sent_at,
      lastErrorCode: row.last_error_code,
      requester: { username: row.username_normalized, displayName: row.display_name },
      tradeCount: row.trade_count,
      archiveUrl: `/api/v1/admin/outbound-emails/${row.id}`
    }))
  });
}

export async function getAdminOutboundEmail(request: Request, env: AppEnv, session: SessionContext, batchId: string): Promise<Response> {
  requireAdmin(session);
  if (!validBatchId(batchId)) throw new AppError(404, "OUTBOUND_EMAIL_NOT_FOUND", "找不到寄件紀錄。");
  const batch = await env.DB.prepare(
    "SELECT id, rfq_id, batch_code FROM outbound_email_batches WHERE id = ?"
  ).bind(batchId).first<{ id: string; rfq_id: string; batch_code: MailBatchCode }>();
  if (!batch) throw new AppError(404, "OUTBOUND_EMAIL_NOT_FOUND", "找不到寄件紀錄。");

  const object = await env.RAW_MAIL_BUCKET.get(outboundArchiveKey(batch.id));
  if (!object) throw new AppError(404, "OUTBOUND_EMAIL_ARCHIVE_NOT_FOUND", "此寄件紀錄尚未儲存內容。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await object.text()) as unknown;
  } catch {
    throw new AppError(500, "OUTBOUND_EMAIL_ARCHIVE_INVALID", "寄件紀錄格式無法讀取。");
  }
  if (!isArchive(parsed) || parsed.batchId !== batch.id || parsed.rfqId !== batch.rfq_id || parsed.batchCode !== batch.batch_code) {
    throw new AppError(500, "OUTBOUND_EMAIL_ARCHIVE_INVALID", "寄件紀錄驗證失敗。");
  }

  await insertAudit(env, "ADMIN_OUTBOUND_EMAIL_VIEWED", "OUTBOUND_EMAIL_BATCH", batch.id, session.user.id, requestId(request), {
    rfqId: batch.rfq_id,
    batchCode: batch.batch_code
  });
  return jsonResponse({ record: parsed });
}
