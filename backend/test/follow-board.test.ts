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
  selectFollowBoardPublicationRows
} from "../src/follow-board-publication";
import { cleanupFollowBoardOperationalData } from "../src/follow-board";
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
               '0730 deal-1 PBZY BARCLAYS跟單20991231', '<board-outbound@example.invalid>',
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
      dealSequenceEnd: 1,
      productCode: "PBZY",
      productCodes: ["PBZY"],
      issuer: "BARCLAYS",
      batchCode: "BMJB",
      expiryDateYyyymmdd: "20991231"
    },
    normalizedSubject: "0730 deal-1 PBZY BARCLAYS跟單20991231",
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
    expect(parseFollowBoardPublicationSubject("0730 deal-03 PBZL BNP跟單20260730")).toEqual({
      subjectDateMmdd: "0730",
      dealSequence: 3,
      dealSequenceEnd: 3,
      productCode: "PBZL",
      productCodes: ["PBZL"],
      issuer: "BNP",
      batchCode: "BMJB",
      expiryDateYyyymmdd: "20260730"
    });
    expect(parseFollowBoardPublicationSubject(
      "0730 deal-2~4 PBZB, PBZC, PBZD SG跟單20260731"
    )).toEqual({
      subjectDateMmdd: "0730",
      dealSequence: 2,
      dealSequenceEnd: 4,
      productCode: "PBZB",
      productCodes: ["PBZB", "PBZC", "PBZD"],
      issuer: "SG",
      batchCode: "SG",
      expiryDateYyyymmdd: "20260731"
    });
    expect(parseFollowBoardPublicationSubject(
      "0728 deal2~4 PBZB, PBZC, PBZD, CA跟單20260815"
    )).toEqual({
      subjectDateMmdd: "0728",
      dealSequence: 2,
      dealSequenceEnd: 4,
      productCode: "PBZB",
      productCodes: ["PBZB", "PBZC", "PBZD"],
      issuer: "CA",
      batchCode: "CA",
      expiryDateYyyymmdd: "20260815"
    });
    expect(parseFollowBoardPublicationSubject("0231 deal-1 PBXX BNP跟單20260730")).toBeNull();
    expect(parseFollowBoardPublicationSubject("0730 deal-21 PBXX BNP跟單20260730")).toBeNull();
    expect(parseFollowBoardPublicationSubject(
      "0730 deal-2~4 PBZB, PBZC BNP跟單20260730"
    )).toBeNull();
    expect(parseFollowBoardPublicationSubject(
      "0730 deal-2~4 PBZB, PBZB, PBZD BNP跟單20260730"
    )).toBeNull();
    expect(parseFollowBoardPublicationSubject("0730 deal-1 PBXX BNP跟單20260230")).toBeNull();
    expect(parseFollowBoardPublicationSubject("0730 deal-1 PBXX BMJB跟單")).toBeNull();
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
    expect(selectFollowBoardPublicationRows(
      [...BARCLAYS_PUBLICATION_TABLES, bnpTable],
      1
    )).toMatchObject({
      rows: [],
      errorCode: "FOLLOW_BOARD_ISSUER_TABLE_AMBIGUOUS"
    });
  });

  it("ignores deal sequence, duplicate quote copies and the forwarded request table", () => {
    const forwardedRequest = {
      index: 4,
      rows: [
        [
          "Product", "Currency", "Guaranteed Periods (m)", "BBG Code 1", "BBG Code 2",
          "BBG Code 3", "BBG Code 4", "BBG Code 5", "Strike (%)", "KO Type",
          "KO Barrier (%)", "Coupon p.a. (%)", "Upfront / NotePrice (%)", "Tenor (m)",
          "Barrier Type", "KI Barrier (%)", "Observation Frequency (m)", "OTC",
          "Effective Date Offset (Calendar Days)", "Trade Date"
        ],
        cells(20, {
          0: "FCN", 1: "USD", 2: 1, 3: "AAPL UW", 4: "MSFT UW",
          8: 85, 9: "Daily Memory", 10: 100, 11: 18.88,
          13: 6, 14: "EKI", 15: 70, 16: 1, 17: "Note", 18: 7
        })
      ]
    };
    expect(selectFollowBoardPublicationRows(
      [
        ...BARCLAYS_PUBLICATION_TABLES,
        {
          index: 1,
          rows: BARCLAYS_PUBLICATION_TABLES[0]?.rows ?? []
        },
        forwardedRequest
      ],
      1
    )).toMatchObject({
      rows: [{
        issuer: "BARCLAYS", couponPaPct: 18.88, sourceTableIndex: 0
      }],
      errorCode: null
    });
  });

  it("fails closed when one publication email contains different complete quotes", () => {
    const secondQuote = {
      index: 1,
      rows: [
        BARCLAYS_PUBLICATION_TABLES[0]?.rows[0] ?? [],
        cells(25, {
          0: "FCN", 1: "USD", 2: 1, 3: "AAPL UW", 4: "MSFT UW",
          8: 85, 9: "Daily Memory", 10: 100, 11: 19.25, 12: 98,
          13: 6, 14: "EKI", 15: 70, 16: 1, 17: "Note", 18: 7,
          19: 10_000_000, 24: "BARCLAYS-EXTERNAL-2"
        })
      ]
    };
    expect(selectFollowBoardPublicationRows(
      [...BARCLAYS_PUBLICATION_TABLES, secondQuote],
      1
    )).toMatchObject({
      rows: [],
      errorCode: "FOLLOW_BOARD_MULTIPLE_COMPLETE_QUOTES"
    });
  });

  it("selects the matching front publication table ahead of a larger forwarded BNP table", () => {
    const selectedHeaders = [
      "Client Ref", "Product", "Currency", "Guaranteed Periods (m)",
      "BBG Code 1", "BBG Code 2", "BBG Code 3", "BBG Code 4", "BBG Code 5",
      "Strike (%)", "KO Type", "KO Barrier (%)", "Coupon p.a. (%)",
      "Upfront / NotePrice (%)", "Tenor (m)", "Barrier Type", "KI Barrier (%)",
      "Observation Frequency (m)", "OTC", "Effective Date Offset(Calendar Days)",
      "Trade Date", "Issue date", "Redemption Valuation Date", "Redemption date"
    ];
    const completedHeaders = [...selectedHeaders, "Remarks"];
    const bnpQuote = (
      reference: string,
      currency: string,
      firstUnderlying: string,
      secondUnderlying: string,
      coupon: number
    ) => cells(25, {
      0: reference, 1: "FCN", 2: currency, 3: 1,
      4: firstUnderlying, 5: secondUnderlying,
      9: 60, 10: "Daily Memory", 11: 100, 12: coupon, 13: 97.5,
      14: 6, 15: "EKI", 16: 50, 17: 1, 18: "Note", 19: 7
    });
    const selectedRows = [
      bnpQuote("BNP-PUBLISH-001", "JPY", "AAA UW", "BBB UW", 13.64),
      bnpQuote("BNP-PUBLISH-002", "CNH", "CCC UW", "DDD UW", 6.89),
      bnpQuote("BNP-PUBLISH-004", "USD", "EEE UW", "FFF UW", 13.49)
    ];
    const forwardedRows = [
      ...selectedRows,
      bnpQuote("BNP-HISTORY-003", "JPY", "GGG UW", "HHH UW", 7.04),
      bnpQuote("BNP-HISTORY-005", "CNH", "III UW", "JJJ UW", 14.1),
      bnpQuote("BNP-HISTORY-006", "USD", "KKK UW", "LLL UW", 15.54)
    ];

    expect(selectFollowBoardPublicationRows([
      { index: 0, rows: [selectedHeaders, ...selectedRows] },
      { index: 1, rows: [selectedHeaders, ...selectedRows] },
      { index: 2, rows: [completedHeaders, ...forwardedRows] }
    ], 3)).toMatchObject({
      rows: [
        { sourceTableIndex: 0, sourceRowIndex: 1, couponPaPct: 13.64 },
        { sourceTableIndex: 0, sourceRowIndex: 2, couponPaPct: 6.89 },
        { sourceTableIndex: 0, sourceRowIndex: 3, couponPaPct: 13.49 }
      ],
      errorCode: null
    });
  });

  it("recognizes a complete BNP table containing escaped non-breaking spaces", () => {
    const headers = [
      "Client Ref", "Product", "Currency", "Guaranteed Periods (m)&nbsp;",
      "BBG Code 1", "BBG Code 2", "BBG Code 3", "BBG Code 4", "BBG Code 5",
      "Strike (%)&nbsp;", "KO Type", "KO Barrier (%)", "Coupon p.a. (%)&nbsp;",
      "Upfront / NotePrice (%)&nbsp;", "Tenor (m)", "Barrier Type",
      "KI Barrier (%)&nbsp;", "Observation Frequency (m)", "OTC",
      "Effective Date Offset(Calendar Days)&nbsp;", "Trade Date", "Issue date",
      "Redemption Valuation Date", "Redemption date", "Remarks"
    ];
    const quote = cells(25, {
      0: "BNP-ENTITY-001", 1: "FCN", 2: "USD", 3: 1,
      4: "AAA UW", 5: "BBB UN", 6: "CCC UW",
      9: "&nbsp;85.00", 10: "Daily Memory", 11: "&nbsp;110.00",
      12: "&nbsp;50.00", 13: "97.19", 14: 3, 15: "EKI",
      16: "&nbsp;70.00", 17: 1, 18: "Note", 19: 7
    });

    expect(selectFollowBoardPublicationRows([
      { index: 0, rows: [headers, quote] }
    ], 1)).toMatchObject({
      rows: [{
        issuer: "BNP",
        strikePct: 85,
        koBarrierPct: 110,
        couponPaPct: 50,
        comparablePricePct: 97.19,
        kiBarrierPct: 70
      }],
      errorCode: null
    });
  });

  it("publishes the issuer and terms detected from an external-channel table without using ranking", async () => {
    const product = await testEnv.DB.prepare(
      `SELECT product_code, issuer, parser_profile, source_rfq_id, expires_at, public_snapshot_json
         FROM follow_board_products WHERE product_code = 'PBZY'`
    ).first<{
      product_code: string;
      issuer: string;
      parser_profile: string;
      source_rfq_id: string | null;
      expires_at: string;
      public_snapshot_json: string;
    }>();
    expect(product).toMatchObject({
      product_code: "PBZY",
      issuer: "BARCLAYS",
      parser_profile: "BARCLAYS_FCN_V2",
      source_rfq_id: null,
      expires_at: "2099-12-31T16:00:00.000Z"
    });
    const snapshot = JSON.parse(product?.public_snapshot_json ?? "{}") as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      productCode: "PBZY",
      issuer: "BARCLAYS",
      couponPaPct: 18.88,
      tradeDate: "30-Jul-26",
      expiresAt: "2099-12-31T16:00:00.000Z",
      estimatedYieldLabel: "預估年化配息率，非保證收益"
    });
    expect(snapshot).not.toHaveProperty("sequence");
    expect(snapshot).not.toHaveProperty("tradeCode");
    expect(JSON.stringify(snapshot)).not.toContain(RFQ_ID);
    const command = await testEnv.DB.prepare(
      `SELECT status, declared_issuer, expiry_date_yyyymmdd
         FROM follow_board_publication_commands WHERE inbound_message_id = ?`
    ).bind(COMMAND_INBOUND_ID).first<{
      status: string;
      declared_issuer: string;
      expiry_date_yyyymmdd: string;
    }>();
    expect(command).toMatchObject({
      status: "PUBLISHED",
      declared_issuer: "BARCLAYS",
      expiry_date_yyyymmdd: "20991231"
    });
  });

  it("rejects a subject issuer that does not match the detected quote table", async () => {
    const now = new Date().toISOString();
    const inboundMessageId = "inm_63000000-0000-4000-8000-000000000021";
    const parseJobId = "job_63000000-0000-4000-8000-000000000022";
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO inbound_messages
          (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
           header_from, return_path, raw_subject, in_reply_to, authentication_results,
           raw_size_bytes, received_at, status)
         VALUES (?, 'raw-email/board-issuer-mismatch.eml', '<board-issuer-mismatch@example.invalid>',
                 'board-issuer-mismatch-hash', 'i14053@firstbank.com.tw', 'rfq@yintsun66.com',
                 'Publisher <i14053@firstbank.com.tw>', '<i14053@firstbank.com.tw>',
                 '0730 deal-1 PBMI BNP跟單20991231', '<board-outbound@example.invalid>',
                 'mx; dkim=pass header.d=firstbank.com.tw', 100, ?, 'PARSING')`
      ).bind(inboundMessageId, now),
      testEnv.DB.prepare(
        `INSERT INTO email_parse_jobs
          (id, inbound_message_id, idempotency_key, status, available_at, created_at, updated_at)
         VALUES (?, ?, 'FOLLOW-BOARD-ISSUER-MISMATCH', 'RUNNING', ?, ?, ?)`
      ).bind(parseJobId, inboundMessageId, now, now, now)
    ]);

    await processFollowBoardPublicationEmail(testEnv, {
      command: {
        subjectDateMmdd: "0730",
        dealSequence: 1,
        dealSequenceEnd: 1,
        productCode: "PBMI",
        productCodes: ["PBMI"],
        issuer: "BNP",
        batchCode: "BMJB",
        expiryDateYyyymmdd: "20991231"
      },
      normalizedSubject: "0730 deal-1 PBMI BNP跟單20991231",
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
      sourceReferenceHash: "issuer-mismatch-reference-hash",
      tables: BARCLAYS_PUBLICATION_TABLES,
      parsedTablesKey: "parsed-email/v1/board-issuer-mismatch.json",
      tableWarnings: [],
      attachmentCount: 0
    });

    const inbound = await testEnv.DB.prepare(
      "SELECT status, last_error_code FROM inbound_messages WHERE id = ?"
    ).bind(inboundMessageId).first<{ status: string; last_error_code: string }>();
    expect(inbound).toEqual({
      status: "MANUAL_REVIEW",
      last_error_code: "FOLLOW_BOARD_TABLE_ISSUER_MISMATCH"
    });
    const product = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM follow_board_products WHERE product_code = 'PBMI'"
    ).first<{ count: number }>();
    expect(Number(product?.count ?? 0)).toBe(0);
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
                 '0730 deal-1 PBZY BARCLAYS跟單20991231', '<board-outbound@example.invalid>',
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
        dealSequenceEnd: 1,
        productCode: "PBZY",
        productCodes: ["PBZY"],
        issuer: "BARCLAYS",
        batchCode: "BMJB",
        expiryDateYyyymmdd: "20991231"
      },
      normalizedSubject: "0730 deal-1 PBZY BARCLAYS跟單20991231",
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
      products: Array<{ productCode: string; expiresAt: string; card: Record<string, unknown> }>;
      dailyInterests: Array<{ employeeNumber: string; branchName: string }>;
    }>();
    expect(body.products[0]?.productCode).toBe("PBZY");
    expect(body.products[0]?.expiresAt).toBe("2099-12-31T16:00:00.000Z");
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

  it("publishes one email with multiple completed quotes atomically in listed code order", async () => {
    const now = new Date().toISOString();
    const inboundMessageId = "inm_63000000-0000-4000-8000-000000000016";
    const parseJobId = "job_63000000-0000-4000-8000-000000000017";
    const headers = BARCLAYS_PUBLICATION_TABLES[0]?.rows[0] ?? [];
    const quoteRows = [
      cells(25, {
        0: "FCN", 1: "USD", 2: 1, 3: "AAPL UW", 4: "MSFT UW",
        8: 85, 9: "Daily Memory", 10: 100, 11: 18.1, 12: 98,
        13: 6, 14: "EKI", 15: 70, 16: 1, 17: "Note", 18: 7,
        19: 10_000_000, 24: "BARCLAYS-MULTI-1"
      }),
      cells(25, {
        0: "FCN", 1: "USD", 2: 1, 3: "NVDA UW", 4: "TSM UN",
        8: 80, 9: "Daily Memory", 10: 100, 11: 19.2, 12: 98,
        13: 6, 14: "EKI", 15: 65, 16: 1, 17: "Note", 18: 7,
        19: 10_000_000, 24: "BARCLAYS-MULTI-2"
      }),
      cells(25, {
        0: "FCN", 1: "USD", 2: 1, 3: "AMD UW", 4: "AVGO UW",
        8: 75, 9: "Daily Memory", 10: 100, 11: 20.3, 12: 98,
        13: 6, 14: "EKI", 15: 60, 16: 1, 17: "Note", 18: 7,
        19: 10_000_000, 24: "BARCLAYS-MULTI-3"
      })
    ];
    const completedTable = { index: 10, rows: [headers, ...quoteRows] };
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO inbound_messages
          (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
           header_from, return_path, raw_subject, in_reply_to, authentication_results,
           raw_size_bytes, received_at, status)
         VALUES (?, 'raw-email/board-multi.eml', '<board-multi@example.invalid>',
                 'board-multi-hash', 'i14053@firstbank.com.tw', 'rfq@yintsun66.com',
                 'Publisher <i14053@firstbank.com.tw>', '<i14053@firstbank.com.tw>',
                 '0730 deal-2~4 PBZB, PBZC, PBZD BARCLAYS跟單20991231',
                 '<board-multi-source@example.invalid>',
                 'mx; dkim=pass header.d=firstbank.com.tw', 100, ?, 'PARSING')`
      ).bind(inboundMessageId, now),
      testEnv.DB.prepare(
        `INSERT INTO email_parse_jobs
          (id, inbound_message_id, idempotency_key, status, available_at, created_at, updated_at)
         VALUES (?, ?, 'FOLLOW-BOARD-MULTI', 'RUNNING', ?, ?, ?)`
      ).bind(parseJobId, inboundMessageId, now, now, now)
    ]);

    await processFollowBoardPublicationEmail(testEnv, {
      command: {
        subjectDateMmdd: "0730",
        dealSequence: 2,
        dealSequenceEnd: 4,
        productCode: "PBZB",
        productCodes: ["PBZB", "PBZC", "PBZD"],
        issuer: "BARCLAYS",
        batchCode: "BMJB",
        expiryDateYyyymmdd: "20991231"
      },
      normalizedSubject: "0730 deal-2~4 PBZB, PBZC, PBZD BARCLAYS跟單20991231",
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
      sourceReferenceHash: "external-multi-thread-reference-hash",
      tables: [
        completedTable,
        { index: 11, rows: [headers, ...quoteRows] }
      ],
      parsedTablesKey: "parsed-email/v1/board-multi.json",
      tableWarnings: [],
      attachmentCount: 0
    });

    const products = await testEnv.DB.prepare(
      `SELECT product_code, deal_sequence, estimated_yield_pct, source_inbound_message_id
         FROM follow_board_products
        WHERE product_code IN ('PBZB', 'PBZC', 'PBZD')
        ORDER BY deal_sequence`
    ).all<{
      product_code: string;
      deal_sequence: number;
      estimated_yield_pct: number;
      source_inbound_message_id: string;
    }>();
    expect(products.results).toEqual([
      {
        product_code: "PBZB", deal_sequence: 2, estimated_yield_pct: 18.1,
        source_inbound_message_id: inboundMessageId
      },
      {
        product_code: "PBZC", deal_sequence: 3, estimated_yield_pct: 19.2,
        source_inbound_message_id: inboundMessageId
      },
      {
        product_code: "PBZD", deal_sequence: 4, estimated_yield_pct: 20.3,
        source_inbound_message_id: inboundMessageId
      }
    ]);

    const command = await testEnv.DB.prepare(
      `SELECT id, product_code, deal_sequence, deal_sequence_end, product_codes_json, status
         FROM follow_board_publication_commands
        WHERE inbound_message_id = ?`
    ).bind(inboundMessageId).first<{
      id: string;
      product_code: string;
      deal_sequence: number;
      deal_sequence_end: number;
      product_codes_json: string;
      status: string;
    }>();
    expect(command).toMatchObject({
      product_code: "PBZB",
      deal_sequence: 2,
      deal_sequence_end: 4,
      status: "PUBLISHED"
    });
    expect(JSON.parse(command?.product_codes_json ?? "[]")).toEqual(["PBZB", "PBZC", "PBZD"]);

    const items = await testEnv.DB.prepare(
      `SELECT item_ordinal, product_code
         FROM follow_board_publication_items
        WHERE command_id = ?
        ORDER BY item_ordinal`
    ).bind(command?.id ?? "").all<{ item_ordinal: number; product_code: string }>();
    expect(items.results).toEqual([
      { item_ordinal: 1, product_code: "PBZB" },
      { item_ordinal: 2, product_code: "PBZC" },
      { item_ordinal: 3, product_code: "PBZD" }
    ]);
  });

  it("publishes none of a multi-product command when any product code already exists", async () => {
    const now = new Date().toISOString();
    const inboundMessageId = "inm_63000000-0000-4000-8000-000000000018";
    const parseJobId = "job_63000000-0000-4000-8000-000000000019";
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO inbound_messages
          (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
           header_from, return_path, raw_subject, in_reply_to, authentication_results,
           raw_size_bytes, received_at, status)
         VALUES (?, 'raw-email/board-multi-duplicate.eml',
                 '<board-multi-duplicate@example.invalid>', 'board-multi-duplicate-hash',
                 'i14053@firstbank.com.tw', 'rfq@yintsun66.com',
                 'Publisher <i14053@firstbank.com.tw>', '<i14053@firstbank.com.tw>',
                 '0730 deal-1~2 PBZY, PBEA BARCLAYS跟單20991231',
                 '<board-multi-duplicate-source@example.invalid>',
                 'mx; dkim=pass header.d=firstbank.com.tw', 100, ?, 'PARSING')`
      ).bind(inboundMessageId, now),
      testEnv.DB.prepare(
        `INSERT INTO email_parse_jobs
          (id, inbound_message_id, idempotency_key, status, available_at, created_at, updated_at)
         VALUES (?, ?, 'FOLLOW-BOARD-MULTI-DUPLICATE', 'RUNNING', ?, ?, ?)`
      ).bind(parseJobId, inboundMessageId, now, now, now)
    ]);

    await processFollowBoardPublicationEmail(testEnv, {
      command: {
        subjectDateMmdd: "0730",
        dealSequence: 1,
        dealSequenceEnd: 2,
        productCode: "PBZY",
        productCodes: ["PBZY", "PBEA"],
        issuer: "BARCLAYS",
        batchCode: "BMJB",
        expiryDateYyyymmdd: "20991231"
      },
      normalizedSubject: "0730 deal-1~2 PBZY, PBEA BARCLAYS跟單20991231",
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
      sourceReferenceHash: "external-multi-duplicate-reference-hash",
      tables: BARCLAYS_PUBLICATION_TABLES,
      parsedTablesKey: "parsed-email/v1/board-multi-duplicate.json",
      tableWarnings: [],
      attachmentCount: 0
    });

    const inbound = await testEnv.DB.prepare(
      "SELECT status, last_error_code FROM inbound_messages WHERE id = ?"
    ).bind(inboundMessageId).first<{ status: string; last_error_code: string }>();
    expect(inbound).toEqual({
      status: "MANUAL_REVIEW",
      last_error_code: "FOLLOW_BOARD_PRODUCT_CODE_EXISTS"
    });
    const unpublished = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM follow_board_products WHERE product_code = 'PBEA'"
    ).first<{ count: number }>();
    expect(Number(unpublished?.count ?? 0)).toBe(0);
  });

  it("hides expired products immediately and archives them without deleting audit data", async () => {
    const now = new Date().toISOString();
    await testEnv.DB.prepare(
      `INSERT INTO follow_board_products
        (id, product_code, status, source_inbound_message_id, source_reference_hash,
         parser_profile, source_table_index, source_row_index, batch_code, deal_sequence,
         subject_date_mmdd, issuer, trade_date, estimated_yield_pct, public_snapshot_json,
         published_by_email, published_at, expires_at, created_at, updated_at)
       VALUES ('fbp_63000000-0000-4000-8000-000000000020', 'PBEX', 'PUBLISHED', ?,
               'expired-reference', 'BARCLAYS_FCN_V2', 0, 1, 'BMJB', 1, '0730',
               'BARCLAYS', '30-Jul-26', 18.8, '{"productCode":"PBEX","currency":"USD"}',
               'i14053@firstbank.com.tw', ?, '2000-01-01T16:00:00.000Z', ?, ?)`
    ).bind(COMMAND_INBOUND_ID, now, now, now).run();

    const manifest = await api("/api/v1/public/follow-board/manifest", {
      headers: { "x-follow-board-pin": "2580" }
    });
    const manifestBody = await manifest.json<{ products: Array<{ productCode: string }> }>();
    expect(manifestBody.products.map(product => product.productCode)).not.toContain("PBEX");

    await cleanupFollowBoardOperationalData(testEnv);
    const product = await testEnv.DB.prepare(
      "SELECT status, archived_at FROM follow_board_products WHERE product_code = 'PBEX'"
    ).first<{ status: string; archived_at: string | null }>();
    expect(product?.status).toBe("ARCHIVED");
    expect(product?.archived_at).not.toBeNull();

    const audit = await testEnv.DB.prepare(
      `SELECT action FROM audit_events
        WHERE entity_id = 'fbp_63000000-0000-4000-8000-000000000020'
        ORDER BY created_at DESC LIMIT 1`
    ).first<{ action: string }>();
    expect(audit?.action).toBe("FOLLOW_BOARD_PRODUCT_EXPIRED");
  });
});
