import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";

const testEnv = env as unknown as AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const INBOUND_ID = "inm_64000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "fbp_64000000-0000-4000-8000-000000000002";
const COMMAND_ID = "fbc_64000000-0000-4000-8000-000000000003";

beforeAll(async () => {
  const migrations = testEnv.TEST_MIGRATIONS;
  await applyD1Migrations(testEnv.DB, migrations.slice(0, -2));
  const now = new Date().toISOString();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO inbound_messages
        (id, r2_raw_mime_key, message_id, content_hash, envelope_from, envelope_to,
         raw_subject, raw_size_bytes, received_at, status)
       VALUES (?, 'raw-email/legacy-follow-board.eml', '<legacy-board@example.invalid>',
               'legacy-board-hash', 'i14053@firstbank.com.tw', 'rfq@yintsun66.com',
               '0730 deal-1 PBLG BMJB跟單', 100, ?, 'PARSED')`
    ).bind(INBOUND_ID, now),
    testEnv.DB.prepare(
      `INSERT INTO follow_board_products
        (id, product_code, status, source_inbound_message_id, source_reference_hash,
         parser_profile, source_table_index, source_row_index, batch_code, deal_sequence,
         subject_date_mmdd, issuer, trade_date, estimated_yield_pct, public_snapshot_json,
         published_by_email, published_at, created_at, updated_at)
       VALUES (?, 'PBLG', 'PUBLISHED', ?, 'legacy-reference', 'BARCLAYS_FCN_V2',
               0, 1, 'BMJB', 1, '0730', 'BARCLAYS', '30-Jul-26', 18.8,
               '{"productCode":"PBLG","currency":"USD"}',
               'i14053@firstbank.com.tw', ?, ?, ?)`
    ).bind(PRODUCT_ID, INBOUND_ID, now, now, now),
    testEnv.DB.prepare(
      `INSERT INTO follow_board_publication_commands
        (id, inbound_message_id, product_id, sender_email, product_code, batch_code,
         deal_sequence, subject_date_mmdd, status, error_code, processed_at)
       VALUES (?, ?, ?, 'i14053@firstbank.com.tw', 'PBLG', 'BMJB',
               1, '0730', 'PUBLISHED', NULL, ?)`
    ).bind(COMMAND_ID, INBOUND_ID, PRODUCT_ID, now),
    testEnv.DB.prepare(
      `INSERT INTO follow_board_interests
        (id, product_id, branch_code, branch_name, employee_number_ciphertext,
         employee_number_iv, employee_number_lookup_hash, employee_number_mask,
         amount_value, currency, submission_date, source_site, created_at, updated_at)
       VALUES ('fbi_64000000-0000-4000-8000-000000000004', ?, '872', '既有分行',
               'ciphertext', 'iv', 'lookup', '64***', 100000, 'USD',
               '2026-07-30', 'APP', ?, ?)`
    ).bind(PRODUCT_ID, now, now)
  ]);
  await applyD1Migrations(testEnv.DB, migrations.slice(-2));
});

describe("follow-board migrations 0014 and 0015", () => {
  it("preserves legacy rows, adds expiry metadata and allows one message to own many products", async () => {
    const product = await testEnv.DB.prepare(
      "SELECT product_code, source_inbound_message_id, expires_at FROM follow_board_products WHERE id = ?"
    ).bind(PRODUCT_ID).first<{
      product_code: string;
      source_inbound_message_id: string;
      expires_at: string | null;
    }>();
    expect(product).toEqual({
      product_code: "PBLG",
      source_inbound_message_id: INBOUND_ID,
      expires_at: null
    });

    const command = await testEnv.DB.prepare(
      `SELECT deal_sequence, deal_sequence_end, product_codes_json,
              declared_issuer, expiry_date_yyyymmdd
         FROM follow_board_publication_commands WHERE id = ?`
    ).bind(COMMAND_ID).first<{
      deal_sequence: number;
      deal_sequence_end: number;
      product_codes_json: string;
      declared_issuer: string | null;
      expiry_date_yyyymmdd: string | null;
    }>();
    expect(command).toEqual({
      deal_sequence: 1,
      deal_sequence_end: 1,
      product_codes_json: '["PBLG"]',
      declared_issuer: null,
      expiry_date_yyyymmdd: null
    });

    const interest = await testEnv.DB.prepare(
      "SELECT branch_name FROM follow_board_interests WHERE product_id = ?"
    ).bind(PRODUCT_ID).first<{ branch_name: string }>();
    expect(interest?.branch_name).toBe("既有分行");

    const item = await testEnv.DB.prepare(
      `SELECT command_id, product_id, item_ordinal, product_code, source_row_index
         FROM follow_board_publication_items WHERE command_id = ?`
    ).bind(COMMAND_ID).first<{
      command_id: string;
      product_id: string;
      item_ordinal: number;
      product_code: string;
      source_row_index: number;
    }>();
    expect(item).toEqual({
      command_id: COMMAND_ID,
      product_id: PRODUCT_ID,
      item_ordinal: 1,
      product_code: "PBLG",
      source_row_index: 1
    });

    const now = new Date().toISOString();
    await testEnv.DB.prepare(
      `INSERT INTO follow_board_products
        (id, product_code, status, source_inbound_message_id, source_reference_hash,
         parser_profile, source_table_index, source_row_index, batch_code, deal_sequence,
         subject_date_mmdd, issuer, trade_date, estimated_yield_pct, public_snapshot_json,
         published_by_email, published_at, created_at, updated_at)
       VALUES ('fbp_64000000-0000-4000-8000-000000000005', 'PBL2', 'PUBLISHED', ?,
               'legacy-reference', 'BARCLAYS_FCN_V2', 0, 2, 'BMJB', 2, '0730',
               'BARCLAYS', '30-Jul-26', 19.1, '{"productCode":"PBL2","currency":"USD"}',
               'i14053@firstbank.com.tw', ?, ?, ?)`
    ).bind(INBOUND_ID, now, now, now).run();

    const products = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM follow_board_products WHERE source_inbound_message_id = ?"
    ).bind(INBOUND_ID).first<{ count: number }>();
    expect(Number(products?.count ?? 0)).toBe(2);

    const foreignKeyErrors = await testEnv.DB.prepare("PRAGMA foreign_key_check").all();
    expect(foreignKeyErrors.results).toEqual([]);
  });
});
