import { requireAdmin } from "./auth";
import { insertAudit } from "./db";
import { AppError } from "./errors";
import { jsonResponse, requestId } from "./http";
import type { AppEnv, SessionContext } from "./types";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

interface TimelineRow {
  id: string;
  workflow_status: string;
  dispatch_status: string;
  trade_count: number;
  created_at: string;
  outbound_queued_at: string | null;
  sent_at: string | null;
  deadline_at: string | null;
  finalized_at: string | null;
  finalization_trigger: string | null;
  current_ranking_version: number;
  username_normalized: string;
  display_name: string;
  branch_name: string;
  outbound_total: number;
  outbound_sent: number;
  outbound_failed: number;
  last_outbound_sent_at: string | null;
  inbound_total: number;
  inbound_parsed: number;
  inbound_late: number;
  inbound_manual_review: number;
  inbound_unmatched: number;
  first_inbound_at: string | null;
  last_inbound_at: string | null;
  artifact_total: number;
  artifact_ready: number;
  artifact_failed: number;
  last_artifact_at: string | null;
}

interface IssuerStateRow {
  rfq_id: string;
  issuer: string;
  status: string;
  terminal_at: string | null;
  terminal_reason: string | null;
}

function listLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new AppError(422, "INVALID_LIST_LIMIT", `limit must be between 1 and ${MAX_LIMIT}.`);
  }
  return value;
}

function elapsedSeconds(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const value = Math.round((Date.parse(end) - Date.parse(start)) / 1_000);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export async function listAdminRfqTimelines(request: Request, env: AppEnv, session: SessionContext): Promise<Response> {
  requireAdmin(session);
  const limit = listLimit(request);
  const rows = await env.DB.prepare(
    `SELECT r.id, r.workflow_status, r.dispatch_status, r.trade_count, r.created_at,
            r.outbound_queued_at, r.sent_at, r.deadline_at, r.finalized_at,
            r.finalization_trigger, r.current_ranking_version,
            u.username_normalized, u.display_name, u.branch_name,
            (SELECT COUNT(*) FROM outbound_email_batches b WHERE b.rfq_id = r.id) AS outbound_total,
            (SELECT COUNT(*) FROM outbound_email_batches b WHERE b.rfq_id = r.id AND b.status = 'SENT') AS outbound_sent,
            (SELECT COUNT(*) FROM outbound_email_batches b WHERE b.rfq_id = r.id AND b.status = 'FAILED') AS outbound_failed,
            (SELECT MAX(b.sent_at) FROM outbound_email_batches b WHERE b.rfq_id = r.id) AS last_outbound_sent_at,
            (SELECT COUNT(*) FROM inbound_messages m WHERE m.rfq_id = r.id) AS inbound_total,
            (SELECT COUNT(*) FROM inbound_messages m WHERE m.rfq_id = r.id AND m.status = 'PARSED') AS inbound_parsed,
            (SELECT COUNT(*) FROM inbound_messages m WHERE m.rfq_id = r.id AND m.status = 'LATE_REPLY') AS inbound_late,
            (SELECT COUNT(*) FROM inbound_messages m WHERE m.rfq_id = r.id AND m.status = 'MANUAL_REVIEW') AS inbound_manual_review,
            (SELECT COUNT(*) FROM inbound_messages m WHERE m.rfq_id = r.id AND m.status = 'UNMATCHED_RFQ') AS inbound_unmatched,
            (SELECT MIN(m.received_at) FROM inbound_messages m WHERE m.rfq_id = r.id) AS first_inbound_at,
            (SELECT MAX(m.received_at) FROM inbound_messages m WHERE m.rfq_id = r.id) AS last_inbound_at,
            (SELECT COUNT(*) FROM generated_artifacts a WHERE a.rfq_id = r.id) AS artifact_total,
            (SELECT COUNT(*) FROM generated_artifacts a WHERE a.rfq_id = r.id AND a.status = 'READY') AS artifact_ready,
            (SELECT COUNT(*) FROM generated_artifacts a WHERE a.rfq_id = r.id AND a.status = 'FAILED') AS artifact_failed,
            (SELECT MAX(a.completed_at) FROM generated_artifacts a WHERE a.rfq_id = r.id) AS last_artifact_at
       FROM rfqs r
       JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?`
  ).bind(limit).all<TimelineRow>();

  const issuerStates = new Map<string, IssuerStateRow[]>();
  if (rows.results.length > 0) {
    const placeholders = rows.results.map(() => "?").join(",");
    const states = await env.DB.prepare(
      `SELECT rfq_id, issuer, status, terminal_at, terminal_reason
         FROM rfq_expected_issuers
        WHERE rfq_id IN (${placeholders})
        ORDER BY rfq_id, issuer`
    ).bind(...rows.results.map(row => row.id)).all<IssuerStateRow>();
    for (const state of states.results) {
      const current = issuerStates.get(state.rfq_id) ?? [];
      current.push(state);
      issuerStates.set(state.rfq_id, current);
    }
  }

  await insertAudit(env, "ADMIN_RFQ_TIMELINE_LIST_VIEWED", "RFQ", null, session.user.id, requestId(request), {
    count: rows.results.length
  });
  return jsonResponse({
    records: rows.results.map(row => ({
      rfqId: row.id,
      requester: {
        username: row.username_normalized,
        displayName: row.display_name,
        branchName: row.branch_name
      },
      tradeCount: row.trade_count,
      workflowStatus: row.workflow_status,
      dispatchStatus: row.dispatch_status,
      rankingVersion: row.current_ranking_version,
      finalizationTrigger: row.finalization_trigger,
      timestamps: {
        createdAt: row.created_at,
        queuedAt: row.outbound_queued_at,
        sentAt: row.sent_at,
        deadlineAt: row.deadline_at,
        firstInboundAt: row.first_inbound_at,
        lastInboundAt: row.last_inbound_at,
        finalizedAt: row.finalized_at,
        lastArtifactAt: row.last_artifact_at
      },
      durationsSeconds: {
        queueToSent: elapsedSeconds(row.outbound_queued_at, row.sent_at),
        sentToFirstInbound: elapsedSeconds(row.sent_at, row.first_inbound_at),
        sentToFinalized: elapsedSeconds(row.sent_at, row.finalized_at),
        finalizedToLastArtifact: elapsedSeconds(row.finalized_at, row.last_artifact_at)
      },
      outbound: {
        total: row.outbound_total,
        sent: row.outbound_sent,
        failed: row.outbound_failed,
        lastSentAt: row.last_outbound_sent_at
      },
      inbound: {
        total: row.inbound_total,
        parsed: row.inbound_parsed,
        late: row.inbound_late,
        manualReview: row.inbound_manual_review,
        unmatched: row.inbound_unmatched
      },
      artifacts: {
        total: row.artifact_total,
        ready: row.artifact_ready,
        failed: row.artifact_failed
      },
      issuerStates: (issuerStates.get(row.id) ?? []).map(state => ({
        issuer: state.issuer,
        status: state.status,
        terminalAt: state.terminal_at,
        terminalReason: state.terminal_reason
      }))
    }))
  });
}
