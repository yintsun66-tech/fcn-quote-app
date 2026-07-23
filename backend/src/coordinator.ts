import { DurableObject } from "cloudflare:workers";
import { newId, nowIso } from "./db";
import type { AppEnv, FinalizationTrigger, QuoteRankJob } from "./types";

const TERMINAL_ISSUER_STATES = ["VALID_REPLY", "NO_QUOTE", "ISSUER_REJECTED", "PARSE_ERROR", "TIMEOUT"] as const;

interface RfqWorkflowRow {
  id: string;
  workflow_status: string;
  deadline_at: string | null;
  current_ranking_version: number;
}

interface IssuerSummary {
  total_count: number;
  terminal_count: number;
}

function isFinalizationTrigger(value: unknown): value is FinalizationTrigger {
  return value === "ALL_TERMINAL" || value === "DEADLINE" || value === "RECALCULATION";
}

async function queuedRankJob(env: AppEnv, rfqId: string, trigger: FinalizationTrigger): Promise<QuoteRankJob | null> {
  const rfq = await env.DB.prepare(
    `SELECT id, workflow_status, deadline_at, current_ranking_version
       FROM rfqs WHERE id = ?`
  ).bind(rfqId).first<RfqWorkflowRow>();
  if (!rfq || ["CANCELLED", "FAILED"].includes(rfq.workflow_status)) return null;
  if (trigger !== "RECALCULATION" && ["COMPLETED", "NO_VALID_QUOTE"].includes(rfq.workflow_status)) return null;

  const requestedVersion = rfq.current_ranking_version + 1;
  const idempotencyKey = `rank:${rfqId}:v${requestedVersion}`;
  const existing = await env.DB.prepare(
    `SELECT id, trigger, requested_version FROM quote_rank_jobs WHERE idempotency_key = ?`
  ).bind(idempotencyKey).first<{ id: string; trigger: FinalizationTrigger; requested_version: number }>();
  if (existing) {
    return { jobId: existing.id, rfqId, trigger: existing.trigger, requestedVersion: existing.requested_version };
  }

  const jobId = newId("rnkjob");
  const createdAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO quote_rank_jobs
        (id, rfq_id, trigger, requested_version, idempotency_key, status,
         available_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`
    ).bind(jobId, rfqId, trigger, requestedVersion, idempotencyKey, createdAt, createdAt, createdAt),
    env.DB.prepare(
      `UPDATE rfqs SET workflow_status = 'FINALIZING', finalization_trigger = ?
        WHERE id = ? AND workflow_status NOT IN ('CANCELLED', 'FAILED')`
    ).bind(trigger, rfqId),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'RFQ_FINALIZATION_QUEUED', 'RFQ', ?, ?, ?, ?)`
    ).bind(newId("aud"), rfqId, `coordinator:${rfqId}`, JSON.stringify({ trigger, requestedVersion }), createdAt)
  ]);

  const stored = await env.DB.prepare(
    `SELECT id, trigger, requested_version FROM quote_rank_jobs WHERE idempotency_key = ?`
  ).bind(idempotencyKey).first<{ id: string; trigger: FinalizationTrigger; requested_version: number }>();
  if (!stored) throw new Error("RANK_JOB_CREATE_FAILED");
  return { jobId: stored.id, rfqId, trigger: stored.trigger, requestedVersion: stored.requested_version };
}

export async function requestFinalization(env: AppEnv, rfqId: string, trigger: FinalizationTrigger): Promise<void> {
  const job = await queuedRankJob(env, rfqId, trigger);
  if (job) await env.QUOTE_RANK_QUEUE.send(job);
}

export async function startRfqCoordinator(env: AppEnv, rfqId: string): Promise<void> {
  const stub = env.RFQ_COORDINATOR.getByName(rfqId);
  const response = await stub.fetch("https://rfq-coordinator.internal/start", {
    method: "POST", headers: { "x-rfq-id": rfqId }
  });
  if (!response.ok) throw new Error("RFQ_COORDINATOR_START_FAILED");
}

export class RfqCoordinator extends DurableObject<AppEnv> {
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
  }

  private async rfqId(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("rfqId")) ?? null;
  }

  private async checkCompletion(rfqId: string): Promise<boolean> {
    const placeholders = TERMINAL_ISSUER_STATES.map(() => "?").join(",");
    const summary = await this.env.DB.prepare(
      `SELECT COUNT(*) AS total_count,
              SUM(CASE WHEN status IN (${placeholders}) THEN 1 ELSE 0 END) AS terminal_count
         FROM rfq_expected_issuers WHERE rfq_id = ?`
    ).bind(...TERMINAL_ISSUER_STATES, rfqId).first<IssuerSummary>();
    const total = Number(summary?.total_count ?? 0);
    const terminal = Number(summary?.terminal_count ?? 0);
    if (total > 0 && terminal === total) {
      await requestFinalization(this.env, rfqId, "ALL_TERMINAL");
      return true;
    }
    if (terminal > 0) {
      await this.env.DB.prepare(
        `UPDATE rfqs SET workflow_status = 'PARTIAL'
          WHERE id = ? AND workflow_status IN ('WAITING', 'PARTIAL')`
      ).bind(rfqId).run();
    }
    return false;
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (path === "/start") {
      const rfqId = request.headers.get("x-rfq-id");
      if (!rfqId) return new Response("Missing RFQ ID", { status: 400 });
      const row = await this.env.DB.prepare("SELECT deadline_at FROM rfqs WHERE id = ?")
        .bind(rfqId).first<{ deadline_at: string | null }>();
      if (!row?.deadline_at) return new Response("RFQ deadline is not ready", { status: 409 });
      await this.ctx.storage.put("rfqId", rfqId);
      await this.ctx.storage.setAlarm(new Date(row.deadline_at));
      await this.checkCompletion(rfqId);
      return new Response(null, { status: 204 });
    }
    if (path === "/issuer-complete") {
      const rfqId = (await this.rfqId()) ?? request.headers.get("x-rfq-id");
      if (!rfqId) return new Response("Missing RFQ ID", { status: 400 });
      await this.ctx.storage.put("rfqId", rfqId);
      await this.checkCompletion(rfqId);
      return new Response(null, { status: 204 });
    }
    if (path === "/deadline") {
      const rfqId = (await this.rfqId()) ?? request.headers.get("x-rfq-id");
      if (!rfqId) return new Response("Missing RFQ ID", { status: 400 });
      await requestFinalization(this.env, rfqId, "DEADLINE");
      return new Response(null, { status: 204 });
    }
    return new Response("Not Found", { status: 404 });
  }

  override async alarm(): Promise<void> {
    const rfqId = await this.rfqId();
    if (!rfqId) throw new Error("RFQ_COORDINATOR_STATE_MISSING");
    await requestFinalization(this.env, rfqId, "DEADLINE");
  }
}

export async function scheduledWorkflowRecovery(env: AppEnv): Promise<void> {
  const now = nowIso();
  const due = await env.DB.prepare(
    `SELECT id FROM rfqs
      WHERE workflow_status IN ('WAITING', 'PARTIAL') AND deadline_at IS NOT NULL AND deadline_at <= ?
      ORDER BY deadline_at LIMIT 100`
  ).bind(now).all<{ id: string }>();
  for (const row of due.results) {
    try { await requestFinalization(env, row.id, "DEADLINE"); } catch (error) {
      console.error("scheduled_deadline_recovery_failed", { rfqId: row.id, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }

  const queued = await env.DB.prepare(
    `SELECT id, rfq_id, trigger, requested_version FROM quote_rank_jobs
      WHERE status = 'QUEUED' AND available_at <= ? ORDER BY created_at LIMIT 100`
  ).bind(now).all<{ id: string; rfq_id: string; trigger: FinalizationTrigger; requested_version: number }>();
  for (const row of queued.results) {
    await env.QUOTE_RANK_QUEUE.send({ jobId: row.id, rfqId: row.rfq_id, trigger: row.trigger, requestedVersion: row.requested_version });
  }

  const renderJobs = await env.DB.prepare(
    `SELECT id, artifact_id, rfq_id, ranking_run_id, trade_code, issuer FROM image_render_jobs
      WHERE status = 'QUEUED' AND available_at <= ? ORDER BY created_at LIMIT 50`
  ).bind(now).all<{ id: string; artifact_id: string; rfq_id: string; ranking_run_id: string; trade_code: string; issuer: string }>();
  for (const row of renderJobs.results) {
    await env.IMAGE_RENDER_QUEUE.send({
      jobId: row.id, artifactId: row.artifact_id, rfqId: row.rfq_id,
      rankingRunId: row.ranking_run_id, tradeCode: row.trade_code, issuer: row.issuer
    });
  }
}
