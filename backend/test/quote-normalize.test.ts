import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { processQuoteNormalizeJob } from "../src/quote-normalize";
import type { AppEnv, QuoteNormalizeJob } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };

describe("canonical quote normalization", () => {
  beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

  it("matches a BNP row to its immutable trade and stores a valid canonical quote", async () => {
    const suffix = crypto.randomUUID();
    const userId = `usr_${suffix}`;
    const rfqId = `rfq_${crypto.randomUUID()}`;
    const tradeId = `trd_${crypto.randomUUID()}`;
    const inboundId = `inb_${crypto.randomUUID()}`;
    const jobId = `qnj_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO users
          (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
           employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
           password_algorithm, password_iterations, status, role, created_at, updated_at)
         VALUES (?, ?, 'Normalizer', 'Test', 'cipher', 'iv', ?, 'hash', 'salt', 'test', 1, 'ACTIVE', 'USER', ?, ?)`
      ).bind(userId, `normalizer-${suffix}`.slice(0, 50), `lookup-${suffix}`, now, now),
      testEnv.DB.prepare(
        `INSERT INTO rfqs
          (id, user_id, status, trade_count, created_at, version, dispatch_status,
           expected_issuer_count, outbound_batch_count, workflow_status)
         VALUES (?, ?, 'VALIDATED', 1, ?, 2, 'WAITING', 11, 8, 'WAITING')`
      ).bind(rfqId, userId, now),
      testEnv.DB.prepare(
        `INSERT INTO rfq_trades
          (id, rfq_id, sequence, trade_code, product, currency, trade_date,
           effective_date_offset_calendar_days, tenor_months, guaranteed_periods_months,
           underlyings_json, strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct,
           upfront_or_note_price_pct, barrier_type, ki_barrier_pct,
           observation_frequency_months, otc, target_field, matching_key_hash, created_at, frozen_at)
         VALUES (?, ?, 1, 'T01', 'FCN', 'USD', '21-Jul-26', 7, 6, 1, '["AAA UW"]',
                 80, 'Daily Memory', 100, NULL, 98, 'NONE', NULL, 1, 'Note', 'COUPON', ?, ?, ?)`
      ).bind(tradeId, rfqId, `matching-${suffix}`, now, now),
      testEnv.DB.prepare(
        `INSERT INTO rfq_expected_issuers
          (id, rfq_id, issuer, outbound_batch_code, status, snapshot_at)
         VALUES (?, ?, 'BNP', 'BMJB', 'PENDING', ?)`
      ).bind(`exp_${crypto.randomUUID()}`, rfqId, now),
      testEnv.DB.prepare(
        `INSERT INTO inbound_messages
          (id, r2_raw_mime_key, content_hash, envelope_from, envelope_to, raw_subject,
           raw_size_bytes, received_at, rfq_id, detected_issuer, status, r2_parsed_tables_key)
         VALUES (?, ?, ?, 'quotation.tw@bnpparibas.com', 'rfq@yintsun66.com', 'Quote',
                 100, ?, ?, 'BNP', 'PARSED', ?)`
      ).bind(inboundId, `raw/${suffix}`, `content-${suffix}`, now, rfqId, `parsed/${suffix}`),
      testEnv.DB.prepare(
        `INSERT INTO quote_normalize_jobs
          (id, inbound_message_id, rfq_id, issuer, idempotency_key, status,
           available_at, created_at, updated_at)
         VALUES (?, ?, ?, 'BNP', ?, 'QUEUED', ?, ?, ?)`
      ).bind(jobId, inboundId, rfqId, `normalize-${suffix}`, now, now, now)
    ]);

    const row = Array.from({ length: 25 }, () => "");
    Object.assign(row, { 0: "REF-1", 1: "FCN", 2: "USD", 3: "1", 4: "AAA UW", 9: "80", 10: "Daily Memory", 11: "100", 12: "12.5", 13: "98", 14: "6", 15: "NONE", 17: "1", 18: "Note", 19: "7" });
    const appEnv = {
      DB: testEnv.DB,
      RAW_MAIL_BUCKET: { async get() { return { async json() { return { tables: [{ index: 0, rows: [row] }] }; } }; } } as unknown as R2Bucket,
      RFQ_COORDINATOR: { getByName() { return { async fetch() { return new Response(null, { status: 204 }); } }; } } as unknown as DurableObjectNamespace
    } as AppEnv;
    const job: QuoteNormalizeJob = { jobId, inboundMessageId: inboundId, rfqId, issuer: "BNP" };
    await processQuoteNormalizeJob(appEnv, job);
    await processQuoteNormalizeJob(appEnv, job);

    const quote = await testEnv.DB.prepare(
      `SELECT trade_id, issuer, coupon_pa_pct, comparable_price_pct, status
         FROM issuer_quotes WHERE inbound_message_id = ?`
    ).bind(inboundId).first<Record<string, unknown>>();
    expect(quote).toMatchObject({ trade_id: tradeId, issuer: "BNP", coupon_pa_pct: 12.5, comparable_price_pct: 98, status: "VALID" });
    const expected = await testEnv.DB.prepare("SELECT status FROM rfq_expected_issuers WHERE rfq_id = ? AND issuer = 'BNP'")
      .bind(rfqId).first<{ status: string }>();
    expect(expected?.status).toBe("VALID_REPLY");
  });
});
