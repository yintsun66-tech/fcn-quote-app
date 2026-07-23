import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Text } from "../src/crypto";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const BASE_URL = "https://api.yintsun66.com";
const ADMIN_ID = "usr_41000000-0000-4000-8000-000000000001";
const USER_ID = "usr_41000000-0000-4000-8000-000000000002";
const RFQ_ID = "rfq_41000000-0000-4000-8000-000000000003";
const ADMIN_TOKEN = "admin-rfq-timeline-token";
const USER_TOKEN = "user-rfq-timeline-token";

async function api(token: string): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`${BASE_URL}/api/v1/admin/rfq-timelines?limit=10`, {
    headers: { cookie: `__Host-fcn_session=${token}` }
  }) as unknown as Request<unknown, IncomingRequestCfProperties>, testEnv, context);
  await waitOnExecutionContext(context);
  return response;
}

async function createUser(id: string, username: string, role: "ADMIN" | "USER"): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO users
      (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
       employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
       password_algorithm, password_iterations, status, role, created_at, updated_at)
     VALUES (?, ?, ?, 'Timeline Branch', 'ciphertext', 'iv', ?, 'password', 'salt', 'test', 1, 'ACTIVE', ?, ?, ?)`
  ).bind(id, username, `${username} User`, `lookup-${username}`, role, now, now).run();
}

async function createSession(id: string, userId: string, token: string): Promise<void> {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO user_sessions
      (id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at, expires_at, absolute_expires_at, credential_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, userId, await sha256Text(token), await sha256Text("csrf"), now, now, expires, expires).run();
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await createUser(ADMIN_ID, "timelineadmin", "ADMIN");
  await createUser(USER_ID, "timelineuser", "USER");
  await createSession("ses_41000000-0000-4000-8000-000000000004", ADMIN_ID, ADMIN_TOKEN);
  await createSession("ses_41000000-0000-4000-8000-000000000005", USER_ID, USER_TOKEN);
  const created = new Date(Date.now() - 120_000).toISOString();
  const queued = new Date(Date.now() - 110_000).toISOString();
  const sent = new Date(Date.now() - 100_000).toISOString();
  const deadline = new Date(Date.now() + 800_000).toISOString();
  const firstInbound = new Date(Date.now() - 70_000).toISOString();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO rfqs
        (id, user_id, status, trade_count, created_at, validated_at, version,
         dispatch_status, workflow_status, outbound_queued_at, sent_at, deadline_at,
         expected_issuer_count, outbound_batch_count)
       VALUES (?, ?, 'VALIDATED', 2, ?, ?, 2, 'WAITING', 'PARTIAL', ?, ?, ?, 11, 8)`
    ).bind(RFQ_ID, USER_ID, created, created, queued, sent, deadline),
    testEnv.DB.prepare(
      `INSERT INTO rfq_expected_issuers
        (id, rfq_id, issuer, outbound_batch_code, status, snapshot_at, terminal_at)
       VALUES ('exp_timeline_bnp', ?, 'BNP', 'BMJB', 'VALID_REPLY', ?, ?)`
    ).bind(RFQ_ID, created, firstInbound),
    testEnv.DB.prepare(
      `INSERT INTO outbound_email_batches
        (id, rfq_id, batch_code, sender, recipient, base_subject, correlation_token_hash,
         status, queued_at, sent_at)
       VALUES ('obm_41000000-0000-4000-8000-000000000006', ?, 'BMJB',
               'rfq@yintsun66.com', 'i14053@firstbank.com.tw', 'private subject',
               'private-token-hash', 'SENT', ?, ?)`
    ).bind(RFQ_ID, queued, sent),
    testEnv.DB.prepare(
      `INSERT INTO inbound_messages
        (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
         raw_subject, raw_size_bytes, received_at, rfq_id, detected_issuer, status)
       VALUES ('inb_41000000-0000-4000-8000-000000000007', 'private/r2/key',
               '<private-message-id>', 'private-content-hash', 'private@example.invalid',
               'rfq@yintsun66.com', 'private inbound subject', 100, ?, ?, 'BNP', 'PARSED')`
    ).bind(firstInbound, RFQ_ID)
  ]);
});

describe("administrator RFQ timeline", () => {
  it("keeps operational timelines private to administrators", async () => {
    const response = await api(USER_TOKEN);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
  });

  it("returns safe timing and status aggregates without raw email or token data", async () => {
    const response = await api(ADMIN_TOKEN);
    expect(response.status).toBe(200);
    const payload = await response.json<{ records: Array<Record<string, unknown>> }>();
    expect(payload.records).toContainEqual(expect.objectContaining({
      rfqId: RFQ_ID,
      tradeCount: 2,
      workflowStatus: "PARTIAL",
      outbound: expect.objectContaining({ total: 1, sent: 1 }),
      inbound: expect.objectContaining({ total: 1, parsed: 1 }),
      issuerStates: [expect.objectContaining({ issuer: "BNP", status: "VALID_REPLY" })]
    }));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("private subject");
    expect(serialized).not.toContain("private-token-hash");
    expect(serialized).not.toContain("private/r2/key");
    expect(serialized).not.toContain("private-message-id");
  });
});
