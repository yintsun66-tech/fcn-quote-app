import { requireCsrf } from "./auth";
import { insertAudit, newId, nowIso } from "./db";
import { rfqCorrelationCode } from "./crypto";
import { AppError } from "./errors";
import { jsonResponse, requestId, requireSameOrigin } from "./http";
import { QUOTE_CARD_WIDTH_PX, renderQuoteCardHtml, type QuoteCardTrade } from "./quote-card";
import { customFifthCandidates, rankValidQuotes, type QuoteRankRow } from "./ranking-policy";
import type { AppEnv, ImageRenderJob, SessionContext, TargetField } from "./types";

const LEASE_MILLISECONDS = 3 * 60 * 1000;
export const RENDER_PROFILE_VERSION = "quote-card-reference-v3";

export function quoteArtifactIdempotencyKey(
  rfqId: string,
  rankingVersion: number,
  tradeCode: string,
  quoteId: string
): string {
  return `image:${rfqId}:v${rankingVersion}:${tradeCode}:${quoteId}`;
}

interface ArtifactJobRow {
  id: string;
  artifact_id: string;
  rfq_id: string;
  ranking_run_id: string;
  trade_code: string;
  quote_id: string;
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

interface ArtifactRequestQuote {
  ranking_run_id: string;
  ranking_version: number;
  quote_id: string;
  issuer: string;
}

interface CurrentRankingRun {
  id: string;
  version: number;
  trigger: string;
}

interface RequestedArtifact {
  id: string;
  ranking_run_id: string;
  trade_code: string;
  quote_id: string;
  issuer: string;
  status: "QUEUED" | "RENDERING" | "READY" | "FAILED";
  completed_at: string | null;
  expires_at: string;
}

function artifactResponse(artifact: RequestedArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    tradeCode: artifact.trade_code,
    quoteId: artifact.quote_id,
    issuer: artifact.issuer,
    status: artifact.status,
    completedAt: artifact.completed_at,
    expiresAt: artifact.expires_at,
    downloadUrl: artifact.status === "READY" ? `/api/v1/artifacts/${artifact.id}/download` : null,
    previewUrl: artifact.status === "READY" ? `/api/v1/artifacts/${artifact.id}/download?preview=1` : null
  };
}

// Single authorization path for every quote-card rendering route (server-side artifacts and the
// client-rendered card). The browser may name a quote id, but only a quote the server itself ranks
// within economic ranks 1-4, or admits as a custom-fifth candidate, is ever authorized.
async function authorizeCardQuote(
  env: AppEnv,
  session: SessionContext,
  rfqId: string,
  tradeCode: string,
  quoteId?: string
): Promise<ArtifactRequestQuote> {
  const rfq = await env.DB.prepare(
    "SELECT workflow_status, current_ranking_version FROM rfqs WHERE id = ? AND user_id = ?"
  ).bind(rfqId, session.user.id).first<{ workflow_status: string; current_ranking_version: number }>();
  if (!rfq) throw new AppError(404, "RFQ_NOT_FOUND", "找不到此詢價，或您沒有權限查看。 ");
  if (rfq.workflow_status !== "COMPLETED" || rfq.current_ranking_version < 1) {
    throw new AppError(409, "RFQ_NOT_FINALIZED", "詢價完成且有有效第一名後，才能產出報價圖。 ");
  }
  const currentRun = await env.DB.prepare(
    "SELECT id, version, trigger FROM ranking_runs WHERE rfq_id = ? AND version = ? LIMIT 1"
  ).bind(rfqId, rfq.current_ranking_version).first<CurrentRankingRun>();
  if (!currentRun) throw new AppError(409, "RANKING_RUN_NOT_FOUND", "找不到目前的正式排名版本。 ");

  let rankedQuote: ArtifactRequestQuote | null = null;
  if (quoteId) {
    const trade = await env.DB.prepare(
      "SELECT id, target_field FROM rfq_trades WHERE rfq_id = ? AND trade_code = ? LIMIT 1"
    ).bind(rfqId, tradeCode).first<{ id: string; target_field: TargetField }>();
    if (trade) {
      const quotes = await env.DB.prepare(
        `SELECT id, trade_id, issuer, status, received_at, strike_pct, ko_barrier_pct,
                coupon_pa_pct, comparable_price_pct, ki_barrier_pct, rejection_reason
           FROM issuer_quotes WHERE rfq_id = ? AND trade_id = ? ORDER BY received_at, id`
      ).bind(rfqId, trade.id).all<QuoteRankRow>();
      const ranked = rankValidQuotes(quotes.results, trade.target_field, {
        includeLateReplies: currentRun.trigger === "RECALCULATION",
        maxEconomicRank: Number.MAX_SAFE_INTEGER
      });
      const allowedQuote = ranked.find(result => result.economicRank <= 4 && result.quote.id === quoteId)
        ?? customFifthCandidates(ranked).find(result => result.quote.id === quoteId);
      if (allowedQuote) {
        rankedQuote = {
          ranking_run_id: currentRun.id,
          ranking_version: currentRun.version,
          quote_id: allowedQuote.quote.id,
          issuer: allowedQuote.quote.issuer
        };
      }
    }
  } else {
    rankedQuote = await env.DB.prepare(
      `SELECT run.id AS ranking_run_id, run.version AS ranking_version, q.id AS quote_id, q.issuer
         FROM ranking_runs run
         JOIN ranking_results result ON result.ranking_run_id = run.id AND result.is_image_winner = 1
         JOIN rfq_trades trade ON trade.id = result.trade_id
         JOIN issuer_quotes q ON q.id = result.quote_id
        WHERE run.rfq_id = ? AND run.version = ? AND trade.trade_code = ?
        LIMIT 1`
    ).bind(rfqId, rfq.current_ranking_version, tradeCode).first<ArtifactRequestQuote>();
  }
  if (!rankedQuote) {
    throw new AppError(
      404,
      quoteId ? "RANKED_QUOTE_NOT_FOUND" : "RANK_ONE_QUOTE_NOT_FOUND",
      quoteId ? "此報價不在目前的前四名或自選第五名候選中。" : "此筆交易沒有可產圖的第一名報價。"
    );
  }
  return rankedQuote;
}

// Loads the exact card model used by the Browser Rendering path, so a client-rendered card and a
// server-rendered artifact are generated from one template and one data query.
async function loadCardTrades(
  env: AppEnv,
  rfqId: string,
  tradeCode: string,
  quoteId: string
): Promise<QuoteCardTrade[]> {
  const rows = await env.DB.prepare(
    `SELECT t.sequence, t.trade_code, q.product, q.currency, q.issuer, q.issuer_display_name,
            t.trade_date, q.tenor_months, q.guaranteed_periods_months, q.underlyings_json,
            q.coupon_pa_pct, q.strike_pct, q.ko_barrier_pct, q.ko_type, q.barrier_type,
            q.ki_barrier_pct, q.comparable_price_pct
       FROM rfq_trades t
       JOIN issuer_quotes q ON q.trade_id = t.id
      WHERE t.rfq_id = ? AND t.trade_code = ? AND q.id = ?
      ORDER BY t.sequence`
  ).bind(rfqId, tradeCode, quoteId).all<QuoteCardRow>();
  if (!rows.results.length) throw new AppError(404, "QUOTE_CARD_NOT_FOUND", "找不到此報價的內容。 ");
  return rows.results.map(row => ({
    sequence: row.sequence, tradeCode: row.trade_code, product: row.product, currency: row.currency,
    issuer: row.issuer, issuerDisplayName: row.issuer_display_name, tradeDate: row.trade_date,
    tenorMonths: row.tenor_months,
    guaranteedPeriodsMonths: row.guaranteed_periods_months, underlyings: safeUnderlyings(row.underlyings_json),
    couponPaPct: row.coupon_pa_pct, strikePct: row.strike_pct, koBarrierPct: row.ko_barrier_pct,
    koType: row.ko_type, barrierType: row.barrier_type, kiBarrierPct: row.ki_barrier_pct,
    comparablePricePct: row.comparable_price_pct
  }));
}

// ADR 0017: returns the authorized quote-card document so the requesting browser can rasterize it
// locally, instead of spending the shared Browser Rendering budget. The HTML is returned inside
// JSON rather than as a rendered response so the API origin never serves renderable markup.
export async function getTradeCardDocument(
  env: AppEnv,
  session: SessionContext,
  rfqId: string,
  tradeCode: string,
  quoteId?: string
): Promise<Response> {
  const authorized = await authorizeCardQuote(env, session, rfqId, tradeCode, quoteId);
  const trades = await loadCardTrades(env, rfqId, tradeCode, authorized.quote_id);
  const html = renderQuoteCardHtml(
    authorized.issuer,
    trades,
    await rfqCorrelationCode(env.EMPLOYEE_LOOKUP_KEY, rfqId)
  );
  return jsonResponse({
    card: {
      tradeCode,
      quoteId: authorized.quote_id,
      issuer: authorized.issuer,
      rankingVersion: authorized.ranking_version,
      renderProfileVersion: RENDER_PROFILE_VERSION,
      width: QUOTE_CARD_WIDTH_PX,
      html
    }
  });
}

export async function requestTradeArtifact(
  request: Request,
  env: AppEnv,
  session: SessionContext,
  rfqId: string,
  tradeCode: string,
  quoteId?: string
): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const rankedQuote = await authorizeCardQuote(env, session, rfqId, tradeCode, quoteId);

  const idempotencyKey = quoteArtifactIdempotencyKey(
    rfqId,
    rankedQuote.ranking_version,
    tradeCode,
    rankedQuote.quote_id
  );
  let artifact = await env.DB.prepare(
    `SELECT id, ranking_run_id, trade_code, quote_id, issuer, status, completed_at, expires_at
       FROM generated_artifacts
      WHERE ranking_run_id = ? AND trade_code = ? AND quote_id = ?`
  ).bind(rankedQuote.ranking_run_id, tradeCode, rankedQuote.quote_id).first<RequestedArtifact>();
  let shouldEnqueue = false;
  const now = nowIso();
  if (!artifact) {
    const artifactId = newId("art");
    const expiresAt = new Date(Date.parse(now) + 90 * 24 * 60 * 60 * 1000).toISOString();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO generated_artifacts
        (id, rfq_id, ranking_run_id, trade_code, quote_id, issuer, status, render_profile_version,
         idempotency_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`
    ).bind(
      artifactId, rfqId, rankedQuote.ranking_run_id, tradeCode, rankedQuote.quote_id, rankedQuote.issuer,
      RENDER_PROFILE_VERSION, idempotencyKey, now, expiresAt
    ).run();
    artifact = await env.DB.prepare(
      `SELECT id, ranking_run_id, trade_code, quote_id, issuer, status, completed_at, expires_at
         FROM generated_artifacts
        WHERE ranking_run_id = ? AND trade_code = ? AND quote_id = ?`
    ).bind(rankedQuote.ranking_run_id, tradeCode, rankedQuote.quote_id).first<RequestedArtifact>();
    shouldEnqueue = inserted.meta.changes > 0;
  } else if (artifact.status === "FAILED") {
    const reset = await env.DB.prepare(
      `UPDATE generated_artifacts SET status = 'QUEUED', last_error_code = NULL
        WHERE id = ? AND status = 'FAILED'`
    ).bind(artifact.id).run();
    shouldEnqueue = reset.meta.changes > 0;
    if (shouldEnqueue) artifact = { ...artifact, status: "QUEUED" };
  }
  if (!artifact) throw new AppError(500, "ARTIFACT_CREATE_FAILED", "無法建立報價圖工作。 ");

  let job = await env.DB.prepare(
    `SELECT id, artifact_id, rfq_id, ranking_run_id, trade_code, quote_id, issuer, status
       FROM image_render_jobs WHERE artifact_id = ?`
  ).bind(artifact.id).first<ArtifactJobRow>();
  if (!job) {
    const jobId = newId("imgjob");
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO image_render_jobs
        (id, artifact_id, rfq_id, ranking_run_id, trade_code, quote_id, issuer, idempotency_key,
         status, available_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`
    ).bind(
      jobId, artifact.id, rfqId, rankedQuote.ranking_run_id, tradeCode, rankedQuote.quote_id, rankedQuote.issuer,
      idempotencyKey, now, now, now
    ).run();
    shouldEnqueue = shouldEnqueue || inserted.meta.changes > 0;
    job = await env.DB.prepare(
      `SELECT id, artifact_id, rfq_id, ranking_run_id, trade_code, quote_id, issuer, status
         FROM image_render_jobs WHERE artifact_id = ?`
    ).bind(artifact.id).first<ArtifactJobRow>();
  } else if (shouldEnqueue && job.status === "FAILED") {
    await env.DB.prepare(
      `UPDATE image_render_jobs SET status = 'QUEUED', last_error_code = NULL,
              lease_expires_at = NULL, available_at = ?, updated_at = ?
        WHERE id = ? AND status = 'FAILED'`
    ).bind(now, now, job.id).run();
    job = { ...job, status: "QUEUED" };
  }
  if (!job) throw new AppError(500, "IMAGE_RENDER_JOB_CREATE_FAILED", "無法建立報價圖佇列工作。 ");
  if (shouldEnqueue) {
    await env.IMAGE_RENDER_QUEUE.send({
      jobId: job.id,
      artifactId: artifact.id,
      rfqId,
      rankingRunId: rankedQuote.ranking_run_id,
      tradeCode,
      quoteId: rankedQuote.quote_id,
      issuer: rankedQuote.issuer
    });
  }
  await insertAudit(env, "QUOTE_IMAGE_REQUESTED", "ARTIFACT", artifact.id, session.user.id, requestId(request), {
    rfqId,
    tradeCode,
    quoteId: rankedQuote.quote_id,
    issuer: rankedQuote.issuer,
    enqueued: shouldEnqueue
  });
  return jsonResponse({ artifact: artifactResponse(artifact) }, artifact.status === "READY" ? 200 : 202);
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
    `SELECT id, artifact_id, rfq_id, ranking_run_id, trade_code, quote_id, issuer, status
       FROM image_render_jobs
      WHERE id = ? AND artifact_id = ? AND rfq_id = ? AND ranking_run_id = ? AND quote_id = ?`
  ).bind(
    requested.jobId,
    requested.artifactId,
    requested.rfqId,
    requested.rankingRunId,
    requested.quoteId
  ).first<ArtifactJobRow>();
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
  let trades: QuoteCardTrade[];
  try {
    trades = await loadCardTrades(env, job.rfq_id, job.trade_code, job.quote_id);
  } catch {
    throw new Error("IMAGE_RENDER_NO_RANKED_QUOTES");
  }
  const html = renderQuoteCardHtml(
    job.issuer,
    trades,
    await rfqCorrelationCode(env.EMPLOYEE_LOOKUP_KEY, job.rfq_id)
  );
  let response: Response;
  try {
    response = await env.BROWSER.quickAction("screenshot", {
      html,
      viewport: { width: QUOTE_CARD_WIDTH_PX, height: 1280, deviceScaleFactor: trades.length > 12 ? 1 : 1.5 },
      screenshotOptions: { type: "png", fullPage: true },
      gotoOptions: { waitUntil: "networkidle0" }
    });
  } catch {
    throw new Error("BROWSER_RENDER_REQUEST_FAILED");
  }
  if (!response.ok) throw new Error(`BROWSER_RENDER_HTTP_${response.status}`);
  const bytes = await response.arrayBuffer();
  const objectKey = `quote-images/v3/${job.rfq_id}/${job.ranking_run_id}/${job.trade_code}/${job.quote_id}.png`;
  await env.RAW_MAIL_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: "image/png", cacheControl: "private, max-age=0, no-store" },
    customMetadata: {
      rfqId: job.rfq_id,
      rankingRunId: job.ranking_run_id,
      tradeCode: job.trade_code,
      quoteId: job.quote_id,
      issuer: job.issuer
    }
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
    ).bind(
      newId("aud"),
      job.artifact_id,
      `queue:${job.id}`,
      JSON.stringify({ tradeCode: job.trade_code, quoteId: job.quote_id, issuer: job.issuer, byteSize: bytes.byteLength }),
      completedAt
    )
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
    ).bind(terminal ? "FAILED" : "QUEUED", code, job.artifactId),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, ?, 'ARTIFACT', ?, ?, ?, ?)`
    ).bind(
      newId("aud"),
      terminal ? "QUOTE_IMAGE_FAILED" : "QUOTE_IMAGE_RETRY_SCHEDULED",
      job.artifactId,
      `queue:${job.jobId}`,
      JSON.stringify({ issuer: job.issuer, tradeCode: job.tradeCode, errorCode: code }),
      now
    )
  ]);
}

function isJob(value: unknown): value is ImageRenderJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return [
    candidate.jobId,
    candidate.artifactId,
    candidate.rfqId,
    candidate.rankingRunId,
    candidate.tradeCode,
    candidate.quoteId,
    candidate.issuer
  ]
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
      const baseDelay = Math.min(300, 15 * 2 ** Math.max(0, message.attempts - 1));
      const jitter = Math.floor(Math.random() * Math.max(1, Math.ceil(baseDelay * 0.2)));
      message.retry({ delaySeconds: Math.min(300, baseDelay + jitter) });
    }
  }
}
