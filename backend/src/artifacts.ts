import { newId, nowIso } from "./db";
import { rfqCorrelationCode } from "./crypto";
import { renderQuoteCardHtml, type QuoteCardTrade } from "./quote-card";
import type { AppEnv, ImageRenderJob } from "./types";

const LEASE_MILLISECONDS = 3 * 60 * 1000;

interface ArtifactJobRow {
  id: string;
  artifact_id: string;
  rfq_id: string;
  ranking_run_id: string;
  trade_code: string;
  issuer: string;
  status: string;
}

interface QuoteCardRow {
  sequence: number;
  trade_code: string;
  product: string;
  currency: string;
  issuer: string;
  issuer_display_name: string;
  trade_date: string | null;
  tenor_months: number | null;
  guaranteed_periods_months: number | null;
  underlyings_json: string;
  coupon_pa_pct: number | null;
  strike_pct: number | null;
  ko_barrier_pct: number | null;
  ko_type: string | null;
  barrier_type: string | null;
  ki_barrier_pct: number | null;
  comparable_price_pct: number | null;
}

function safeUnderlyings(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function claimJob(env: AppEnv, requested: ImageRenderJob): Promise<ArtifactJobRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, artifact_id, rfq_id, ranking_run_id, trade_code, issuer, status FROM image_render_jobs
      WHERE id = ? AND artifact_id = ? AND rfq_id = ? AND ranking_run_id = ?`
  ).bind(requested.jobId, requested.artifactId, requested.rfqId, requested.rankingRunId).first<ArtifactJobRow>();
  if (!row) throw new Error("IMAGE_RENDER_JOB_NOT_FOUND");
  if (row.status === "COMPLETED") return null;
  const now = nowIso();
  const lease = new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE image_render_jobs SET status = 'RUNNING', attempt_count = attempt_count + 1,
            lease_expires_at = ?, last_error_code = NULL, updated_at = ?
      WHERE id = ? AND status != 'COMPLETED'
        AND (status != 'RUNNING' OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
  ).bind(lease, now, row.id, now).run();
  if (claimed.meta.changes === 0) throw new Error("IMAGE_RENDER_JOB_LEASED");
  await env.DB.prepare("UPDATE generated_artifacts SET status = 'RENDERING', attempt_count = attempt_count + 1 WHERE id = ?")
    .bind(row.artifact_id).run();
  return row;
}

export async function processImageRenderJob(env: AppEnv, requested: ImageRenderJob): Promise<void> {
  const job = await claimJob(env, requested);
  if (!job) return;
  const rows = await env.DB.prepare(
    `SELECT t.sequence, t.trade_code, q.product, q.currency, q.issuer, q.issuer_display_name,
            t.trade_date, q.tenor_months, q.guaranteed_periods_months, q.underlyings_json,
            q.coupon_pa_pct, q.strike_pct, q.ko_barrier_pct, q.ko_type, q.barrier_type,
            q.ki_barrier_pct, q.comparable_price_pct
       FROM ranking_results r
       JOIN rfq_trades t ON t.id = r.trade_id
       JOIN issuer_quotes q ON q.id = r.quote_id
      WHERE r.ranking_run_id = ? AND t.trade_code = ? AND r.is_image_winner = 1
      ORDER BY t.sequence`
  ).bind(job.ranking_run_id, job.trade_code).all<QuoteCardRow>();
  if (!rows.results.length) throw new Error("IMAGE_RENDER_NO_RANKED_QUOTES");
  const trades: QuoteCardTrade[] = rows.results.map(row => ({
    sequence: row.sequence, tradeCode: row.trade_code, product: row.product, currency: row.currency,
    issuer: row.issuer, issuerDisplayName: row.issuer_display_name, tradeDate: row.trade_date,
    tenorMonths: row.tenor_months,
    guaranteedPeriodsMonths: row.guaranteed_periods_months, underlyings: safeUnderlyings(row.underlyings_json),
    couponPaPct: row.coupon_pa_pct, strikePct: row.strike_pct, koBarrierPct: row.ko_barrier_pct,
    koType: row.ko_type, barrierType: row.barrier_type, kiBarrierPct: row.ki_barrier_pct,
    comparablePricePct: row.comparable_price_pct
  }));
  const html = renderQuoteCardHtml(
    job.issuer,
    trades,
    await rfqCorrelationCode(env.EMPLOYEE_LOOKUP_KEY, job.rfq_id)
  );
  const response = await env.BROWSER.quickAction("screenshot", {
    html,
    viewport: { width: 720, height: 1280, deviceScaleFactor: trades.length > 12 ? 1 : 1.5 },
    screenshotOptions: { type: "png", fullPage: true },
    gotoOptions: { waitUntil: "networkidle0" }
  });
  if (!response.ok) throw new Error("BROWSER_RENDER_FAILED");
  const bytes = await response.arrayBuffer();
  const objectKey = `quote-images/v3/${job.rfq_id}/${job.ranking_run_id}/${job.trade_code}.png`;
  await env.RAW_MAIL_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: "image/png", cacheControl: "private, max-age=0, no-store" },
    customMetadata: { rfqId: job.rfq_id, rankingRunId: job.ranking_run_id, tradeCode: job.trade_code, issuer: job.issuer }
  });
  const completedAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE generated_artifacts SET status = 'READY', r2_object_key = ?, content_hash = ?,
              byte_size = ?, completed_at = ?, last_error_code = NULL WHERE id = ?`
    ).bind(objectKey, await hashBytes(bytes), bytes.byteLength, completedAt, job.artifact_id),
    env.DB.prepare(
      `UPDATE image_render_jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
              lease_expires_at = NULL, last_error_code = NULL WHERE id = ?`
    ).bind(completedAt, completedAt, job.id),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'QUOTE_IMAGE_READY', 'ARTIFACT', ?, ?, ?, ?)`
    ).bind(newId("aud"), job.artifact_id, `queue:${job.id}`, JSON.stringify({ tradeCode: job.trade_code, issuer: job.issuer, byteSize: bytes.byteLength }), completedAt)
  ]);
}

async function markFailure(env: AppEnv, job: ImageRenderJob, terminal: boolean, code: string): Promise<void> {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE image_render_jobs SET status = ?, lease_expires_at = NULL, last_error_code = ?, updated_at = ?
        WHERE id = ? AND status != 'COMPLETED'`
    ).bind(terminal ? "FAILED" : "QUEUED", code, now, job.jobId),
    env.DB.prepare(
      `UPDATE generated_artifacts SET status = ?, last_error_code = ? WHERE id = ? AND status != 'READY'`
    ).bind(terminal ? "FAILED" : "QUEUED", code, job.artifactId)
  ]);
}

function isJob(value: unknown): value is ImageRenderJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.jobId, candidate.artifactId, candidate.rfqId, candidate.rankingRunId, candidate.tradeCode, candidate.issuer]
    .every(part => typeof part === "string" && part.length > 0);
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_]{3,64}$/u.test(error.message) ? error.message : "IMAGE_RENDER_FAILED";
}

export async function consumeImageRender(batch: MessageBatch<unknown>, env: AppEnv): Promise<void> {
  for (const message of batch.messages) {
    if (!isJob(message.body)) { message.retry({ delaySeconds: 300 }); continue; }
    try {
      await processImageRenderJob(env, message.body);
      message.ack();
    } catch (error) {
      if (error instanceof Error && error.message === "IMAGE_RENDER_JOB_LEASED") {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      const terminal = message.attempts >= 4;
      await markFailure(env, message.body, terminal, errorCode(error));
      message.retry({ delaySeconds: Math.min(300, 15 * 2 ** Math.max(0, message.attempts - 1)) });
    }
  }
}
