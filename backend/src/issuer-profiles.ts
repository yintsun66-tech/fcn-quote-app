import type { Issuer } from "./inbound-parser";

export const ISSUER_PROFILE_VERSION = "issuer-fcn-v3";

export type QuoteStatus =
  | "VALID"
  | "NO_QUOTE"
  | "INVALID_VALUE"
  | "PARSE_ERROR"
  | "ISSUER_REJECTED"
  | "TIMEOUT"
  | "LATE_REPLY"
  | "SENDER_MISMATCH"
  | "UNMATCHED_RFQ"
  | "AMBIGUOUS_TRADE_MATCH"
  | "DUPLICATE"
  | "PRODUCT_MISMATCH"
  | "UNIT_UNCONFIRMED"
  | "MANUAL_REVIEW";

export type PriceSemantics = "NOTE_PRICE" | "COST" | "OFFER_PRICE" | "UPFRONT";
export type CanonicalProduct = "FCN" | "DAC";

export interface ParsedIssuerRow {
  issuer: Issuer;
  issuerDisplayName: string;
  parserProfile: string;
  sourceTableIndex: number;
  sourceRowIndex: number;
  rawValues: string[];
  product: CanonicalProduct | null;
  currency: string | null;
  tenorMonths: number | null;
  guaranteedPeriodsMonths: number | null;
  underlyings: string[];
  strikePct: number | null;
  koType: string | null;
  koBarrierPct: number | null;
  couponPaPct: number | null;
  rawPriceValue: number | null;
  rawPriceLabel: string;
  priceSemantics: PriceSemantics;
  comparablePricePct: number | null;
  barrierType: string | null;
  kiBarrierPct: number | null;
  observationFrequencyMonths: number | null;
  otc: string | null;
  effectiveDateOffsetCalendarDays: number | null;
  quoteReference: string | null;
  issuerComment: string | null;
  rejectionReason: string | null;
  warnings: string[];
  rawTargetValues: {
    strike: string;
    koBarrier: string;
    coupon: string;
    price: string;
    kiBarrier: string;
  };
}

interface TableLike {
  index: number;
  rows: string[][];
}

interface ParsedTablesDocument {
  tables: TableLike[];
}

type Unit = "WHOLE_PERCENT" | "DECIMAL_FRACTION";

interface StandardColumns {
  product: number;
  currency: number;
  guaranteed: number;
  underlyings: number[];
  strike: number;
  koType: number;
  koBarrier: number;
  coupon: number;
  price: number;
  tenor: number;
  barrierType: number;
  kiBarrier: number;
  observation: number;
  otc?: number;
  effectiveOffset?: number;
  reference?: number;
  comment?: number;
}

interface StandardProfile {
  issuer: Issuer;
  displayName: string;
  profile: string;
  columns: StandardColumns;
  unit: Unit;
  priceLabel: string;
  priceSemantics: PriceSemantics;
}

interface SgColumns {
  underlyings: number[];
  tenor: number;
  observation: number;
  currency: number;
  coupon: number;
  fixedCoupons: number;
  guaranteed: number;
  strike: number;
  koBarrier: number;
  koType: number;
  barrierType: number;
  kiBarrier: number;
  price: number;
  comment?: number;
}

const STANDARD_PROFILES: Partial<Record<Issuer, StandardProfile>> = Object.freeze({
  BNP: {
    issuer: "BNP", displayName: "BNP", profile: "BNP_FCN_V1", unit: "WHOLE_PERCENT",
    priceLabel: "Upfront / NotePrice (%)", priceSemantics: "NOTE_PRICE",
    columns: { product: 1, currency: 2, guaranteed: 3, underlyings: [4, 5, 6, 7, 8], strike: 9, koType: 10, koBarrier: 11, coupon: 12, price: 13, tenor: 14, barrierType: 15, kiBarrier: 16, observation: 17, otc: 18, effectiveOffset: 19, reference: 0, comment: 24 }
  },
  BARCLAYS: {
    issuer: "BARCLAYS", displayName: "BARCLAYS", profile: "BARCLAYS_FCN_V2", unit: "WHOLE_PERCENT",
    priceLabel: "Upfront / NotePrice (%)", priceSemantics: "NOTE_PRICE",
    columns: { product: 0, currency: 1, guaranteed: 2, underlyings: [3, 4, 5, 6, 7], strike: 8, koType: 9, koBarrier: 10, coupon: 11, price: 12, tenor: 13, barrierType: 14, kiBarrier: 15, observation: 16, otc: 17, effectiveOffset: 18, reference: 24 }
  },
  JPM: {
    issuer: "JPM", displayName: "JPM", profile: "JPM_FCN_V1", unit: "WHOLE_PERCENT",
    priceLabel: "Upfront / NotePrice (%)", priceSemantics: "NOTE_PRICE",
    columns: { product: 0, currency: 1, guaranteed: 2, underlyings: [3, 4, 5, 6, 7], strike: 8, koType: 9, koBarrier: 10, coupon: 11, price: 12, tenor: 13, barrierType: 14, kiBarrier: 15, observation: 16, otc: 17, effectiveOffset: 18, reference: 20, comment: 21 }
  },
  NOMURA: {
    issuer: "NOMURA", displayName: "NOMURA", profile: "NOMURA_FCN_V1", unit: "WHOLE_PERCENT",
    priceLabel: "Upfront / NotePrice (%)", priceSemantics: "NOTE_PRICE",
    columns: { product: 1, currency: 2, guaranteed: 3, underlyings: [5, 6, 7, 8, 9], strike: 10, koType: 11, koBarrier: 12, coupon: 13, price: 14, tenor: 15, barrierType: 16, kiBarrier: 17, observation: 18, otc: 19, effectiveOffset: 21, reference: 0, comment: 24 }
  },
  DBS: {
    issuer: "DBS", displayName: "DBS", profile: "DBS_FCN_V1", unit: "DECIMAL_FRACTION",
    priceLabel: "Upfront / NotePrice (%)", priceSemantics: "NOTE_PRICE",
    columns: { product: 0, currency: 1, guaranteed: 2, underlyings: [3, 4, 5, 6], strike: 7, koType: 8, koBarrier: 9, coupon: 10, price: 11, tenor: 12, barrierType: 13, kiBarrier: 14, observation: 15, otc: 16, reference: 22 }
  },
  UBS: {
    issuer: "UBS", displayName: "UBS", profile: "UBS_FCN_V2", unit: "WHOLE_PERCENT",
    priceLabel: "Cost (%)", priceSemantics: "COST",
    columns: { product: 0, currency: 1, guaranteed: 2, underlyings: [3, 4, 5, 6, 7], strike: 8, koType: 9, koBarrier: 10, coupon: 11, price: 12, tenor: 13, barrierType: 14, kiBarrier: 15, observation: 16, otc: 17 }
  },
  GS: {
    issuer: "GS", displayName: "GS", profile: "GS_FCN_V1", unit: "WHOLE_PERCENT",
    priceLabel: "Cost (%)", priceSemantics: "COST",
    columns: { product: 0, currency: 1, guaranteed: 2, underlyings: [3, 4, 5, 6, 7], strike: 8, koType: 9, koBarrier: 10, coupon: 11, price: 12, tenor: 13, barrierType: 14, kiBarrier: 15, observation: 16, effectiveOffset: 18, comment: 20 }
  },
  CA: {
    issuer: "CA", displayName: "CA", profile: "CA_FCN_V1", unit: "WHOLE_PERCENT",
    priceLabel: "Upfront / NotePrice (%)", priceSemantics: "NOTE_PRICE",
    columns: { product: 0, currency: 1, guaranteed: 8, underlyings: [2, 3, 4, 5], strike: 6, koType: 7, koBarrier: 9, coupon: 10, price: 11, tenor: 12, barrierType: 13, kiBarrier: 14, observation: 15, otc: 16, reference: 20, comment: 18 }
  }
});

const INVALID_VALUES = /^(?:N\/?A|NA|DNW|NO\s*QUOTE|NOT\s*AVAILABLE|ERROR|-+)$/iu;
const REJECTION_TEXT = /(?:REJECT|LIMIT|PLEASE\s+CONTACT\s+SALES|NOT\s+AVAILABLE|超過限制|不報價|無法報價)/iu;

function text(row: readonly string[], index: number | undefined): string {
  if (index === undefined) return "";
  return String(row[index] ?? "").replace(/[\u00a0\u2007\u202f]/gu, " ").trim();
}

function optionalText(row: readonly string[], index: number | undefined): string | null {
  const value = text(row, index);
  return value ? value : null;
}

function rawNumber(value: string): number | null {
  const normalized = value.replace(/,/g, "").replace(/%/g, "").trim();
  if (!normalized || INVALID_VALUES.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function percentage(value: string, unit: Unit): number | null {
  const parsed = rawNumber(value);
  if (parsed === null) return null;
  if (value.includes("%")) return parsed;
  return unit === "DECIMAL_FRACTION" ? parsed * 100 : parsed;
}

function months(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:M|MONTHS?)?\s*$/iu.exec(value);
  if (!match?.[1]) return null;
  const result = Number(match[1]);
  return Number.isFinite(result) ? result : null;
}

function integer(value: string): number | null {
  const result = rawNumber(value);
  return result !== null && Number.isInteger(result) ? result : null;
}

function product(value: string): CanonicalProduct | null {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (normalized === "FCN" || normalized === "FCA") return "FCN";
  // Shared DAC family aliases. UBS reply-only VMRAN is intentionally handled in its issuer profile.
  if (normalized === "DAC" || normalized === "DRA" || normalized === "WRA"
    || normalized === "RANGE ACCRUAL") return "DAC";
  return null;
}

function currency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/u.test(normalized) ? normalized : null;
}

function underlying(value: string): string | null {
  const normalized = value.normalize("NFKC").trim().toUpperCase().replace(/\s+/gu, " ");
  if (!normalized || INVALID_VALUES.test(normalized)) return null;
  return normalized;
}

function barrier(value: string): "NONE" | "EKI" | "AKI" | null {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (!normalized || normalized === "NA" || normalized === "N/A" || normalized === "NONE" || normalized === "-") return "NONE";
  if (normalized.includes("EUROPEAN") || normalized === "EKI") return "EKI";
  if (normalized.includes("DAILY") || normalized.includes("CONTINUOUS") || normalized === "AKI") return "AKI";
  return null;
}

function yes(value: string): boolean {
  return /^(?:TRUE|YES|Y|1)$/iu.test(value.trim());
}

function koType(value: string, memoryValue?: string): string | null {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (!normalized) return null;
  const daily = normalized.includes("DAILY") || normalized === "TRUE";
  const memory = normalized.includes("MEMORY") || (memoryValue ? yes(memoryValue) : false);
  return daily ? (memory ? "Daily Memory" : "Daily") : (memory ? "Period End Memory" : "Period End");
}

function targetRaw(row: readonly string[], strike: number, koBarrier: number, coupon: number, price: number, kiBarrier: number): ParsedIssuerRow["rawTargetValues"] {
  return {
    strike: text(row, strike),
    koBarrier: text(row, koBarrier),
    coupon: text(row, coupon),
    price: text(row, price),
    kiBarrier: text(row, kiBarrier)
  };
}

function rejection(comment: string | null, rawTargets: ParsedIssuerRow["rawTargetValues"], barrierType: string | null): string | null {
  if (comment && REJECTION_TEXT.test(comment)) return comment.slice(0, 1_000);
  // KI barrier is legitimately "NA"/"-" when there is no knock-in (barrier type NONE); scanning it
  // there made normal NONE-barrier quotes (e.g. MS) look ISSUER_REJECTED. Only scan it when a KI applies.
  const scan = [rawTargets.strike, rawTargets.koBarrier, rawTargets.coupon, rawTargets.price];
  if (barrierType !== "NONE") scan.push(rawTargets.kiBarrier);
  const invalid = scan.find(value => INVALID_VALUES.test(value));
  return invalid ? invalid : null;
}

function comparablePrice(raw: number | null, semantics: PriceSemantics): number | null {
  if (raw === null) return null;
  return semantics === "UPFRONT" ? 100 - raw : raw;
}

function normalizedHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "");
}

function findHeaderIndex(headers: readonly string[], aliases: readonly string[]): number {
  const normalizedAliases = new Set(aliases.map(normalizedHeader));
  return headers.findIndex(header => normalizedAliases.has(normalizedHeader(header)));
}

function barclaysQuoteHeaderIndex(rows: readonly string[][]): number {
  return rows.findIndex(row =>
    findHeaderIndex(row, ["Product"]) >= 0
    && findHeaderIndex(row, ["Quote ID", "Quote Id"]) >= 0
  );
}

function barclaysCometErrors(document: ParsedTablesDocument): Map<number, Map<number, string>> {
  const errorsByQuoteTable = new Map<number, Map<number, string>>();
  let currentQuoteTableIndex: number | null = null;
  for (const table of document.tables ?? []) {
    if (barclaysQuoteHeaderIndex(table.rows) >= 0) currentQuoteTableIndex = table.index;
    for (let headerIndex = 0; headerIndex < table.rows.length; headerIndex += 1) {
      const headers = table.rows[headerIndex] ?? [];
      const underlyingColumn = findHeaderIndex(headers, ["Underlying (Bloomberg)"]);
      const rowColumn = findHeaderIndex(headers, ["Row"]);
      const messageColumn = findHeaderIndex(headers, ["Message"]);
      if (currentQuoteTableIndex === null || underlyingColumn < 0 || rowColumn < 0 || messageColumn < 0) continue;
      const errors = errorsByQuoteTable.get(currentQuoteTableIndex) ?? new Map<number, string>();
      for (let rowIndex = headerIndex + 1; rowIndex < table.rows.length; rowIndex += 1) {
        const source = table.rows[rowIndex] ?? [];
        const sequence = integer(text(source, rowColumn));
        const message = text(source, messageColumn)
          .replace(/&quot;/giu, "\"")
          .replace(/&nbsp;|&#160;/giu, " ")
          .trim();
        if (sequence !== null && sequence > 0 && /COMET\s+EMAIL\s+PARSER\s+ERRORS/iu.test(message)) {
          errors.set(sequence, message.slice(0, 1_000));
        }
      }
      if (errors.size > 0) errorsByQuoteTable.set(currentQuoteTableIndex, errors);
    }
  }
  return errorsByQuoteTable;
}

const SG_PERIOD_WORDS = new Set([
  "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT",
  "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN",
  "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN", "TWENTY",
  "TWENTY ONE", "TWENTY TWO", "TWENTY THREE", "TWENTY FOUR",
  "TWENTY-ONE", "TWENTY-TWO", "TWENTY-THREE", "TWENTY-FOUR"
]);

function sgProduct(fixedCoupons: string): CanonicalProduct | null {
  const normalized = fixedCoupons.normalize("NFKC").trim().toUpperCase().replace(/\s+/gu, " ");
  if (normalized === "ALL PERIODS") return "FCN";
  if (/^\d+$/u.test(normalized)) return Number(normalized) >= 1 && Number(normalized) <= 24 ? "DAC" : null;
  const firstPeriods = /^FIRST(?:\s+(.+?))?\s+PERIODS?$/u.exec(normalized);
  const count = firstPeriods?.[1];
  if (firstPeriods && (!count || SG_PERIOD_WORDS.has(count)
    || (/^\d+$/u.test(count) && Number(count) >= 1 && Number(count) <= 24))) return "DAC";
  return null;
}

function sgColumns(rows: readonly string[][]): SgColumns | null {
  for (const row of rows) {
    const underlyings = row
      .map((header, index) => ({ header: normalizedHeader(header), index }))
      .filter(item => /^UNDERLYING\d*$/u.test(item.header))
      .map(item => item.index);
    const columns: SgColumns = {
      underlyings,
      tenor: findHeaderIndex(row, ["No. of Periods", "No of Periods", "Periods"]),
      observation: findHeaderIndex(row, ["Settlement Frequency", "Frequency"]),
      currency: findHeaderIndex(row, ["Currency"]),
      coupon: findHeaderIndex(row, ["Coupon p.a.", "Coupon pa", "Coupon"]),
      fixedCoupons: findHeaderIndex(row, ["Fixed Coupons"]),
      guaranteed: findHeaderIndex(row, ["Non-Call (m)", "Non Call", "Non-call"]),
      strike: findHeaderIndex(row, ["Put Strike", "Strike"]),
      koBarrier: findHeaderIndex(row, ["AutoCall", "Autocall Barrier", "KO Barrier"]),
      koType: findHeaderIndex(row, ["KO Type"]),
      barrierType: findHeaderIndex(row, ["KI Type", "Barrier Type"]),
      kiBarrier: findHeaderIndex(row, ["KI", "KI Barrier"]),
      price: findHeaderIndex(row, ["Offer Price"]),
      comment: findHeaderIndex(row, ["Comment", "Comments"])
    };
    const required = [
      columns.tenor,
      columns.observation,
      columns.currency,
      columns.coupon,
      columns.fixedCoupons,
      columns.guaranteed,
      columns.strike,
      columns.koBarrier,
      columns.koType,
      columns.barrierType,
      columns.kiBarrier,
      columns.price
    ];
    if (underlyings.length > 0 && required.every(index => index >= 0)) {
      if (columns.comment !== undefined && columns.comment < 0) delete columns.comment;
      return columns;
    }
  }
  return null;
}

function standardRow(profile: StandardProfile, row: string[], tableIndex: number, rowIndex: number): ParsedIssuerRow | null {
  const columns = profile.columns;
  const rawProduct = text(row, columns.product);
  const parsedProduct = profile.issuer === "UBS" && rawProduct.normalize("NFKC").trim().toUpperCase() === "VMRAN"
    ? "DAC"
    : product(rawProduct);
  const parsedCurrency = currency(text(row, columns.currency));
  const underlyings = columns.underlyings.map(index => underlying(text(row, index))).filter((value): value is string => Boolean(value));
  if (!parsedProduct || !parsedCurrency || underlyings.length === 0) return null;
  const rawTargets = targetRaw(row, columns.strike, columns.koBarrier, columns.coupon, columns.price, columns.kiBarrier);
  const rawPriceValue = percentage(rawTargets.price, profile.unit);
  const comment = optionalText(row, columns.comment);
  const barrierType = barrier(text(row, columns.barrierType));
  const kiBarrier = barrierType === "NONE" && rawNumber(rawTargets.kiBarrier) === 0
    ? null
    : percentage(rawTargets.kiBarrier, profile.unit);
  return {
    issuer: profile.issuer,
    issuerDisplayName: profile.displayName,
    parserProfile: profile.profile,
    sourceTableIndex: tableIndex,
    sourceRowIndex: rowIndex,
    rawValues: row,
    product: parsedProduct,
    currency: parsedCurrency,
    tenorMonths: months(text(row, columns.tenor)),
    guaranteedPeriodsMonths: integer(text(row, columns.guaranteed)),
    underlyings,
    strikePct: percentage(rawTargets.strike, profile.unit),
    koType: koType(text(row, columns.koType)),
    koBarrierPct: percentage(rawTargets.koBarrier, profile.unit),
    couponPaPct: percentage(rawTargets.coupon, profile.unit),
    rawPriceValue,
    rawPriceLabel: profile.priceLabel,
    priceSemantics: profile.priceSemantics,
    comparablePricePct: comparablePrice(rawPriceValue, profile.priceSemantics),
    barrierType,
    kiBarrierPct: kiBarrier,
    observationFrequencyMonths: integer(text(row, columns.observation)),
    otc: optionalText(row, columns.otc),
    effectiveDateOffsetCalendarDays: integer(text(row, columns.effectiveOffset)),
    quoteReference: optionalText(row, columns.reference),
    issuerComment: comment,
    rejectionReason: rejection(comment, rawTargets, barrierType),
    warnings: [],
    rawTargetValues: rawTargets
  };
}

interface MsColumns {
  currency: number;
  underlyings: number[];
  tenor: number;
  observation: number;
  coupon: number;
  strike: number;
  barrierType: number;
  kiBarrier: number;
  koBarrier: number;
  koType: number;
  koMemory: number;
  guaranteed: number;
  price: number;
}

// MS FCN and DRA (Range Accrual) reply layouts differ: DRA inserts "Accrual Barrier" (after
// Coupon) and "Fixed Coupon (m)" (after KO Type), shifting Put Strike/KI/KO/Non-Call/Note Price.
// Columns per the reference workbook (資料來源MS(23) for FCN, 資料來源MS(DRA) for DRA).
const MS_FCN_COLUMNS: MsColumns = {
  currency: 9, underlyings: [3, 4, 5, 6, 7, 8], tenor: 10, observation: 11, coupon: 12,
  strike: 13, barrierType: 14, kiBarrier: 15, koBarrier: 16, koType: 17, koMemory: 19,
  guaranteed: 18, price: 22
};
const MS_DRA_COLUMNS: MsColumns = {
  currency: 9, underlyings: [3, 4, 5, 6, 7, 8], tenor: 10, observation: 11, coupon: 12,
  strike: 14, barrierType: 15, kiBarrier: 16, koBarrier: 17, koType: 18, koMemory: 21,
  guaranteed: 20, price: 24
};

function msRow(row: string[], tableIndex: number, rowIndex: number): ParsedIssuerRow | null {
  const parsedProduct = product(text(row, 1));
  if (!parsedProduct) return null;
  // DAC (MS "Range Accrual") uses the shifted DRA layout; FCN uses the base layout.
  const columns = parsedProduct === "DAC" ? MS_DRA_COLUMNS : MS_FCN_COLUMNS;
  const parsedCurrency = currency(text(row, columns.currency));
  const underlyings = columns.underlyings.map(index => underlying(text(row, index))).filter((value): value is string => Boolean(value));
  if (!parsedCurrency || underlyings.length === 0) return null;
  const rawTargets = targetRaw(row, columns.strike, columns.koBarrier, columns.coupon, columns.price, columns.kiBarrier);
  const rawPriceValue = percentage(rawTargets.price, "DECIMAL_FRACTION");
  const barrierType = barrier(text(row, columns.barrierType));
  return {
    issuer: "MS", issuerDisplayName: "MS（OBU不得承做）",
    parserProfile: parsedProduct === "DAC" ? "MS_DRA_V1" : "MS_FCN_V1",
    sourceTableIndex: tableIndex, sourceRowIndex: rowIndex, rawValues: row,
    product: parsedProduct, currency: parsedCurrency, tenorMonths: months(text(row, columns.tenor)),
    // MS puts the non-call periods as e.g. "1m"; months() accepts the "m" suffix (integer() rejected
    // it, leaving guaranteedPeriodsMonths null so every row failed trade matching → PARSE_ERROR).
    guaranteedPeriodsMonths: months(text(row, columns.guaranteed)), underlyings,
    strikePct: percentage(rawTargets.strike, "DECIMAL_FRACTION"),
    koType: koType(text(row, columns.koType), text(row, columns.koMemory)),
    koBarrierPct: percentage(rawTargets.koBarrier, "DECIMAL_FRACTION"),
    couponPaPct: percentage(rawTargets.coupon, "DECIMAL_FRACTION"), rawPriceValue,
    rawPriceLabel: "Note Price", priceSemantics: "NOTE_PRICE", comparablePricePct: rawPriceValue,
    barrierType, kiBarrierPct: barrierType === "NONE" ? null : percentage(rawTargets.kiBarrier, "DECIMAL_FRACTION"),
    observationFrequencyMonths: months(text(row, columns.observation)), otc: "Note", effectiveDateOffsetCalendarDays: null,
    quoteReference: optionalText(row, 0), issuerComment: "MS（OBU不得承做）", rejectionReason: rejection(null, rawTargets, barrierType),
    warnings: ["MS_OBU_RESTRICTION_REQUIRES_USER_ATTRIBUTE"], rawTargetValues: rawTargets
  };
}

function sgRow(row: string[], tableIndex: number, rowIndex: number, detectedColumns: SgColumns | null): ParsedIssuerRow | null {
  const columns: SgColumns = detectedColumns ?? {
    underlyings: [4, 5, 6, 7, 8],
    tenor: 9,
    observation: 10,
    currency: 11,
    coupon: 13,
    fixedCoupons: 14,
    guaranteed: 15,
    strike: 16,
    koBarrier: 17,
    koType: 18,
    barrierType: 19,
    kiBarrier: 20,
    price: 21,
    comment: 23
  };
  const parsedCurrency = currency(text(row, columns.currency));
  const underlyings = columns.underlyings.map(index => underlying(text(row, index))).filter((value): value is string => Boolean(value));
  const parsedProduct = sgProduct(text(row, columns.fixedCoupons));
  if (!parsedProduct || !parsedCurrency || underlyings.length === 0) return null;
  const rawTargets = targetRaw(row, columns.strike, columns.koBarrier, columns.coupon, columns.price, columns.kiBarrier);
  const rawPriceValue = percentage(rawTargets.price, "DECIMAL_FRACTION");
  const comment = optionalText(row, columns.comment);
  const barrierType = barrier(text(row, columns.barrierType));
  return {
    issuer: "SG", issuerDisplayName: "SG",
    parserProfile: parsedProduct === "DAC" ? "SG_DAC_V1" : (detectedColumns ? "SG_FCN_V2" : "SG_FCN_V1"),
    sourceTableIndex: tableIndex, sourceRowIndex: rowIndex, rawValues: row,
    product: parsedProduct, currency: parsedCurrency, tenorMonths: months(text(row, columns.tenor)),
    guaranteedPeriodsMonths: integer(text(row, columns.guaranteed)), underlyings,
    strikePct: percentage(rawTargets.strike, "DECIMAL_FRACTION"), koType: koType(text(row, columns.koType)),
    koBarrierPct: percentage(rawTargets.koBarrier, "DECIMAL_FRACTION"), couponPaPct: percentage(rawTargets.coupon, "DECIMAL_FRACTION"),
    rawPriceValue, rawPriceLabel: "Offer Price", priceSemantics: "OFFER_PRICE", comparablePricePct: rawPriceValue,
    barrierType, kiBarrierPct: barrierType === "NONE" ? null : percentage(rawTargets.kiBarrier, "DECIMAL_FRACTION"),
    observationFrequencyMonths: /^MONTHLY$/iu.test(text(row, columns.observation)) ? 1 : months(text(row, columns.observation)),
    otc: "Note", effectiveDateOffsetCalendarDays: null, quoteReference: null, issuerComment: comment,
    rejectionReason: rejection(comment, rawTargets, barrierType),
    warnings: [detectedColumns ? "SG_HEADER_MAPPED_DYNAMICALLY" : "SG_SOURCE_HEADERS_ARE_POSITIONAL"],
    rawTargetValues: rawTargets
  };
}

function citiRow(row: string[], tableIndex: number, rowIndex: number): ParsedIssuerRow | null {
  const parsedProduct = product(text(row, 0));
  const parsedCurrency = currency(text(row, 2));
  const underlyings = [5, 6, 7, 8, 9].map(index => underlying(text(row, index))).filter((value): value is string => Boolean(value));
  if (!parsedProduct || !parsedCurrency || underlyings.length === 0) return null;
  const rawTargets = targetRaw(row, 10, 15, 18, 19, 12);
  const rawPriceValue = percentage(rawTargets.price, "WHOLE_PERCENT");
  const comment = optionalText(row, 29);
  const barrierType = barrier(text(row, 11));
  const memory = text(row, 16);
  const daily = text(row, 17);
  const normalizedKoType = yes(daily) ? (yes(memory) ? "Daily Memory" : "Daily") : (yes(memory) ? "Period End Memory" : "Period End");
  const nonCallable = integer(text(row, 14));
  return {
    issuer: "CITI", issuerDisplayName: "CITI", parserProfile: "CITI_FCN_V1",
    sourceTableIndex: tableIndex, sourceRowIndex: rowIndex, rawValues: row,
    product: parsedProduct, currency: parsedCurrency, tenorMonths: months(text(row, 3)),
    guaranteedPeriodsMonths: nonCallable === null ? null : nonCallable + 1, underlyings,
    strikePct: percentage(rawTargets.strike, "WHOLE_PERCENT"), koType: normalizedKoType,
    koBarrierPct: percentage(rawTargets.koBarrier, "WHOLE_PERCENT"), couponPaPct: percentage(rawTargets.coupon, "WHOLE_PERCENT"),
    rawPriceValue, rawPriceLabel: "Upfront (%)", priceSemantics: "UPFRONT", comparablePricePct: comparablePrice(rawPriceValue, "UPFRONT"),
    barrierType, kiBarrierPct: barrierType === "NONE" ? null : percentage(rawTargets.kiBarrier, "WHOLE_PERCENT"),
    observationFrequencyMonths: integer(text(row, 13)), otc: "Note", effectiveDateOffsetCalendarDays: integer(text(row, 4)),
    quoteReference: optionalText(row, 30), issuerComment: comment, rejectionReason: rejection(comment, rawTargets, barrierType),
    warnings: ["CITI_UPFRONT_CONVERTED_TO_NOTE_PRICE"], rawTargetValues: rawTargets
  };
}

export function parseIssuerTables(issuer: Issuer, document: ParsedTablesDocument): ParsedIssuerRow[] {
  const result: ParsedIssuerRow[] = [];
  const barclaysErrors = issuer === "BARCLAYS"
    ? barclaysCometErrors(document)
    : new Map<number, Map<number, string>>();
  for (const table of document.tables ?? []) {
    const detectedSgColumns = issuer === "SG" ? sgColumns(table.rows) : null;
    const barclaysHeaderIndex = issuer === "BARCLAYS" ? barclaysQuoteHeaderIndex(table.rows) : -1;
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
      const source = table.rows[rowIndex] ?? [];
      const row = issuer === "MS"
        ? msRow(source, table.index, rowIndex)
        : issuer === "SG"
          ? sgRow(source, table.index, rowIndex, detectedSgColumns)
          : issuer === "CITI"
            ? citiRow(source, table.index, rowIndex)
            : STANDARD_PROFILES[issuer]
              ? standardRow(STANDARD_PROFILES[issuer], source, table.index, rowIndex)
              : null;
      if (!row) continue;
      if (issuer === "BARCLAYS" && barclaysHeaderIndex >= 0) {
        const cometError = barclaysErrors.get(table.index)?.get(rowIndex - barclaysHeaderIndex);
        if (cometError) {
          row.issuerComment = cometError;
          row.rejectionReason = cometError;
          row.warnings.push("BARCLAYS_COMET_ERROR");
        }
      }
      result.push(row);
    }
  }
  return result;
}

export function rawTargetFor(row: ParsedIssuerRow, target: "COUPON" | "PRICE" | "STRIKE" | "KO_BARRIER" | "KI_BARRIER"): string {
  if (target === "COUPON") return row.rawTargetValues.coupon;
  if (target === "PRICE") return row.rawTargetValues.price;
  if (target === "STRIKE") return row.rawTargetValues.strike;
  if (target === "KO_BARRIER") return row.rawTargetValues.koBarrier;
  return row.rawTargetValues.kiBarrier;
}

export function targetValueFor(row: ParsedIssuerRow, target: "COUPON" | "PRICE" | "STRIKE" | "KO_BARRIER" | "KI_BARRIER"): number | null {
  if (target === "COUPON") return row.couponPaPct;
  if (target === "PRICE") return row.comparablePricePct;
  if (target === "STRIKE") return row.strikePct;
  if (target === "KO_BARRIER") return row.koBarrierPct;
  return row.kiBarrierPct;
}

export function invalidQuoteValue(value: string): boolean {
  return !value.trim() || INVALID_VALUES.test(value.trim());
}
