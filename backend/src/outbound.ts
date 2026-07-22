import {
  EMAIL_INSTITUTIONS,
  MAIL_INSTITUTION_ORDER,
  branchSubjectLabel,
  buildInstitutionEmail,
  type MailTradeRecord
} from "../shared/email-formats.js";
import { archiveOutboundEmail } from "./admin-outbound";
import { requireCsrf } from "./auth";
import { rfqCorrelationCode, sha256Text, stableStringify } from "./crypto";
import { newId, nowIso } from "./db";
import { AppError } from "./errors";
import { startRfqCoordinator } from "./coordinator";
import { jsonResponse, requestId, requireIdempotencyKey, requireSameOrigin } from "./http";
import { fetchOwnedRfq, type TradeRow } from "./rfqs";
import type { AppEnv, MailBatchCode, OutboundEmailJob, SessionContext } from "./types";

const EXPECTED_OUTBOUND_FROM = "rfq@yintsun66.com";
const EXPECTED_OUTBOUND_TO = "i14053@firstbank.com.tw";
const EXPECTED_ISSUERS: ReadonlyArray<{ issuer: string; batchCode: MailBatchCode }> = Object.freeze([
  { issuer: "BNP", batchCode: "BMJB" },
  { issuer: "MS", batchCode: "BMJB" },
  { issuer: "JPM", batchCode: "BMJB" },
  { issuer: "BARCLAYS", batchCode: "BMJB" },
  { issuer: "NOMURA", batchCode: "NOMURA" },
  { issuer: "UBS", batchCode: "UBS" },
  { issuer: "DBS", batchCode: "DBS" },
  { issuer: "SG", batchCode: "SG" },
  { issuer: "CITI", batchCode: "CITI" },
  { issuer: "GS", batchCode: "GS" },
  { issuer: "CA", batchCode: "CA" }
]);
const BATCH_CODES = MAIL_INSTITUTION_ORDER as readonly MailBatchCode[];

interface IdempotencyRow {
  request_hash: string;
  response_status: number;
  response_json: string;
}

interface PendingJobRow extends OutboundEmailJob {
  jobId: string;
  batchId: string;
  rfqId: string;
}

interface OutboundBatchRow {
  id: string;
  rfq_id: string;
  batch_code: MailBatchCode;
  sender: string;
  recipient: string;
  base_subject: string;
  correlation_token_hash: string;
  status: "QUEUED" | "SENDING" | "SENT" | "FAILED";
}

function assertFixedAddresses(env: AppEnv): void {
  if (env.OUTBOUND_FROM.toLowerCase() !== EXPECTED_OUTBOUND_FROM || env.OUTBOUND_TO.toLowerCase() !== EXPECTED_OUTBOUND_TO) {
    throw new AppError(500, "INVALID_OUTBOUND_EMAIL_CONFIGURATION", "伺服器寄信設定不正確。 ");
  }
}

async function correlationToken(env: AppEnv, rfqId: string): Promise<string> {
  // Short, human-readable subject correlation code (see ADR 0002). Deterministic per RFQ so
  // outbound storage, the worker rebuild, and inbound matching all agree on sha256(code).
  return rfqCorrelationCode(env.EMPLOYEE_LOOKUP_KEY, rfqId);
}

function numberText(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

function tradeRecord(trade: TradeRow): MailTradeRecord {
  const underlyings = JSON.parse(trade.underlyings_json) as unknown;
  if (!Array.isArray(underlyings) || underlyings.some(value => typeof value !== "string")) {
    throw new AppError(500, "INVALID_STORED_TRADE", "詢價資料格式不正確。 ");
  }
  return {
    product: trade.product,
    currency: trade.currency,
    guaranteedPeriods: String(trade.guaranteed_periods_months),
    bbgCode1: underlyings[0] ?? "",
    bbgCode2: underlyings[1] ?? "",
    bbgCode3: underlyings[2] ?? "",
    bbgCode4: underlyings[3] ?? "",
    bbgCode5: underlyings[4] ?? "",
    strike: numberText(trade.strike_pct),
    koType: trade.ko_type,
    koBarrier: numberText(trade.ko_barrier_pct),
    coupon: numberText(trade.coupon_pa_pct),
    upfront: numberText(trade.upfront_or_note_price_pct),
    tenor: String(trade.tenor_months),
    barrierType: trade.barrier_type,
    kiBarrier: numberText(trade.ki_barrier_pct),
    observationFrequency: String(trade.observation_frequency_months),
    otc: trade.otc,
    effectiveDateOffset: String(trade.effective_date_offset_calendar_days),
    tradeDate: trade.trade_date
  };
}

async function enqueueJobs(env: AppEnv, rfqId: string): Promise<void> {
  const pending = await env.DB.prepare(
    `SELECT id AS jobId, related_entity_id AS batchId, rfq_id AS rfqId
       FROM jobs
      WHERE rfq_id = ? AND job_type = 'OUTBOUND_EMAIL' AND status IN ('QUEUED', 'FAILED')
      ORDER BY created_at ASC`
  ).bind(rfqId).all<PendingJobRow>();
  if (pending.results.length === 0) return;
  try {
    await env.OUTBOUND_EMAIL_QUEUE.sendBatch(pending.results.map(body => ({ body })));
  } catch {
    throw new AppError(503, "OUTBOUND_QUEUE_UNAVAILABLE", "詢價已保存，但寄信佇列暫時無法使用；請以相同 Idempotency-Key 重試。 ");
  }
}

export async function sendRfq(
  request: Request,
  env: AppEnv,
  session: SessionContext,
  rfqId: string
): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  assertFixedAddresses(env);
  const idempotencyKey = requireIdempotencyKey(request);
  const requestHash = await sha256Text(stableStringify({ action: "SEND_RFQ", rfqId }));
  const existing = await env.DB.prepare(
    `SELECT request_hash, response_status, response_json FROM idempotency_keys
      WHERE user_id = ? AND scope = 'SEND_RFQ' AND idempotency_key = ?`
  ).bind(session.user.id, idempotencyKey).first<IdempotencyRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "此 Idempotency-Key 已用於不同內容。 ");
    }
    await enqueueJobs(env, rfqId);
    return jsonResponse(JSON.parse(existing.response_json) as unknown, existing.response_status);
  }

  const current = await fetchOwnedRfq(env, session.user.id, rfqId);
  if (current.rfq.status !== "VALIDATED") {
    throw new AppError(409, "RFQ_NOT_VALIDATED", "詢價必須先完成驗證才能寄送。 ");
  }
  if (current.rfq.dispatch_status !== "NOT_SENT") {
    throw new AppError(409, "RFQ_ALREADY_DISPATCHED", "此詢價已進入寄送流程。 ");
  }

  const queuedAt = nowIso();
  const token = await correlationToken(env, rfqId);
  const tokenHash = await sha256Text(token);
  // Snapshot the requester's branch label into the per-send base subject (see ADR 0002).
  const branchLabel = branchSubjectLabel(session.user.branchName);
  const branchSuffix = branchLabel ? ` ${branchLabel}` : "";
  const jobs: OutboundEmailJob[] = [];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE rfqs
          SET dispatch_status = 'QUEUED', correlation_token_hash = ?, outbound_queued_at = ?,
              expected_issuer_count = ?, outbound_batch_count = ?, version = version + 1,
              workflow_status = 'QUEUED'
        WHERE id = ? AND user_id = ? AND status = 'VALIDATED' AND dispatch_status = 'NOT_SENT'`
    ).bind(tokenHash, queuedAt, EXPECTED_ISSUERS.length, BATCH_CODES.length, rfqId, session.user.id)
  ];

  for (const expected of EXPECTED_ISSUERS) {
    statements.push(env.DB.prepare(
      `INSERT INTO rfq_expected_issuers
        (id, rfq_id, issuer, outbound_batch_code, status, snapshot_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`
    ).bind(newId("exp"), rfqId, expected.issuer, expected.batchCode, queuedAt));
  }
  for (const batchCode of BATCH_CODES) {
    const profile = EMAIL_INSTITUTIONS[batchCode];
    if (!profile) throw new AppError(500, "MISSING_EMAIL_PROFILE", "找不到寄信格式設定。 ");
    const batchId = newId("obm");
    const jobId = newId("job");
    jobs.push({ jobId, batchId, rfqId });
    statements.push(env.DB.prepare(
      `INSERT INTO outbound_email_batches
        (id, rfq_id, batch_code, sender, recipient, base_subject, correlation_token_hash, status, queued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`
    ).bind(batchId, rfqId, batchCode, env.OUTBOUND_FROM, env.OUTBOUND_TO, `${profile.subject}${branchSuffix}`, tokenHash, queuedAt));
    statements.push(env.DB.prepare(
      `INSERT INTO jobs
        (id, job_type, rfq_id, related_entity_id, idempotency_key, status, available_at, created_at, updated_at)
       VALUES (?, 'OUTBOUND_EMAIL', ?, ?, ?, 'QUEUED', ?, ?, ?)`
    ).bind(jobId, rfqId, batchId, `OUTBOUND_EMAIL:${rfqId}:${batchCode}`, queuedAt, queuedAt, queuedAt));
  }

  const publicBody = {
    rfq: {
      id: rfqId,
      status: current.rfq.status,
      dispatchStatus: "QUEUED",
      outboundQueuedAt: queuedAt,
      sentAt: null,
      deadlineAt: null,
      expectedIssuerCount: EXPECTED_ISSUERS.length,
      outboundBatchCount: BATCH_CODES.length
    }
  };
  statements.push(env.DB.prepare(
    `INSERT INTO idempotency_keys
      (id, user_id, scope, idempotency_key, request_hash, response_status, response_json, created_at, expires_at)
     VALUES (?, ?, 'SEND_RFQ', ?, ?, 202, ?, ?, ?)`
  ).bind(
    newId("idem"), session.user.id, idempotencyKey, requestHash, JSON.stringify(publicBody), queuedAt,
    new Date(Date.parse(queuedAt) + 24 * 60 * 60 * 1000).toISOString()
  ));
  statements.push(env.DB.prepare(
    `INSERT INTO audit_events
      (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
     VALUES (?, ?, 'RFQ_EMAILS_QUEUED', 'RFQ', ?, ?, ?, ?)`
  ).bind(
    newId("aud"), session.user.id, rfqId, requestId(request),
    JSON.stringify({ batchCount: BATCH_CODES.length, expectedIssuerCount: EXPECTED_ISSUERS.length }), queuedAt
  ));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const concurrent = await env.DB.prepare(
      `SELECT request_hash, response_status, response_json FROM idempotency_keys
        WHERE user_id = ? AND scope = 'SEND_RFQ' AND idempotency_key = ?`
    ).bind(session.user.id, idempotencyKey).first<IdempotencyRow>();
    if (concurrent) {
      if (concurrent.request_hash !== requestHash) {
        throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "此 Idempotency-Key 已用於不同內容。 ");
      }
      await enqueueJobs(env, rfqId);
      return jsonResponse(JSON.parse(concurrent.response_json) as unknown, concurrent.response_status);
    }
    const state = await fetchOwnedRfq(env, session.user.id, rfqId);
    if (state.rfq.dispatch_status !== "NOT_SENT") {
      throw new AppError(409, "RFQ_ALREADY_DISPATCHED", "此詢價已進入寄送流程。 ");
    }
    throw error;
  }

  try {
    await env.OUTBOUND_EMAIL_QUEUE.sendBatch(jobs.map(body => ({ body })));
  } catch {
    throw new AppError(503, "OUTBOUND_QUEUE_UNAVAILABLE", "詢價已保存，但寄信佇列暫時無法使用；請以相同 Idempotency-Key 重試。 ");
  }
  return jsonResponse(publicBody, 202);
}

async function storedTrades(env: AppEnv, rfqId: string): Promise<TradeRow[]> {
  const result = await env.DB.prepare(
    `SELECT id, sequence, trade_code, product, currency, trade_date,
            effective_date_offset_calendar_days, tenor_months, guaranteed_periods_months,
            underlyings_json, strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct,
            upfront_or_note_price_pct, barrier_type, ki_barrier_pct,
            observation_frequency_months, otc, target_field, matching_key_hash,
            created_at, frozen_at
       FROM rfq_trades WHERE rfq_id = ? ORDER BY sequence ASC`
  ).bind(rfqId).all<TradeRow>();
  return result.results;
}

async function claimBatch(env: AppEnv, job: OutboundEmailJob): Promise<OutboundBatchRow | null> {
  const current = await env.DB.prepare(
    `SELECT id, rfq_id, batch_code, sender, recipient, base_subject, correlation_token_hash, status
       FROM outbound_email_batches WHERE id = ? AND rfq_id = ?`
  ).bind(job.batchId, job.rfqId).first<OutboundBatchRow>();
  if (!current) throw new Error("OUTBOUND_BATCH_NOT_FOUND");
  if (current.status === "SENT") {
    await env.DB.prepare(
      "UPDATE jobs SET status = 'COMPLETED', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?"
    ).bind(nowIso(), nowIso(), job.jobId).run();
    return null;
  }

  const claimedAt = nowIso();
  const leaseExpiresAt = new Date(Date.parse(claimedAt) + 2 * 60 * 1000).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE outbound_email_batches
        SET status = 'SENDING', attempt_count = attempt_count + 1,
            lease_expires_at = ?, last_error_code = NULL
      WHERE id = ? AND rfq_id = ? AND status != 'SENT'
        AND (status != 'SENDING' OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
  ).bind(leaseExpiresAt, job.batchId, job.rfqId, claimedAt).run();
  if (claimed.meta.changes === 0) throw new Error("OUTBOUND_BATCH_LEASED");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET status = 'RUNNING', attempt_count = attempt_count + 1,
              lease_expires_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ?`
    ).bind(leaseExpiresAt, claimedAt, job.jobId),
    env.DB.prepare(
      "UPDATE rfqs SET dispatch_status = 'SENDING' WHERE id = ? AND dispatch_status IN ('QUEUED', 'SENDING')"
    ).bind(job.rfqId)
  ]);
  return { ...current, status: "SENDING" };
}

export async function processOutboundEmailJob(env: AppEnv, job: OutboundEmailJob): Promise<void> {
  assertFixedAddresses(env);
  const batch = await claimBatch(env, job);
  if (!batch) return;
  if (batch.sender.toLowerCase() !== EXPECTED_OUTBOUND_FROM || batch.recipient.toLowerCase() !== EXPECTED_OUTBOUND_TO) {
    throw new Error("OUTBOUND_ADDRESS_MISMATCH");
  }

  const token = await correlationToken(env, batch.rfq_id);
  if (await sha256Text(token) !== batch.correlation_token_hash) throw new Error("CORRELATION_TOKEN_MISMATCH");
  const records = (await storedTrades(env, batch.rfq_id)).map(tradeRecord);
  if (records.length === 0) throw new Error("OUTBOUND_TRADES_NOT_FOUND");
  const email = buildInstitutionEmail(batch.batch_code, records, { rfqToken: token, batchCode: batch.batch_code, subjectBase: batch.base_subject });
  if (!email.subject.startsWith(`${batch.base_subject} `)) throw new Error("OUTBOUND_SUBJECT_MISMATCH");
  const contentHash = await sha256Text(stableStringify({ subject: email.subject, html: email.html, plainText: email.plainText }));
  await env.DB.prepare(
    "UPDATE outbound_email_batches SET content_hash = ? WHERE id = ? AND status = 'SENDING'"
  ).bind(contentHash, batch.id).run();
  await archiveOutboundEmail(env, {
    batchId: batch.id,
    rfqId: batch.rfq_id,
    batchCode: batch.batch_code,
    sender: batch.sender,
    recipient: batch.recipient,
    subject: email.subject,
    html: email.html,
    plainText: email.plainText,
    contentHash
  });
  const result = await env.EMAIL.send({
    from: batch.sender,
    to: batch.recipient,
    subject: email.subject,
    text: email.plainText,
    html: email.html,
    headers: {
      "X-FCN-RFQ-ID": batch.rfq_id,
      "X-FCN-BATCH": batch.batch_code
    }
  });
  const sentAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE outbound_email_batches
          SET status = 'SENT', content_hash = ?, sent_at = ?, provider_message_id = ?,
              lease_expires_at = NULL, last_error_code = NULL
        WHERE id = ? AND status = 'SENDING'`
    ).bind(contentHash, sentAt, result.messageId, batch.id),
    env.DB.prepare(
      `UPDATE jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
              lease_expires_at = NULL, last_error_code = NULL WHERE id = ?`
    ).bind(sentAt, sentAt, job.jobId),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'OUTBOUND_EMAIL_SENT', 'OUTBOUND_EMAIL_BATCH', ?, ?, ?, ?)`
    ).bind(newId("aud"), batch.id, `queue:${job.jobId}`, JSON.stringify({ batchCode: batch.batch_code }), sentAt)
  ]);

  const summary = await env.DB.prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS sent_count
       FROM outbound_email_batches WHERE rfq_id = ?`
  ).bind(batch.rfq_id).first<{ total_count: number; sent_count: number }>();
  if (summary && summary.total_count === BATCH_CODES.length && summary.sent_count === BATCH_CODES.length) {
    const deadlineAt = new Date(Date.parse(sentAt) + 10 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE rfqs SET dispatch_status = 'WAITING', sent_at = COALESCE(sent_at, ?),
              deadline_at = COALESCE(deadline_at, ?), workflow_status = 'WAITING'
        WHERE id = ? AND dispatch_status IN ('QUEUED', 'SENDING')`
    ).bind(sentAt, deadlineAt, batch.rfq_id).run();
    try {
      await startRfqCoordinator(env, batch.rfq_id);
    } catch (error) {
      console.error("rfq_coordinator_start_failed", {
        rfqId: batch.rfq_id,
        errorType: error instanceof Error ? error.name : "unknown"
      });
    }
  }
}

async function markOutboundFailure(env: AppEnv, job: OutboundEmailJob, terminal: boolean, errorCode: string): Promise<void> {
  const failedAt = nowIso();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE outbound_email_batches SET status = 'FAILED', lease_expires_at = NULL, last_error_code = ?
        WHERE id = ? AND status != 'SENT'`
    ).bind(errorCode, job.batchId),
    env.DB.prepare(
      `UPDATE jobs SET status = 'FAILED', lease_expires_at = NULL, last_error_code = ?, updated_at = ?
        WHERE id = ? AND status != 'COMPLETED'`
    ).bind(errorCode, failedAt, job.jobId)
  ];
  if (terminal) {
    statements.push(env.DB.prepare(
      "UPDATE rfqs SET dispatch_status = 'FAILED', workflow_status = 'FAILED' WHERE id = ? AND dispatch_status != 'WAITING'"
    ).bind(job.rfqId));
  }
  await env.DB.batch(statements);
}

function queueErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)) return error.message;
  return "OUTBOUND_EMAIL_SEND_FAILED";
}

function isOutboundEmailJob(value: unknown): value is OutboundEmailJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.jobId, candidate.batchId, candidate.rfqId]
    .every(part => typeof part === "string" && /^[a-z]+_[0-9a-f-]{36}$/i.test(part));
}

export async function consumeOutboundEmail(batch: MessageBatch<unknown>, env: AppEnv): Promise<void> {
  for (const message of batch.messages) {
    if (!isOutboundEmailJob(message.body)) {
      console.error("invalid_outbound_queue_message", { messageId: message.id });
      message.retry({ delaySeconds: 300 });
      continue;
    }
    try {
      await processOutboundEmailJob(env, message.body);
      message.ack();
    } catch (error) {
      if (error instanceof Error && error.message === "OUTBOUND_BATCH_LEASED") {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      const terminal = message.attempts >= 4;
      try {
        await markOutboundFailure(env, message.body, terminal, queueErrorCode(error));
      } catch (persistenceError) {
        console.error("outbound_failure_persistence_failed", {
          jobId: message.body.jobId,
          errorType: persistenceError instanceof Error ? persistenceError.name : "unknown"
        });
      }
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** Math.max(0, message.attempts - 1)) });
    }
  }
}
