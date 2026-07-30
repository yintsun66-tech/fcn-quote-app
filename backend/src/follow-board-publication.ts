import type { Address, Email } from "postal-mime";
import { newId, nowIso } from "./db";
import {
  detectIssuerTableProfiles,
  type ParsedIssuerRow
} from "./issuer-profiles";
import type { AppEnv, MailBatchCode } from "./types";

export const FOLLOW_BOARD_PUBLICATION_VERSION = "follow-board-publication-v6";

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
  dealSequenceEnd: number;
  productCode: string;
  productCodes: string[];
  issuer: ParsedIssuerRow["issuer"];
  batchCode: MailBatchCode;
  expiryDateYyyymmdd: string;
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

function validYyyymmdd(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function expiryAtFromSubject(value: string): string | null {
  if (!validYyyymmdd(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1_000).toISOString();
}

export function parseFollowBoardPublicationSubject(subject: string): FollowBoardPublicationCommand | null {
  const withoutCorrelation = subject.normalize("NFKC").replace(
    /\s*\[RFQ:[A-Za-z0-9_-]{10,128}\]\s*\[BATCH:(?:BMJB|NOMURA|UBS|DBS|SG|CITI|GS|CA)\]\s*$/iu,
    ""
  ).trim();
  const match = /^(\d{4})\s+deal-?(\d{1,2})(?:~(\d{1,2}))?\s+([A-Z0-9]{4,12}(?:\s*,\s*[A-Z0-9]{4,12})*)\s*,?\s+(BNP|MS|JPM|BARCLAYS|NOMURA|UBS|DBS|SG|CITI|GS|CA)\s*跟單\s*(\d{8})$/iu
    .exec(withoutCorrelation);
  if (!match?.[1] || !match[2] || !match[4] || !match[5] || !match[6]
    || !validMmdd(match[1]) || !validYyyymmdd(match[6])) {
    return null;
  }
  const dealSequence = Number(match[2]);
  const dealSequenceEnd = match[3] ? Number(match[3]) : dealSequence;
  const productCodes = match[4].split(",").map(code => code.trim().toUpperCase());
  const issuer = match[5].toUpperCase() as ParsedIssuerRow["issuer"];
  const batchCode = ISSUER_BATCH[issuer];
  const expectedCount = dealSequenceEnd - dealSequence + 1;
  if (!Number.isInteger(dealSequence)
    || !Number.isInteger(dealSequenceEnd)
    || dealSequence < 1
    || dealSequenceEnd > 20
    || expectedCount < 1
    || productCodes.length !== expectedCount
    || new Set(productCodes).size !== productCodes.length
    || !batchCode) {
    return null;
  }
  return {
    subjectDateMmdd: match[1],
    dealSequence,
    dealSequenceEnd,
    productCode: productCodes[0] ?? "",
    productCodes,
    issuer,
    batchCode,
    expiryDateYyyymmdd: match[6]
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
  rows: ParsedIssuerRow[];
  errorCode: string | null;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function calculateFollowBoardSalesFeePct(
  row: Pick<ParsedIssuerRow, "issuer" | "rawPriceValue" | "priceSemantics" | "comparablePricePct">
): number | null {
  const value = row.issuer === "CITI"
    && row.priceSemantics === "UPFRONT"
    && finite(row.rawPriceValue)
    ? row.rawPriceValue
    : finite(row.comparablePricePct)
      ? 100 - row.comparablePricePct
      : null;
  return value === null ? null : Number(value.toFixed(4));
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

function publicationRowSignature(row: ParsedIssuerRow): string {
  return JSON.stringify({
    issuer: row.issuer,
    parserProfile: row.parserProfile,
    product: row.product,
    currency: row.currency,
    tenorMonths: row.tenorMonths,
    guaranteedPeriodsMonths: row.guaranteedPeriodsMonths,
    underlyings: row.underlyings,
    strikePct: row.strikePct,
    koType: row.koType,
    koBarrierPct: row.koBarrierPct,
    couponPaPct: row.couponPaPct,
    rawPriceValue: row.rawPriceValue,
    priceSemantics: row.priceSemantics,
    comparablePricePct: row.comparablePricePct,
    barrierType: row.barrierType,
    kiBarrierPct: row.kiBarrierPct,
    observationFrequencyMonths: row.observationFrequencyMonths,
    otc: row.otc,
    effectiveDateOffsetCalendarDays: row.effectiveDateOffsetCalendarDays,
    quoteReference: row.quoteReference
  });
}

function uniquePublicationRows(rows: readonly ParsedIssuerRow[]): ParsedIssuerRow[] {
  const uniqueRows = new Map<string, ParsedIssuerRow>();
  for (const row of rows) {
    const signature = publicationRowSignature(row);
    if (!uniqueRows.has(signature)) uniqueRows.set(signature, row);
  }
  return [...uniqueRows.values()];
}

function publicationRowListSignature(rows: readonly ParsedIssuerRow[]): string {
  return JSON.stringify(rows.map(publicationRowSignature));
}

export function selectFollowBoardPublicationRows(
  tables: Array<{ index: number; rows: string[][] }>,
  expectedCount: number
): PublicationTableSelection {
  const profiles = detectIssuerTableProfiles({ tables });
  if (profiles.length === 0) {
    return { rows: [], errorCode: "FOLLOW_BOARD_ISSUER_TABLE_NOT_RECOGNIZED" };
  }
  if (profiles.length > 1) {
    return { rows: [], errorCode: "FOLLOW_BOARD_ISSUER_TABLE_AMBIGUOUS" };
  }

  const parsedRows = profiles[0]?.rows ?? [];
  const validRows = parsedRows.filter(row => validatePublicationRow(row) === null);
  if (validRows.length === 0) {
    const errors = [...new Set(parsedRows.map(validatePublicationRow).filter(
      (error): error is string => Boolean(error)
    ))];
    return {
      rows: [],
      errorCode: errors.length === 1
        ? errors[0] ?? "FOLLOW_BOARD_COMPLETE_QUOTE_NOT_FOUND"
        : "FOLLOW_BOARD_COMPLETE_QUOTE_NOT_FOUND"
    };
  }

  const rowsByTable = new Map<number, ParsedIssuerRow[]>();
  for (const row of validRows) {
    const tableRows = rowsByTable.get(row.sourceTableIndex) ?? [];
    tableRows.push(row);
    rowsByTable.set(row.sourceTableIndex, tableRows);
  }
  const matchingTableCandidates = [...rowsByTable.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, rows]) => uniquePublicationRows(rows))
    .filter(rows => rows.length === expectedCount);
  if (matchingTableCandidates.length > 0) {
    const uniqueCandidates = new Map<string, ParsedIssuerRow[]>();
    for (const rows of matchingTableCandidates) {
      const signature = publicationRowListSignature(rows);
      if (!uniqueCandidates.has(signature)) uniqueCandidates.set(signature, rows);
    }
    if (uniqueCandidates.size > 1) {
      return { rows: [], errorCode: "FOLLOW_BOARD_MULTIPLE_COMPLETE_QUOTES" };
    }
    return {
      rows: uniqueCandidates.values().next().value ?? [],
      errorCode: null
    };
  }

  const uniqueRows = uniquePublicationRows(validRows);
  if (uniqueRows.length !== expectedCount) {
    return {
      rows: [],
      errorCode: uniqueRows.length > expectedCount
        ? "FOLLOW_BOARD_MULTIPLE_COMPLETE_QUOTES"
        : "FOLLOW_BOARD_QUOTE_COUNT_MISMATCH"
    };
  }
  return { rows: uniqueRows, errorCode: null };
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
        (id, inbound_message_id, product_id, sender_email, product_code, batch_code, declared_issuer,
          deal_sequence, deal_sequence_end, product_codes_json, subject_date_mmdd,
          expiry_date_yyyymmdd, status, error_code, processed_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newId("fbc"),
      input.inboundMessageId,
      publisher,
      input.command.productCode,
      input.command.batchCode,
      input.command.issuer,
      input.command.dealSequence,
      input.command.dealSequenceEnd,
      JSON.stringify(input.command.productCodes),
      input.command.subjectDateMmdd,
      input.command.expiryDateYyyymmdd,
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
        productCodes: input.command.productCodes,
        batchCode: input.command.batchCode,
        declaredIssuer: input.command.issuer,
        expiryDateYyyymmdd: input.command.expiryDateYyyymmdd,
        dealSequenceStart: input.command.dealSequence,
        dealSequenceEnd: input.command.dealSequenceEnd
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
  const expectedProductCount = input.command.dealSequenceEnd - input.command.dealSequence + 1;
  if (input.command.dealSequence < 1
    || input.command.dealSequenceEnd > 20
    || expectedProductCount < 1
    || input.command.productCodes.length !== expectedProductCount
    || input.command.productCode !== input.command.productCodes[0]
    || input.command.productCodes.some(code => !/^[A-Z0-9]{4,12}$/u.test(code))
    || new Set(input.command.productCodes).size !== input.command.productCodes.length) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_COMMAND_COUNT_MISMATCH"
    });
    return;
  }
  const publishedAt = nowIso();
  const expiresAt = expiryAtFromSubject(input.command.expiryDateYyyymmdd);
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(publishedAt)) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_EXPIRY_NOT_FUTURE"
    });
    return;
  }
  const duplicatePlaceholders = input.command.productCodes.map(() => "?").join(", ");
  const duplicates = await env.DB.prepare(
    `SELECT product_code
       FROM follow_board_products
      WHERE product_code COLLATE NOCASE IN (${duplicatePlaceholders})`
  ).bind(...input.command.productCodes).all<{ product_code: string }>();
  if (duplicates.results.length > 0) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_PRODUCT_CODE_EXISTS"
    });
    return;
  }
  const selection = selectFollowBoardPublicationRows(
    input.tables,
    input.command.productCodes.length
  );
  if (selection.rows.length === 0 || selection.errorCode) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: selection.errorCode ?? "FOLLOW_BOARD_ISSUER_TABLE_NOT_RECOGNIZED"
    });
    return;
  }
  if (selection.rows.some(quote => quote.issuer !== input.command.issuer)) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_TABLE_ISSUER_MISMATCH"
    });
    return;
  }

  const tradeDate = tradeDateFromSubject(input.command.subjectDateMmdd, publishedAt);
  const commandId = newId("fbc");
  const publications = selection.rows.map((quote, index) => {
    const productCode = input.command.productCodes[index] ?? "";
    const productId = newId("fbp");
    const dealSequence = input.command.dealSequence + index;
    return {
      quote,
      productCode,
      productId,
      dealSequence,
      snapshot: {
        schemaVersion: 3,
        productCode,
        product: quote.product,
        currency: quote.currency,
        issuer: quote.issuer,
        issuerDisplayName: quote.issuerDisplayName,
        tradeDate,
        expiresAt,
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
        salesFeePct: calculateFollowBoardSalesFeePct(quote),
        estimatedYieldLabel: "預估年化配息率，非保證收益"
      }
    };
  });
  const firstPublication = publications[0];
  if (!firstPublication) {
    await completeFailure(env, input, publisher, {
      inboundStatus: "MANUAL_REVIEW",
      commandStatus: "MANUAL_REVIEW",
      errorCode: "FOLLOW_BOARD_COMPLETE_QUOTE_NOT_FOUND"
    });
    return;
  }
  const productStatements = publications.map(publication =>
    env.DB.prepare(
      `INSERT INTO follow_board_products
        (id, product_code, status, source_rfq_id, source_outbound_batch_id,
         source_inbound_message_id, source_reference_hash, parser_profile,
         source_table_index, source_row_index, batch_code, deal_sequence,
          subject_date_mmdd, issuer, trade_date, estimated_yield_pct,
          public_snapshot_json, published_by_email, published_at, expires_at, archived_at,
          archived_by_user_id, created_at, updated_at)
        VALUES (?, ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, NULL, NULL, ?, ?)`
    ).bind(
      publication.productId,
      publication.productCode,
      input.correlation?.rfqId ?? null,
      input.correlation?.batchId ?? null,
      input.inboundMessageId,
      input.sourceReferenceHash,
      publication.quote.parserProfile,
      publication.quote.sourceTableIndex,
      publication.quote.sourceRowIndex,
      input.command.batchCode,
      publication.dealSequence,
      input.command.subjectDateMmdd,
      publication.quote.issuer,
      tradeDate,
      publication.quote.couponPaPct,
      JSON.stringify(publication.snapshot),
      publisher,
      publishedAt,
      expiresAt,
      publishedAt,
      publishedAt
    )
  );
  const itemStatements = publications.map((publication, index) =>
    env.DB.prepare(
      `INSERT INTO follow_board_publication_items
        (id, command_id, product_id, item_ordinal, product_code, source_row_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newId("fbpi"),
      commandId,
      publication.productId,
      index + 1,
      publication.productCode,
      publication.quote.sourceRowIndex,
      publishedAt
    )
  );
  const auditStatements = publications.map((publication, index) =>
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'FOLLOW_BOARD_PRODUCT_PUBLISHED', 'FOLLOW_BOARD_PRODUCT', ?, ?, ?, ?)`
    ).bind(
      newId("aud"),
      publication.productId,
      `queue:${input.parseJobId}`,
      JSON.stringify({
        productCode: publication.productCode,
        batchCode: input.command.batchCode,
        declaredIssuer: input.command.issuer,
        expiresAt,
        dealSequence: publication.dealSequence,
        itemOrdinal: index + 1,
        itemCount: publications.length,
        issuer: publication.quote.issuer,
        parserProfile: publication.quote.parserProfile,
        sourceTableIndex: publication.quote.sourceTableIndex,
        sourceRowIndex: publication.quote.sourceRowIndex,
        warningCodes: input.tableWarnings
      }),
      publishedAt
    )
  );
  await env.DB.batch([
    ...productStatements,
    env.DB.prepare(
      `INSERT INTO follow_board_publication_commands
        (id, inbound_message_id, product_id, sender_email, product_code, batch_code, declared_issuer,
          deal_sequence, deal_sequence_end, product_codes_json, subject_date_mmdd,
          expiry_date_yyyymmdd, status, error_code, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', NULL, ?)`
    ).bind(
      commandId,
      input.inboundMessageId,
      firstPublication.productId,
      publisher,
      input.command.productCode,
      input.command.batchCode,
      input.command.issuer,
      input.command.dealSequence,
      input.command.dealSequenceEnd,
      JSON.stringify(input.command.productCodes),
      input.command.subjectDateMmdd,
      input.command.expiryDateYyyymmdd,
      publishedAt
    ),
    ...itemStatements,
    ...auditStatements,
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
        {
          source: "FOLLOW_BOARD_TABLE_PROFILE",
          issuer: firstPublication.quote.issuer,
          parserProfile: firstPublication.quote.parserProfile
        }
      ]),
      firstPublication.quote.issuer,
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
    ).bind(publishedAt, publishedAt, input.parseJobId)
  ]);
}
