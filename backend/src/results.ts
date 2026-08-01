import { requireCsrf } from "./auth";
import { requestFinalization } from "./coordinator";
import { sha256Text, stableStringify } from "./crypto";
import { insertAudit } from "./db";
import { AppError } from "./errors";
import { jsonResponse, requestId, requireSameOrigin } from "./http";
import {
  customFifthCandidates,
  rankingDirection,
  rankValidQuotes,
  type QuoteRankRow
} from "./ranking-policy";
import { rfqMailGraceStartsAt, rfqSoftDeadlineAt } from "./rfq-timing";
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
  rejection_reason: string | null;
}

type ProvisionalQuoteState = { quote_count: number; latest_quote_at: string | null } | null;

// A finalized ranking version is immutable: a recalculation always writes a new version rather than
// rewriting the previous one, and this payload contains no artifact state. Keying on the RFQ, its
// version, its workflow status and its finalization time means a stale entry can never be served —
// any change to those produces a different key. Entries are only written for runs that exclude late
// replies (see the write site). Bounded so an isolate cannot grow without limit.
const FINALIZED_RESULTS_CACHE_LIMIT = 32;
const finalizedResultsCache = new Map<string, Record<string, unknown>>();

function finalizedResultsKey(rfqId: string, rfq: OwnedWorkflow): string | null {
  if (rfq.current_ranking_version <= 0) return null;
  if (!["COMPLETED", "NO_VALID_QUOTE"].includes(rfq.workflow_status)) return null;
  return `${rfqId}:${rfq.current_ranking_version}:${rfq.workflow_status}:${rfq.finalized_at ?? ""}`;
}

function rememberFinalizedResults(key: string, payload: Record<string, unknown>): void {
  finalizedResultsCache.delete(key);
  finalizedResultsCache.set(key, payload);
  while (finalizedResultsCache.size > FINALIZED_RESULTS_CACHE_LIMIT) {
    const oldest = finalizedResultsCache.keys().next();
    if (oldest.done) break;
    finalizedResultsCache.delete(oldest.value);
  }
}

function groupByTrade<T>(rows: T[], tradeId: (row: T) => unknown): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(tradeId(row));
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
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

function isProvisionalWorkflow(rfq: OwnedWorkflow): boolean {
  return rfq.current_ranking_version === 0
    && ["WAITING", "PARTIAL", "FINALIZING"].includes(rfq.workflow_status);
}

// `includeProvisionalQuoteState` lets the snapshot poller pull the provisional quote counter in the
// same round trip instead of issuing it afterwards; it is unused by the plain status endpoint.
async function loadRfqStatus(
  env: AppEnv,
  session: SessionContext,
  rfqId: string,
  options: { includeProvisionalQuoteState?: boolean } = {}
): Promise<{
  rfq: OwnedWorkflow;
  payload: Record<string, unknown>;
  provisionalQuoteState: ProvisionalQuoteState;
}> {
  const rfq = await ownedWorkflow(env, session.user.id, rfqId);
  // None of these reads depend on each other once the owning RFQ row is known. `batch` sends them
  // as one request rather than several concurrent ones: the same single wave of latency, but one
  // subrequest instead of four, and — because a batch is one transaction — one consistent read
  // snapshot, so a finalization committing mid-flight can no longer produce a payload that mixes
  // pre- and post-finalize rows.
  const statements: D1PreparedStatement[] = [];
  const issuersAt = statements.push(env.DB.prepare(
    `SELECT issuer, status, terminal_at, terminal_reason FROM rfq_expected_issuers
      WHERE rfq_id = ? ORDER BY issuer`
  ).bind(rfqId)) - 1;
  const lateRepliesAt = statements.push(env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE
              WHEN run.trigger = 'RECALCULATION'
               AND run.completed_at >= COALESCE(message.normalized_at, message.received_at)
              THEN 0 ELSE 1 END) AS unranked
       FROM inbound_messages message
       JOIN rfqs rfq ON rfq.id = message.rfq_id
       LEFT JOIN ranking_runs run
         ON run.rfq_id = rfq.id AND run.version = rfq.current_ranking_version
      WHERE message.rfq_id = ? AND message.status = 'LATE_REPLY'`
  ).bind(rfqId)) - 1;
  const artifactsAt = rfq.current_ranking_version > 0 ? statements.push(env.DB.prepare(
    `SELECT id, trade_code, quote_id, issuer, status, byte_size, completed_at, expires_at FROM generated_artifacts
      WHERE rfq_id = ? AND ranking_run_id = (
        SELECT id FROM ranking_runs WHERE rfq_id = ? AND version = ? LIMIT 1
      ) ORDER BY trade_code, created_at`
  ).bind(rfqId, rfqId, rfq.current_ranking_version)) - 1 : -1;
  const quoteStateAt = options.includeProvisionalQuoteState && isProvisionalWorkflow(rfq)
    ? statements.push(env.DB.prepare(
       `SELECT COUNT(*) AS quote_count, MAX(created_at) AS latest_quote_at
          FROM issuer_quotes q
         WHERE q.rfq_id = ?
           AND EXISTS (
             SELECT 1 FROM rfq_expected_issuers expected
              WHERE expected.rfq_id = q.rfq_id AND expected.issuer = q.issuer
           )`
     ).bind(rfqId)) - 1
    : -1;
  const batched = await env.DB.batch<Record<string, unknown>>(statements);
  const issuers = (batched[issuersAt]?.results ?? []) as {
    issuer: string; status: string; terminal_at: string | null; terminal_reason: string | null;
  }[];
  const lateReplies = (batched[lateRepliesAt]?.results[0] ?? null) as
    { total: number; unranked: number | null } | null;
  const artifacts = artifactsAt >= 0 ? batched[artifactsAt]?.results ?? [] : [];
  const provisionalQuoteState = (quoteStateAt >= 0 ? batched[quoteStateAt]?.results[0] ?? null : null) as
    ProvisionalQuoteState;
  return { rfq, provisionalQuoteState, payload: {
    rfq: {
      id: rfq.id, workflowStatus: rfq.workflow_status, createdAt: rfq.created_at,
      sentAt: rfq.sent_at, softDeadlineAt: rfqSoftDeadlineAt(env, rfq.sent_at),
      mailGraceStartsAt: rfqMailGraceStartsAt(env, rfq.sent_at),
      deadlineAt: rfq.deadline_at, finalizedAt: rfq.finalized_at,
      finalizationTrigger: rfq.finalization_trigger, rankingVersion: rfq.current_ranking_version,
      hasLateReplies: Number(lateReplies?.total ?? 0) > 0,
      hasUnrankedLateReplies: Number(lateReplies?.unranked ?? 0) > 0
    },
    issuers: issuers.map(row => ({ issuer: row.issuer, status: row.status, terminalAt: row.terminal_at, reason: row.terminal_reason })),
    artifacts: artifacts.map(row => ({
      id: row.id, tradeCode: row.trade_code, quoteId: row.quote_id, issuer: row.issuer,
      status: row.status, byteSize: row.byte_size,
      completedAt: row.completed_at, expiresAt: row.expires_at
    }))
  } };
}

export async function getRfqStatus(env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  return jsonResponse((await loadRfqStatus(env, session, rfqId)).payload);
}

/**
 * A single-statement fingerprint of everything the snapshot version is derived from.
 *
 * The browser polls every four seconds and almost every poll is unchanged, yet answering "unchanged"
 * still cost the full status read. This answers it from one query instead.
 *
 * The digest must be a function of every input to the version hash, so that any real change also
 * changes the digest. It is deliberately *coarser* than the payload — it covers all artifacts of the
 * RFQ rather than only the current run's — because being over-sensitive costs one redundant full
 * response, while being under-sensitive would freeze the caller's view. Ownership is enforced in the
 * same statement.
 */
async function snapshotDigest(
  env: AppEnv,
  userId: string,
  rfqId: string
): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(
    `SELECT r.workflow_status, r.current_ranking_version, r.created_at, r.sent_at, r.deadline_at,
            r.finalized_at, r.finalization_trigger,
            (SELECT group_concat(d) FROM (
               SELECT e.issuer || '|' || e.status || '|' || COALESCE(e.terminal_at, '') || '|'
                      || COALESCE(e.terminal_reason, '') AS d
                 FROM rfq_expected_issuers e WHERE e.rfq_id = r.id ORDER BY e.issuer)) AS issuer_digest,
            (SELECT group_concat(d) FROM (
               SELECT a.id || '|' || a.trade_code || '|' || a.quote_id || '|' || a.issuer || '|'
                      || a.status || '|' || COALESCE(a.byte_size, '') || '|'
                      || COALESCE(a.completed_at, '') || '|' || COALESCE(a.expires_at, '') AS d
                 FROM generated_artifacts a WHERE a.rfq_id = r.id
                ORDER BY a.trade_code, a.created_at, a.id)) AS artifact_digest,
            (SELECT COUNT(*) FROM issuer_quotes q
              WHERE q.rfq_id = r.id
                AND EXISTS (
                  SELECT 1 FROM rfq_expected_issuers expected
                   WHERE expected.rfq_id = q.rfq_id AND expected.issuer = q.issuer
                )) AS quote_count,
            (SELECT MAX(q.created_at) FROM issuer_quotes q
              WHERE q.rfq_id = r.id
                AND EXISTS (
                  SELECT 1 FROM rfq_expected_issuers expected
                   WHERE expected.rfq_id = q.rfq_id AND expected.issuer = q.issuer
                )) AS latest_quote_at,
            (SELECT COUNT(*) FROM inbound_messages m
              WHERE m.rfq_id = r.id AND m.status = 'LATE_REPLY') AS late_reply_count,
            (SELECT MAX(COALESCE(m.normalized_at, m.received_at)) FROM inbound_messages m
              WHERE m.rfq_id = r.id AND m.status = 'LATE_REPLY') AS latest_late_reply_at
       FROM rfqs r WHERE r.id = ? AND r.user_id = ?`
  ).bind(rfqId, userId).first<Record<string, unknown>>();
  if (!row) return null;
  // The two derived deadlines come from environment variables rather than the database, so they are
  // folded in here; otherwise changing one and redeploying would leave a polling client on the old
  // value until something else changed.
  return {
    ...row,
    softDeadlineAt: rfqSoftDeadlineAt(env, row.sent_at as string | null),
    mailGraceStartsAt: rfqMailGraceStartsAt(env, row.sent_at as string | null)
  };
}

export async function getRfqSnapshot(
  request: Request,
  env: AppEnv,
  session: SessionContext,
  rfqId: string
): Promise<Response> {
  const since = new URL(request.url).searchParams.get("since");
  if (since && !/^[A-Za-z0-9_-]{43}$/u.test(since)) {
    throw new AppError(400, "INVALID_SNAPSHOT_VERSION", "詢價快照版本格式無效。 ");
  }
  // The version is always measured *before* the payload is read. If the RFQ changes in between, the
  // caller receives newer data than the version it stores, so its next poll sees a different digest
  // and re-fetches. The reverse order — a version newer than the payload it accompanies — would
  // strand the caller on stale data, and is what this ordering rules out.
  const digest = await snapshotDigest(env, session.user.id, rfqId);
  if (!digest) throw new AppError(404, "RFQ_NOT_FOUND", "找不到此詢價，或您沒有權限查看。 ");
  const version = await sha256Text(stableStringify(digest));
  // The common case: nothing has moved since the last poll, and this is the entire request — one
  // statement, no status read, no payload construction.
  if (since === version) return jsonResponse({ changed: false, version });

  const loadedStatus = await loadRfqStatus(env, session, rfqId, { includeProvisionalQuoteState: true });
  const status = loadedStatus.payload as {
    rfq: { workflowStatus: string; rankingVersion: number };
    issuers: unknown[];
    artifacts: unknown[];
  };

  const hasResults = ["WAITING", "PARTIAL", "FINALIZING", "COMPLETED", "NO_VALID_QUOTE"].includes(
    status.rfq.workflowStatus
  );
  const wantsArtifacts = status.rfq.rankingVersion > 0
    && ["COMPLETED", "NO_VALID_QUOTE"].includes(status.rfq.workflowStatus);
  // Both payloads read from the already-authorized RFQ row, so the changed branch also goes out as
  // one wave rather than a results round trip followed by an artifacts round trip.
  const [results, artifactsPayload] = await Promise.all([
    hasResults ? loadRfqResultsPayload(env, session, rfqId, loadedStatus.rfq) : Promise.resolve(null),
    wantsArtifacts
      ? loadRfqArtifactsPayload(env, session, rfqId, loadedStatus.rfq)
      : Promise.resolve({ artifacts: [] as Record<string, unknown>[] })
  ]);
  return jsonResponse({ changed: true, version, status, results, artifacts: artifactsPayload.artifacts });
}

async function loadRfqResultsPayload(
  env: AppEnv,
  session: SessionContext,
  rfqId: string,
  loadedRfq?: OwnedWorkflow
): Promise<Record<string, unknown>> {
  const rfq = loadedRfq ?? await ownedWorkflow(env, session.user.id, rfqId);
  // Ownership is verified above, before anything is read from the cache.
  const cacheKey = finalizedResultsKey(rfqId, rfq);
  const cached = cacheKey ? finalizedResultsCache.get(cacheKey) : undefined;
  if (cached) return cached;
  const isProvisional = isProvisionalWorkflow(rfq);
  // Every one of these reads is keyed only by the RFQ and its current ranking version, so they are
  // issued together; sequencing them was the largest single cost of the polling path.
  const ranked = rfq.current_ranking_version > 0;
  const statements: D1PreparedStatement[] = [];
  const tradesAt = statements.push(env.DB.prepare(
    `SELECT id, sequence, trade_code, product, currency, target_field, underlyings_json
       FROM rfq_trades WHERE rfq_id = ? ORDER BY sequence`
  ).bind(rfqId)) - 1;
  const currentRunAt = ranked ? statements.push(env.DB.prepare(
    "SELECT trigger FROM ranking_runs WHERE rfq_id = ? AND version = ? LIMIT 1"
  ).bind(rfqId, rfq.current_ranking_version)) - 1 : -1;
  const resultsAt = ranked ? statements.push(env.DB.prepare(
    `SELECT r.trade_id, r.economic_rank, r.display_order, r.target_field,
            r.normalized_value, r.direction, r.is_image_winner, r.tie_group,
            q.id AS quote_id, q.issuer, q.issuer_display_name, q.received_at,
            q.normalization_warnings_json, q.rejection_reason, q.issuer_comment
       FROM ranking_results r JOIN issuer_quotes q ON q.id = r.quote_id
       JOIN ranking_runs run ON run.id = r.ranking_run_id
      WHERE r.rfq_id = ? AND run.version = ?
      ORDER BY r.trade_id, r.economic_rank, r.display_order`
  ).bind(rfqId, rfq.current_ranking_version)) - 1 : -1;
  const exclusionsAt = ranked ? statements.push(env.DB.prepare(
    `SELECT e.trade_id, e.issuer, e.reason_code FROM ranking_exclusions e
       JOIN ranking_runs run ON run.id = e.ranking_run_id
      WHERE e.rfq_id = ? AND run.version = ? ORDER BY e.trade_id, e.issuer`
  ).bind(rfqId, rfq.current_ranking_version)) - 1 : -1;
  const quotesAt = isProvisional || ranked ? statements.push(env.DB.prepare(
    `SELECT q.id, q.trade_id, q.issuer, q.issuer_display_name, q.status, q.received_at,
             q.strike_pct, q.ko_barrier_pct, q.coupon_pa_pct, q.comparable_price_pct,
             q.ki_barrier_pct, q.normalization_warnings_json, q.rejection_reason
        FROM issuer_quotes q
       WHERE q.rfq_id = ?
         AND EXISTS (
           SELECT 1 FROM rfq_expected_issuers expected
            WHERE expected.rfq_id = q.rfq_id AND expected.issuer = q.issuer
         )
       ORDER BY q.received_at, q.id`
   ).bind(rfqId)) - 1 : -1;
  // One request, one transaction: the trades, the ranking rows and the quotes are guaranteed to
  // come from the same instant, which concurrent statements did not guarantee.
  const batched = await env.DB.batch<Record<string, unknown>>(statements);
  const trades = { results: batched[tradesAt]?.results ?? [] };
  const currentRun = (currentRunAt >= 0 ? batched[currentRunAt]?.results[0] ?? null : null) as
    { trigger: string } | null;
  const results = { results: resultsAt >= 0 ? batched[resultsAt]?.results ?? [] : [] };
  const exclusions = { results: exclusionsAt >= 0 ? batched[exclusionsAt]?.results ?? [] : [] };
  const candidateQuotes = {
    results: (quotesAt >= 0 ? batched[quotesAt]?.results ?? [] : []) as unknown as ProvisionalQuoteRow[]
  };
  const rankOptions = {
    includeLateReplies: currentRun?.trigger === "RECALCULATION",
    maxEconomicRank: Number.MAX_SAFE_INTEGER
  };
  // Group each result set by trade once. The previous shape re-scanned every candidate quote,
  // ranking row and exclusion row for each trade, and the tie check re-scanned the ranking rows
  // once more per ranking row, so a multi-trade RFQ paid a quadratic cost on every poll.
  const quotesByTrade = groupByTrade(candidateQuotes.results, quote => quote.trade_id);
  const resultsByTrade = groupByTrade(results.results, row => row.trade_id);
  const exclusionsByTrade = groupByTrade(exclusions.results, row => row.trade_id);
  const rankedByTrade = new Map<string, ReturnType<typeof rankValidQuotes>>();
  for (const trade of trades.results) {
    const tradeId = String(trade.id);
    rankedByTrade.set(tradeId, rankValidQuotes(
      quotesByTrade.get(tradeId) ?? [],
      String(trade.target_field) as TargetField,
      rankOptions
    ));
  }
  const tradePayloads = trades.results.map(trade => {
    const tradeId = String(trade.id);
    const targetField = String(trade.target_field) as TargetField;
    const allRankedQuotes = rankedByTrade.get(tradeId) ?? [];
    const tradeQuotes = quotesByTrade.get(tradeId) ?? [];
    const tradeResults = resultsByTrade.get(tradeId) ?? [];
    const provisionalRankings = allRankedQuotes.filter(result => result.economicRank <= 4);
    // Tie membership is counted over exactly the same population as before: the displayed
    // provisional rankings, or every persisted ranking row of the trade.
    const provisionalTieCounts = countBy(provisionalRankings, result => result.tieGroup);
    const persistedTieCounts = countBy(tradeResults, row => String(row.tie_group));
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
          tie: (provisionalTieCounts.get(result.tieGroup) ?? 0) > 1,
          receivedAt: quote.received_at,
          warnings: JSON.parse(quote.normalization_warnings_json || "[]") as unknown
        };
      })
      : tradeResults.filter(result => Number(result.economic_rank) <= 4).map(result => ({
        quoteId: result.quote_id, rank: result.economic_rank, displayOrder: result.display_order,
        issuer: result.issuer, issuerDisplayName: result.issuer_display_name,
        value: result.normalized_value, direction: result.direction,
        isImageWinner: result.is_image_winner === 1,
        tie: (persistedTieCounts.get(String(result.tie_group)) ?? 0) > 1,
        receivedAt: result.received_at, warnings: JSON.parse(String(result.normalization_warnings_json ?? "[]")) as unknown
      }));
    const alternateQuotes = customFifthCandidates(allRankedQuotes).map(result => {
      const quote = result.quote as ProvisionalQuoteRow;
      return {
        quoteId: quote.id,
        issuer: quote.issuer,
        issuerDisplayName: quote.issuer_display_name,
        value: result.value,
        receivedAt: quote.received_at,
        warnings: JSON.parse(quote.normalization_warnings_json || "[]") as unknown
      };
    });
    const validIssuerCount = new Set(allRankedQuotes.map(result => result.quote.issuer)).size;
    return {
      id: trade.id, sequence: trade.sequence, tradeCode: trade.trade_code, product: trade.product,
      currency: trade.currency, targetField: trade.target_field,
      underlyings: JSON.parse(String(trade.underlyings_json ?? "[]")) as unknown,
      validQuoteCount: validIssuerCount,
      lastUpdatedAt: isProvisional ? tradeQuotes.at(-1)?.received_at ?? null : rfq.finalized_at,
      rankings,
      alternateQuotes,
      exclusions: isProvisional
        ? tradeQuotes
          .filter(quote => quote.status !== "VALID")
          .map(quote => ({ issuer: quote.issuer, reason: quote.status }))
        : (exclusionsByTrade.get(tradeId) ?? []).map(exclusion => ({ issuer: exclusion.issuer, reason: exclusion.reason_code }))
    };
  });
  const payload = {
    rfq: {
      id: rfq.id,
      workflowStatus: rfq.workflow_status,
      rankingVersion: rfq.current_ranking_version,
      isProvisional,
      allTradesHaveThreeValidQuotes: isProvisional && tradePayloads.length > 0
        ? tradePayloads.every(trade => trade.validQuoteCount >= 3)
        : false,
      allTradesHaveFiveValidQuotes: isProvisional && tradePayloads.length > 0
        ? tradePayloads.every(trade => trade.validQuoteCount >= 5)
        : false
    },
    trades: tradePayloads
  };
  // A RECALCULATION run admits late replies, and a further late reply can still change the
  // alternate-quote list without advancing the version, so those payloads are never cached.
  if (cacheKey && currentRun?.trigger !== "RECALCULATION") rememberFinalizedResults(cacheKey, payload);
  return payload;
}

export async function getRfqResults(env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  return jsonResponse(await loadRfqResultsPayload(env, session, rfqId));
}

async function loadRfqArtifactsPayload(
  env: AppEnv,
  session: SessionContext,
  rfqId: string,
  loadedRfq?: OwnedWorkflow
): Promise<{ artifacts: Record<string, unknown>[] }> {
  const rfq = loadedRfq ?? await ownedWorkflow(env, session.user.id, rfqId);
  const artifacts = await env.DB.prepare(
    `SELECT a.id, a.trade_code, a.quote_id, a.issuer, a.content_type, a.byte_size,
             a.status, a.completed_at, a.expires_at, result.economic_rank,
             result.is_image_winner
        FROM generated_artifacts a
        JOIN ranking_runs r ON r.id = a.ranking_run_id
        LEFT JOIN ranking_results result
          ON result.ranking_run_id = a.ranking_run_id AND result.quote_id = a.quote_id
       WHERE a.rfq_id = ? AND r.version = ?
       ORDER BY a.trade_code,
                CASE WHEN result.economic_rank BETWEEN 1 AND 4 THEN result.economic_rank ELSE 5 END,
                result.display_order, a.created_at`
  ).bind(rfqId, rfq.current_ranking_version).all<Record<string, unknown>>();
  return { artifacts: artifacts.results.map(row => ({
    id: row.id, tradeCode: row.trade_code, quoteId: row.quote_id, issuer: row.issuer,
    rank: Number(row.economic_rank) >= 1 && Number(row.economic_rank) <= 4 ? row.economic_rank : 5,
    isCustom: row.economic_rank === null || Number(row.economic_rank) > 4,
    isDefault: row.is_image_winner === 1,
    contentType: row.content_type, byteSize: row.byte_size,
    status: row.status, completedAt: row.completed_at, expiresAt: row.expires_at,
    downloadUrl: row.status === "READY" ? `/api/v1/artifacts/${row.id}/download` : null,
    previewUrl: row.status === "READY" ? `/api/v1/artifacts/${row.id}/download?preview=1` : null
  })) };
}

export async function listRfqArtifacts(env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  return jsonResponse(await loadRfqArtifactsPayload(env, session, rfqId));
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
  const isPreview = new URL(request.url).searchParams.get("preview") === "1";
  // Records real image demand so render volume can be sized against actual downloads rather than
  // assumed usage. Safe fields only: no quote value, correlation code or personal data.
  await insertAudit(env, "QUOTE_IMAGE_DOWNLOADED", "ARTIFACT", artifactId, session.user.id, requestId(request), {
    preview: isPreview,
    issuer: artifact.issuer
  });
  const headers = new Headers();
  headers.set("content-type", artifact.content_type);
  const disposition = isPreview ? "inline" : "attachment";
  headers.set("content-disposition", `${disposition}; filename="${artifact.rfq_id}-${artifact.trade_code}-${artifact.issuer}.png"`);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

export async function recalculateRfq(request: Request, env: AppEnv, session: SessionContext, rfqId: string): Promise<Response> {
  requireSameOrigin(request);
  await requireCsrf(request, session);
  const rfq = session.user.role === "ADMIN"
    ? await env.DB.prepare(
      `SELECT id, workflow_status, created_at, sent_at, deadline_at, finalized_at,
              finalization_trigger, current_ranking_version
         FROM rfqs WHERE id = ?`
    ).bind(rfqId).first<OwnedWorkflow>()
    : await ownedWorkflow(env, session.user.id, rfqId);
  if (!rfq) throw new AppError(404, "RFQ_NOT_FOUND", "找不到此詢價，或您沒有權限查看。 ");
  if (!["COMPLETED", "NO_VALID_QUOTE"].includes(rfq.workflow_status)) {
    throw new AppError(409, "RFQ_NOT_FINALIZED", "只有已完成的詢價可以重新計算。 ");
  }
  await insertAudit(env, "RFQ_RECALCULATION_REQUESTED", "RFQ", rfqId, session.user.id, requestId(request), {
    fromVersion: rfq.current_ranking_version,
    requestedByAdmin: session.user.role === "ADMIN"
  });
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
  const graceStartsAt = rfqMailGraceStartsAt(env, rfq.sent_at);
  if (graceStartsAt && rfq.deadline_at
    && Date.now() >= Date.parse(graceStartsAt)
    && Date.now() < Date.parse(rfq.deadline_at)) {
    throw new AppError(409, "RFQ_MAIL_GRACE_ACTIVE", "正在等待最後郵件轉送，緩衝期結束後會自動完成排名。 ");
  }
  await insertAudit(env, "RFQ_EARLY_FINALIZE_REQUESTED", "RFQ", rfqId, session.user.id, requestId(request), {
    fromStatus: rfq.workflow_status
  });
  await requestFinalization(env, rfqId, "DEADLINE");
  return jsonResponse({ rfq: { id: rfqId, workflowStatus: "FINALIZING", requestedVersion: rfq.current_ranking_version + 1 } }, 202);
}
