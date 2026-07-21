import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { processQuoteRankJob } from "../src/ranking";
import type { AppEnv, ImageRenderJob, QuoteRankJob } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };

describe("versioned ranking persistence", () => {
  beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

  it("persists dense top-three ranks and queues only the deterministic rank-one image", async () => {
    const suffix = crypto.randomUUID();
    const userId = `usr_${suffix}`;
    const rfqId = `rfq_${crypto.randomUUID()}`;
    const tradeId = `trd_${crypto.randomUUID()}`;
    const inboundId = `inb_${crypto.randomUUID()}`;
    const jobId = `rnkjob_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO users
          (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
           employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
           password_algorithm, password_iterations, status, role, created_at, updated_at)
         VALUES (?, ?, 'Ranker', 'Test', 'cipher', 'iv', ?, 'hash', 'salt', 'test', 1, 'ACTIVE', 'USER', ?, ?)`
      ).bind(userId, `ranker-${suffix}`.slice(0, 50), `lookup-${suffix}`, now, now),
      testEnv.DB.prepare(
        `INSERT INTO rfqs
          (id, user_id, status, trade_count, created_at, version, dispatch_status,
           workflow_status, expected_issuer_count, outbound_batch_count)
         VALUES (?, ?, 'VALIDATED', 1, ?, 2, 'WAITING', 'FINALIZING', 11, 8)`
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
        `INSERT INTO inbound_messages
          (id, r2_raw_mime_key, content_hash, envelope_from, envelope_to, raw_subject,
           raw_size_bytes, received_at, rfq_id, detected_issuer, status)
         VALUES (?, ?, ?, 'sender@example.com', 'reply@yintsun66.com', 'Quote', 100, ?, ?, 'BNP', 'PARSED')`
      ).bind(inboundId, `raw/${suffix}`, `content-${suffix}`, now, rfqId),
      testEnv.DB.prepare(
        `INSERT INTO quote_rank_jobs
          (id, rfq_id, trigger, requested_version, idempotency_key, status,
           available_at, created_at, updated_at)
         VALUES (?, ?, 'ALL_TERMINAL', 1, ?, 'QUEUED', ?, ?, ?)`
      ).bind(jobId, rfqId, `rank:${rfqId}:v1`, now, now, now)
    ]);
    const coupons = [14, 14, 12, 10];
    const issuers = ["BNP", "JPM", "UBS", "CA"];
    for (let index = 0; index < coupons.length; index += 1) {
      const receivedAt = new Date(Date.parse(now) + index * 1000).toISOString();
      await testEnv.DB.prepare(
        `INSERT INTO issuer_quotes
          (id, rfq_id, trade_id, inbound_message_id, issuer, issuer_display_name,
           product, currency, tenor_months, guaranteed_periods_months, underlyings_json,
           strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct, raw_price_value,
           raw_price_label, price_semantics, comparable_price_pct, barrier_type,
           observation_frequency_months, otc, received_at, parser_profile, parser_version,
           source_table_index, source_row_index, raw_values_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'FCN', 'USD', 6, 1, '["AAA UW"]', 80,
                 'Daily Memory', 100, ?, 98, 'NotePrice', 'NOTE_PRICE', 98, 'NONE',
                 1, 'Note', ?, 'TEST', 'v1', 0, ?, '[]', 'VALID', ?)`
      ).bind(`quo_${crypto.randomUUID()}`, rfqId, tradeId, inboundId, issuers[index], issuers[index], coupons[index], receivedAt, index, now).run();
    }
    const imageJobs: ImageRenderJob[] = [];
    const appEnv = {
      DB: testEnv.DB,
      IMAGE_RENDER_QUEUE: { async send(job: ImageRenderJob) { imageJobs.push(job); } } as unknown as Queue<ImageRenderJob>
    } as AppEnv;
    const job: QuoteRankJob = { jobId, rfqId, trigger: "ALL_TERMINAL", requestedVersion: 1 };
    await processQuoteRankJob(appEnv, job);
    await processQuoteRankJob(appEnv, job);

    const results = await testEnv.DB.prepare(
      "SELECT economic_rank, is_image_winner, normalized_value FROM ranking_results WHERE rfq_id = ? ORDER BY display_order"
    ).bind(rfqId).all<{ economic_rank: number; is_image_winner: number; normalized_value: number }>();
    expect(results.results.map(row => [row.economic_rank, row.normalized_value])).toEqual([[1, 14], [1, 14], [2, 12], [3, 10]]);
    expect(results.results.filter(row => row.is_image_winner === 1)).toHaveLength(1);
    expect(imageJobs).toHaveLength(1);
    const rfq = await testEnv.DB.prepare("SELECT workflow_status, current_ranking_version FROM rfqs WHERE id = ?")
      .bind(rfqId).first<{ workflow_status: string; current_ranking_version: number }>();
    expect(rfq).toEqual({ workflow_status: "COMPLETED", current_ranking_version: 1 });
  });
});
