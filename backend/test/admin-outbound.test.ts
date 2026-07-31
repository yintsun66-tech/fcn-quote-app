import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, type D1Migration, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { archiveOutboundEmail, outboundArchiveKey } from "../src/admin-outbound";
import { sha256Text } from "../src/crypto";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const BASE_URL = "https://api.yintsun66.com";
const ADMIN_ID = "usr_20000000-0000-4000-8000-000000000001";
const USER_ID = "usr_20000000-0000-4000-8000-000000000002";
const RFQ_ID = "rfq_20000000-0000-4000-8000-000000000003";
const BATCH_ID = "obm_20000000-0000-4000-8000-000000000004";
const ADMIN_TOKEN = "admin-outbound-session-token";
const USER_TOKEN = "user-outbound-session-token";

async function api(path: string, token: string): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`${BASE_URL}${path}`, {
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
     VALUES (?, ?, ?, '測試分行', 'ciphertext', 'iv', ?, 'password', 'salt', 'test', 1, 'ACTIVE', ?, ?, ?)`
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
  await createUser(ADMIN_ID, "outboundadmin", "ADMIN");
  await createUser(USER_ID, "outbounduser", "USER");
  await createSession("ses_20000000-0000-4000-8000-000000000005", ADMIN_ID, ADMIN_TOKEN);
  await createSession("ses_20000000-0000-4000-8000-000000000006", USER_ID, USER_TOKEN);
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO rfqs (id, user_id, status, trade_count, created_at, validated_at, version)
     VALUES (?, ?, 'VALIDATED', 1, ?, ?, 1)`
  ).bind(RFQ_ID, USER_ID, now, now).run();
  await testEnv.DB.prepare(
    `INSERT INTO outbound_email_batches
      (id, rfq_id, batch_code, sender, recipient, base_subject, correlation_token_hash, content_hash, status, queued_at)
     VALUES (?, ?, 'UBS', 'rfq@yintsun66.com', 'i14053@firstbank.com.tw',
             'UBS[詢價]FCBKTPE: FCN(T+7)', 'correlation', 'content-hash', 'SENT', ?)`
  ).bind(BATCH_ID, RFQ_ID, now).run();
  await archiveOutboundEmail(testEnv, {
    batchId: BATCH_ID,
    rfqId: RFQ_ID,
    batchCode: "UBS",
    sender: "rfq@yintsun66.com",
    recipient: "i14053@firstbank.com.tw",
    subject: "UBS[詢價]FCBKTPE: FCN(T+7) [RFQ:opaque-token][BATCH:UBS]",
    html: "<!doctype html><html><body><table><tr><td>archive</td></tr></table></body></html>",
    plainText: "archive",
    contentHash: "content-hash"
  });
});

describe("administrator outbound email archive", () => {
  it("keeps the archive private to administrators", async () => {
    const response = await api("/api/v1/admin/outbound-emails", USER_TOKEN);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ADMIN_REQUIRED" } });
  });

  it("lists and retrieves an archived outbound subject and HTML", async () => {
    expect(outboundArchiveKey(BATCH_ID)).toBe(`raw-email/outbound/v1/${BATCH_ID}.json`);
    const listResponse = await api("/api/v1/admin/outbound-emails?limit=10", ADMIN_TOKEN);
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json<{ records: Array<{ id: string; baseSubject: string; requester: { username: string } }> }>();
    expect(list.records).toContainEqual(expect.objectContaining({
      id: BATCH_ID,
      baseSubject: "UBS[詢價]FCBKTPE: FCN(T+7)",
      requester: expect.objectContaining({ username: "outbounduser" })
    }));

    const detailResponse = await api(`/api/v1/admin/outbound-emails/${BATCH_ID}`, ADMIN_TOKEN);
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      record: {
        batchId: BATCH_ID,
        subject: "UBS[詢價]FCBKTPE: FCN(T+7) [RFQ:opaque-token][BATCH:UBS]",
        html: expect.stringContaining("<table")
      }
    });
    expect(await testEnv.RAW_MAIL_BUCKET.get(outboundArchiveKey(BATCH_ID))).not.toBeNull();
  });
});
