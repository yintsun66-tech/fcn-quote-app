import { newId, nowIso } from "./db";
import type { AppEnv, ImageRenderJob, QuoteRankJob, TargetField } from "./types";

const RULES_VERSION = "ranking-v1";
const RENDER_PROFILE_VERSION = "quote-card-reference-v3";
const LEASE_MILLISECONDS = 2 * 60 * 1000;

interface RankJobRow {
  id: string;
  rfq_id: string;
  trigger: QuoteRankJob["trigger"];
  requested_version: number;
  status: string;
}

interface TradeTargetRow {
  id: string;
  target_field: TargetField;
}

interface QuoteRankRow {
  id: string;
  trade_id: string | null;
  issuer: string;
  status: string;
  received_at: string;
  strike_pct: number | null;
  ko_barrier_pct: number | null;
  coupon_pa_pct: number | null;
  comparable_price_pct: number | null;
  ki_barrier_pct: number | null;
}

interface RankedQuote {
  quote: QuoteRankRow;
  economicRank: number;
  displayOrder: number;
  value: number;
  tieGroup: string;
}

function direction(field: TargetField): "ASC" | "DESC" {
  return field === "COUPON" ? "DESC" : "ASC";
}

export function quoteTargetValue(quote: QuoteRankRow, field: TargetField): number | null {
  if (field === "COUPON") return quote.coupon_pa_pct;
  if (field === "PRICE") return quote.comparable_price_pct;
  if (field === "STRIKE") return quote.strike_pct;
  if (field === "KO_BARRIER") return quote.ko_barrier_pct;
  return quote.ki_barrier_pct;
}

export function rankValidQuotes(quotes: QuoteRankRow[], field: TargetField): RankedQuote[] {
  const sortable = quotes.flatMap(quote => {
    const value = quoteTargetValue(quote, field);
    return quote.status === "VALID" && value !== null && Number.isFinite(value) ? [{ quote, value }] : [];
  });
  const multiplier = direction(field) === "ASC" ? 1 : -1;
  sortable.sort((left, right) => {
    const economic = multiplier * (left.value - right.value);
    if (Math.abs(economic) > 1e-9) return economic;
    return left.quote.received_at.localeCompare(right.quote.received_at) || left.quote.id.localeCompare(right.quote.id);
  });
  let economicRank = 0;
  let previous: number | null = null;
  return sortable.flatMap((entry, index) => {
    if (previous === null || Math.abs(entry.value - previous) > 1e-9) economicRank += 1;
    previous = entry.value;
    if (economicRank > 3) return [];
    return [{
      quote: entry.quote,
      economicRank,
      displayOrder: index + 1,
      value: entry.value,
      tieGroup: `${field}:${entry.value.toFixed(8)}`
    }];
  });
}

async function claimJob(env: AppEnv, requested: QuoteRankJob): Promise<RankJobRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, rfq_id, trigger, requested_version, status FROM quote_rank_jobs
      WHERE id = ? AND rfq_id = ? AND requested_version = ?`
  ).bind(requested.jobId, requested.rfqId, requested.requestedVersion).first<RankJobRow>();
  if (!row) throw new Error("QUOTE_RANK_JOB_NOT_FOUND");
  if (row.status === "COMPLETED") return null;
  const now = nowIso();
  const lease = new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE quote_rank_jobs SET status = 'RUNNING', attempt_count = attempt_count + 1,
            lease_expires_at = ?, last_error_code = NULL, updated_at = ?
      WHERE id = ? AND status != 'COMPLETED'
        AND (status != 'RUNNING' OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
  ).bind(lease, now, row.id, now).run();
  if (claimed.meta.changes === 0) throw new Error("QUOTE_RANK_JOB_LEASED");
  return row;
}

async function persistArtifacts(
  env: AppEnv,
  rfqId: string,
  runId: string,
  version: number,
  quotedIssuers: Set<string>,
  createdAt: string
): Promise<ImageRenderJob[]> {
  const jobs: ImageRenderJob[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const issuer of [...quotedIssuers].sort()) {
    const artifactId = newId("art");
    const jobId = newId("imgjob");
    const idempotencyKey = `image:${rfqId}:v${version}:${issuer}`;
    const expiresAt = new Date(Date.parse(createdAt) + 90 * 24 * 60 * 60 * 1000).toISOString();
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO generated_artifacts
          (id, rfq_id, ranking_run_id, issuer, status, render_profile_version,
           idempotency_key, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`
      ).bind(artifactId, rfqId, runId, issuer, RENDER_PROFILE_VERSION, idempotencyKey, createdAt, expiresAt),
      env.DB.prepare(
        `INSERT OR IGNORE INTO image_render_jobs
          (id, artifact_id, rfq_id, ranking_run_id, issuer, idempotency_key,
           status, available_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`
      ).bind(jobId, artifactId, rfqId, runId, issuer, idempotencyKey, createdAt, createdAt, createdAt)
    );
  }
  if (statements.length) await env.DB.batch(statements);
  const stored = await env.DB.prepare(
    `SELECT j.id, j.artifact_id, j.rfq_id, j.ranking_run_id, j.issuer
       FROM image_render_jobs j JOIN generated_artifacts a ON a.id = j.artifact_id
      WHERE j.ranking_run_id = ? AND j.status = 'QUEUED' ORDER BY j.issuer`
  ).bind(runId).all<{ id: string; artifact_id: string; rfq_id: string; ranking_run_id: string; issuer: string }>();
  for (const row of stored.results) {
    jobs.push({ jobId: row.id, artifactId: row.artifact_id, rfqId: row.rfq_id, rankingRunId: row.ranking_run_id, issuer: row.issuer });
  }
  return jobs;
}

export async function processQuoteRankJob(env: AppEnv, requested: QuoteRankJob): Promise<void> {
  const job = await claimJob(env, requested);
  if (!job) return;
  const startedAt = nowIso();
  if (job.trigger === "DEADLINE") {
    await env.DB.prepare(
      `UPDATE rfq_expected_issuers SET status = 'TIMEOUT', terminal_at = ?, terminal_reason = 'RFQ_DEADLINE_PASSED'
        WHERE rfq_id = ? AND status = 'PENDING'`
    ).bind(startedAt, job.rfq_id).run();
  }

  const runId = newId("run");
  const runKey = `ranking:${job.rfq_id}:v${job.requested_version}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ranking_runs
      (id, rfq_id, version, trigger, target_field_rules_version, status, idempotency_key, started_at)
     VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?)`
  ).bind(runId, job.rfq_id, job.requested_version, job.trigger, RULES_VERSION, runKey, startedAt).run();
  const run = await env.DB.prepare(
    `SELECT id, status FROM ranking_runs WHERE idempotency_key = ?`
  ).bind(runKey).first<{ id: string; status: string }>();
  if (!run) throw new Error("RANKING_RUN_CREATE_FAILED");
  if (["COMPLETED", "NO_VALID_QUOTE"].includes(run.status)) {
    await env.DB.prepare(
      `UPDATE quote_rank_jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ?, lease_expires_at = NULL WHERE id = ?`
    ).bind(nowIso(), nowIso(), job.id).run();
    return;
  }

  const trades = await env.DB.prepare(
    `SELECT id, target_field FROM rfq_trades WHERE rfq_id = ? ORDER BY sequence`
  ).bind(job.rfq_id).all<TradeTargetRow>();
  const quotes = await env.DB.prepare(
    `SELECT id, trade_id, issuer, status, received_at, strike_pct, ko_barrier_pct,
            coupon_pa_pct, comparable_price_pct, ki_barrier_pct
       FROM issuer_quotes WHERE rfq_id = ? ORDER BY received_at, id`
  ).bind(job.rfq_id).all<QuoteRankRow>();

  const statements: D1PreparedStatement[] = [];
  const quotedIssuers = new Set<string>();
  let validResultCount = 0;
  for (const trade of trades.results) {
    const tradeQuotes = quotes.results.filter(quote => quote.trade_id === trade.id);
    tradeQuotes.forEach(quote => {
      const value = quoteTargetValue(quote, trade.target_field);
      if (quote.status === "VALID" && value !== null && Number.isFinite(value)) quotedIssuers.add(quote.issuer);
    });
    const ranked = rankValidQuotes(tradeQuotes, trade.target_field);
    validResultCount += ranked.length;
    const firstRank = ranked.filter(result => result.economicRank === 1);
    const imageWinnerId = firstRank[0]?.quote.id ?? null;
    for (const result of ranked) {
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO ranking_results
          (id, ranking_run_id, rfq_id, trade_id, quote_id, economic_rank, display_order,
           target_field, normalized_value, direction, is_image_winner, tie_group, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        newId("res"), run.id, job.rfq_id, trade.id, result.quote.id, result.economicRank,
        result.displayOrder, trade.target_field, result.value, direction(trade.target_field),
        result.quote.id === imageWinnerId ? 1 : 0, result.tieGroup, startedAt
      ));
    }
    for (const quote of tradeQuotes.filter(candidate => !ranked.some(result => result.quote.id === candidate.id))) {
      const value = quoteTargetValue(quote, trade.target_field);
      const reason = quote.status !== "VALID" ? quote.status : value === null || !Number.isFinite(value) ? "INVALID_TARGET_VALUE" : "OUTSIDE_TOP_THREE";
      statements.push(env.DB.prepare(
        `INSERT INTO ranking_exclusions
          (id, ranking_run_id, rfq_id, trade_id, quote_id, issuer, reason_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId("exc"), run.id, job.rfq_id, trade.id, quote.id, quote.issuer, reason, startedAt));
    }
  }

  const completedAt = nowIso();
  const resultStatus = validResultCount > 0 ? "COMPLETED" : "NO_VALID_QUOTE";
  statements.push(
    env.DB.prepare("UPDATE ranking_runs SET status = ?, completed_at = ? WHERE id = ?")
      .bind(resultStatus, completedAt, run.id),
    env.DB.prepare(
      `UPDATE rfqs SET workflow_status = ?, finalized_at = ?, finalization_trigger = ?,
              current_ranking_version = ? WHERE id = ?`
    ).bind(resultStatus, completedAt, job.trigger, job.requested_version, job.rfq_id),
    env.DB.prepare(
      `UPDATE quote_rank_jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
              lease_expires_at = NULL, last_error_code = NULL WHERE id = ?`
    ).bind(completedAt, completedAt, job.id),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'RFQ_RANKING_COMPLETED', 'RFQ', ?, ?, ?, ?)`
    ).bind(newId("aud"), job.rfq_id, `queue:${job.id}`, JSON.stringify({ version: job.requested_version, resultStatus, validResultCount }), completedAt)
  );
  await env.DB.batch(statements);

  const imageJobs = await persistArtifacts(env, job.rfq_id, run.id, job.requested_version, quotedIssuers, completedAt);
  for (const imageJob of imageJobs) await env.IMAGE_RENDER_QUEUE.send(imageJob);
}

async function markFailure(env: AppEnv, job: QuoteRankJob, terminal: boolean, code: string): Promise<void> {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE quote_rank_jobs SET status = ?, lease_expires_at = NULL, last_error_code = ?, updated_at = ?
        WHERE id = ? AND status != 'COMPLETED'`
    ).bind(terminal ? "FAILED" : "QUEUED", code, now, job.jobId),
    ...(terminal ? [env.DB.prepare(
      `UPDATE rfqs SET workflow_status = 'FAILED' WHERE id = ? AND workflow_status = 'FINALIZING'`
    ).bind(job.rfqId)] : [])
  ]);
}

function isJob(value: unknown): value is QuoteRankJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.jobId === "string" && typeof candidate.rfqId === "string"
    && typeof candidate.requestedVersion === "number"
    && ["ALL_TERMINAL", "DEADLINE", "RECALCULATION"].includes(String(candidate.trigger));
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_]{3,64}$/u.test(error.message) ? error.message : "QUOTE_RANK_FAILED";
}

export async function consumeQuoteRank(batch: MessageBatch<unknown>, env: AppEnv): Promise<void> {
  for (const message of batch.messages) {
    if (!isJob(message.body)) { message.retry({ delaySeconds: 300 }); continue; }
    try {
      await processQuoteRankJob(env, message.body);
      message.ack();
    } catch (error) {
      if (error instanceof Error && error.message === "QUOTE_RANK_JOB_LEASED") {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      const terminal = message.attempts >= 4;
      await markFailure(env, message.body, terminal, errorCode(error));
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** Math.max(0, message.attempts - 1)) });
    }
  }
}
