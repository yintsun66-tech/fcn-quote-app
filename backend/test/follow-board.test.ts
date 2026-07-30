import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
  waitOnExecutionContext
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { encryptEmployeeNumber, keyedHash, sha256Text } from "../src/crypto";
import {
  parseFollowBoardPublicationSubject,
  processFollowBoardPublicationEmail,
  selectFollowBoardPublicationRow
} from "../src/follow-board-publication";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const BASE_URL = "https://api.yintsun66.com";
const STATIC_ORIGIN = "https://yintsun66-tech.github.io";
const USER_ID = "usr_63000000-0000-4000-8000-000000000001";
const ADMIN_ID = "usr_63000000-0000-4000-8000-000000000002";
const RFQ_ID = "rfq_63000000-0000-4000-8000-000000000003";
const TRADE_ID = "trd_63000000-0000-4000-8000-000000000004";
const BATCH_ID = "obm_63000000-0000-4000-8000-000000000005";
const ISSUER_INBOUND_ID = "inm_63000000-0000-4000-8000-000000000006";
const COMMAND_INBOUND_ID = "inm_63000000-0000-4000-8000-000000000007";
const PARSE_JOB_ID = "job_63000000-0000-4000-8000-000000000008";
const QUOTE_ID = "quo_63000000-0000-4000-8000-000000000009";
const RUN_ID = "rnk_63000000-0000-4000-8000-000000000010";
const ADMIN_TOKEN = "follow-board-admin-token";
const ADMIN_CSRF = "follow-board-admin-csrf";

function cells(length: number, values: Record<number, string | number>): string[] {
  const row = Array.from({ length }, () => "");
  for (const [index, value] of Object.entries(values)) row[Number(index)] = String(value);
  return row;
}

const BARCLAYS_PUBLICATION_TABLES = [{
  index: 0,
  rows: [
    [
      "Product", "Currency", "Guaranteed Periods (m)", "BBG Code 1", "BBG Code 2",
      "BBG Code 3", "BBG Code 4", "BBG Code 5", "Strike (%)", "KO Type",
      "KO Barrier (%)", "Coupon p.a. (%)", "Upfront / NotePrice (%)", "Tenor (m)",
      "Barrier Type", "KI Barrier (%)", "Observation Frequency (m)", "OTC",
      "Effective Date Offset (calendar days)", "Notional", "Trade Date", "Issue Date",
      "Final Valuation Date", "Maturity Date", "Quote Id"
    ],
    cells(25, {
      0: "FCN", 1: "USD", 2: 1, 3: "AAPL UW", 4: "MSFT UW",
      8: 85, 9: "Daily Memory", 10: 100, 11: 18.88, 12: 98,
      13: 6, 14: "EKI", 15: 70, 16: 1, 17: "Note", 18: 7,
      19: 10_000_000, 24: "BARCLAYS-EXTERNAL-1"
    })
  ]
}];

async function api(path: string, init: RequestInit = {}, origin = STATIC_ORIGIN): Promise<Response> {
  const headers = new Headers(init.headers);
  if (origin) headers.set("origin", origin);
  headers.set("cf-connecting-ip", "203.0.113.63");
  if (init.body) headers.set("content-type", "application/json");
  const context = createExecutionContext();
  const request = new Request(
    `${BASE_URL}${path}`,
    { ...init, headers }
  ) as unknown as Request<unknown, IncomingRequestCfProperties>;
  const response = await worker.fetch(request, testEnv, context);
  await waitOnExecutionContext(context);
  return response;
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO users
        (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
         employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
         password_algorithm, password_iterations, status, role, created_at, updated_at)
       VALUES (?, '63001', 'Board Owner', '測試分行', 'ciphertext', 'iv', 'board-owner',
               'password', 'salt', 'test', 1, 'ACTIVE', 'USER', ?, ?)`
    ).bind(USER_ID, now, now),
    testEnv.DB.prepare(
      `INSERT INTO users
        (id, username_normalized, display_name, branch_name, employee_number_ciphertext,
         employee_number_iv, employee_number_lookup_hash, password_hash, password_salt,
         password_algorithm, password_iterations, status, role, created_at, updated_at)
       VALUES (?, '63002', 'Board Admin', '管理分行', 'ciphertext', 'iv', 'board-admin',
               'password', 'salt', 'test', 1, 'ACTIVE', 'ADMIN', ?, ?)`
    ).bind(ADMIN_ID, now, now),
    testEnv.DB.prepare(
      `INSERT INTO rfqs
        (id, user_id, status, trade_count, created_at, validated_at, version,
         dispatch_status, workflow_status, current_ranking_version,
         expected_issuer_count, outbound_batch_count)
       VALUES (?, ?, 'VALIDATED', 1, ?, ?, 2, 'WAITING', 'COMPLETED', 1, 11, 8)`
    ).bind(RFQ_ID, USER_ID, now, now),
    testEnv.DB.prepare(
      `INSERT INTO rfq_trades
        (id, rfq_id, sequence, trade_code, product, currency, trade_date,
         effective_date_offset_calendar_days, tenor_months, guaranteed_periods_months,
         underlyings_json, strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct,
         upfront_or_note_price_pct, barrier_type, ki_barrier_pct,
         observation_frequency_months, otc, target_field, matching_key_hash, created_at, frozen_at)
       VALUES (?, ?, 1, 'T01', 'FCN', 'USD', '30-Jul-26', 7, 6, 1,
               '["AAPL UW","MSFT UW"]', 85, 'Daily Memory', 100, NULL, 98,
               'EKI', 70, 1, 'Note', 'COUPON', 'board-match', ?, ?)`
    ).bind(TRADE_ID, RFQ_ID, now, now),
    testEnv.DB.prepare(
      `INSERT INTO outbound_email_batches
        (id, rfq_id, batch_code, sender, recipient, base_subject, correlation_token_hash,
         status, queued_at, sent_at, provider_message_id)
       VALUES (?, ?, 'BMJB', 'rfq@yintsun66.com', 'i14053@firstbank.com.tw',
               'BMJB quote', 'board-correlation', 'SENT', ?, ?, '<board-outbound@example.invalid>')`
    ).bind(BATCH_ID, RFQ_ID, now, now),
    testEnv.DB.prepare(
      `INSERT INTO inbound_messages
        (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
         raw_subject, raw_size_bytes, received_at, rfq_id, status)
       VALUES (?, 'raw-email/board-issuer.eml', '<board-issuer@example.invalid>',
               'board-issuer-hash', 'quotation.tw@bnpparibas.com', 'rfq@yintsun66.com',
               'BMJB quote', 100, ?, ?, 'PARSED')`
    ).bind(ISSUER_INBOUND_ID, now, RFQ_ID),
    testEnv.DB.prepare(
      `INSERT INTO inbound_messages
        (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
         header_from, return_path, raw_subject, in_reply_to, authentication_results,
         raw_size_bytes, received_at, status)
       VALUES (?, 'raw-email/board-command.eml', '<board-command@example.invalid>',
               'board-command-hash', 'i14053@firstbank.com.tw', 'rfq@yintsun66.com',
               'Publisher <i14053@firstbank.com.tw>', '<i14053@firstbank.com.tw>',
               '0730 deal-1 PBZY BMJB跟單', '<board-outbound@example.invalid>',
               'mx; dkim=pass header.d=firstbank.com.tw', 100, ?, 'PARSING')`
    ).bind(COMMAND_INBOUND_ID, now),
    testEnv.DB.prepare(
      `INSERT INTO email_parse_jobs
        (id, inbound_message_id, idempotency_key, status, available_at, created_at, updated_at)
       VALUES (?, ?, 'FOLLOW-BOARD-PARSE', 'RUNNING', ?, ?, ?)`
    ).bind(PARSE_JOB_ID, COMMAND_INBOUND_ID, now, now, now),
    testEnv.DB.prepare(
      `INSERT INTO issuer_quotes
        (id, rfq_id, trade_id, outbound_batch_id, inbound_message_id, issuer,
         issuer_display_name, product, currency, trade_date,
         effective_date_offset_calendar_days, tenor_months, guaranteed_periods_months,
         underlyings_json, strike_pct, ko_type, ko_barrier_pct, coupon_pa_pct,
         raw_price_value, raw_price_label, price_semantics, comparable_price_pct,
         barrier_type, ki_barrier_pct, observation_frequency_months, otc,
         received_at, parser_profile, parser_version, source_table_index,
         source_row_index, raw_values_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'BNP', 'BNP PARIBAS', 'FCN', 'USD', '30-Jul-26',
               7, 6, 1, '["AAPL UW","MSFT UW"]', 85, 'Daily Memory', 100, 14.47,
               98, 'Note Price', 'NOTE_PRICE', 98, 'EKI', 70, 1, 'Note',
               ?, 'BNP_FCN', 'test-v1', 0, 1, '{}', 'VALID', ?)`
    ).bind(QUOTE_ID, RFQ_ID, TRADE_ID, BATCH_ID, ISSUER_INBOUND_ID, now, now),
    testEnv.DB.prepare(
      `INSERT INTO ranking_runs
        (id, rfq_id, version, trigger, target_field_rules_version, status,
         idempotency_key, started_at, completed_at)
       VALUES (?, ?, 1, 'DEADLINE', 'test-v1', 'COMPLETED', 'board-rank', ?, ?)`
    ).bind(RUN_ID, RFQ_ID, now, now),
    testEnv.DB.prepare(
      `INSERT INTO ranking_results
        (id, ranking_run_id, rfq_id, trade_id, quote_id, economic_rank,
         display_order, target_field, normalized_value, direction,
         is_image_winner, tie_group, created_at)
       VALUES ('rrs_63000000-0000-4000-8000-000000000011', ?, ?, ?, ?, 1, 1,
               'COUPON', 14.47, 'DESC', 1, '14.47', ?)`
    ).bind(RUN_ID, RFQ_ID, TRADE_ID, QUOTE_ID, now),
    testEnv.DB.prepare(
      `INSERT INTO user_sessions
        (id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at,
         expires_at, absolute_expires_at, credential_version)
       VALUES ('ses_63000000-0000-4000-8000-000000000012', ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(ADMIN_ID, await sha256Text(ADMIN_TOKEN), await sha256Text(ADMIN_CSRF), now, now, expires, expires)
  ]);

  await processFollowBoardPublicationEmail(testEnv, {
    command: {
      subjectDateMmdd: "0730",
      dealSequence: 1,
      productCode: "PBZY",
      batchCode: "BMJB"
    },
    normalizedSubject: "0730 deal-1 PBZY BMJB跟單",
    inboundMessageId: COMMAND_INBOUND_ID,
    parseJobId: PARSE_JOB_ID,
    email: {
      from: { name: "Publisher", address: "i14053@firstbank.com.tw" },
      attachments: []
    } as never,
    envelopeFrom: "i14053@firstbank.com.tw",
    headerFrom: "Publisher <i14053@firstbank.com.tw>",
    returnPath: "<i14053@firstbank.com.tw>",
    authenticationResults: "mx; dkim=pass header.d=firstbank.com.tw",
    correlation: null,
    correlationEvidenceConflict: false,
    correlationEvidenceBatchCode: "BMJB",
    sourceReferenceHash: "external-thread-reference-hash",
    tables: BARCLAYS_PUBLICATION_TABLES,
    parsedTablesKey: "parsed-email/v1/board-command.json",
    tableWarnings: [],
    attachmentCount: 0
  });

  const encrypted = await encryptEmployeeNumber(testEnv.EMPLOYEE_DATA_KEY, "63111");
  await testEnv.DB.prepare(
    `INSERT INTO follow_board_interests
      (id, product_id, branch_code, branch_name, employee_number_ciphertext,
       employee_number_iv, employee_number_lookup_hash, employee_number_mask,
       amount_value, currency, submission_date, source_site, created_at, updated_at)
     SELECT 'fbi_63000000-0000-4000-8000-000000000013', id, '872', '既有測試分行',
            ?, ?, ?, '63***', 100000, 'USD', ?, 'APP', ?, ?
       FROM follow_board_products WHERE product_code = 'PBZY'`
  ).bind(
    encrypted.ciphertext,
    encrypted.iv,
    await keyedHash(testEnv.EMPLOYEE_LOOKUP_KEY, "FOLLOW_BOARD_EMPLOYEE_V1:63111"),
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date()),
    now,
    now
  ).run();
});

describe("follow board", () => {
  it("accepts the exact publication command and rejects malformed commands", () => {
    expect(parseFollowBoardPublicationSubject("0730 deal-1 PBXX BMJB跟單")).toEqual({
      subjectDateMmdd: "0730",
      dealSequence: 1,
      productCode: "PBXX",
      batchCode: "BMJB"
    });
    expect(parseFollowBoardPublicationSubject("0231 deal-1 PBXX BMJB跟單")).toBeNull();
    expect(parseFollowBoardPublicationSubject("0730 deal-21 PBXX BMJB跟單")).toBeNull();
  });

  it("fails closed when one publication email contains conflicting issuer table signatures", () => {
    const bnpTable = {
      index: 1,
      rows: [
        cells(25, {
          0: "Client Ref", 1: "Product", 2: "Currency",
          12: "Coupon p.a. (%)", 24: "Remarks"
        }),
        cells(25, {
          0: "BNP-1", 1: "FCN", 2: "USD", 3: 1, 4: "AAPL UW",
          9: 85, 10: "Daily Memory", 11: 100, 12: 17.5, 13: 98,
          14: 6, 15: "EKI", 16: 70, 17: 1, 18: "Note", 19: 7
        })
      ]
    };
    expect(selectFollowBoardPublicationRow(
      [...BARCLAYS_PUBLICATION_TABLES, bnpTable],
      1
    )).toMatchObject({
      row: null,
      errorCode: "FOLLOW_BOARD_ISSUER_TABLE_AMBIGUOUS"
    });
  });

  it("fails closed when one publication email contains multiple quote tables for the same issuer", () => {
    expect(selectFollowBoardPublicationRow(
      [
        ...BARCLAYS_PUBLICATION_TABLES,
        {
          index: 1,
          rows: BARCLAYS_PUBLICATION_TABLES[0]?.rows ?? []
        }
      ],
      1
    )).toMatchObject({
      row: null,
      errorCode: "FOLLOW_BOARD_MULTIPLE_QUOTE_TABLES"
    });
  });

  it("publishes the issuer and terms detected from an external-channel table without using ranking", async () => {
    const product = await testEnv.DB.prepare(
      `SELECT product_code, issuer, parser_profile, source_rfq_id, public_snapshot_json
         FROM follow_board_products WHERE product_code = 'PBZY'`
    ).first<{
      product_code: string;
      issuer: string;
      parser_profile: string;
      source_rfq_id: string | null;
      public_snapshot_json: string;
    }>();
    expect(product).toMatchObject({
      product_code: "PBZY",
      issuer: "BARCLAYS",
      parser_profile: "BARCLAYS_FCN_V2",
      source_rfq_id: null
    });
    const snapshot = JSON.parse(product?.public_snapshot_json ?? "{}") as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      productCode: "PBZY",
      issuer: "BARCLAYS",
      couponPaPct: 18.88,
      tradeDate: "30-Jul-26",
      estimatedYieldLabel: "預估年化配息率，非保證收益"
    });
    expect(JSON.stringify(snapshot)).not.toContain(RFQ_ID);
    const command = await testEnv.DB.prepare(
      "SELECT status FROM follow_board_publication_commands WHERE inbound_message_id = ?"
    ).bind(COMMAND_INBOUND_ID).first<{ status: string }>();
    expect(command?.status).toBe("PUBLISHED");
  });

  it("fails closed when a second email tries to reuse the same product code", async () => {
    const now = new Date().toISOString();
    const inboundMessageId = "inm_63000000-0000-4000-8000-000000000014";
    const parseJobId = "job_63000000-0000-4000-8000-000000000015";
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO inbound_messages
          (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
           header_from, return_path, raw_subject, in_reply_to, authentication_results,
           raw_size_bytes, received_at, status)
         VALUES (?, 'raw-email/board-duplicate.eml', '<board-duplicate@example.invalid>',
                 'board-duplicate-hash', 'i14053@firstbank.com.tw', 'rfq@yintsun66.com',
                 'Publisher <i14053@firstbank.com.tw>', '<i14053@firstbank.com.tw>',
                 '0730 deal-1 PBZY BMJB跟單', '<board-outbound@example.invalid>',
                 'mx; dkim=pass header.d=firstbank.com.tw', 100, ?, 'PARSING')`
      ).bind(inboundMessageId, now),
      testEnv.DB.prepare(
        `INSERT INTO email_parse_jobs
          (id, inbound_message_id, idempotency_key, status, available_at, created_at, updated_at)
         VALUES (?, ?, 'FOLLOW-BOARD-DUPLICATE', 'RUNNING', ?, ?, ?)`
      ).bind(parseJobId, inboundMessageId, now, now, now)
    ]);

    await processFollowBoardPublicationEmail(testEnv, {
      command: {
        subjectDateMmdd: "0730",
        dealSequence: 1,
        productCode: "PBZY",
        batchCode: "BMJB"
      },
      normalizedSubject: "0730 deal-1 PBZY BMJB跟單",
      inboundMessageId,
      parseJobId,
      email: {
        from: { name: "Publisher", address: "i14053@firstbank.com.tw" },
        attachments: []
      } as never,
      envelopeFrom: "i14053@firstbank.com.tw",
      headerFrom: "Publisher <i14053@firstbank.com.tw>",
      returnPath: "<i14053@firstbank.com.tw>",
      authenticationResults: "mx; dkim=pass header.d=firstbank.com.tw",
      correlation: null,
      correlationEvidenceConflict: false,
      correlationEvidenceBatchCode: "BMJB",
      sourceReferenceHash: "external-thread-reference-hash",
      tables: BARCLAYS_PUBLICATION_TABLES,
      parsedTablesKey: "parsed-email/v1/board-duplicate.json",
      tableWarnings: [],
      attachmentCount: 0
    });

    const inbound = await testEnv.DB.prepare(
      "SELECT status, last_error_code FROM inbound_messages WHERE id = ?"
    ).bind(inboundMessageId).first<{ status: string; last_error_code: string }>();
    expect(inbound).toMatchObject({
      status: "MANUAL_REVIEW",
      last_error_code: "FOLLOW_BOARD_PRODUCT_CODE_EXISTS"
    });
    const count = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM follow_board_products WHERE product_code = 'PBZY'"
    ).first<{ count: number }>();
    expect(Number(count?.count ?? 0)).toBe(1);
  });

  it("requires the four-digit PIN and returns a CORS-enabled public manifest", async () => {
    const denied = await api("/api/v1/public/follow-board/manifest");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("access-control-allow-origin")).toBe(STATIC_ORIGIN);

    const allowed = await api("/api/v1/public/follow-board/manifest", {
      headers: { "x-follow-board-pin": "2580" }
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(STATIC_ORIGIN);
    const body = await allowed.json<{
      products: Array<{ productCode: string; card: Record<string, unknown> }>;
      dailyInterests: Array<{ employeeNumber: string; branchName: string }>;
    }>();
    expect(body.products[0]?.productCode).toBe("PBZY");
    expect(body.dailyInterests[0]).toMatchObject({
      employeeNumber: "63***",
      branchName: "既有測試分行"
    });
  });

  it("upserts a public follow interest and exposes the full employee number only to ADMIN", async () => {
    const submitted = await api("/api/v1/public/follow-board/interests", {
      method: "POST",
      headers: {
        "x-follow-board-pin": "2580",
        "idempotency-key": `follow-${crypto.randomUUID()}`
      },
      body: JSON.stringify({
        productCode: "PBZY",
        branchCode: "901",
        branchName: "公開測試分行",
        employeeNumber: "63222",
        amountValue: 250000
      })
    });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ employeeNumber: "63***", amountValue: 250000 });

    const admin = await api("/api/v1/admin/follow-board/interests", {
      headers: { cookie: `__Host-fcn_session=${ADMIN_TOKEN}` }
    }, "");
    expect(admin.status).toBe(200);
    const body = await admin.json<{ interests: Array<{ employeeNumber: string; branchName: string }> }>();
    expect(body.interests).toContainEqual(expect.objectContaining({
      employeeNumber: "63222",
      branchName: "公開測試分行"
    }));
  });

  it("allows ADMIN to archive a product while preserving the stored record", async () => {
    const response = await api("/api/v1/admin/follow-board/products/PBZY/archive", {
      method: "POST",
      headers: {
        origin: BASE_URL,
        cookie: `__Host-fcn_session=${ADMIN_TOKEN}; __Host-fcn_csrf=${ADMIN_CSRF}`,
        "x-csrf-token": ADMIN_CSRF
      }
    }, BASE_URL);
    expect(response.status).toBe(200);
    const row = await testEnv.DB.prepare(
      "SELECT status FROM follow_board_products WHERE product_code = 'PBZY'"
    ).first<{ status: string }>();
    expect(row?.status).toBe("ARCHIVED");
  });
});
