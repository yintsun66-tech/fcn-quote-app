import { sha256Bytes } from "./crypto";
import { newId, nowIso } from "./db";
import type { AppEnv, InboundEmailJob } from "./types";

const DEFAULT_MAX_INBOUND_BYTES = 25 * 1024 * 1024;
const HEADER_LIMIT = 8_192;

interface ExistingInboundRow {
  id: string;
  status: string;
  job_id: string;
  job_status: string;
}

function positiveInteger(value: string, fallback: number): number {
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : fallback;
}

function bounded(value: string | null, maximum = HEADER_LIMIT): string | null {
  if (value === null) return null;
  return Array.from(value.trim()).slice(0, maximum).join("");
}

function messageId(headers: Headers): string | null {
  const value = bounded(headers.get("message-id"), 998);
  return value || null;
}

async function findExisting(
  env: AppEnv,
  contentHash: string,
  sourceMessageId: string | null
): Promise<ExistingInboundRow | null> {
  return env.DB.prepare(
    `SELECT m.id, m.status, j.id AS job_id, j.status AS job_status
       FROM inbound_messages m
       JOIN email_parse_jobs j ON j.inbound_message_id = m.id
      WHERE m.content_hash = ? OR (? IS NOT NULL AND m.message_id = ?)
      ORDER BY CASE WHEN m.content_hash = ? THEN 0 ELSE 1 END
      LIMIT 1`
  ).bind(contentHash, sourceMessageId, sourceMessageId, contentHash).first<ExistingInboundRow>();
}

async function queueExistingIfNeeded(env: AppEnv, existing: ExistingInboundRow): Promise<void> {
  if (existing.status !== "RECEIVED" && existing.job_status !== "FAILED") return;
  const now = nowIso();
  if (existing.job_status === "FAILED") {
    await env.DB.prepare(
      `UPDATE email_parse_jobs
          SET status = 'QUEUED', last_error_code = NULL, lease_expires_at = NULL,
              available_at = ?, updated_at = ?
        WHERE id = ? AND status = 'FAILED'`
    ).bind(now, now, existing.job_id).run();
  }
  await env.INBOUND_EMAIL_QUEUE.send({ jobId: existing.job_id, inboundMessageId: existing.id });
  await env.DB.prepare(
    "UPDATE inbound_messages SET status = 'QUEUED', queued_at = COALESCE(queued_at, ?) WHERE id = ? AND status = 'RECEIVED'"
  ).bind(now, existing.id).run();
}

export async function ingestInboundEmail(message: ForwardableEmailMessage, env: AppEnv): Promise<void> {
  const expectedRecipient = env.INBOUND_ADDRESS.trim().toLowerCase();
  if (message.to.trim().toLowerCase() !== expectedRecipient) {
    message.setReject("Recipient not accepted");
    return;
  }

  const maximumBytes = positiveInteger(env.MAX_INBOUND_EMAIL_BYTES, DEFAULT_MAX_INBOUND_BYTES);
  if (message.rawSize < 1 || message.rawSize > maximumBytes) {
    message.setReject("Message size not accepted");
    return;
  }

  const rawMime = await new Response(message.raw).arrayBuffer();
  if (rawMime.byteLength < 1 || rawMime.byteLength > maximumBytes) {
    message.setReject("Message size not accepted");
    return;
  }

  const contentHash = await sha256Bytes(rawMime);
  const sourceMessageId = messageId(message.headers);
  const existing = await findExisting(env, contentHash, sourceMessageId);
  if (existing) {
    await queueExistingIfNeeded(env, existing);
    return;
  }

  const inboundMessageId = newId("inm");
  const jobId = newId("job");
  const receivedAt = nowIso();
  const objectKey = `raw-email/v1/${contentHash}.eml`;
  await env.RAW_MAIL_BUCKET.put(objectKey, rawMime, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { contentHash, receivedAt }
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO inbound_messages
          (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
           header_from, return_path, raw_subject, in_reply_to, references_header,
           authentication_results, raw_size_bytes, received_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED')`
      ).bind(
        inboundMessageId,
        objectKey,
        sourceMessageId,
        contentHash,
        bounded(message.from, 320) ?? "",
        bounded(message.to, 320) ?? "",
        bounded(message.headers.get("from")),
        bounded(message.headers.get("return-path")),
        bounded(message.headers.get("subject")) ?? "",
        bounded(message.headers.get("in-reply-to")),
        bounded(message.headers.get("references")),
        bounded(message.headers.get("authentication-results")),
        rawMime.byteLength,
        receivedAt
      ),
      env.DB.prepare(
        `INSERT INTO email_parse_jobs
          (id, inbound_message_id, idempotency_key, status, available_at, created_at, updated_at)
         VALUES (?, ?, ?, 'QUEUED', ?, ?, ?)`
      ).bind(jobId, inboundMessageId, `EMAIL_PARSE:${inboundMessageId}`, receivedAt, receivedAt, receivedAt),
      env.DB.prepare(
        `INSERT INTO audit_events
          (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
         VALUES (?, NULL, 'INBOUND_EMAIL_RECEIVED', 'INBOUND_MESSAGE', ?, ?, ?, ?)`
      ).bind(
        newId("aud"),
        inboundMessageId,
        crypto.randomUUID(),
        JSON.stringify({ rawSizeBytes: rawMime.byteLength }),
        receivedAt
      )
    ]);
  } catch (error) {
    const raced = await findExisting(env, contentHash, sourceMessageId);
    if (!raced) throw error;
    await queueExistingIfNeeded(env, raced);
    return;
  }

  const job: InboundEmailJob = { jobId, inboundMessageId };
  await env.INBOUND_EMAIL_QUEUE.send(job);
  await env.DB.prepare(
    "UPDATE inbound_messages SET status = 'QUEUED', queued_at = ? WHERE id = ? AND status = 'RECEIVED'"
  ).bind(nowIso(), inboundMessageId).run();
}
