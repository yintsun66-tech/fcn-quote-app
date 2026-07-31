import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyRetention, retentionSettings } from "../src/retention";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

interface FakeObject { key: string; uploaded: Date }

function fakeBucket(objects: FakeObject[]) {
  const deleted: string[] = [];
  return {
    deleted,
    bucket: {
      async list({ prefix, limit }: { prefix: string; cursor?: string; limit?: number }) {
        const matches = objects.filter(object => object.key.startsWith(prefix) && !deleted.includes(object.key));
        return { objects: matches.slice(0, limit ?? 100), truncated: false, cursor: undefined };
      },
      async delete(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) deleted.push(key);
      }
    }
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function seedRfq(id: string, createdAt: string, userId: string): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users
      (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
       employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
       password_algorithm, password_iterations, status, role, created_at, updated_at)
     VALUES (?, ?, 'Retention', 'Branch', 'x', 'y', ?, 'h', 's', 'PBKDF2', 10000, 'ACTIVE', 'USER', ?, ?)`
  ).bind(userId, `ret${userId.slice(-6)}`, `hash${userId}`, createdAt, createdAt).run();
  await testEnv.DB.prepare(
    "INSERT INTO rfqs (id, user_id, status, trade_count, created_at) VALUES (?, ?, 'VALIDATED', 1, ?)"
  ).bind(id, userId, createdAt).run();
}

describe("retention policy", () => {
  it("stays disabled by default so deploying the code deletes nothing", async () => {
    const { bucket, deleted } = fakeBucket([{ key: "raw-email/v1/old.eml", uploaded: daysAgo(90) }]);
    const report = await applyRetention({
      ...testEnv,
      RETENTION_ENABLED: "0",
      RAW_MAIL_BUCKET: bucket
    } as unknown as AppEnv);
    expect(report.enabled).toBe(false);
    expect(deleted).toEqual([]);
  });

  it("reads the approved 10/10/30-day defaults", () => {
    const settings = retentionSettings({
      RETENTION_ENABLED: "1",
      RETENTION_RAW_MAIL_DAYS: "10",
      RETENTION_IMAGE_DAYS: "10",
      RETENTION_RESULT_DAYS: "30"
    } as unknown as AppEnv);
    expect(settings).toEqual({ enabled: true, rawMailDays: 10, imageDays: 10, resultDays: 30 });
  });

  it("expires mail and image objects past their own retention but keeps fresh ones", async () => {
    const { bucket, deleted } = fakeBucket([
      { key: "raw-email/v1/old.eml", uploaded: daysAgo(20) },
      { key: "raw-email/outbound/v1/old.json", uploaded: daysAgo(20) },
      { key: "parsed-email/v1/old.json", uploaded: daysAgo(20) },
      { key: "quote-images/v3/old.png", uploaded: daysAgo(20) },
      { key: "raw-email/v1/fresh.eml", uploaded: daysAgo(2) },
      { key: "quote-images/v3/fresh.png", uploaded: daysAgo(2) }
    ]);
    const report = await applyRetention({
      ...testEnv,
      RETENTION_ENABLED: "1",
      RETENTION_RAW_MAIL_DAYS: "10",
      RETENTION_IMAGE_DAYS: "10",
      RETENTION_RESULT_DAYS: "30",
      RAW_MAIL_BUCKET: bucket
    } as unknown as AppEnv);
    expect(deleted).toEqual(expect.arrayContaining([
      "raw-email/v1/old.eml",
      "raw-email/outbound/v1/old.json",
      "parsed-email/v1/old.json",
      "quote-images/v3/old.png"
    ]));
    expect(deleted).not.toContain("raw-email/v1/fresh.eml");
    expect(deleted).not.toContain("quote-images/v3/fresh.png");
    expect(report.mailObjects).toBe(3);
    expect(report.imageObjects).toBe(1);
  });

  it("deletes structured results past the window but never one still on the follow board", async () => {
    const oldDate = daysAgo(60).toISOString();
    const freshDate = daysAgo(1).toISOString();
    await seedRfq("rfq_ret_old", oldDate, "usr_ret_a");
    await seedRfq("rfq_ret_fresh", freshDate, "usr_ret_b");
    await seedRfq("rfq_ret_published", oldDate, "usr_ret_c");
    // The dangerous shape: source_rfq_id is left NULL, so the product only reaches this RFQ through
    // its inbound message. inbound_messages cascades from rfqs while follow_board_products
    // RESTRICTs the message, so deleting the RFQ would throw and abort the entire run.
    await testEnv.DB.prepare(
      `INSERT INTO inbound_messages
        (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to, header_from,
         raw_subject, raw_size_bytes, received_at, rfq_id, status, parser_version)
       VALUES ('inb_ret', 'raw-email/v1/ret.eml', '<ret@x>', 'hash_ret', 'a@b', 'c@d', 'a@b',
               'RET', 100, ?, 'rfq_ret_published', 'PARSED', 'v1')`
    ).bind(oldDate).run();
    await testEnv.DB.prepare(
      `INSERT INTO follow_board_products
        (id, product_code, status, source_inbound_message_id, source_reference_hash, parser_profile,
         source_table_index, source_row_index, batch_code, deal_sequence, subject_date_mmdd, issuer,
         trade_date, estimated_yield_pct, public_snapshot_json, published_by_email,
         published_at, created_at, updated_at)
       VALUES ('fbp_ret', 'RET-01', 'PUBLISHED', 'inb_ret', 'ref_ret', 'BNP_FCN_V1',
               0, 0, 'BMJB', 1, '0721', 'BNP', '2026-07-21', 15.46, '{}', 'retention@test.invalid',
               ?, ?, ?)`
    ).bind(oldDate, oldDate, oldDate).run();

    const { bucket } = fakeBucket([]);
    const report = await applyRetention({
      ...testEnv,
      RETENTION_ENABLED: "1",
      RETENTION_RESULT_DAYS: "30",
      RAW_MAIL_BUCKET: bucket
    } as unknown as AppEnv);

    expect(report.rfqsDeleted).toBeGreaterThanOrEqual(1);
    expect(report.rfqsHeldByFollowBoard).toBeGreaterThanOrEqual(1);
    const remaining = await testEnv.DB.prepare(
      "SELECT id FROM rfqs WHERE id IN ('rfq_ret_old','rfq_ret_fresh','rfq_ret_published')"
    ).all<{ id: string }>();
    const ids = remaining.results.map(row => row.id);
    expect(ids).not.toContain("rfq_ret_old");
    expect(ids).toContain("rfq_ret_fresh");
    expect(ids).toContain("rfq_ret_published");
  });
});
