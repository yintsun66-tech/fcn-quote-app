import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestInboundEmail } from "../src/inbound";
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
    to: options.to ?? "reply@yintsun66.com",
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
    INBOUND_ADDRESS: "reply@yintsun66.com",
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
    } as unknown as Queue<InboundEmailJob>
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
});
