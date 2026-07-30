import { insertAudit, nowIso } from "./db";
import type { AppEnv } from "./types";

// Retention is destructive and irreversible, so it stays off until RETENTION_ENABLED === "1".
// Deploying this module therefore changes nothing until the operator explicitly turns it on.
const DEFAULT_RAW_MAIL_DAYS = 10;
const DEFAULT_IMAGE_DAYS = 10;
const DEFAULT_RESULT_DAYS = 30;

// Bounded per run. The scheduled handler fires every two minutes, so a backlog drains steadily
// without one invocation trying to delete an unbounded number of objects or rows.
const MAX_OBJECTS_PER_PREFIX = 200;
const MAX_RFQS_PER_RUN = 50;

// Raw inbound MIME, the sanitized parse output derived from it, and the outbound mail archive are
// all "mail" for retention purposes. Generated quote images are their own class.
const MAIL_PREFIXES = ["raw-email/", "parsed-email/"] as const;
// `follow-board-images/` holds the publicly fetchable LINE cards, so expiring them on the image
// window also bounds how long that public URL stays live.
const IMAGE_PREFIXES = ["quote-images/", "follow-board-images/"] as const;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export interface RetentionSettings {
  enabled: boolean;
  rawMailDays: number;
  imageDays: number;
  resultDays: number;
}

export function retentionSettings(env: AppEnv): RetentionSettings {
  return {
    enabled: String(env.RETENTION_ENABLED) === "1",
    rawMailDays: positiveInteger(env.RETENTION_RAW_MAIL_DAYS, DEFAULT_RAW_MAIL_DAYS),
    imageDays: positiveInteger(env.RETENTION_IMAGE_DAYS, DEFAULT_IMAGE_DAYS),
    resultDays: positiveInteger(env.RETENTION_RESULT_DAYS, DEFAULT_RESULT_DAYS)
  };
}

export interface RetentionReport {
  enabled: boolean;
  mailObjects: number;
  imageObjects: number;
  artifactKeysCleared: number;
  inboundKeysCleared: number;
  rfqsDeleted: number;
  rfqsHeldByFollowBoard: number;
}

// Deletes objects whose R2 upload time is older than the cutoff. Uses the object's own `uploaded`
// timestamp rather than a D1 pointer, so an orphaned object is still collected.
async function expireObjects(
  env: AppEnv,
  prefixes: readonly string[],
  cutoff: string,
  dryRun: boolean
): Promise<number> {
  let removed = 0;
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    let scanned = 0;
    do {
      // `exactOptionalPropertyTypes` forbids passing an explicit `cursor: undefined`.
      const listed = await env.RAW_MAIL_BUCKET.list(cursor ? { prefix, cursor, limit: 100 } : { prefix, limit: 100 });
      const expired = listed.objects
        .filter(object => object.uploaded.toISOString() < cutoff)
        .map(object => object.key);
      if (expired.length) {
        if (!dryRun) await env.RAW_MAIL_BUCKET.delete(expired);
        removed += expired.length;
      }
      scanned += listed.objects.length;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor && scanned < MAX_OBJECTS_PER_PREFIX && removed < MAX_OBJECTS_PER_PREFIX);
  }
  return removed;
}

/**
 * Applies the approved retention policy. Safe to call on every scheduled tick: it is idempotent,
 * bounded, and a failure in one phase does not prevent the others from running on the next tick.
 *
 * Pass `dryRun` to measure what would be removed without deleting anything.
 */
export async function applyRetention(env: AppEnv, dryRun = false): Promise<RetentionReport> {
  const settings = retentionSettings(env);
  const report: RetentionReport = {
    enabled: settings.enabled,
    mailObjects: 0,
    imageObjects: 0,
    artifactKeysCleared: 0,
    inboundKeysCleared: 0,
    rfqsDeleted: 0,
    rfqsHeldByFollowBoard: 0
  };
  if (!settings.enabled && !dryRun) return report;

  const mailCutoff = cutoffIso(settings.rawMailDays);
  const imageCutoff = cutoffIso(settings.imageDays);
  const resultCutoff = cutoffIso(settings.resultDays);
  const effectiveDryRun = dryRun || !settings.enabled;

  report.mailObjects = await expireObjects(env, MAIL_PREFIXES, mailCutoff, effectiveDryRun);
  report.imageObjects = await expireObjects(env, IMAGE_PREFIXES, imageCutoff, effectiveDryRun);

  // Clear D1 pointers to objects that no longer exist, so a download attempt fails closed with the
  // existing "not ready" contract instead of a confusing missing-object error.
  if (!effectiveDryRun) {
    const artifacts = await env.DB.prepare(
      `UPDATE generated_artifacts SET r2_object_key = NULL
        WHERE r2_object_key IS NOT NULL AND created_at < ?`
    ).bind(imageCutoff).run();
    report.artifactKeysCleared = Number(artifacts.meta.changes ?? 0);

    // `inbound_messages.r2_raw_mime_key` is NOT NULL, so it must be left in place — clearing it
    // would abort every scheduled run. Only the nullable parsed-tables pointer is cleared. The raw
    // key becomes a dangling reference by design; nothing reads it after parsing, which completes
    // minutes after receipt and therefore long before this retention window.
    const inbound = await env.DB.prepare(
      `UPDATE inbound_messages SET r2_parsed_tables_key = NULL
        WHERE r2_parsed_tables_key IS NOT NULL AND received_at < ?`
    ).bind(mailCutoff).run();
    report.inboundKeysCleared = Number(inbound.meta.changes ?? 0);
  }

  // Structured results. follow_board_products holds three ON DELETE RESTRICT references, and an
  // RFQ reaches all of them: source_rfq_id directly, and source_inbound_message_id /
  // source_outbound_batch_id through their own ON DELETE CASCADE from rfqs. source_rfq_id is
  // nullable, so excluding by it alone would still let a cascade hit a RESTRICT and abort the run.
  // Everything not held this way cascades cleanly through the existing children.
  const heldClause = `EXISTS (
      SELECT 1 FROM follow_board_products f
       WHERE f.source_rfq_id = r.id
          OR f.source_inbound_message_id IN (SELECT m.id FROM inbound_messages m WHERE m.rfq_id = r.id)
          OR f.source_outbound_batch_id IN (SELECT b.id FROM outbound_email_batches b WHERE b.rfq_id = r.id)
    )`;

  const candidates = await env.DB.prepare(
    `SELECT r.id FROM rfqs r
      WHERE r.created_at < ? AND NOT ${heldClause}
      ORDER BY r.created_at
      LIMIT ?`
  ).bind(resultCutoff, MAX_RFQS_PER_RUN).all<{ id: string }>();

  const held = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM rfqs r WHERE r.created_at < ? AND ${heldClause}`
  ).bind(resultCutoff).first<{ count: number }>();
  report.rfqsHeldByFollowBoard = Number(held?.count ?? 0);

  if (!effectiveDryRun && candidates.results.length) {
    await env.DB.batch(candidates.results.map(row =>
      env.DB.prepare("DELETE FROM rfqs WHERE id = ?").bind(row.id)
    ));
    report.rfqsDeleted = candidates.results.length;
  } else {
    report.rfqsDeleted = effectiveDryRun ? candidates.results.length : 0;
  }

  if (!effectiveDryRun && (report.mailObjects || report.imageObjects || report.rfqsDeleted)) {
    // Counts only. No RFQ id, object key, mail content or account identifier is recorded.
    await insertAudit(env, "RETENTION_APPLIED", "SYSTEM", null, null, `scheduled:${nowIso()}`, {
      mailObjects: report.mailObjects,
      imageObjects: report.imageObjects,
      rfqsDeleted: report.rfqsDeleted,
      rawMailDays: settings.rawMailDays,
      imageDays: settings.imageDays,
      resultDays: settings.resultDays
    });
  }
  return report;
}
