import { requireCsrf } from "./auth";
import { requestFinalization } from "./coordinator";
import { insertAudit } from "./db";
import { AppError } from "./errors";
import { jsonResponse, requestId, requireSameOrigin } from "./http";
import { quoteTargetValue, rankingDirection, rankValidQuotes, type QuoteRankRow } from "./ranking";
import { rfqSoftDeadlineAt } from "./rfq-timing";
import type { AppEnv, SessionContext, TargetField } from "./types";

interface OwnedWorkflow {
  id: string;
  workflow_status: string;
  created_at: string;
  sent_at: string | null;
  deadline_at: string | null;
  finalized_at: string | null;
  finalization_trigger: string | null;
  current_ranking_version: number;
}

interface ProvisionalQuoteRow extends QuoteRankRow {
  issuer_display_name: string;
  normalization_warnings_json: string;
}

async function ownedWorkflow(env: AppEnv, userId: string, rfqId: string): Promise<OwnedWorkflow> {
  const row = await env.DB.prepare(
    `SELECT id, workflow_status, created_at, sent_at, deadline_at, finalized_at,
            finalization_trigger, current_ranking_version
       FROM rfqs WHERE id = ? AND user_id = ?`
  ).bind(rfqId, userId).first<OwnedWorkflow>();
  if (!row) throw new AppError(404, "RFQ_NOT_FOUND", "找不到此詢價，或您沒有權限查看。 ");
  return row;
}

export async function getRfqStatus(env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  const rfq = await ownedWorkflow(env, session.user.id, rfqId);
  const issuers = await env.DB.prepare(
    `SELECT issuer, status, terminal_at, terminal_reason FROM rfq_expected_issuers
      WHERE rfq_id = ? ORDER BY issuer`
  ).bind(rfqId).all<{ issuer: string; status: string; terminal_at: string | null; terminal_reason: string | null }>();
  const artifacts = await env.DB.prepare(
    `SELECT id, trade_code, issuer, status, byte_size, completed_at, expires_at FROM generated_artifacts
      WHERE rfq_id = ? AND ranking_run_id = (
        SELECT id FROM ranking_runs WHERE rfq_id = ? AND version = ? LIMIT 1
      ) ORDER BY trade_code`
  ).bind(rfqId, rfqId, rfq.current_ranking_version).all<Record<string, unknown>>();
  return jsonResponse({
    rfq: {
      id: rfq.id, workflowStatus: rfq.workflow_status, createdAt: rfq.created_at,
      sentAt: rfq.sent_at, softDeadlineAt: rfqSoftDeadlineAt(env, rfq.sent_at),
      deadlineAt: rfq.deadline_at, finalizedAt: rfq.finalized_at,
      finalizationTrigger: rfq.finalization_trigger, rankingVersion: rfq.current_ranking_version
    },
    issuers: issuers.results.map(row => ({ issuer: row.issuer, status: row.status, terminalAt: row.terminal_at, reason: row.terminal_reason })),
    artifacts: artifacts.results.map(row => ({
      id: row.id, tradeCode: row.trade_code, issuer: row.issuer, status: row.status, byteSize: row.byte_size,
      completedAt: row.completed_at, expiresAt: row.expires_at
    }))
  });
}

export async function getRfqResults(env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  const rfq = await ownedWorkflow(env, session.user.id, rfqId);
  const trades = await env.DB.prepare(
    `SELECT id, sequence, trade_code, product, currency, target_field, underlyings_json
       FROM rfq_trades WHERE rfq_id = ? ORDER BY sequence`
  ).bind(rfqId).all<Record<string, unknown>>();
  const isProvisional = rfq.current_ranking_version === 0 && ["WAITING", "PARTIAL", "FINALIZING"].includes(rfq.workflow_status);
  const results = rfq.current_ranking_version > 0 ? await env.DB.prepare(
    `SELECT r.trade_id, r.economic_rank, r.display_order, r.target_field,
            r.normalized_value, r.direction, r.is_image_winner, r.tie_group,
            q.id AS quote_id, q.issuer, q.issuer_display_name, q.received_at,
            q.normalization_warnings_json, q.rejection_reason, q.issuer_comment
       FROM ranking_results r JOIN issuer_quotes q ON q.id = r.quote_id
       JOIN ranking_runs run ON run.id = r.ranking_run_id
      WHERE r.rfq_id = ? AND run.version = ?
      ORDER BY r.trade_id, r.economic_rank, r.display_order`
  ).bind(rfqId, rfq.current_ranking_version).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const exclusions = rfq.current_ranking_version > 0 ? await env.DB.prepare(
    `SELECT e.trade_id, e.issuer, e.reason_code FROM ranking_exclusions e
       JOIN ranking_runs run ON run.id = e.ranking_run_id
      WHERE e.rfq_id = ? AND run.version = ? ORDER BY e.trade_id, e.issuer`
  ).bind(rfqId, rfq.current_ranking_version).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  const provisionalQuotes = isProvisional ? await env.DB.prepare(
    `SELECT id, trade_id, issuer, issuer_display_name, status, received_at,
            strike_pct, ko_barrier_pct, coupon_pa_pct, comparable_price_pct,
            ki_barrier_pct, normalization_warnings_json
       FROM issuer_quotes WHERE rfq_id = ? ORDER BY received_at, id`
  ).bind(rfqId).all<ProvisionalQuoteRow>() : { results: [] as ProvisionalQuoteRow[] };
  const provisionalByTrade = new Map<string, ReturnType<typeof rankValidQuotes>>();
  const provisionalValidCounts = new Map<string, number>();
  const provisionalLastUpdated = new Map<string, string | null>();
  if (isProvisional) {
    for (const trade of trades.results) {
      const tradeId = String(trade.id);
      const targetField = String(trade.target_field) as TargetField;
      const tradeQuotes = provisionalQuotes.results.filter(quote => quote.trade_id === tradeId);
      provisionalByTrade.set(tradeId, rankValidQuotes(tradeQuotes, targetField));
      provisionalValidCounts.set(tradeId, new Set(tradeQuotes.filter(quote => {
        const value = quoteTargetValue(quote, targetField);
        return quote.status === "VALID" && value !== null && Number.isFinite(value);
      }).map(quote => quote.issuer)).size);
      provisionalLastUpdated.set(tradeId, tradeQuotes.at(-1)?.received_at ?? null);
    }
  }
  const tradePayloads = trades.results.map(trade => {
    const tradeId = String(trade.id);
    const targetField = String(trade.target_field) as TargetField;
    const provisionalRankings = provisionalByTrade.get(tradeId) ?? [];
    const rankings = isProvisional
      ? provisionalRankings.map(result => {
        const quote = result.quote as ProvisionalQuoteRow;
        return {
          quoteId: quote.id,
          rank: result.economicRank,
          displayOrder: result.displayOrder,
          issuer: quote.issuer,
          issuerDisplayName: quote.issuer_display_name,
          value: result.value,
          direction: rankingDirection(targetField),
          isImageWinner: false,
          tie: provisionalRankings.filter(candidate => candidate.tieGroup === result.tieGroup).length > 1,
          receivedAt: quote.received_at,
          warnings: JSON.parse(quote.normalization_warnings_json || "[]") as unknown
        };
      })
      : results.results.filter(result => result.trade_id === trade.id).map(result => ({
        quoteId: result.quote_id, rank: result.economic_rank, displayOrder: result.display_order,
        issuer: result.issuer, issuerDisplayName: result.issuer_display_name,
        value: result.normalized_value, direction: result.direction,
        isImageWinner: result.is_image_winner === 1,
        tie: results.results.filter(candidate => candidate.trade_id === trade.id && candidate.tie_group === result.tie_group).length > 1,
        receivedAt: result.received_at, warnings: JSON.parse(String(result.normalization_warnings_json ?? "[]")) as unknown
      }));
    return {
      id: trade.id, sequence: trade.sequence, tradeCode: trade.trade_code, product: trade.product,
      currency: trade.currency, targetField: trade.target_field,
      underlyings: JSON.parse(String(trade.underlyings_json ?? "[]")) as unknown,
      validQuoteCount: isProvisional ? provisionalValidCounts.get(tradeId) ?? 0 : rankings.length,
      lastUpdatedAt: isProvisional ? provisionalLastUpdated.get(tradeId) ?? null : rfq.finalized_at,
      rankings,
      exclusions: isProvisional
        ? provisionalQuotes.results
          .filter(quote => quote.trade_id === tradeId && quote.status !== "VALID")
          .map(quote => ({ issuer: quote.issuer, reason: quote.status }))
        : exclusions.results.filter(exclusion => exclusion.trade_id === trade.id).map(exclusion => ({ issuer: exclusion.issuer, reason: exclusion.reason_code }))
    };
  });
  return jsonResponse({
    rfq: {
      id: rfq.id,
      workflowStatus: rfq.workflow_status,
      rankingVersion: rfq.current_ranking_version,
      isProvisional,
      allTradesHaveThreeValidQuotes: isProvisional && tradePayloads.length > 0
        ? tradePayloads.every(trade => trade.validQuoteCount >= 3)
        : false
    },
    trades: tradePayloads
  });
}

export async function listRfqArtifacts(env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  const rfq = await ownedWorkflow(env, session.user.id, rfqId);
  const artifacts = await env.DB.prepare(
    `SELECT a.id, a.trade_code, a.issuer, a.content_type, a.byte_size, a.status, a.completed_at, a.expires_at
       FROM generated_artifacts a JOIN ranking_runs r ON r.id = a.ranking_run_id
      WHERE a.rfq_id = ? AND r.version = ? ORDER BY a.trade_code`
  ).bind(rfqId, rfq.current_ranking_version).all<Record<string, unknown>>();
  return jsonResponse({ artifacts: artifacts.results.map(row => ({
    id: row.id, tradeCode: row.trade_code, issuer: row.issuer, contentType: row.content_type, byteSize: row.byte_size,
    status: row.status, completedAt: row.completed_at, expiresAt: row.expires_at,
    downloadUrl: row.status === "READY" ? `/api/v1/artifacts/${row.id}/download` : null,
    previewUrl: row.status === "READY" ? `/api/v1/artifacts/${row.id}/download?preview=1` : null
  })) });
}

export async function downloadArtifact(request: Request, env: AppEnv, session: SessionContext, artifactId: string): Promise<Response> {
  const artifact = await env.DB.prepare(
    `SELECT a.r2_object_key, a.content_type, a.trade_code, a.issuer, a.status, a.expires_at, a.rfq_id
       FROM generated_artifacts a JOIN rfqs r ON r.id = a.rfq_id
      WHERE a.id = ? AND r.user_id = ?`
  ).bind(artifactId, session.user.id).first<{
    r2_object_key: string | null; content_type: string; trade_code: string; issuer: string; status: string; expires_at: string; rfq_id: string;
  }>();
  if (!artifact) throw new AppError(404, "ARTIFACT_NOT_FOUND", "找不到此報價圖，或您沒有下載權限。 ");
  if (artifact.status !== "READY" || !artifact.r2_object_key) throw new AppError(409, "ARTIFACT_NOT_READY", "報價圖仍在產生中。 ");
  if (Date.parse(artifact.expires_at) <= Date.now()) throw new AppError(410, "ARTIFACT_EXPIRED", "此報價圖已超過保存期限。 ");
  const object = await env.RAW_MAIL_BUCKET.get(artifact.r2_object_key);
  if (!object) throw new AppError(404, "ARTIFACT_OBJECT_NOT_FOUND", "報價圖檔案不存在。 ");
  const headers = new Headers();
  headers.set("content-type", artifact.content_type);
  const disposition = new URL(request.url).searchParams.get("preview") === "1" ? "inline" : "attachment";
  headers.set("content-disposition", `${disposition}; filename="${artifact.rfq_id}-${artifact.trade_code}-${artifact.issuer}.png"`);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

export async function recalculateRfq(request: Request, env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const rfq = await ownedWorkflow(env, session.user.id, rfqId);
  if (!["COMPLETED", "NO_VALID_QUOTE"].includes(rfq.workflow_status)) {
    throw new AppError(409, "RFQ_NOT_FINALIZED", "只有已完成的詢價可以重新計算。 ");
  }
  await requestFinalization(env, rfqId, "RECALCULATION");
  return jsonResponse({ rfq: { id: rfqId, workflowStatus: "FINALIZING", requestedVersion: rfq.current_ranking_version + 1 } }, 202);
}

// User-initiated early close of the reply window. Ranks whatever valid replies exist now
// instead of waiting for the deadline. Reuses the DEADLINE finalization trigger (idempotent
// with the eventual alarm on the same ranking version); the user actor is captured in audit.
export async function finalizeRfqNow(request: Request, env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const rfq = await ownedWorkflow(env, session.user.id, rfqId);
  if (!["WAITING", "PARTIAL"].includes(rfq.workflow_status)) {
    throw new AppError(409, "RFQ_NOT_WAITING", "只有等待報價中的詢價可以提早結束。 ");
  }
  await insertAudit(env, "RFQ_EARLY_FINALIZE_REQUESTED", "RFQ", rfqId, session.user.id, requestId(request), {
    fromStatus: rfq.workflow_status
  });
  await requestFinalization(env, rfqId, "DEADLINE");
  return jsonResponse({ rfq: { id: rfqId, workflowStatus: "FINALIZING", requestedVersion: rfq.current_ranking_version + 1 } }, 202);
}
