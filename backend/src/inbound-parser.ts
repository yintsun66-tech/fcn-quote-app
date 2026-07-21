import PostalMime, { type Address, type Email } from "postal-mime";
import { keyedHash, sha256Text } from "./crypto";
import { nowIso } from "./db";
import type { AppEnv, InboundEmailJob, MailBatchCode, QuoteNormalizeJob } from "./types";

export const INBOUND_PARSER_VERSION = "inbound-mime-v1";

const MAX_HEADERS_SIZE = 128 * 1024;
const MAX_NESTING_DEPTH = 10;
const MAX_TABLES = 100;
const MAX_ROWS_PER_TABLE = 200;
const MAX_CELLS_PER_ROW = 64;
const MAX_CELL_CHARACTERS = 4_096;

export type Issuer = "BNP" | "MS" | "JPM" | "BARCLAYS" | "NOMURA" | "UBS" | "DBS" | "SG" | "CITI" | "GS" | "CA";
export type InboundTerminalStatus = "PARSED" | "SENDER_MISMATCH" | "UNMATCHED_RFQ" | "MANUAL_REVIEW" | "LATE_REPLY";

const ISSUER_DOMAINS: Readonly<Record<Issuer, readonly string[]>> = Object.freeze({
  BNP: ["bnpparibas.com"],
  MS: ["morganstanley.com"],
  JPM: ["jpmorgan.com"],
  BARCLAYS: ["barclays.com"],
  NOMURA: ["nomura.com"],
  UBS: ["ubs.com"],
  DBS: ["dbs.com"],
  SG: ["sgcib.com"],
  CITI: ["citi.com"],
  GS: ["gs.com"],
  CA: ["ca-cib.com"]
});

const FORWARDED_SENDERS: Readonly<Record<Issuer, readonly string[]>> = Object.freeze({
  BNP: ["quotation.tw@bnpparibas.com", "dl.tw_obu_osp_pricing@asia.bnpparibas.com", "dl.eqd.taiwan@asia.bnpparibas.com"],
  MS: ["mstwsp@morganstanley.com"],
  JPM: ["no_reply_jpm_autopricer@jpmorgan.com"],
  BARCLAYS: ["barcapcomet@barclays.com"],
  NOMURA: ["pricing@nomura.com"],
  UBS: ["ol-ged-emailpricer@ubs.com"],
  DBS: ["sperfq@dbs.com"],
  SG: ["asi-mark-sls-tw-autopricer@sgcib.com"],
  CITI: ["mailrfq@citi.com"],
  GS: ["gs-asia-pb-autoquote-reply@gs.com"],
  CA: ["eisemailpricer@ca-cib.com"]
});

const ISSUER_BATCH: Readonly<Record<Issuer, MailBatchCode>> = Object.freeze({
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

interface InboundMessageRow {
  id: string;
  r2_raw_mime_key: string;
  envelope_from: string;
  header_from: string | null;
  return_path: string | null;
  raw_subject: string;
  in_reply_to: string | null;
  references_header: string | null;
  authentication_results: string | null;
  status: string;
}

interface ParseJobRow {
  id: string;
  inbound_message_id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  lease_expires_at: string | null;
}

interface ClaimedInbound {
  job: ParseJobRow;
  message: InboundMessageRow;
}

interface CorrelatedRfq {
  rfqId: string;
  batchId: string;
  batchCode: MailBatchCode;
  deadlineAt: string | null;
  source: "TOKEN" | "REPLY_HEADER";
  tokenHash: string | null;
}

export interface SenderEvidence {
  issuer: Issuer;
  domain: string;
  source: "DKIM" | "ENVELOPE_FROM" | "HEADER_FROM" | "RETURN_PATH" | "PARSED_FROM" | "FORWARDED_BODY";
}

export interface SenderDetection {
  issuer: Issuer | null;
  conflict: boolean;
  evidence: SenderEvidence[];
  warnings: string[];
}

export interface ExtractedTable {
  index: number;
  rows: string[][];
  rowCount: number;
  maxColumnCount: number;
  truncated: boolean;
}

export interface ExtractedTables {
  tables: ExtractedTable[];
  warnings: string[];
}

function bounded(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\s\u00a0\u2000-\u200b\u202f\u205f\u3000]+/gu, " ").trim();
}

export function normalizeEmailSubject(value: string): string {
  let subject = normalizeWhitespace(value.normalize("NFKC"));
  const prefix = /^(?:(?:RE|FW|FWD)\s*:?\s*|EXTERNAL\s*:?\s*|轉寄\s*[-:：]?\s*|外來信件\s*\(\s*OUTERMAIL\s*\)\s*[-:：]?\s*)/iu;
  for (let index = 0; index < 12; index += 1) {
    const next = subject.replace(prefix, "");
    if (next === subject) break;
    subject = normalizeWhitespace(next);
  }
  return subject;
}

export function subjectBatchCode(subject: string): MailBatchCode | null {
  const normalized = normalizeEmailSubject(subject).toUpperCase();
  if (/野村|NOMURA/u.test(normalized)) return "NOMURA";
  if (/UBS(?=\s|\[|詢價|FCB|$)/u.test(normalized)) return "UBS";
  if (/DBS(?=\s|\[|詢價|FCB|$)/u.test(normalized)) return "DBS";
  if (/CITI(?=\s|\[|詢價|FCB|$)/u.test(normalized)) return "CITI";
  if (/SG(?=\s|\[|詢價|FCB|$)/u.test(normalized)) return "SG";
  if (/GS(?=\s|\[|詢價|FCB|$)/u.test(normalized)) return "GS";
  if (/CA(?=\s|\[|詢價|FCB|$)/u.test(normalized)) return "CA";
  if (/BMJB(?=\s|\[|詢價|FCB|$)/u.test(normalized)) return "BMJB";
  return null;
}

export function requesterMarker(subject: string): string | null {
  const match = /##([^#]{1,320})##/u.exec(subject);
  return match?.[1] ? normalizeWhitespace(match[1]) : null;
}

export function correlationTags(subject: string): { token: string; batchCode: MailBatchCode } | null {
  // Length 10 accepts the short Crockford code (ADR 0002); the wider range keeps any
  // in-flight long tokens correlatable across a rollout. Matching is by sha256 lookup.
  const match = /\[RFQ:([A-Za-z0-9_-]{10,128})\]\s*\[BATCH:(BMJB|NOMURA|UBS|DBS|SG|CITI|GS|CA)\]/iu.exec(subject);
  if (!match?.[1] || !match[2]) return null;
  return { token: match[1], batchCode: match[2].toUpperCase() as MailBatchCode };
}

function issuerForDomain(domain: string): Issuer | null {
  const candidate = domain.toLowerCase().replace(/^\.+|\.+$/g, "");
  for (const [issuer, domains] of Object.entries(ISSUER_DOMAINS) as Array<[Issuer, readonly string[]]>) {
    if (domains.some(allowed => candidate === allowed || candidate.endsWith(`.${allowed}`))) return issuer;
  }
  return null;
}

function domainsIn(value: string): string[] {
  const domains = new Set<string>();
  for (const match of value.matchAll(/(?:^|[^A-Z0-9._%+-])[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})(?=$|[^A-Z0-9.-])/giu)) {
    if (match[1]) domains.add(match[1].toLowerCase());
  }
  return [...domains];
}

function mailboxes(address: Address | undefined): string[] {
  if (!address) return [];
  if (Array.isArray(address.group)) return address.group.map(entry => entry.address);
  return typeof address.address === "string" ? [address.address] : [];
}

function dkimDomains(authenticationResults: string): string[] {
  const domains = new Set<string>();
  for (const match of authenticationResults.matchAll(/dkim\s*=\s*pass\b[^;\r\n]{0,500}?header\.d\s*=\s*([A-Z0-9.-]+)/giu)) {
    if (match[1]) domains.add(match[1].toLowerCase());
  }
  return [...domains];
}

function bodySearchText(email: Email): string {
  return `${email.text ?? ""}\n${email.html ?? ""}`
    .normalize("NFKC")
    .replace(/&#0*64;|&#x0*40;|&commat;/giu, "@").toLowerCase();
}

export function detectSender(
  email: Email,
  metadata: Pick<InboundMessageRow, "envelope_from" | "header_from" | "return_path" | "authentication_results">
): SenderDetection {
  const evidence: SenderEvidence[] = [];
  const addDomains = (values: readonly string[], source: SenderEvidence["source"]): void => {
    for (const value of values) {
      const issuer = issuerForDomain(value);
      if (issuer) evidence.push({ issuer, domain: value.toLowerCase(), source });
    }
  };

  addDomains(dkimDomains(metadata.authentication_results ?? ""), "DKIM");
  addDomains(domainsIn(metadata.envelope_from), "ENVELOPE_FROM");
  addDomains(domainsIn(metadata.header_from ?? ""), "HEADER_FROM");
  addDomains(domainsIn(metadata.return_path ?? ""), "RETURN_PATH");
  addDomains([...mailboxes(email.from), ...mailboxes(email.sender)].flatMap(domainsIn), "PARSED_FROM");

  const body = bodySearchText(email);
  for (const [issuer, addresses] of Object.entries(FORWARDED_SENDERS) as Array<[Issuer, readonly string[]]>) {
    for (const address of addresses) {
      if (body.includes(address)) {
        const domain = address.slice(address.lastIndexOf("@") + 1);
        evidence.push({ issuer, domain, source: "FORWARDED_BODY" });
      }
    }
  }

  const uniqueEvidence = [...new Map(evidence.map(item => [`${item.issuer}:${item.domain}:${item.source}`, item])).values()];
  const issuers = [...new Set(uniqueEvidence.map(item => item.issuer))];
  const warnings: string[] = [];
  if (issuers.length === 1 && uniqueEvidence.every(item => item.source === "FORWARDED_BODY")) {
    warnings.push("FORWARDED_BODY_SENDER_EVIDENCE");
  }
  return {
    issuer: issuers.length === 1 ? issuers[0] ?? null : null,
    conflict: issuers.length > 1,
    evidence: uniqueEvidence,
    warnings
  };
}

function cleanCell(value: string): string {
  return bounded(normalizeWhitespace(value), MAX_CELL_CHARACTERS);
}

function stripExecutableSections(html: string): string {
  let safe = html;
  for (const tag of ["script", "style", "template"]) {
    safe = safe.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "giu"), "");
    safe = safe.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "giu"), "");
  }
  return safe;
}

interface MutableTable {
  index: number;
  rows: string[][];
  maxColumnCount: number;
  truncated: boolean;
}

export async function extractHtmlTables(html: string): Promise<ExtractedTables> {
  const safeHtml = stripExecutableSections(html);
  const tables: MutableTable[] = [];
  const tableStack: Array<MutableTable | null> = [];
  const rowStack: Array<{ table: MutableTable; cells: string[] } | null> = [];
  const cellStack: Array<{ row: { table: MutableTable; cells: string[] }; text: string; truncated: boolean } | null> = [];
  const warnings = new Set<string>();

  const cellHandler: HTMLRewriterElementContentHandlers = {
    element(element) {
      const row = rowStack.at(-1) ?? null;
      if (!row || row.cells.length >= MAX_CELLS_PER_ROW) {
        if (row) {
          row.table.truncated = true;
          warnings.add("TABLE_CELL_LIMIT_REACHED");
        }
        cellStack.push(null);
      } else {
        const cell = { row, text: "", truncated: false };
        cellStack.push(cell);
        element.onEndTag(() => {
          const completed = cellStack.pop();
          if (!completed) return;
          completed.row.cells.push(cleanCell(completed.text));
          if (completed.truncated) completed.row.table.truncated = true;
        });
      }
    },
    text(text) {
      const cell = cellStack.at(-1);
      if (!cell) return;
      if (cell.text.length >= MAX_CELL_CHARACTERS) {
        cell.truncated = true;
        return;
      }
      cell.text += text.text;
      if (cell.text.length > MAX_CELL_CHARACTERS) cell.truncated = true;
    }
  };

  const rewriter = new HTMLRewriter()
    .on("script", { element: element => { element.remove(); } })
    .on("style", { element: element => { element.remove(); } })
    .on("template", { element: element => { element.remove(); } })
    .on("table", {
      element(element) {
        if (tables.length >= MAX_TABLES) {
          tableStack.push(null);
          warnings.add("TABLE_COUNT_LIMIT_REACHED");
        } else {
          const table: MutableTable = { index: tables.length, rows: [], maxColumnCount: 0, truncated: false };
          tables.push(table);
          tableStack.push(table);
        }
        element.onEndTag(() => { tableStack.pop(); });
      }
    })
    .on("tr", {
      element(element) {
        const table = tableStack.at(-1) ?? null;
        if (!table || table.rows.length >= MAX_ROWS_PER_TABLE) {
          if (table) {
            table.truncated = true;
            warnings.add("TABLE_ROW_LIMIT_REACHED");
          }
          rowStack.push(null);
        } else {
          const row = { table, cells: [] as string[] };
          rowStack.push(row);
          element.onEndTag(() => {
            const completed = rowStack.pop();
            if (!completed || completed.cells.length === 0) return;
            completed.table.rows.push(completed.cells);
            completed.table.maxColumnCount = Math.max(completed.table.maxColumnCount, completed.cells.length);
          });
        }
      }
    })
    .on("th", cellHandler)
    .on("td", cellHandler);

  await rewriter.transform(new Response(safeHtml, { headers: { "content-type": "text/html; charset=utf-8" } })).arrayBuffer();
  return {
    tables: tables.map(table => ({ ...table, rowCount: table.rows.length })),
    warnings: [...warnings]
  };
}

async function claimInbound(env: AppEnv, requested: InboundEmailJob): Promise<ClaimedInbound | null> {
  const current = await env.DB.prepare(
    `SELECT j.id, j.inbound_message_id, j.status, j.lease_expires_at,
            m.id AS message_id, m.r2_raw_mime_key, m.envelope_from, m.header_from,
            m.return_path, m.raw_subject, m.in_reply_to, m.references_header,
            m.authentication_results, m.status AS message_status
       FROM email_parse_jobs j
       JOIN inbound_messages m ON m.id = j.inbound_message_id
      WHERE j.id = ? AND j.inbound_message_id = ?`
  ).bind(requested.jobId, requested.inboundMessageId).first<Record<string, string | null>>();
  if (!current) throw new Error("INBOUND_JOB_NOT_FOUND");
  if (current.status === "COMPLETED") return null;

  const claimedAt = nowIso();
  const leaseExpiresAt = new Date(Date.parse(claimedAt) + 2 * 60 * 1000).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE email_parse_jobs
        SET status = 'RUNNING', attempt_count = attempt_count + 1,
            lease_expires_at = ?, last_error_code = NULL, updated_at = ?
      WHERE id = ? AND inbound_message_id = ? AND status != 'COMPLETED'
        AND (status != 'RUNNING' OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
  ).bind(leaseExpiresAt, claimedAt, requested.jobId, requested.inboundMessageId, claimedAt).run();
  if (claimed.meta.changes === 0) throw new Error("INBOUND_JOB_LEASED");
  await env.DB.prepare(
    `UPDATE inbound_messages SET status = 'PARSING', parse_attempt_count = parse_attempt_count + 1,
            last_error_code = NULL WHERE id = ?`
  ).bind(requested.inboundMessageId).run();

  return {
    job: {
      id: current.id ?? requested.jobId,
      inbound_message_id: current.inbound_message_id ?? requested.inboundMessageId,
      status: "RUNNING",
      lease_expires_at: leaseExpiresAt
    },
    message: {
      id: current.message_id ?? requested.inboundMessageId,
      r2_raw_mime_key: current.r2_raw_mime_key ?? "",
      envelope_from: current.envelope_from ?? "",
      header_from: current.header_from ?? null,
      return_path: current.return_path ?? null,
      raw_subject: current.raw_subject ?? "",
      in_reply_to: current.in_reply_to ?? null,
      references_header: current.references_header ?? null,
      authentication_results: current.authentication_results ?? null,
      status: current.message_status ?? "PARSING"
    }
  };
}

function referenceIds(value: string): string[] {
  const result = new Set<string>();
  for (const match of value.matchAll(/<[^<>\s]{1,998}>/gu)) {
    if (match[0]) result.add(match[0]);
    if (result.size >= 20) break;
  }
  return [...result];
}

async function correlateRfq(
  env: AppEnv,
  tags: { token: string; batchCode: MailBatchCode } | null,
  inReplyTo: string,
  references: string
): Promise<CorrelatedRfq | null> {
  if (tags) {
    const tokenHash = await sha256Text(tags.token);
    const match = await env.DB.prepare(
      `SELECT b.id AS batch_id, b.rfq_id, b.batch_code, r.deadline_at
         FROM outbound_email_batches b JOIN rfqs r ON r.id = b.rfq_id
        WHERE b.correlation_token_hash = ? AND b.batch_code = ?`
    ).bind(tokenHash, tags.batchCode).first<{ batch_id: string; rfq_id: string; batch_code: MailBatchCode; deadline_at: string | null }>();
    if (!match) return null;
    return {
      rfqId: match.rfq_id,
      batchId: match.batch_id,
      batchCode: match.batch_code,
      deadlineAt: match.deadline_at,
      source: "TOKEN",
      tokenHash
    };
  }

  const ids = referenceIds(`${inReplyTo} ${references}`);
  if (ids.length === 0) return null;
  const placeholders = ids.map(() => "?").join(",");
  const matches = await env.DB.prepare(
    `SELECT b.id AS batch_id, b.rfq_id, b.batch_code, r.deadline_at
       FROM outbound_email_batches b JOIN rfqs r ON r.id = b.rfq_id
      WHERE b.provider_message_id IN (${placeholders}) LIMIT 2`
  ).bind(...ids).all<{ batch_id: string; rfq_id: string; batch_code: MailBatchCode; deadline_at: string | null }>();
  if (matches.results.length !== 1 || !matches.results[0]) return null;
  const match = matches.results[0];
  return {
    rfqId: match.rfq_id,
    batchId: match.batch_id,
    batchCode: match.batch_code,
    deadlineAt: match.deadline_at,
    source: "REPLY_HEADER",
    tokenHash: null
  };
}

function terminalOutcome(
  sender: SenderDetection,
  subjectBatch: MailBatchCode | null,
  tags: { token: string; batchCode: MailBatchCode } | null,
  correlation: CorrelatedRfq | null
): { status: InboundTerminalStatus; errorCode: string | null } {
  if (sender.conflict) return { status: "SENDER_MISMATCH", errorCode: "MULTIPLE_ISSUER_EVIDENCE" };
  if (!sender.issuer) return { status: "MANUAL_REVIEW", errorCode: "UNKNOWN_ISSUER" };
  const expectedBatch = ISSUER_BATCH[sender.issuer];
  if (subjectBatch && subjectBatch !== expectedBatch) return { status: "SENDER_MISMATCH", errorCode: "SUBJECT_SENDER_MISMATCH" };
  if (!subjectBatch) return { status: "MANUAL_REVIEW", errorCode: "UNKNOWN_SUBJECT_BATCH" };
  if (tags && tags.batchCode !== subjectBatch) return { status: "MANUAL_REVIEW", errorCode: "CORRELATION_BATCH_MISMATCH" };
  if (!correlation) return { status: "UNMATCHED_RFQ", errorCode: "RFQ_CORRELATION_NOT_FOUND" };
  if (correlation.batchCode !== expectedBatch) return { status: "SENDER_MISMATCH", errorCode: "RFQ_BATCH_SENDER_MISMATCH" };
  if (correlation.deadlineAt && Date.parse(correlation.deadlineAt) < Date.now()) {
    return { status: "LATE_REPLY", errorCode: "RFQ_DEADLINE_PASSED" };
  }
  return { status: "PARSED", errorCode: null };
}

export async function processInboundEmailJob(env: AppEnv, requested: InboundEmailJob): Promise<void> {
  const claimed = await claimInbound(env, requested);
  if (!claimed) {
    await enqueueNormalization(env, requested.inboundMessageId);
    return;
  }
  if (!claimed.message.r2_raw_mime_key) throw new Error("RAW_MIME_KEY_MISSING");
  const rawObject = await env.RAW_MAIL_BUCKET.get(claimed.message.r2_raw_mime_key);
  if (!rawObject) throw new Error("RAW_MIME_NOT_FOUND");
  const rawMime = await rawObject.arrayBuffer();
  const email = await PostalMime.parse(rawMime, {
    rfc822Attachments: false,
    forceRfc822Attachments: false,
    attachmentEncoding: "arraybuffer",
    maxNestingDepth: MAX_NESTING_DEPTH,
    maxHeadersSize: MAX_HEADERS_SIZE
  });
  const rawSubject = email.subject ?? claimed.message.raw_subject;
  const normalizedSubject = bounded(normalizeEmailSubject(rawSubject), 8_192);
  const subjectBatch = subjectBatchCode(normalizedSubject);
  const tags = correlationTags(normalizedSubject);
  const marker = requesterMarker(normalizedSubject);
  const markerHash = marker ? await keyedHash(env.EMPLOYEE_LOOKUP_KEY, `REQUESTER_MARKER_V1:${marker.normalize("NFKC").toLowerCase()}`) : null;
  const sender = detectSender(email, claimed.message);
  const correlation = await correlateRfq(
    env,
    tags,
    email.inReplyTo ?? claimed.message.in_reply_to ?? "",
    email.references ?? claimed.message.references_header ?? ""
  );
  const outcome = terminalOutcome(sender, subjectBatch, tags, correlation);
  const extracted = email.html ? await extractHtmlTables(email.html) : { tables: [], warnings: ["HTML_BODY_NOT_PRESENT"] };
  const warnings = [...new Set([...sender.warnings, ...extracted.warnings])];
  const parsedAt = nowIso();
  const parsedKey = `parsed-email/v1/${claimed.message.id}.json`;
  const parsedDocument = {
    schemaVersion: 1,
    parserVersion: INBOUND_PARSER_VERSION,
    inboundMessageId: claimed.message.id,
    parsedAt,
    tableCount: extracted.tables.length,
    tables: extracted.tables,
    hasPlainText: Boolean(email.text?.trim()),
    attachmentCount: email.attachments.length,
    warnings
  };
  await env.RAW_MAIL_BUCKET.put(parsedKey, JSON.stringify(parsedDocument), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { parserVersion: INBOUND_PARSER_VERSION, parsedAt }
  });
  const auditMetadata = {
    status: outcome.status,
    issuer: sender.issuer,
    batchCode: subjectBatch,
    correlationSource: correlation?.source ?? null,
    tableCount: extracted.tables.length,
    warningCodes: warnings
  };
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE inbound_messages
          SET normalized_subject = ?, requester_marker_hash = ?, subject_batch_code = ?,
              sender_evidence_json = ?, detected_issuer = ?, rfq_id = ?, correlated_batch_id = ?,
              correlation_source = ?, correlation_token_hash = ?, r2_parsed_tables_key = ?,
              html_table_count = ?, attachment_count = ?, status = ?, parser_version = ?,
              parsed_at = ?, last_error_code = ?
        WHERE id = ?`
    ).bind(
      normalizedSubject,
      markerHash,
      subjectBatch,
      JSON.stringify(sender.evidence),
      sender.issuer,
      correlation?.rfqId ?? null,
      correlation?.batchId ?? null,
      correlation?.source ?? null,
      correlation?.tokenHash ?? null,
      parsedKey,
      extracted.tables.length,
      email.attachments.length,
      outcome.status,
      INBOUND_PARSER_VERSION,
      parsedAt,
      outcome.errorCode,
      claimed.message.id
    ),
    env.DB.prepare(
      `UPDATE email_parse_jobs SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
              lease_expires_at = NULL, last_error_code = ? WHERE id = ?`
    ).bind(parsedAt, parsedAt, outcome.errorCode, claimed.job.id),
    env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata_json, created_at)
       VALUES (?, NULL, 'INBOUND_EMAIL_PARSED', 'INBOUND_MESSAGE', ?, ?, ?, ?)`
    ).bind(`aud_${crypto.randomUUID()}`, claimed.message.id, `queue:${claimed.job.id}`, JSON.stringify(auditMetadata), parsedAt)
  ];
  if ((outcome.status === "PARSED" || outcome.status === "LATE_REPLY") && correlation && sender.issuer) {
    const normalizeJobId = `job_${crypto.randomUUID()}`;
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO quote_normalize_jobs
        (id, inbound_message_id, rfq_id, issuer, idempotency_key, status,
         available_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`
    ).bind(
      normalizeJobId,
      claimed.message.id,
      correlation.rfqId,
      sender.issuer,
      `QUOTE_NORMALIZE:${claimed.message.id}`,
      parsedAt,
      parsedAt,
      parsedAt
    ));
  }
  await env.DB.batch(statements);
  await enqueueNormalization(env, claimed.message.id);
}

async function enqueueNormalization(env: AppEnv, inboundMessageId: string): Promise<void> {
  const job = await env.DB.prepare(
    `SELECT id AS jobId, inbound_message_id AS inboundMessageId, rfq_id AS rfqId, issuer
       FROM quote_normalize_jobs
      WHERE inbound_message_id = ? AND status IN ('QUEUED', 'FAILED')`
  ).bind(inboundMessageId).first<QuoteNormalizeJob>();
  if (!job) return;
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE quote_normalize_jobs SET status = 'QUEUED', last_error_code = NULL,
            lease_expires_at = NULL, available_at = ?, updated_at = ?
      WHERE id = ? AND status = 'FAILED'`
  ).bind(now, now, job.jobId).run();
  await env.QUOTE_NORMALIZE_QUEUE.send(job);
}

async function markInboundFailure(env: AppEnv, job: InboundEmailJob, terminal: boolean, errorCode: string): Promise<void> {
  const failedAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE email_parse_jobs SET status = 'FAILED', lease_expires_at = NULL,
              last_error_code = ?, updated_at = ? WHERE id = ? AND status != 'COMPLETED'`
    ).bind(errorCode, failedAt, job.jobId),
    env.DB.prepare(
      `UPDATE inbound_messages SET status = ?, last_error_code = ?, parser_version = ?
        WHERE id = ? AND status NOT IN ('PARSED', 'LATE_REPLY')`
    ).bind(terminal ? "PARSE_ERROR" : "QUEUED", errorCode, INBOUND_PARSER_VERSION, job.inboundMessageId)
  ]);
}

function queueErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)) return error.message;
  return "INBOUND_EMAIL_PARSE_FAILED";
}

function isInboundEmailJob(value: unknown): value is InboundEmailJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.jobId, candidate.inboundMessageId]
    .every(part => typeof part === "string" && /^[a-z]+_[0-9a-f-]{36}$/i.test(part));
}

export async function consumeInboundEmail(batch: MessageBatch<unknown>, env: AppEnv): Promise<void> {
  for (const message of batch.messages) {
    if (!isInboundEmailJob(message.body)) {
      console.error("invalid_inbound_queue_message", { messageId: message.id });
      message.retry({ delaySeconds: 300 });
      continue;
    }
    try {
      await processInboundEmailJob(env, message.body);
      message.ack();
    } catch (error) {
      if (error instanceof Error && error.message === "INBOUND_JOB_LEASED") {
        message.retry({ delaySeconds: 30 });
        continue;
      }
      const terminal = message.attempts >= 4;
      try {
        await markInboundFailure(env, message.body, terminal, queueErrorCode(error));
      } catch (persistenceError) {
        console.error("inbound_failure_persistence_failed", {
          jobId: message.body.jobId,
          errorType: persistenceError instanceof Error ? persistenceError.name : "unknown"
        });
      }
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** Math.max(0, message.attempts - 1)) });
    }
  }
}
