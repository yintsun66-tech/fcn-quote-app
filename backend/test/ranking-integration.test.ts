import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { processQuoteRankJob } from "../src/ranking";
import { processImageRenderJob } from "../src/artifacts";
import { downloadArtifact, listRfqArtifacts } from "../src/results";
import { rfqCorrelationCode } from "../src/crypto";
import type { AppEnv, ImageRenderJob, QuoteRankJob, SessionContext } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const BASE_URL = "https://api.yintsun66.com";
const LOOKUP_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("versioned ranking persistence", () => {
  beforeAll(async () => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

  it("persists dense top-three ranks and queues switchable issuer images", async () => {
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
         VALUES (?, ?, ?, 'sender@example.com', 'rfq@yintsun66.com', 'Quote', 100, ?, ?, 'BNP', 'PARSED')`
      ).bind(inboundId, `raw/${suffix}`, `content-${suffix}`, now, rfqId),
      testEnv.DB.prepare(
        `INSERT INTO quote_rank_jobs
          (id, rfq_id, trigger, requested_version, idempotency_key, status,
           available_at, created_at, updated_at)
         VALUES (?, ?, 'ALL_TERMINAL', 1, ?, 'QUEUED', ?, ?, ?)`
      ).bind(jobId, rfqId, `rank:${rfqId}:v1`, now, now, now)
    ]);
    const coupons = [14, 14, 12, 10, 8];
    const issuers = ["BNP", "JPM", "UBS", "CA", "SG"];
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
    expect(imageJobs.map(job => job.issuer)).toEqual(["BNP", "CA", "JPM", "SG", "UBS"]);
    const artifacts = await testEnv.DB.prepare(
      "SELECT issuer, render_profile_version FROM generated_artifacts WHERE rfq_id = ? ORDER BY issuer"
    ).bind(rfqId).all<{ issuer: string; render_profile_version: string }>();
    expect(artifacts.results).toEqual([
      { issuer: "BNP", render_profile_version: "quote-card-reference-v3" },
      { issuer: "CA", render_profile_version: "quote-card-reference-v3" },
      { issuer: "JPM", render_profile_version: "quote-card-reference-v3" },
      { issuer: "SG", render_profile_version: "quote-card-reference-v3" },
      { issuer: "UBS", render_profile_version: "quote-card-reference-v3" }
    ]);
    const session = { user: { id: userId } } as SessionContext;
    const artifactList = await (await listRfqArtifacts(testEnv, session, rfqId)).json<{
      artifacts: Array<{ id: string; issuer: string; isDefault: boolean; previewUrl: string | null }>;
    }>();
    expect(artifactList.artifacts.map(item => [item.issuer, item.isDefault])).toEqual([
      ["BNP", true], ["CA", false], ["JPM", false], ["SG", false], ["UBS", false]
    ]);

    let renderedSgHtml = "";
    const renderEnv = {
      DB: testEnv.DB,
      RAW_MAIL_BUCKET: testEnv.RAW_MAIL_BUCKET,
      EMPLOYEE_LOOKUP_KEY: LOOKUP_KEY,
      BROWSER: {
        async quickAction(_action: string, options: { html: string }) {
          renderedSgHtml = options.html;
          return new Response(new Uint8Array([7, 8, 9]), { status: 200 });
        }
      }
    } as unknown as AppEnv;
    await processImageRenderJob(renderEnv, imageJobs.find(item => item.issuer === "SG")!);
    expect(renderedSgHtml).toContain("<h1>FCN 報價</h1>");
    expect(renderedSgHtml).toContain("8%");
    expect(renderedSgHtml).toContain("報價日期：21-Jul-26");
    expect(renderedSgHtml).toContain(`RFQ 編號：[RFQ:${await rfqCorrelationCode(LOOKUP_KEY, rfqId)}]`);

    const bnpArtifact = artifactList.artifacts.find(item => item.issuer === "BNP")!;
    const objectKey = `quote-images/v3/${rfqId}/test/BNP.png`;
    await testEnv.RAW_MAIL_BUCKET.put(objectKey, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
    await testEnv.DB.prepare(
      "UPDATE generated_artifacts SET status = 'READY', r2_object_key = ?, completed_at = ? WHERE id = ?"
    ).bind(objectKey, now, bnpArtifact.id).run();
    const refreshedArtifacts = await (await listRfqArtifacts(testEnv, session, rfqId)).json<{
      artifacts: Array<{ issuer: string; previewUrl: string | null }>;
    }>();
    expect(refreshedArtifacts.artifacts.find(item => item.issuer === "BNP")?.previewUrl).toContain("?preview=1");
    const preview = await downloadArtifact(
      new Request(`${BASE_URL}/api/v1/artifacts/${bnpArtifact.id}/download?preview=1`),
      testEnv,
      session,
      bnpArtifact.id
    );
    expect(preview.headers.get("content-disposition")).toContain("inline");
    const download = await downloadArtifact(
      new Request(`${BASE_URL}/api/v1/artifacts/${bnpArtifact.id}/download`),
      testEnv,
      session,
      bnpArtifact.id
    );
    expect(download.headers.get("content-disposition")).toContain("attachment");
    const rfq = await testEnv.DB.prepare("SELECT workflow_status, current_ranking_version FROM rfqs WHERE id = ?")
      .bind(rfqId).first<{ workflow_status: string; current_ranking_version: number }>();
    expect(rfq).toEqual({ workflow_status: "COMPLETED", current_ranking_version: 1 });
  });
});
