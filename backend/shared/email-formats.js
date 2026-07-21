const fieldColumns = [
  ["product", "Product"], ["currency", "Currency"], ["guaranteedPeriods", "Guaranteed Periods (m)"],
  ["bbgCode1", "BBG Code 1"], ["bbgCode2", "BBG Code 2"], ["bbgCode3", "BBG Code 3"],
  ["bbgCode4", "BBG Code 4"], ["bbgCode5", "BBG Code 5"], ["strike", "Strike (%)"],
  ["koType", "KO Type"], ["koBarrier", "KO Barrier (%)"], ["coupon", "Coupon p.a. (%)"],
  ["upfront", "Upfront / NotePrice (%)"], ["tenor", "Tenor (m)"], ["barrierType", "Barrier Type"],
  ["kiBarrier", "KI Barrier (%)"], ["observationFrequency", "Observation Frequency (m)"],
  ["otc", "OTC"], ["effectiveDateOffset", "Effective Date Offset (Calendar Days)"], ["tradeDate", "Trade Date"],
];

function recordValue(record, name) {
  return String(record[name] ?? "").trim();
}

const sourceColumn = (label, name) => ({ label, value: record => recordValue(record, name) });
const blankColumn = label => ({ label, value: () => "" });
const productColumn = (label, fcnCode, dacCode) => ({
  label,
  value: record => productForIssuer(record, fcnCode, dacCode),
});

function productForIssuer(record, fcnCode, dacCode) {
  const product = recordValue(record, "product");
  if (product === "FCN") return fcnCode;
  if (product === "DAC") return dacCode;
  return "";
}

function numberOffset(value, offset = 0, suffix = "", fromOneHundred = false) {
  if (value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const result = fromOneHundred ? 100 - number : number + offset;
  return `${Number.isInteger(result) ? result : result.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}${suffix}`;
}

function citiBarrierType(value) {
  return ({ NONE: "NONE", EKI: "European", AKI: "Daily Close" })[value] || "";
}

function citiMemoryAutocall(value) {
  if (!value) return "";
  return /Memory$/i.test(value) ? "TRUE" : "FALSE";
}

function citiDailyKo(value) {
  if (!value) return "";
  return /^Daily/i.test(value) ? "TRUE" : "FALSE";
}

export const MAIL_INSTITUTION_ORDER = Object.freeze(["BMJB", "NOMURA", "UBS", "DBS", "SG", "CITI", "GS", "CA"]);

export const EMAIL_INSTITUTIONS = Object.freeze({
  BMJB: {
    label: "BNP MS JPM 巴克萊",
    subject: "BMJB[詢價]FCBKTPE: FCN(T+7)",
    columns: fieldColumns.map(([name, label]) => sourceColumn(label, name)),
  },
  NOMURA: {
    label: "Nomura",
    subject: "野村[詢價]FCBKTPE: FCN(T+7)",
    columns: [
      productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Non-call Periods", "guaranteedPeriods"),
      { label: "Guaranteed Coupon Periods", value: record => productForIssuer(record, "", recordValue(record, "guaranteedPeriods")) },
      sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"),
      sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), sourceColumn("Effective Date Offset", "effectiveDateOffset"), sourceColumn("Trade Date", "tradeDate"),
    ],
  },
  UBS: {
    label: "UBS",
    subject: "UBS[詢價]FCBKTPE: FCN(T+7)",
    columns: [
      productColumn("Product", "FCN", "WRA"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("Currency", "currency"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), blankColumn("Effective Date Offset"),
    ],
  },
  DBS: {
    label: "DBS",
    subject: "DBS[詢價]FCBKTPE: FCN(T+7)",
    columns: [
      productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), { label: "Issue Date Lag", value: record => numberOffset(recordValue(record, "effectiveDateOffset"), -2, "BD") },
    ],
  },
  SG: {
    label: "SG",
    subject: "SG[詢價]FCBKTPE: FCN(T+7)",
    columns: [
      sourceColumn("Trade Date", "tradeDate"), productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), { label: "OTC", value: () => "Note" }, blankColumn("Funding Spread (bps)"), { label: "Effective Date Offset(Calendar Days)", value: () => "7" },
    ],
  },
  CITI: {
    label: "CITI",
    subject: "CITI[詢價]FCBKTPE: FCN(T+7)",
    columns: [
      productColumn("Product", "FCA", "DRA"), sourceColumn("Strike Date", "tradeDate"), sourceColumn("Currency", "currency"), sourceColumn("Tenor (m)", "tenor"), { label: "Issue T+", value: record => numberOffset(recordValue(record, "effectiveDateOffset"), -2) },
      sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"),
      { label: "Barrier Type", value: record => citiBarrierType(recordValue(record, "barrierType")) }, sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), { label: "Non Callable Periods", value: record => numberOffset(recordValue(record, "guaranteedPeriods"), -1) }, sourceColumn("KO Barrier (%)", "koBarrier"), { label: "Memory Autocall", value: record => citiMemoryAutocall(recordValue(record, "koType")) }, { label: "Daily KO", value: record => citiDailyKo(recordValue(record, "koType")) }, sourceColumn("Coupon p.a. (%)", "coupon"), { label: "Upfront (%)", value: record => numberOffset(recordValue(record, "upfront"), 0, "", true) }, blankColumn("Notional Amount"), { label: "Format", value: record => recordValue(record, "product") ? "Citi US Issuer" : "" }, blankColumn("Swap Index"), blankColumn("Funding Spread (bps)"),
    ],
  },
  GS: {
    label: "GS",
    subject: "GS[詢價]FCBKTPE: FCN(T+7)",
    columns: [
      productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("Non-call Periods (m)", "guaranteedPeriods"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("BBG Code 5", "bbgCode5"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Cost (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("Strike Date", "tradeDate"), sourceColumn("Issue Date (T + ?)", "effectiveDateOffset"),
    ],
  },
  CA: {
    label: "CA",
    subject: "CA[詢價]FCBKTPE: FCN(T+7)",
    columns: [
      productColumn("Product", "FCN", "DRA"), sourceColumn("Currency", "currency"), sourceColumn("BBG Code 1", "bbgCode1"), sourceColumn("BBG Code 2", "bbgCode2"), sourceColumn("BBG Code 3", "bbgCode3"), sourceColumn("BBG Code 4", "bbgCode4"), sourceColumn("Strike (%)", "strike"), sourceColumn("KO Type", "koType"), sourceColumn("Guaranteed Periods (m)", "guaranteedPeriods"), sourceColumn("KO Barrier (%)", "koBarrier"), sourceColumn("Coupon p.a. (%)", "coupon"), sourceColumn("Upfront / NotePrice (%)", "upfront"), sourceColumn("Tenor (m)", "tenor"), sourceColumn("Barrier Type", "barrierType"), sourceColumn("KI Barrier (%)", "kiBarrier"), sourceColumn("Observation Frequency (m)", "observationFrequency"), sourceColumn("OTC", "otc"), blankColumn("Funding Spread (bps)"), blankColumn("Remarks"),
    ],
  },
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function buildEmailBody(columns, dataRows) {
  const header = columns.map(column => column.label).join("\t");
  const values = dataRows.map(values => values.join("\t"));
  return [header, ...values].join("\r\n");
}

export function buildEmailHtml(columns, dataRows) {
  const headerCells = columns.map(column =>
    `<th style="border:1px solid #ffffff;background:#184e77;color:#ffffff;padding:8px 6px;font:700 11px Arial,Calibri,sans-serif;text-align:center;vertical-align:middle;white-space:nowrap;">${escapeHtml(column.label)}</th>`
  ).join("");
  const tableRows = dataRows.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const cellValue = columnIndex === values.length - 1 && value === "" ? "&nbsp;" : escapeHtml(value);
      return `<td style="border:1px solid #b7c9d3;padding:8px 6px;font:11px Arial,Calibri,sans-serif;text-align:center;vertical-align:middle;white-space:nowrap;">${cellValue}</td>`;
    }).join("");
    return `<tr style="background:${rowIndex % 2 ? "#f6fafc" : "#ffffff"};">${cells}</tr>`;
  }).join("");

  return `<!doctype html>
<html><body style="margin:0;font-family:Arial,Calibri,sans-serif;color:#000000;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #b7c9d3;font-family:Arial,Calibri,sans-serif;">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body></html>`;
}

// Sanitized branch label placed in the outbound subject after the issuer base subject.
// Keeps only CJK ideographs and digits (NFKC-normalized) so user-entered text can never
// inject an issuer code, the [RFQ:]/[BATCH:] tags, or the ## requester marker into the
// subject. Appends 「分行」 only when the sanitized value does not already end with it.
export function branchSubjectLabel(rawBranchName) {
  const normalized = String(rawBranchName ?? "").normalize("NFKC");
  const kept = Array.from(normalized).filter(character => /[一-鿿0-9\s]/u.test(character)).join("");
  const collapsed = kept.replace(/\s+/g, " ").trim().slice(0, 20);
  if (!collapsed) return "";
  return collapsed.endsWith("分行") ? collapsed : `${collapsed}分行`;
}

export function buildCorrelatedSubject(baseSubject, rfqToken, batchCode) {
  if (/##|^(?:re|fw|fwd)\s*:/i.test(baseSubject)) throw new Error("Unsafe outbound base subject.");
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(rfqToken)) throw new Error("Invalid RFQ correlation token.");
  if (!MAIL_INSTITUTION_ORDER.includes(batchCode)) throw new Error("Invalid outbound batch code.");
  return `${baseSubject} [RFQ:${rfqToken}][BATCH:${batchCode}]`;
}

export function buildInstitutionEmail(key, records, correlation) {
  const institution = EMAIL_INSTITUTIONS[key];
  if (!institution) throw new Error("Unknown email institution.");
  const dataRows = records.map(record => institution.columns.map(column => String(column.value(record) ?? "")));
  const subjectBase = correlation?.subjectBase ?? institution.subject;
  return {
    key,
    label: institution.label,
    subject: correlation
      ? buildCorrelatedSubject(subjectBase, correlation.rfqToken, correlation.batchCode ?? key)
      : institution.subject,
    html: buildEmailHtml(institution.columns, dataRows),
    plainText: buildEmailBody(institution.columns, dataRows),
  };
}
