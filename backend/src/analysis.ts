import { authorizeCardQuote } from "./artifacts";
import { AppError } from "./errors";
import { jsonResponse } from "./http";
import type { AppEnv, SessionContext } from "./types";

interface AnalysisInputRow {
  rfq_id: string;
  finalized_at: string | null;
  sequence: number;
  trade_code: string;
  requested_product: string;
  requested_currency: string;
  requested_trade_date: string;
  requested_effective_offset: number;
  requested_tenor_months: number;
  requested_guaranteed_periods_months: number;
  requested_underlyings_json: string;
  requested_strike_pct: number | null;
  requested_ko_type: string;
  requested_ko_barrier_pct: number | null;
  requested_coupon_pa_pct: number | null;
  requested_price_pct: number | null;
  requested_barrier_type: string;
  requested_ki_barrier_pct: number | null;
  requested_observation_frequency_months: number;
  requested_otc: string;
  target_field: string;
  quote_id: string;
  issuer: string;
  issuer_display_name: string;
  quote_product: string | null;
  quote_currency: string | null;
  quote_trade_date: string | null;
  quote_effective_offset: number | null;
  quote_tenor_months: number | null;
  quote_guaranteed_periods_months: number | null;
  quote_underlyings_json: string;
  quote_strike_pct: number | null;
  quote_ko_type: string | null;
  quote_ko_barrier_pct: number | null;
  quote_coupon_pa_pct: number | null;
  raw_price_value: number | null;
  raw_price_label: string | null;
  price_semantics: string | null;
  comparable_price_pct: number | null;
  quote_barrier_type: string | null;
  quote_ki_barrier_pct: number | null;
  quote_observation_frequency_months: number | null;
  quote_otc: string | null;
  quote_reference: string | null;
  issuer_comment: string | null;
  received_at: string;
  normalization_warnings_json: string;
}

function stringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function unknownArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function analysisProduct(value: string | null): "FCN" | "DAC" | null {
  const normalized = String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
  if (normalized === "FCN") return "FCN";
  if (["DAC", "DRA", "WRA", "RANGE ACCRUAL"].includes(normalized)) return "DAC";
  return null;
}

export async function getTradeAnalysisInput(
  env: AppEnv,
  session: SessionContext,
  rfqId: string,
  tradeCode: string,
  quoteId: string
): Promise<Response> {
  const authorized = await authorizeCardQuote(env, session, rfqId, tradeCode, quoteId);
  const row = await env.DB.prepare(
    `SELECT r.id AS rfq_id, r.finalized_at,
            t.sequence, t.trade_code, t.product AS requested_product,
            t.currency AS requested_currency, t.trade_date AS requested_trade_date,
            t.effective_date_offset_calendar_days AS requested_effective_offset,
            t.tenor_months AS requested_tenor_months,
            t.guaranteed_periods_months AS requested_guaranteed_periods_months,
            t.underlyings_json AS requested_underlyings_json,
            t.strike_pct AS requested_strike_pct, t.ko_type AS requested_ko_type,
            t.ko_barrier_pct AS requested_ko_barrier_pct,
            t.coupon_pa_pct AS requested_coupon_pa_pct,
            t.upfront_or_note_price_pct AS requested_price_pct,
            t.barrier_type AS requested_barrier_type,
            t.ki_barrier_pct AS requested_ki_barrier_pct,
            t.observation_frequency_months AS requested_observation_frequency_months,
            t.otc AS requested_otc, t.target_field,
            q.id AS quote_id, q.issuer, q.issuer_display_name,
            q.product AS quote_product, q.currency AS quote_currency,
            q.trade_date AS quote_trade_date,
            q.effective_date_offset_calendar_days AS quote_effective_offset,
            q.tenor_months AS quote_tenor_months,
            q.guaranteed_periods_months AS quote_guaranteed_periods_months,
            q.underlyings_json AS quote_underlyings_json,
            q.strike_pct AS quote_strike_pct, q.ko_type AS quote_ko_type,
            q.ko_barrier_pct AS quote_ko_barrier_pct,
            q.coupon_pa_pct AS quote_coupon_pa_pct,
            q.raw_price_value, q.raw_price_label, q.price_semantics,
            q.comparable_price_pct, q.barrier_type AS quote_barrier_type,
            q.ki_barrier_pct AS quote_ki_barrier_pct,
            q.observation_frequency_months AS quote_observation_frequency_months,
            q.otc AS quote_otc, q.quote_reference, q.issuer_comment,
            q.received_at, q.normalization_warnings_json
       FROM rfqs r
       JOIN rfq_trades t ON t.rfq_id = r.id
       JOIN issuer_quotes q ON q.rfq_id = r.id AND q.trade_id = t.id
      WHERE r.id = ? AND r.user_id = ? AND t.trade_code = ? AND q.id = ?
      LIMIT 1`
  ).bind(rfqId, session.user.id, tradeCode, authorized.quote_id).first<AnalysisInputRow>();
  if (!row) throw new AppError(404, "ANALYSIS_INPUT_NOT_FOUND", "找不到此報價的分析資料。 ");

  const product = analysisProduct(row.quote_product ?? row.requested_product);
  if (!product) {
    throw new AppError(422, "ANALYSIS_PRODUCT_UNSUPPORTED", "市場與風險分析僅支援 FCN、DAC／DRA。 ");
  }

  const quoteUnderlyings = stringArray(row.quote_underlyings_json);
  const underlyings = quoteUnderlyings.length ? quoteUnderlyings : stringArray(row.requested_underlyings_json);
  return jsonResponse({
    analysisInput: {
      version: 1,
      rfq: {
        id: row.rfq_id,
        finalizedAt: row.finalized_at,
        rankingVersion: authorized.ranking_version
      },
      trade: {
        sequence: row.sequence,
        tradeCode: row.trade_code,
        targetField: row.target_field,
        requestedProduct: row.requested_product,
        requestedUnderlyings: stringArray(row.requested_underlyings_json)
      },
      quote: {
        id: row.quote_id,
        issuer: row.issuer,
        issuerDisplayName: row.issuer_display_name,
        receivedAt: row.received_at,
        rawPriceValue: row.raw_price_value,
        rawPriceLabel: row.raw_price_label,
        priceSemantics: row.price_semantics,
        quoteReference: row.quote_reference,
        issuerComment: row.issuer_comment,
        normalizationWarnings: unknownArray(row.normalization_warnings_json)
      },
      terms: {
        product,
        currency: row.quote_currency ?? row.requested_currency,
        tradeDate: row.quote_trade_date ?? row.requested_trade_date,
        effectiveDateOffsetCalendarDays: row.quote_effective_offset ?? row.requested_effective_offset,
        tenorMonths: row.quote_tenor_months ?? row.requested_tenor_months,
        guaranteedPeriodsMonths: row.quote_guaranteed_periods_months ?? row.requested_guaranteed_periods_months,
        underlyings,
        strikePct: row.quote_strike_pct ?? row.requested_strike_pct,
        koType: row.quote_ko_type ?? row.requested_ko_type,
        koBarrierPct: row.quote_ko_barrier_pct ?? row.requested_ko_barrier_pct,
        couponPaPct: row.quote_coupon_pa_pct ?? row.requested_coupon_pa_pct,
        upfrontOrNotePricePct: row.comparable_price_pct ?? row.requested_price_pct,
        barrierType: row.quote_barrier_type ?? row.requested_barrier_type,
        kiBarrierPct: row.quote_ki_barrier_pct ?? row.requested_ki_barrier_pct,
        observationFrequencyMonths:
          row.quote_observation_frequency_months ?? row.requested_observation_frequency_months,
        otc: row.quote_otc ?? row.requested_otc
      }
    }
  });
}
