import type { Address, Email } from "postal-mime";
import { newId, nowIso } from "./db";
import {
  detectIssuerTableProfiles,
  type ParsedIssuerRow
} from "./issuer-profiles";
import type { AppEnv, MailBatchCode } from "./types";

export const FOLLOW_BOARD_PUBLICATION_VERSION = "follow-board-publication-v2";

const AUTHORIZED_PUBLISHERS = new Set([
  "i14053@firstbank.com.tw",
  "i97293@firstbank.com.tw",
  "i11147@firstbank.com.tw"
]);

const ISSUER_BATCH: Readonly<Record<string, MailBatchCode>> = Object.freeze({
  BNP: "BMJB",
  MS: "BMJB",
  JPM: "BMJB",
  BARCLAYS: "BMJB",
  NOMURA: "NOMURA",
  UBS: "UBS",
  DBS: "DBS",
  SG: "SG",
  CITI: "CITI",
  GS: "GS",
  CA: "CA"
});

export interface FollowBoardPublicationCommand {
  subjectDateMmdd: string;
  dealSequence: number;
  productCode: string;
  batchCode: MailBatchCode;
}

export interface FollowBoardCorrelation {
  rfqId: string;
  batchId: string;
  batchCode: MailBatchCode;
  source: "TOKEN" | "BODY_TOKEN" | "REPLY_HEADER";
  tokenHash: string | null;
}

interface PublicationInput {
  command: FollowBoardPublicationCommand;
  normalizedSubject: string;
  inboundMessageId: string;
  parseJobId: string;
  email: Email;
  envelopeFrom: string;
  headerFrom: string | null;
  returnPath: string | null;
  authenticationResults: string | null;
  correlation: FollowBoardCorrelation | null;
  correlationEvidenceConflict: boolean;
  correlationEvidenceBatchCode: MailBatchCode | null;
  sourceReferenceHash: string | null;
  tables: Array<{ index: number; rows: string[][] }>;
  parsedTablesKey: string;
  tableWarnings: string[];
  attachmentCount: number;
}

interface PublicationFailure {
  inboundStatus: "MANUAL_REVIEW" | "SENDER_MISMATCH" | "UNMATCHED_RFQ";
  commandStatus: "MANUAL_REVIEW" | "REJECTED";
  errorCode: string;
}

function validMmdd(value: string): boolean {
  if (!/^\d{4}$/.test(value)) return false;
  const month = Number(value.slice(0, 2));
  const day = Number(value.slice(2));
  const date = new Date(Date.UTC(2000, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseFollowBoardPublicationSubject(subject: string): FollowBoardPublicationCommand | null {
  const withoutCorrelation = subject.replace(
    /\s*\[RFQ:[A-Za-z0-9_-]{10,128}\]\s*\[BATCH:(?:BMJB|NOMURA|UBS|DBS|SG|CITI|GS|CA)\]\s*$/iu,
    ""
  ).trim();
  const match = /^(\d{4})\s+deal-(\d{1,2})\s+([A-Z0-9]{4,12})\s+(BMJB|NOMURA|UBS|DBS|SG|CITI|GS|CA)\s*跟單$/iu
    .exec(withoutCorrelation);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !validMmdd(match[1])) return null;
  const dealSequence = Number(match[2]);
  if (!Number.isInteger(dealSequence) || dealSequence < 1 || dealSequence > 20) return null;
  return {
    subjectDateMmdd: match[1],
    dealSequence,
    productCode: match[3].toUpperCase(),
    batchCode: match[4].toUpperCase() as MailBatchCode
  };
}

function addresses(address: Address | undefined): string[] {
  if (!address) return [];
  if (Array.isArray(address.group)) return address.group.map(item => item.address.toLowerCase());
  return typeof address.address === "string" ? [address.address.toLowerCase()] : [];
}

function addressesIn(value: string): string[] {
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)]
    .map(match => match[0]?.toLowerCase())
    .filter((address): address is string => Boolean(address));
}

function authenticatedFirstBank(authenticationResults: string): boolean {
  const normalized = authenticationResults.normalize("NFKC");
  const dkimPass = /dkim\s*=\s*pass\b[^;\r\n]{0,500}?header\.d\s*=\s*(?:[A-Z0-9.-]+\.)?firstbank\.com\.tw\b/iu
    .test(normalized);
  const spfPass = /spf\s*=\s*pass\b[^;\r\n]{0,500}?(?:smtp\.mailfrom|mailfrom|envelope-from)\s*[=:]\s*<?[^;>\s]*@?firstbank\.com\.tw\b/iu
    .test(normalized);
  return dkimPass || spfPass;
}

function trustedPublisher(input: PublicationInput): string | null {
  const candidates = new Set([
    ...addresses(input.email.from),
    ...addresses(input.email.sender),
    ...addressesIn(input.envelopeFrom),
    ...addressesIn(input.headerFrom ?? ""),
    ...addressesIn(input.returnPath ?? "")
  ]);
  const publisher = [...candidates].find(address => AUTHORIZED_PUBLISHERS.has(address)) ?? null;
  return publisher && authenticatedFirstBank(input.authenticationResults ?? "") ? publisher : null;
}

interface PublicationTableSelection {
  row: ParsedIssuerRow | null;
  errorCode: string | null;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function validatePublicationRow(row: ParsedIssuerRow): string | null {
  if (row.rejectionReason) return "FOLLOW_BOARD_QUOTE_REJECTED";
  if (!finite(row.couponPaPct)) return "FOLLOW_BOARD_COUPON_NOT_AVAILABLE";
  const requiredNumbers = [
    row.tenorMonths,
    row.guaranteedPeriodsMonths,
    row.strikePct,
    row.koBarrierPct,
    row.comparablePricePct,
    row.observationFrequencyMonths
  ];
  if (requiredNumbers.some(value => !finite(value))
    || !row.product
    || !row.currency
    || row.underlyings.length === 0
    || !row.koType
    || !row.barrierType
    || (row.barrierType !== "NONE" && !finite(row.kiBarrierPct))) {
    return "FOLLOW_BOARD_QUOTE_INCOMPLETE";
  }
  return null;
}

export function selectFollowBoardPublicationRow(
  tables: Array<{ index: number; rows: string[][] }>,
  dealSequence: number
): PublicationTableSelection {
  const profiles = detectIssuerTableProfiles({ tables });
  if (profiles.length === 0) {
    return { row: null, errorCode: "FOLLOW_BOARD_ISSUER_TABLE_NOT_RECOGNIZED" };
  }
  if (profiles.length > 1) {
    return { row: null, errorCode: "FOLLOW_BOARD_ISSUER_TABLE_AMBIGUOUS" };
  }
  if (profiles[0]?.tableIndexes.length !== 1) {
    return { row: null, errorCode: "FOLLOW_BOARD_MULTIPLE_QUOTE_TABLES" };
  }
  const recognizedTableIndex = profiles[0].tableIndexes[0];
  const rows = profiles[0].rows.filter(row => row.sourceTableIndex === recognizedTableIndex);
  const row = rows[dealSequence - 1] ?? null;
  if (!row) return { row: null, errorCode: "FOLLOW_BOARD_DEAL_ROW_NOT_FOUND" };
  return { row, errorCode: validatePublicationRow(row) };
}

function tradeDateFromSubject(subjectDateMmdd: string, publishedAt: string): string {
  const month = Number(subjectDateMmdd.slice(0, 2));
  const day = Number(subjectDateMmdd.slice(2));
  const published = new Date(publishedAt);
  const baseYear = published.getUTCFullYear();
  const candidates = [baseYear - 1, baseYear, baseYear + 1]
    .map(year => new Date(Date.UTC(year, month - 1, day)))
    .sort((left, right) =>
      Math.abs(left.getTime() - published.getTime()) - Math.abs(right.getTime() - published.getTime())
    );
  const selected = candidates[0] ?? published;
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    [selected.getUTCMonth()] ?? "";
  return `${String(selected.getUTCDate()).padStart(2, "0")}-${monthName}-${String(selected.getUTCFullYear()).slice(-2)}`;
}

async function completeFailure(
  env: AppEnv,
  input: PublicationInput,
  publisher: string | null,
  failure: PublicationFailure
): Promise<void> {
  const processedAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO follow_board_publication_commands
        (id, inbound_message_id, product_id, sender_email, product_code, batch_code,
         deal_sequence, subject_date_mmdd, status, error_code, processed_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newId("fbc"),
      input.inboundMessageId,
      publisher,
      input.command.productCode,
      input.command.batchCode,
      input.command.dealSequence,
      input.command.subjectDateMmdd,
      failure.commandStatus,
      failure.errorCode,
      processedAt
    ),
    env.DB.prepare(
      `UPDATE inbound_messages
          SET normalized_subject = ?, subject_batch_code = ?, sender_evidence_json = ?,
              rfq_id = ?, correlated_batch_id = ?, correlation_source = ?,
              correlation_token_hash = ?, r2_parsed_tables_key = ?,
              html_table_count = ?, attachment_count = ?, status = ?,
              parser_version = ?, parsed_at = ?, last_error_code = ?
        WHERE id = ?`
    ).bind(
      input.normalizedSubject,
      input.command.batchCode,
      JSON.stringify(publisher ? [{ source: "FOLLOW_BOARD_PUBLISHER", address: publisher }] : []),
      input.correlation?.rfqId ?? null,
      input.correlation?.batchId ?? null,
      input.correlation?.source === "BODY_TOKEN" ? "TOKEN" : input.correlation?.source ?? null,
      input.correlation?.tokenHash ?? null,
      input.parsedTablesKey,
      input.tables.length,
      input.attachmentCount,
      failure.inboundStatus,
      FOLLOW_BOARD_PUBLICATION_VERSION,
      processedAt,
      failure.errorCode,
      input.inboundMessageId
    ),
    env.DB.prepare(
      `UPDATE email_parse_jobs
          SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
              lease_expires_at = NULL, last_error_code = ?
        WHERE id = ?`
    ).bind(processedAt, processedAt, failure.errorCode, input.parseJobId),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'FOLLOW_BOARD_PUBLICATION_REJECTED', 'INBOUND_MESSAGE', ?, ?, ?, ?)`
    ).bind(
      newId("aud"),
      input.inboundMessageId,
      `queue:${input.parseJobId}`,
      JSON.stringify({
        errorCode: failure.errorCode,
        productCode: input.command.productCode,
        batchCode: input.command.batchCode,
        dealSequence: input.command.dealSequence
      }),
      processedAt
    )
  ]);
}

export async function processFollowBoardPublicationEmail(
  env: AppEnv,
  input: PublicationInput
): Promise<void> {
  const publisher = trustedPublisher(input);
  if (!publisher) {
    await completeFailure(env, input, null, {
      inboundStatus: "SENDER_MISMATCH",
      commandStatus: "REJECTED",
      errorCode: "FOLLOW_BOARD_PUBLISHER_NOT_AUTHORIZED"
    });
    return;
  }
  if (input.correlationEvidenceConflict) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_SOURCE_REFERENCE_CONFLICT"
    });
    return;
  }
  if (!input.sourceReferenceHash) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_SOURCE_REFERENCE_MISSING"
    });
    return;
  }
  if ((input.correlationEvidenceBatchCode
      && input.correlationEvidenceBatchCode !== input.command.batchCode)
    || (input.correlation && input.correlation.batchCode !== input.command.batchCode)) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_BATCH_MISMATCH"
    });
    return;
  }
  const duplicate = await env.DB.prepare(
    "SELECT id FROM follow_board_products WHERE product_code = ? COLLATE NOCASE"
  ).bind(input.command.productCode).first<{ id: string }>();
  if (duplicate) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_PRODUCT_CODE_EXISTS"
    });
    return;
  }
  const selection = selectFollowBoardPublicationRow(input.tables, input.command.dealSequence);
  if (!selection.row || selection.errorCode) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: selection.errorCode ?? "FOLLOW_BOARD_ISSUER_TABLE_NOT_RECOGNIZED"
    });
    return;
  }
  const quote = selection.row;
  if (ISSUER_BATCH[quote.issuer] !== input.command.batchCode) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_TABLE_BATCH_MISMATCH"
    });
    return;
  }

  const publishedAt = nowIso();
  const tradeDate = tradeDateFromSubject(input.command.subjectDateMmdd, publishedAt);
  const productId = newId("fbp");
  const snapshot = {
    schemaVersion: 1,
    productCode: input.command.productCode,
    sequence: input.command.dealSequence,
    tradeCode: `T${String(input.command.dealSequence).padStart(2, "0")}`,
    product: quote.product,
    currency: quote.currency,
    issuer: quote.issuer,
    issuerDisplayName: quote.issuerDisplayName,
    tradeDate,
    tenorMonths: quote.tenorMonths,
    guaranteedPeriodsMonths: quote.guaranteedPeriodsMonths,
    underlyings: quote.underlyings.slice(0, 6),
    couponPaPct: quote.couponPaPct,
    strikePct: quote.strikePct,
    koBarrierPct: quote.koBarrierPct,
    koType: quote.koType,
    barrierType: quote.barrierType,
    kiBarrierPct: quote.kiBarrierPct,
    comparablePricePct: quote.comparablePricePct,
    estimatedYieldLabel: "預估年化配息率，非保證收益"
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO follow_board_products
        (id, product_code, status, source_rfq_id, source_outbound_batch_id,
         source_inbound_message_id, source_reference_hash, parser_profile,
         source_table_index, source_row_index, batch_code, deal_sequence,
         subject_date_mmdd, issuer, trade_date, estimated_yield_pct,
         public_snapshot_json, published_by_email, published_at, archived_at,
         archived_by_user_id, created_at, updated_at)
       VALUES (?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               NULL, NULL, ?, ?)`
    ).bind(
      productId,
      input.command.productCode,
      input.correlation?.rfqId ?? null,
      input.correlation?.batchId ?? null,
      input.inboundMessageId,
      input.sourceReferenceHash,
      quote.parserProfile,
      quote.sourceTableIndex,
      quote.sourceRowIndex,
      input.command.batchCode,
      input.command.dealSequence,
      input.command.subjectDateMmdd,
      quote.issuer,
      tradeDate,
      quote.couponPaPct,
      JSON.stringify(snapshot),
      publisher,
      publishedAt,
      publishedAt,
      publishedAt
    ),
    env.DB.prepare(
      `INSERT INTO follow_board_publication_commands
        (id, inbound_message_id, product_id, sender_email, product_code, batch_code,
         deal_sequence, subject_date_mmdd, status, error_code, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', NULL, ?)`
    ).bind(
      newId("fbc"),
      input.inboundMessageId,
      productId,
      publisher,
      input.command.productCode,
      input.command.batchCode,
      input.command.dealSequence,
      input.command.subjectDateMmdd,
      publishedAt
    ),
    env.DB.prepare(
      `UPDATE inbound_messages
          SET normalized_subject = ?, subject_batch_code = ?, sender_evidence_json = ?,
              detected_issuer = ?, rfq_id = ?, correlated_batch_id = ?,
              correlation_source = ?, correlation_token_hash = ?,
              r2_parsed_tables_key = ?, html_table_count = ?, attachment_count = ?,
              status = 'PARSED', parser_version = ?, parsed_at = ?, last_error_code = NULL
        WHERE id = ?`
    ).bind(
      input.normalizedSubject,
      input.command.batchCode,
      JSON.stringify([
        { source: "FOLLOW_BOARD_PUBLISHER", address: publisher },
        { source: "FOLLOW_BOARD_TABLE_PROFILE", issuer: quote.issuer, parserProfile: quote.parserProfile }
      ]),
      quote.issuer,
      input.correlation?.rfqId ?? null,
      input.correlation?.batchId ?? null,
      input.correlation
        ? (input.correlation.source === "BODY_TOKEN" ? "TOKEN" : input.correlation.source)
        : null,
      input.correlation?.tokenHash ?? null,
      input.parsedTablesKey,
      input.tables.length,
      input.attachmentCount,
      FOLLOW_BOARD_PUBLICATION_VERSION,
      publishedAt,
      input.inboundMessageId
    ),
    env.DB.prepare(
      `UPDATE email_parse_jobs
          SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
              lease_expires_at = NULL, last_error_code = NULL
        WHERE id = ?`
    ).bind(publishedAt, publishedAt, input.parseJobId),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'FOLLOW_BOARD_PRODUCT_PUBLISHED', 'FOLLOW_BOARD_PRODUCT', ?, ?, ?, ?)`
    ).bind(
      newId("aud"),
      productId,
      `queue:${input.parseJobId}`,
      JSON.stringify({
        productCode: input.command.productCode,
        batchCode: input.command.batchCode,
        dealSequence: input.command.dealSequence,
        issuer: quote.issuer,
        parserProfile: quote.parserProfile,
        sourceTableIndex: quote.sourceTableIndex,
        sourceRowIndex: quote.sourceRowIndex,
        warningCodes: input.tableWarnings
      }),
      publishedAt
    )
  ]);
}
