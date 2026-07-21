import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Text } from "../src/crypto";
import { processOutboundEmailJob, sendRfq } from "../src/outbound";
import type { AppEnv, OutboundEmailJob, SessionContext } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const BASE_URL = "https://api.yintsun66.com";
const USER_ID = "usr_10000000-0000-4000-8000-000000000001";
const RFQ_ID = "rfq_10000000-0000-4000-8000-000000000002";
const TRADE_ID = "trd_10000000-0000-4000-8000-000000000003";
const RAW_CSRF = "csrf-test-value";
const queued: OutboundEmailJob[] = [];
const sent: Array<{ from: unknown; to: unknown; subject: unknown; text: unknown; html: unknown }> = [];
const contentHashPresentBeforeSend: boolean[] = [];
let appEnv: AppEnv;
let session: SessionContext;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO users
      (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
       employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
       password_algorithm, password_iterations, status, role, created_at, updated_at)
     VALUES (?, 'phase3user', 'Phase 3 User', '測試分行', 'ciphertext', 'iv', 'lookup',
             'password', 'salt', 'test', 1, 'ACTIVE', 'USER', ?, ?)`
  ).bind(USER_ID, now, now).run();
  await testEnv.DB.prepare(
    `INSERT INTO rfqs (id, user_id, status, trade_count, created_at, validated_at, version)
     VALUES (?, ?, 'VALIDATED', 1, ?, ?, 2)`
  ).bind(RFQ_ID, USER_ID, now, now).run();
  await testEnv.DB.prepare(
    `INSERT INTO rfq_trades
      (id, rfq_id, sequence, trade_code, product, currency, trade_date,
       effective_date_offset_calendar_days, tenor_months, guaranteed_periods_months,
       underlyings_json, strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct,
       upfront_or_note_price_pct, barrier_type, ki_barrier_pct,
       observation_frequency_months, otc, target_field, matching_key_hash, created_at, frozen_at)
     VALUES (?, ?, 1, 'T01', 'FCN', 'USD', '21-Jul-26', 7, 6, 1,
             '["AAPL UW","MSFT UW"]', 85, 'Daily Memory', 100, NULL,
             98, 'NONE', NULL, 1, 'Note', 'COUPON', 'matching-key', ?, ?)`
  ).bind(TRADE_ID, RFQ_ID, now, now).run();

  appEnv = {
    DB: testEnv.DB,
    EMPLOYEE_DATA_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    EMPLOYEE_LOOKUP_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    OUTBOUND_FROM: "rfq@yintsun66.com",
    OUTBOUND_TO: "i14053@firstbank.com.tw",
    OUTBOUND_EMAIL_QUEUE: {
      async sendBatch(messages: Iterable<{ body: OutboundEmailJob }>) {
        queued.push(...Array.from(messages, message => message.body));
        return { outcome: "ok" };
      }
    } as unknown as Queue<OutboundEmailJob>,
    EMAIL: {
      async send(message: EmailMessageBuilder) {
        const batchCode = String(message.headers?.["X-FCN-BATCH"] ?? "");
        const persisted = await testEnv.DB.prepare(
          "SELECT content_hash FROM outbound_email_batches WHERE rfq_id = ? AND batch_code = ?"
        ).bind(RFQ_ID, batchCode).first<{ content_hash: string | null }>();
        contentHashPresentBeforeSend.push(Boolean(persisted?.content_hash));
        sent.push({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html
        });
        return { messageId: `test-message-${sent.length}` };
      }
    } as SendEmail
  } as AppEnv;
  session = {
    id: "ses_10000000-0000-4000-8000-000000000004",
    csrfTokenHash: await sha256Text(RAW_CSRF),
    absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: USER_ID,
      username: "phase3user",
      displayName: "Phase 3 User",
      branchName: "測試分行",
      role: "USER",
      credentialVersion: 1
    }
  };
});

describe("outbound RFQ email workflow", () => {
  it("snapshots eleven issuers and queues eight idempotent email batches", async () => {
    const key = "phase3-send-idempotency-key";
    const request = () => new Request(`${BASE_URL}/api/v1/rfqs/${RFQ_ID}/send`, {
      method: "POST",
      headers: {
        origin: BASE_URL,
        cookie: `__Host-fcn_csrf=${RAW_CSRF}`,
        "x-csrf-token": RAW_CSRF,
        "idempotency-key": key
      }
    });
    const first = await sendRfq(request(), appEnv, session, RFQ_ID);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      rfq: { id: RFQ_ID, dispatchStatus: "QUEUED", expectedIssuerCount: 11, outboundBatchCount: 8 }
    });
    expect(queued).toHaveLength(8);

    const second = await sendRfq(request(), appEnv, session, RFQ_ID);
    expect(second.status).toBe(202);
    const counts = await testEnv.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM rfq_expected_issuers WHERE rfq_id = ?) AS issuer_count,
        (SELECT COUNT(*) FROM outbound_email_batches WHERE rfq_id = ?) AS batch_count,
        (SELECT COUNT(*) FROM jobs WHERE rfq_id = ?) AS job_count`
    ).bind(RFQ_ID, RFQ_ID, RFQ_ID).first<{ issuer_count: number; batch_count: number; job_count: number }>();
    expect(counts).toEqual({ issuer_count: 11, batch_count: 8, job_count: 8 });
  });

  it("sends all eight formats and moves the RFQ to the ten-minute waiting window", async () => {
    const uniqueJobs = new Map(queued.map(job => [job.jobId, job]));
    expect(uniqueJobs.size).toBe(8);
    for (const job of uniqueJobs.values()) await processOutboundEmailJob(appEnv, job);
    expect(sent).toHaveLength(8);
    expect(contentHashPresentBeforeSend).toEqual(Array(8).fill(true));
    for (const email of sent) {
      expect(email.from).toBe("rfq@yintsun66.com");
      expect(email.to).toBe("i14053@firstbank.com.tw");
      expect(email.subject).toMatch(/ \[RFQ:[A-Za-z0-9_-]{16,64}\]\[BATCH:(?:BMJB|NOMURA|UBS|DBS|SG|CITI|GS|CA)\]$/);
      expect(email.subject).not.toMatch(/##|^(?:re|fw|fwd)\s*:/i);
      expect(email.html).toContain("<table");
      expect(email.text).toContain("Product");
    }
    const rfq = await testEnv.DB.prepare(
      "SELECT dispatch_status, sent_at, deadline_at, correlation_token_hash FROM rfqs WHERE id = ?"
    ).bind(RFQ_ID).first<{ dispatch_status: string; sent_at: string; deadline_at: string; correlation_token_hash: string }>();
    expect(rfq?.dispatch_status).toBe("WAITING");
    expect(Date.parse(rfq?.deadline_at ?? "") - Date.parse(rfq?.sent_at ?? "")).toBe(10 * 60 * 1000);
    expect(rfq?.correlation_token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const batches = await testEnv.DB.prepare(
      "SELECT status, provider_message_id, content_hash FROM outbound_email_batches WHERE rfq_id = ?"
    ).bind(RFQ_ID).all<{ status: string; provider_message_id: string; content_hash: string }>();
    expect(batches.results).toHaveLength(8);
    expect(batches.results.every(row => row.status === "SENT" && row.provider_message_id && row.content_hash)).toBe(true);
  });

  it("does not send a batch twice after it is marked sent", async () => {
    const firstJob = queued[0];
    if (!firstJob) throw new Error("Missing queued job");
    await processOutboundEmailJob(appEnv, firstJob);
    expect(sent).toHaveLength(8);
  });
});
