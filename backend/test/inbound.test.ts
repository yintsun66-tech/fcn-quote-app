import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Text } from "../src/crypto";
import { ingestInboundEmail } from "../src/inbound";
import { processInboundEmailJob } from "../src/inbound-parser";
import type { AppEnv, InboundEmailJob } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const objects = new Map<string, ArrayBuffer>();
const queued: InboundEmailJob[] = [];
let rejectReason: string | null = null;
let failNextQueue = false;
let appEnv: AppEnv;

function email(raw: string, options: { to?: string; id?: string } = {}): ForwardableEmailMessage {
  const bytes = new TextEncoder().encode(raw);
  const headers = new Headers({
    from: "Issuer Pricing <pricing@example.com>",
    "return-path": "<pricing@example.com>",
    subject: "Re: test quote [RFQ:test][BATCH:BMJB]",
    "message-id": options.id ?? `<${crypto.randomUUID()}@example.com>`,
    "authentication-results": "mx.example; dkim=pass header.d=example.com"
  });
  return {
    from: "pricing@example.com",
    to: options.to ?? "rfq@yintsun66.com",
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    rawSize: bytes.byteLength,
    headers,
    setReject(reason: string) { rejectReason = reason; },
    async forward() { return { messageId: "not-used" }; },
    async reply() { return { messageId: "not-used" }; }
  } as ForwardableEmailMessage;
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  appEnv = {
    DB: testEnv.DB,
    EMPLOYEE_DATA_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    EMPLOYEE_LOOKUP_KEY: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    INBOUND_ADDRESS: "rfq@yintsun66.com",
    MAX_INBOUND_EMAIL_BYTES: "26214400",
    RAW_MAIL_BUCKET: {
      async put(key: string, value: ArrayBuffer | ArrayBufferView | string) {
        const bytes = typeof value === "string"
          ? new TextEncoder().encode(value).buffer
          : value instanceof ArrayBuffer
            ? value
            : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        objects.set(key, bytes as ArrayBuffer);
        return {};
      },
      async get(key: string) {
        const value = objects.get(key);
        if (!value) return null;
        return { async arrayBuffer() { return value; } };
      }
    } as unknown as R2Bucket,
    INBOUND_EMAIL_QUEUE: {
      async send(job: InboundEmailJob) {
        if (failNextQueue) {
          failNextQueue = false;
          throw new Error("simulated queue failure");
        }
        queued.push(job);
      }
    } as unknown as Queue<InboundEmailJob>,
    QUOTE_NORMALIZE_QUEUE: {
      async send() {}
    } as unknown as Queue
  } as unknown as AppEnv;
});

beforeEach(() => {
  rejectReason = null;
  failNextQueue = false;
  queued.length = 0;
});

describe("inbound email ingestion", () => {
  it("stores raw MIME privately, records metadata, and queues exactly once for an exact duplicate", async () => {
    const raw = "From: pricing@example.com\r\nSubject: Quote\r\n\r\nquote body one";
    const id = "<phase4-one@example.com>";
    await ingestInboundEmail(email(raw, { id }), appEnv);
    await ingestInboundEmail(email(raw, { id }), appEnv);

    const messages = await testEnv.DB.prepare(
      "SELECT status, raw_size_bytes, r2_raw_mime_key, message_id FROM inbound_messages WHERE message_id = ?"
    ).bind(id).all<{ status: string; raw_size_bytes: number; r2_raw_mime_key: string; message_id: string }>();
    expect(messages.results).toHaveLength(1);
    expect(messages.results[0]).toMatchObject({ status: "QUEUED", message_id: id });
    expect(messages.results[0]?.r2_raw_mime_key).toMatch(/^raw-email\/v1\/[A-Za-z0-9_-]{43}\.eml$/);
    expect(objects.has(messages.results[0]?.r2_raw_mime_key ?? "")).toBe(true);
    expect(queued).toHaveLength(1);
  });

  it("repairs a queue-send failure without storing a second message", async () => {
    const raw = "From: pricing@example.com\r\nSubject: Quote\r\n\r\nquote body retry";
    const id = "<phase4-retry@example.com>";
    failNextQueue = true;
    await expect(ingestInboundEmail(email(raw, { id }), appEnv)).rejects.toThrow("simulated queue failure");
    await ingestInboundEmail(email(raw, { id }), appEnv);
    const row = await testEnv.DB.prepare(
      "SELECT status FROM inbound_messages WHERE message_id = ?"
    ).bind(id).first<{ status: string }>();
    expect(row?.status).toBe("QUEUED");
    expect(queued).toHaveLength(1);
  });

  it("rejects an unexpected recipient before storing content", async () => {
    await ingestInboundEmail(email("not accepted", { to: "other@yintsun66.com" }), appEnv);
    expect(rejectReason).toBe("Recipient not accepted");
  });

  it("parses a synthetic issuer table, correlates by opaque token, and completes idempotently", async () => {
    const userId = "usr_20000000-0000-4000-8000-000000000001";
    const rfqId = "rfq_20000000-0000-4000-8000-000000000002";
    const batchId = "obm_20000000-0000-4000-8000-000000000003";
    const token = "synthetic-rfq-token-0123456789abcdef";
    const tokenHash = await sha256Text(token);
    const now = new Date().toISOString();
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO users
          (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
           employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
           password_algorithm, password_iterations, status, role, created_at, updated_at)
         VALUES (?, 'phase4buser', 'Phase 4b User', 'Test Branch', 'ciphertext', 'iv', 'phase4b-lookup',
                 'password', 'salt', 'test', 1, 'ACTIVE', 'USER', ?, ?)`
      ).bind(userId, now, now),
      testEnv.DB.prepare(
        `INSERT INTO rfqs
          (id, user_id, status, trade_count, created_at, validated_at, version,
           dispatch_status, correlation_token_hash, sent_at, deadline_at, expected_issuer_count, outbound_batch_count)
         VALUES (?, ?, 'VALIDATED', 1, ?, ?, 2, 'WAITING', ?, ?, ?, 11, 8)`
      ).bind(rfqId, userId, now, now, tokenHash, now, deadline),
      testEnv.DB.prepare(
        `INSERT INTO outbound_email_batches
          (id, rfq_id, batch_code, sender, recipient, base_subject, correlation_token_hash,
           status, queued_at, sent_at, provider_message_id)
         VALUES (?, ?, 'BMJB', 'rfq@yintsun66.com', 'i14053@firstbank.com.tw',
                 'BMJB[詢價]FCBKTPE: FCN(T+7)', ?, 'SENT', ?, ?, '<outbound-phase4b@example.invalid>')`
      ).bind(batchId, rfqId, tokenHash, now, now)
    ]);

    const inboundId = `<phase4b-parse-${crypto.randomUUID()}@example.invalid>`;
    const raw = [
      "From: BNP Pricing <quotation.tw@bnpparibas.com>",
      "Return-Path: <quotation.tw@bnpparibas.com>",
      "Authentication-Results: mx.example; dkim=pass header.d=bnpparibas.com",
      `Subject: RE: External BMJB[詢價]FCBKTPE: FCN(T+7) ##requester@example.invalid## [RFQ:${token}][BATCH:BMJB]`,
      `Message-ID: ${inboundId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><script>doNotPersist()</script><table><tr><th>Product</th><th>Coupon</th></tr><tr><td>FCN</td><td>12.34%</td></tr></table></body></html>"
    ].join("\r\n");
    await ingestInboundEmail(email(raw, { id: inboundId }), appEnv);
    const job = queued.at(-1);
    if (!job) throw new Error("Missing inbound parse job");
    await processInboundEmailJob(appEnv, job);
    await processInboundEmailJob(appEnv, job);

    const row = await testEnv.DB.prepare(
      `SELECT status, detected_issuer, rfq_id, subject_batch_code, correlation_source,
              requester_marker_hash, r2_parsed_tables_key, html_table_count, parser_version
         FROM inbound_messages WHERE message_id = ?`
    ).bind(inboundId).first<Record<string, string | number | null>>();
    expect(row).toMatchObject({
      status: "PARSED",
      detected_issuer: "BNP",
      rfq_id: rfqId,
      subject_batch_code: "BMJB",
      correlation_source: "TOKEN",
      html_table_count: 1,
      parser_version: "inbound-mime-v1"
    });
    expect(row?.requester_marker_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const parsedBytes = objects.get(String(row?.r2_parsed_tables_key));
    expect(parsedBytes).toBeDefined();
    const parsed = JSON.parse(new TextDecoder().decode(parsedBytes)) as { tables: Array<{ rows: string[][] }> };
    expect(parsed.tables[0]?.rows).toEqual([["Product", "Coupon"], ["FCN", "12.34%"]]);
    expect(JSON.stringify(parsed)).not.toContain("doNotPersist");
  });
});
