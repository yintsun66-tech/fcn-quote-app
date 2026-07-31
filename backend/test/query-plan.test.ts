import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function queryPlan(sql: string, ...bindings: unknown[]): Promise<string> {
  const rows = await testEnv.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...bindings)
    .all<{ detail: string }>();
  return rows.results.map(row => row.detail).join("\n");
}

describe("migration 0016 query-performance indexes", () => {
  it("creates the four indexes", async () => {
    const rows = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (
         'idx_audit_action_created', 'idx_rfqs_user_created_id',
         'idx_outbound_batches_queued', 'idx_ranking_exclusions_rfq_run'
       ) ORDER BY name`
    ).all<{ name: string }>();
    expect(rows.results.map(row => row.name)).toEqual([
      "idx_audit_action_created",
      "idx_outbound_batches_queued",
      "idx_ranking_exclusions_rfq_run",
      "idx_rfqs_user_created_id"
    ]);
  });

  it("uses an index instead of scanning for the duplicate-registration audit summary", async () => {
    const plan = await queryPlan(
      `SELECT created_at, safe_metadata_json FROM audit_events
        WHERE action = 'REGISTRATION_DUPLICATE' AND created_at >= ?
        ORDER BY created_at DESC LIMIT 200`,
      "2026-07-01T00:00:00.000Z"
    );
    expect(plan).toContain("idx_audit_action_created");
    expect(plan).not.toContain("SCAN audit_events");
  });

  it("orders the owner RFQ list from the index rather than a temporary sort", async () => {
    const plan = await queryPlan(
      `SELECT r.id FROM rfqs r WHERE r.user_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 21`,
      "usr_00000000-0000-4000-8000-000000000000"
    );
    expect(plan).toContain("idx_rfqs_user_created_id");
    expect(plan).not.toContain("USE TEMP B-TREE");
  });

  it("orders the ADMIN outbound-mail list from the index", async () => {
    const plan = await queryPlan(
      `SELECT b.id FROM outbound_email_batches b ORDER BY b.queued_at DESC, b.id DESC LIMIT 50`
    );
    expect(plan).toContain("idx_outbound_batches_queued");
    expect(plan).not.toContain("USE TEMP B-TREE");
  });

  it("looks up ranking exclusions by RFQ through an index", async () => {
    const plan = await queryPlan(
      `SELECT e.trade_id, e.issuer, e.reason_code FROM ranking_exclusions e
         JOIN ranking_runs run ON run.id = e.ranking_run_id
        WHERE e.rfq_id = ? AND run.version = ? ORDER BY e.trade_id, e.issuer`,
      "rfq_00000000-0000-4000-8000-000000000000",
      1
    );
    expect(plan).toContain("idx_ranking_exclusions_rfq_run");
    expect(plan).not.toContain("SCAN ranking_exclusions");
  });
});
