import { newId, nowIso } from "./db";
import {
  invalidQuoteValue,
  ISSUER_PROFILE_VERSION,
  parseIssuerTables,
  rawTargetFor,
  targetValueFor,
  type ParsedIssuerRow,
  type QuoteStatus
} from "./issuer-profiles";
import type { Issuer } from "./inbound-parser";
import type { TradeRow } from "./rfqs";
import type { AppEnv, QuoteNormalizeJob, TargetField } from "./types";

const LEASE_MILLISECONDS = 2 * 60 * 1000;

interface NormalizeJobRow {
  id: string;
  inbound_message_id: string;
  rfq_id: string;
  issuer: Issuer;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
}

interface InboundForNormalize {
  id: string;
  rfq_id: string;
  detected_issuer: Issuer;
  correlated_batch_id: string | null;
  r2_parsed_tables_key: string;
  received_at: string;
  status: string;
}

interface ParsedTablesDocument {
  tables: Array<{ index: number; rows: string[][] }>;
}

interface MatchedQuote {
  row: ParsedIssuerRow;
  trade: TradeRow | null;
  status: QuoteStatus;
  errors: string[];
  warnings: string[];
}

function normalizedUnderlyings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.normalize("NFKC").trim().toUpperCase().replace(/\s+/gu, " ")).filter(Boolean))].sort();
}

function closeNumber(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= 0.011;
}

function tradeUnderlyings(trade: TradeRow): string[] {
  const parsed = JSON.parse(trade.underlyings_json) as unknown;
  return Array.isArray(parsed) ? normalizedUnderlyings(parsed.filter((value): value is string => typeof value === "string")) : [];
}

function matchesTrade(row: ParsedIssuerRow, trade: TradeRow): boolean {
  if (row.product !== trade.product || row.currency !== trade.currency) return false;
  if (row.tenorMonths !== trade.tenor_months || row.guaranteedPeriodsMonths !== trade.guaranteed_periods_months) return false;
  if (JSON.stringify(normalizedUnderlyings(row.underlyings)) !== JSON.stringify(tradeUnderlyings(trade))) return false;
  if (row.koType !== trade.ko_type || row.barrierType !== trade.barrier_type) return false;
  if (row.observationFrequencyMonths !== trade.observation_frequency_months) return false;
  const comparisons: Array<[TargetField, number | null, number | null]> = [
    ["STRIKE", row.strikePct, trade.strike_pct],
    ["KO_BARRIER", row.koBarrierPct, trade.ko_barrier_pct],
    ["COUPON", row.couponPaPct, trade.coupon_pa_pct],
    ["PRICE", row.comparablePricePct, trade.upfront_or_note_price_pct],
    ["KI_BARRIER", row.kiBarrierPct, trade.ki_barrier_pct]
  ];
  return comparisons.every(([field, quoteValue, tradeValue]) => field === trade.target_field || closeNumber(quoteValue, tradeValue));
}

function classify(row: ParsedIssuerRow, trade: TradeRow | null, inboundStatus: string): { status: QuoteStatus; errors: string[] } {
  if (!trade) return { status: "AMBIGUOUS_TRADE_MATCH", errors: ["NO_UNIQUE_TRADE_MATCH"] };
  if (inboundStatus === "LATE_REPLY") return { status: "LATE_REPLY", errors: ["RFQ_DEADLINE_PASSED"] };
  const targetRaw = rawTargetFor(row, trade.target_field);
  if (row.rejectionReason) return { status: "ISSUER_REJECTED", errors: ["ISSUER_REJECTION"] };
  if (invalidQuoteValue(targetRaw)) return { status: "NO_QUOTE", errors: ["TARGET_VALUE_NOT_QUOTED"] };
  const targetValue = targetValueFor(row, trade.target_field);
  if (targetValue === null || !Number.isFinite(targetValue)) return { status: "INVALID_VALUE", errors: ["TARGET_VALUE_INVALID"] };
  return { status: "VALID", errors: [] };
}

function matchRows(rows: ParsedIssuerRow[], trades: TradeRow[], inboundStatus: string): MatchedQuote[] {
  const used = new Set<string>();
  return rows.map(row => {
    const candidates = trades.filter(trade => matchesTrade(row, trade)).sort((left, right) => left.sequence - right.sequence);
    const trade = candidates.find(candidate => !used.has(candidate.id)) ?? null;
    const warnings = [...row.warnings];
    if (trade) used.add(trade.id);
    if (candidates.length > 1) warnings.push("MATCHED_BY_SOURCE_ROW_ORDER");
    const outcome = classify(row, trade, inboundStatus);
    return { row, trade, status: outcome.status, errors: outcome.errors, warnings };
  });
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

async function claimJob(env: AppEnv, requested: QuoteNormalizeJob): Promise<{ job: NormalizeJobRow; inbound: InboundForNormalize } | null> {
  const row = await env.DB.prepare(
    `SELECT j.id, j.inbound_message_id, j.rfq_id, j.issuer, j.status,
            m.id AS message_id, m.rfq_id AS message_rfq_id, m.detected_issuer,
            m.correlated_batch_id, m.r2_parsed_tables_key, m.received_at,
            m.status AS message_status
       FROM quote_normalize_jobs j JOIN inbound_messages m ON m.id = j.inbound_message_id
      WHERE j.id = ? AND j.inbound_message_id = ? AND j.rfq_id = ? AND j.issuer = ?`
  ).bind(requested.jobId, requested.inboundMessageId, requested.rfqId, requested.issuer).first<Record<string, string | null>>();
  if (!row) throw new Error("QUOTE_NORMALIZE_JOB_NOT_FOUND");
  if (row.status === "COMPLETED") return null;
  const claimedAt = nowIso();
  const leaseExpiresAt = new Date(Date.parse(claimedAt) + LEASE_MILLISECONDS).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE quote_normalize_jobs
        SET status = 'RUNNING', attempt_count = attempt_count + 1, lease_expires_at = ?,
            last_error_code = NULL, updated_at = ?
      WHERE id = ? AND status != 'COMPLETED'
        AND (status != 'RUNNING' OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
  ).bind(leaseExpiresAt, claimedAt, requested.jobId, claimedAt).run();
  if (claimed.meta.changes === 0) throw new Error("QUOTE_NORMALIZE_JOB_LEASED");
  if (!row.r2_parsed_tables_key || !row.detected_issuer || !row.message_rfq_id) throw new Error("QUOTE_NORMALIZE_INPUT_INCOMPLETE");
  return {
    job: { id: row.id ?? requested.jobId, inbound_message_id: row.inbound_message_id ?? requested.inboundMessageId, rfq_id: row.rfq_id ?? requested.rfqId, issuer: row.issuer as Issuer, status: "RUNNING" },
    inbound: {
      id: row.message_id ?? requested.inboundMessageId,
      rfq_id: row.message_rfq_id,
      detected_issuer: row.detected_issuer as Issuer,
      correlated_batch_id: row.correlated_batch_id ?? null,
      r2_parsed_tables_key: row.r2_parsed_tables_key,
      received_at: row.received_at ?? nowIso(),
      status: row.message_status ?? "PARSED"
    }
  };
}

function expectedIssuerStatus(quotes: MatchedQuote[]): "VALID_REPLY" | "NO_QUOTE" | "ISSUER_REJECTED" | "PARSE_ERROR" {
  if (quotes.some(quote => quote.status === "VALID")) return "VALID_REPLY";
  if (quotes.some(quote => quote.status === "ISSUER_REJECTED")) return "ISSUER_REJECTED";
  if (quotes.some(quote => quote.status === "NO_QUOTE")) return "NO_QUOTE";
  return "PARSE_ERROR";
}

async function notifyCoordinator(env: AppEnv, rfqId: string): Promise<void> {
  const stub = env.RFQ_COORDINATOR.getByName(rfqId);
  const response = await stub.fetch("https://rfq-coordinator.internal/issuer-complete", {
    method: "POST", headers: { "x-rfq-id": rfqId }
  });
  if (!response.ok) throw new Error("RFQ_COORDINATOR_UNAVAILABLE");
}

export async function processQuoteNormalizeJob(env: AppEnv, requested: QuoteNormalizeJob): Promise<void> {
  const claimed = await claimJob(env, requested);
  if (!claimed) {
    await notifyCoordinator(env, requested.rfqId);
    return;
  }
  const object = await env.RAW_MAIL_BUCKET.get(claimed.inbound.r2_parsed_tables_key);
  if (!object) throw new Error("PARSED_TABLES_NOT_FOUND");
  const document = await object.json<ParsedTablesDocument>();
  const rows = parseIssuerTables(claimed.inbound.detected_issuer, document);
  const trades = await storedTrades(env, claimed.inbound.rfq_id);
  const quotes = matchRows(rows, trades, claimed.inbound.status);
  const completedAt = nowIso();
  const statements: D1PreparedStatement[] = [];

  if (quotes.length === 0) {
    statements.push(env.DB.prepare(
      `INSERT INTO quote_parse_errors
        (id, inbound_message_id, issuer, parser_version, error_code, safe_error_detail, created_at)
       VALUES (?, ?, ?, ?, 'NO_QUOTE_ROWS_FOUND', 'No supported FCN/DAC rows were found in extracted tables.', ?)`
    ).bind(newId("qpe"), claimed.inbound.id, claimed.inbound.detected_issuer, ISSUER_PROFILE_VERSION, completedAt));
  }

  for (const quote of quotes) {
    const row = quote.row;
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO issuer_quotes
        (id, rfq_id, trade_id, outbound_batch_id, inbound_message_id, issuer, issuer_display_name,
         product, currency, trade_date, effective_date_offset_calendar_days, tenor_months,
         guaranteed_periods_months, underlyings_json, strike_pct, ko_type, ko_barrier_pct,
         coupon_pa_pct, raw_price_value, raw_price_label, price_semantics, comparable_price_pct,
         barrier_type, ki_barrier_pct, observation_frequency_months, otc, quote_reference,
         issuer_comment, rejection_reason, received_at, parser_profile, parser_version,
         source_table_index, source_row_index, raw_values_json, normalization_warnings_json,
         validation_errors_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newId("quo"), claimed.inbound.rfq_id, quote.trade?.id ?? null, claimed.inbound.correlated_batch_id,
      claimed.inbound.id, row.issuer, row.issuerDisplayName, row.product, row.currency,
      row.effectiveDateOffsetCalendarDays, row.tenorMonths, row.guaranteedPeriodsMonths,
      JSON.stringify(row.underlyings), row.strikePct, row.koType, row.koBarrierPct,
      row.couponPaPct, row.rawPriceValue, row.rawPriceLabel, row.priceSemantics,
      row.comparablePricePct, row.barrierType, row.kiBarrierPct, row.observationFrequencyMonths,
      row.otc, row.quoteReference, row.issuerComment, row.rejectionReason,
      claimed.inbound.received_at, row.parserProfile, ISSUER_PROFILE_VERSION,
      row.sourceTableIndex, row.sourceRowIndex, JSON.stringify(row.rawValues),
      JSON.stringify(quote.warnings), JSON.stringify(quote.errors), quote.status, completedAt
    ));
  }

  const issuerStatus = expectedIssuerStatus(quotes);
  if (claimed.inbound.status !== "LATE_REPLY") {
    statements.push(env.DB.prepare(
      `UPDATE rfq_expected_issuers SET status = ?, terminal_at = ?, terminal_reason = ?
        WHERE rfq_id = ? AND issuer = ? AND status = 'PENDING'`
    ).bind(issuerStatus, completedAt, quotes.length === 0 ? "NO_QUOTE_ROWS_FOUND" : null, claimed.inbound.rfq_id, claimed.inbound.detected_issuer));
  }
  statements.push(
    env.DB.prepare(
      `UPDATE inbound_messages SET normalized_at = ?, normalized_quote_count = ? WHERE id = ?`
    ).bind(completedAt, quotes.length, claimed.inbound.id),
    env.DB.prepare(
      `UPDATE quote_normalize_jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
              lease_expires_at = NULL, last_error_code = NULL WHERE id = ?`
    ).bind(completedAt, completedAt, claimed.job.id),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'ISSUER_QUOTES_NORMALIZED', 'INBOUND_MESSAGE', ?, ?, ?, ?)`
    ).bind(newId("aud"), claimed.inbound.id, `queue:${claimed.job.id}`, JSON.stringify({ issuer: claimed.inbound.detected_issuer, quoteCount: quotes.length, issuerStatus }), completedAt)
  );
  await env.DB.batch(statements);
  await notifyCoordinator(env, claimed.inbound.rfq_id);
}

async function markFailure(env: AppEnv, job: QuoteNormalizeJob, terminal: boolean, errorCode: string): Promise<void> {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE quote_normalize_jobs SET status = 'FAILED', lease_expires_at = NULL,
              last_error_code = ?, updated_at = ? WHERE id = ? AND status != 'COMPLETED'`
    ).bind(errorCode, now, job.jobId),
    ...(terminal ? [env.DB.prepare(
      `UPDATE rfq_expected_issuers SET status = 'PARSE_ERROR', terminal_at = ?, terminal_reason = ?
        WHERE rfq_id = ? AND issuer = ? AND status = 'PENDING'`
    ).bind(now, errorCode, job.rfqId, job.issuer)] : [])
  ]);
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,64}$/u.test(error.message)) return error.message;
  return "QUOTE_NORMALIZE_FAILED";
}

function isJob(value: unknown): value is QuoteNormalizeJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.jobId === "string" && typeof candidate.inboundMessageId === "string"
    && typeof candidate.rfqId === "string" && typeof candidate.issuer === "string";
}

export async function consumeQuoteNormalize(batch: MessageBatch<unknown>, env: AppEnv): Promise<void> {
  for (const message of batch.messages) {
    if (!isJob(message.body)) {
      message.retry({ delaySeconds: 300 });
      continue;
    }
    try {
      await processQuoteNormalizeJob(env, message.body);
      message.ack();
    } catch (error) {
      if (error instanceof Error && error.message === "QUOTE_NORMALIZE_JOB_LEASED") {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      const terminal = message.attempts >= 4;
      await markFailure(env, message.body, terminal, errorCode(error));
      if (terminal) {
        try { await notifyCoordinator(env, message.body.rfqId); } catch {}
      }
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** Math.max(0, message.attempts - 1)) });
    }
  }
}
