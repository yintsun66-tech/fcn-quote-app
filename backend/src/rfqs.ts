import { sha256Text, stableStringify } from "./crypto";
import { insertAudit, newId, nowIso } from "./db";
import { AppError } from "./errors";
import { jsonResponse, readJson, requestId, requireIdempotencyKey, requireSameOrigin } from "./http";
import type { AppEnv, NormalizedTrade, SessionContext } from "./types";
import { normalizeRfqInput } from "./validation";
import { requireCsrf } from "./auth";

interface IdempotencyRow {
  request_hash: string;
  response_status: number;
  response_json: string;
}

export interface RfqRow {
  id: string;
  status: "DRAFT" | "VALIDATED" | "CANCELLED";
  dispatch_status: "NOT_SENT" | "QUEUED" | "SENDING" | "WAITING" | "FAILED";
  trade_count: number;
  created_at: string;
  validated_at: string | null;
  cancelled_at: string | null;
  outbound_queued_at: string | null;
  sent_at: string | null;
  deadline_at: string | null;
  expected_issuer_count: number;
  outbound_batch_count: number;
  version: number;
}

export interface TradeRow {
  id: string;
  sequence: number;
  trade_code: string;
  product: "FCN" | "DAC";
  currency: string;
  trade_date: string;
  effective_date_offset_calendar_days: number;
  tenor_months: number;
  guaranteed_periods_months: number;
  underlyings_json: string;
  strike_pct: number | null;
  ko_type: "Daily" | "Daily Memory" | "Period End" | "Period End Memory";
  ko_barrier_pct: number | null;
  coupon_pa_pct: number | null;
  upfront_or_note_price_pct: number | null;
  barrier_type: "EKI" | "AKI" | "NONE";
  ki_barrier_pct: number | null;
  observation_frequency_months: number;
  otc: "Note";
  target_field: NormalizedTrade["targetField"];
  matching_key_hash: string;
  created_at: string;
  frozen_at: string | null;
}

function publicTrade(row: TradeRow): Record<string, unknown> {
  return {
    id: row.id,
    sequence: row.sequence,
    tradeCode: row.trade_code,
    product: row.product,
    currency: row.currency,
    tradeDate: row.trade_date,
    effectiveDateOffsetCalendarDays: row.effective_date_offset_calendar_days,
    tenorMonths: row.tenor_months,
    guaranteedPeriodsMonths: row.guaranteed_periods_months,
    underlyings: JSON.parse(row.underlyings_json) as unknown,
    strikePct: row.strike_pct,
    koType: row.ko_type,
    koBarrierPct: row.ko_barrier_pct,
    couponPaPct: row.coupon_pa_pct,
    upfrontOrNotePricePct: row.upfront_or_note_price_pct,
    barrierType: row.barrier_type,
    kiBarrierPct: row.ki_barrier_pct,
    observationFrequencyMonths: row.observation_frequency_months,
    otc: row.otc,
    targetField: row.target_field,
    createdAt: row.created_at,
    frozenAt: row.frozen_at
  };
}

export async function fetchOwnedRfq(env: AppEnv, userId: string, rfqId: string): Promise<{ rfq: RfqRow; trades: TradeRow[] }> {
  const rfq = await env.DB.prepare(
    `SELECT id, status, dispatch_status, trade_count, created_at, validated_at, cancelled_at,
            outbound_queued_at, sent_at, deadline_at, expected_issuer_count,
            outbound_batch_count, version
       FROM rfqs WHERE id = ? AND user_id = ?`
  ).bind(rfqId, userId).first<RfqRow>();
  if (!rfq) throw new AppError(404, "RFQ_NOT_FOUND", "找不到此詢價。 ");
  const trades = await env.DB.prepare(
    `SELECT id, sequence, trade_code, product, currency, trade_date,
            effective_date_offset_calendar_days, tenor_months, guaranteed_periods_months,
            underlyings_json, strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct,
            upfront_or_note_price_pct, barrier_type, ki_barrier_pct,
            observation_frequency_months, otc, target_field, matching_key_hash,
            created_at, frozen_at
       FROM rfq_trades WHERE rfq_id = ? ORDER BY sequence ASC`
  ).bind(rfqId).all<TradeRow>();
  return { rfq, trades: trades.results };
}

function rfqResponse(rfq: RfqRow, trades: TradeRow[]): Record<string, unknown> {
  return {
    rfq: {
      id: rfq.id,
      status: rfq.status,
      dispatchStatus: rfq.dispatch_status,
      tradeCount: rfq.trade_count,
      createdAt: rfq.created_at,
      validatedAt: rfq.validated_at,
      cancelledAt: rfq.cancelled_at,
      outboundQueuedAt: rfq.outbound_queued_at,
      sentAt: rfq.sent_at,
      deadlineAt: rfq.deadline_at,
      expectedIssuerCount: rfq.expected_issuer_count,
      outboundBatchCount: rfq.outbound_batch_count,
      version: rfq.version,
      trades: trades.map(publicTrade)
    }
  };
}

export async function createRfq(request: Request, env: AppEnv, session: SessionContext): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const idempotencyKey = requireIdempotencyKey(request);
  const trades = await normalizeRfqInput(await readJson(request));
  const requestHash = await sha256Text(stableStringify({ trades }));
  const existing = await env.DB.prepare(
    `SELECT request_hash, response_status, response_json FROM idempotency_keys
      WHERE user_id = ? AND scope = 'CREATE_RFQ' AND idempotency_key = ?`
  ).bind(session.user.id, idempotencyKey).first<IdempotencyRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "此 Idempotency-Key 已用於不同內容。 ");
    }
    return jsonResponse(JSON.parse(existing.response_json) as unknown, existing.response_status);
  }

  const rfqId = newId("rfq");
  const createdAt = nowIso();
  const publicBody = {
    rfq: {
      id: rfqId,
      status: "DRAFT",
      dispatchStatus: "NOT_SENT",
      tradeCount: trades.length,
      createdAt,
      validatedAt: null,
      cancelledAt: null,
      outboundQueuedAt: null,
      sentAt: null,
      deadlineAt: null,
      expectedIssuerCount: 0,
      outboundBatchCount: 0,
      version: 1,
      trades: trades.map(trade => ({ id: newId("trd"), ...trade, createdAt, frozenAt: null }))
    }
  };
  const publicTrades = publicBody.rfq.trades;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO rfqs (id, user_id, status, trade_count, created_at, version) VALUES (?, ?, 'DRAFT', ?, ?, 1)"
    ).bind(rfqId, session.user.id, trades.length, createdAt)
  ];
  trades.forEach((trade, index) => {
    const publicTradeData = publicTrades[index];
    if (!publicTradeData) throw new AppError(500, "RFQ_BUILD_FAILED", "建立詢價資料失敗。 ");
    statements.push(env.DB.prepare(
      `INSERT INTO rfq_trades
        (id, rfq_id, sequence, trade_code, product, currency, trade_date,
         effective_date_offset_calendar_days, tenor_months, guaranteed_periods_months,
         underlyings_json, strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct,
         upfront_or_note_price_pct, barrier_type, ki_barrier_pct,
         observation_frequency_months, otc, target_field, matching_key_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      publicTradeData.id, rfqId, trade.sequence, trade.tradeCode, trade.product, trade.currency,
      trade.tradeDate, trade.effectiveDateOffsetCalendarDays, trade.tenorMonths,
      trade.guaranteedPeriodsMonths, JSON.stringify(trade.underlyings), trade.strikePct,
      trade.koType, trade.koBarrierPct, trade.couponPaPct, trade.upfrontOrNotePricePct,
      trade.barrierType, trade.kiBarrierPct, trade.observationFrequencyMonths, trade.otc,
      trade.targetField, trade.matchingKeyHash, createdAt
    ));
  });
  statements.push(env.DB.prepare(
    `INSERT INTO idempotency_keys
      (id, user_id, scope, idempotency_key, request_hash, response_status, response_json, created_at, expires_at)
     VALUES (?, ?, 'CREATE_RFQ', ?, ?, 201, ?, ?, ?)`
  ).bind(
    newId("idem"), session.user.id, idempotencyKey, requestHash, JSON.stringify(publicBody),
    createdAt, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  ));
  statements.push(env.DB.prepare(
    `INSERT INTO audit_events
      (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
     VALUES (?, ?, 'RFQ_CREATED', 'RFQ', ?, ?, ?, ?)`
  ).bind(newId("aud"), session.user.id, rfqId, requestId(request), JSON.stringify({ tradeCount: trades.length }), createdAt));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const concurrent = await env.DB.prepare(
      `SELECT request_hash, response_status, response_json FROM idempotency_keys
        WHERE user_id = ? AND scope = 'CREATE_RFQ' AND idempotency_key = ?`
    ).bind(session.user.id, idempotencyKey).first<IdempotencyRow>();
    if (!concurrent) throw error;
    if (concurrent.request_hash !== requestHash) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "此 Idempotency-Key 已用於不同內容。 ");
    }
    return jsonResponse(JSON.parse(concurrent.response_json) as unknown, concurrent.response_status);
  }
  return jsonResponse(publicBody, 201);
}

export async function getRfq(env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  const { rfq, trades } = await fetchOwnedRfq(env, session.user.id, rfqId);
  return jsonResponse(rfqResponse(rfq, trades));
}

export async function validateRfq(request: Request, env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const current = await fetchOwnedRfq(env, session.user.id, rfqId);
  if (current.rfq.status === "CANCELLED") throw new AppError(409, "RFQ_CANCELLED", "已取消的詢價不能驗證。 ");
  const input = {
    trades: current.trades.map(trade => ({
      product: trade.product,
      currency: trade.currency,
      tradeDate: trade.trade_date,
      effectiveDateOffsetCalendarDays: trade.effective_date_offset_calendar_days,
      tenorMonths: trade.tenor_months,
      guaranteedPeriodsMonths: trade.guaranteed_periods_months,
      underlyings: JSON.parse(trade.underlyings_json) as unknown,
      strikePct: trade.strike_pct,
      koType: trade.ko_type,
      koBarrierPct: trade.ko_barrier_pct,
      couponPaPct: trade.coupon_pa_pct,
      upfrontOrNotePricePct: trade.upfront_or_note_price_pct,
      barrierType: trade.barrier_type,
      kiBarrierPct: trade.ki_barrier_pct,
      observationFrequencyMonths: trade.observation_frequency_months,
      otc: trade.otc,
      targetField: trade.target_field
    }))
  };
  const normalized = await normalizeRfqInput(input);
  if (normalized.some((trade, index) => trade.matchingKeyHash !== current.trades[index]?.matching_key_hash)) {
    throw new AppError(409, "RFQ_INTEGRITY_ERROR", "詢價資料完整性檢查失敗。 ");
  }
  if (current.rfq.status === "DRAFT") {
    const validatedAt = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE rfqs SET status = 'VALIDATED', validated_at = ?, version = version + 1 WHERE id = ? AND user_id = ? AND status = 'DRAFT'"
      ).bind(validatedAt, rfqId, session.user.id),
      env.DB.prepare(
        "UPDATE rfq_trades SET frozen_at = ? WHERE rfq_id = ? AND frozen_at IS NULL"
      ).bind(validatedAt, rfqId)
    ]);
    await insertAudit(env, "RFQ_VALIDATED", "RFQ", rfqId, session.user.id, requestId(request));
  }
  const result = await fetchOwnedRfq(env, session.user.id, rfqId);
  return jsonResponse(rfqResponse(result.rfq, result.trades));
}
