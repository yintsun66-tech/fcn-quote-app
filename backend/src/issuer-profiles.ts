import type { Issuer } from "./inbound-parser";

export const ISSUER_PROFILE_VERSION = "issuer-fcn-v1";

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

const STANDARD_PROFILES: Partial<Record<Issuer, StandardProfile>> = Object.freeze({
  BNP: {
    issuer: "BNP", displayName: "BNP", profile: "BNP_FCN_V1", unit: "WHOLE_PERCENT",
    priceLabel: "Upfront / NotePrice (%)", priceSemantics: "NOTE_PRICE",
    columns: { product: 1, currency: 2, guaranteed: 3, underlyings: [4, 5, 6, 7, 8], strike: 9, koType: 10, koBarrier: 11, coupon: 12, price: 13, tenor: 14, barrierType: 15, kiBarrier: 16, observation: 17, otc: 18, effectiveOffset: 19, reference: 0, comment: 24 }
  },
  BARCLAYS: {
    issuer: "BARCLAYS", displayName: "BARCLAYS", profile: "BARCLAYS_FCN_V1", unit: "WHOLE_PERCENT",
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
    issuer: "UBS", displayName: "UBS", profile: "UBS_FCN_V1", unit: "WHOLE_PERCENT",
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
  if (normalized === "DAC") return "DAC";
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

function rejection(comment: string | null, rawTargets: ParsedIssuerRow["rawTargetValues"]): string | null {
  if (comment && REJECTION_TEXT.test(comment)) return comment.slice(0, 1_000);
  const targetValues = Object.values(rawTargets);
  const invalid = targetValues.find(value => INVALID_VALUES.test(value));
  return invalid ? invalid : null;
}

function comparablePrice(raw: number | null, semantics: PriceSemantics): number | null {
  if (raw === null) return null;
  return semantics === "UPFRONT" ? 100 - raw : raw;
}

function standardRow(profile: StandardProfile, row: string[], tableIndex: number, rowIndex: number): ParsedIssuerRow | null {
  const columns = profile.columns;
  const parsedProduct = product(text(row, columns.product));
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
    rejectionReason: rejection(comment, rawTargets),
    warnings: [],
    rawTargetValues: rawTargets
  };
}

function msRow(row: string[], tableIndex: number, rowIndex: number): ParsedIssuerRow | null {
  const parsedProduct = product(text(row, 1));
  const parsedCurrency = currency(text(row, 9));
  const underlyings = [3, 4, 5, 6, 7, 8].map(index => underlying(text(row, index))).filter((value): value is string => Boolean(value));
  if (!parsedProduct || !parsedCurrency || underlyings.length === 0) return null;
  const rawTargets = targetRaw(row, 13, 16, 12, 22, 15);
  const rawPriceValue = percentage(rawTargets.price, "DECIMAL_FRACTION");
  const barrierType = barrier(text(row, 14));
  return {
    issuer: "MS", issuerDisplayName: "MS（OBU不得承做）", parserProfile: "MS_FCN_V1",
    sourceTableIndex: tableIndex, sourceRowIndex: rowIndex, rawValues: row,
    product: parsedProduct, currency: parsedCurrency, tenorMonths: months(text(row, 10)),
    // MS puts the non-call periods as e.g. "1m"; months() accepts the "m" suffix (integer() rejected
    // it, leaving guaranteedPeriodsMonths null so every row failed trade matching → PARSE_ERROR).
    guaranteedPeriodsMonths: months(text(row, 18)), underlyings,
    strikePct: percentage(rawTargets.strike, "DECIMAL_FRACTION"),
    koType: koType(text(row, 17), text(row, 19)),
    koBarrierPct: percentage(rawTargets.koBarrier, "DECIMAL_FRACTION"),
    couponPaPct: percentage(rawTargets.coupon, "DECIMAL_FRACTION"), rawPriceValue,
    rawPriceLabel: "Note Price", priceSemantics: "NOTE_PRICE", comparablePricePct: rawPriceValue,
    barrierType, kiBarrierPct: barrierType === "NONE" ? null : percentage(rawTargets.kiBarrier, "DECIMAL_FRACTION"),
    observationFrequencyMonths: months(text(row, 11)), otc: "Note", effectiveDateOffsetCalendarDays: null,
    quoteReference: optionalText(row, 0), issuerComment: "MS（OBU不得承做）", rejectionReason: rejection(null, rawTargets),
    warnings: ["MS_OBU_RESTRICTION_REQUIRES_USER_ATTRIBUTE"], rawTargetValues: rawTargets
  };
}

function sgRow(row: string[], tableIndex: number, rowIndex: number): ParsedIssuerRow | null {
  const parsedCurrency = currency(text(row, 11));
  const underlyings = [4, 5, 6, 7, 8].map(index => underlying(text(row, index))).filter((value): value is string => Boolean(value));
  const fixedCoupons = text(row, 14).toUpperCase();
  const parsedProduct: CanonicalProduct | null = fixedCoupons === "ALL PERIODS" ? "FCN" : null;
  if (!parsedProduct || !parsedCurrency || underlyings.length === 0) return null;
  const rawTargets = targetRaw(row, 16, 17, 13, 21, 20);
  const rawPriceValue = percentage(rawTargets.price, "DECIMAL_FRACTION");
  const comment = optionalText(row, 23);
  const barrierType = barrier(text(row, 19));
  return {
    issuer: "SG", issuerDisplayName: "SG", parserProfile: "SG_FCN_V1",
    sourceTableIndex: tableIndex, sourceRowIndex: rowIndex, rawValues: row,
    product: parsedProduct, currency: parsedCurrency, tenorMonths: months(text(row, 9)),
    guaranteedPeriodsMonths: integer(text(row, 15)), underlyings,
    strikePct: percentage(rawTargets.strike, "DECIMAL_FRACTION"), koType: koType(text(row, 18)),
    koBarrierPct: percentage(rawTargets.koBarrier, "DECIMAL_FRACTION"), couponPaPct: percentage(rawTargets.coupon, "DECIMAL_FRACTION"),
    rawPriceValue, rawPriceLabel: "Offer Price", priceSemantics: "OFFER_PRICE", comparablePricePct: rawPriceValue,
    barrierType, kiBarrierPct: barrierType === "NONE" ? null : percentage(rawTargets.kiBarrier, "DECIMAL_FRACTION"),
    observationFrequencyMonths: /^MONTHLY$/iu.test(text(row, 10)) ? 1 : months(text(row, 10)),
    otc: "Note", effectiveDateOffsetCalendarDays: null, quoteReference: null, issuerComment: comment,
    rejectionReason: rejection(comment, rawTargets), warnings: ["SG_SOURCE_HEADERS_ARE_POSITIONAL"], rawTargetValues: rawTargets
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
    quoteReference: optionalText(row, 30), issuerComment: comment, rejectionReason: rejection(comment, rawTargets),
    warnings: ["CITI_UPFRONT_CONVERTED_TO_NOTE_PRICE"], rawTargetValues: rawTargets
  };
}

export function parseIssuerTables(issuer: Issuer, document: ParsedTablesDocument): ParsedIssuerRow[] {
  const result: ParsedIssuerRow[] = [];
  for (const table of document.tables ?? []) {
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
      const source = table.rows[rowIndex] ?? [];
      const row = issuer === "MS"
        ? msRow(source, table.index, rowIndex)
        : issuer === "SG"
          ? sgRow(source, table.index, rowIndex)
          : issuer === "CITI"
            ? citiRow(source, table.index, rowIndex)
            : STANDARD_PROFILES[issuer]
              ? standardRow(STANDARD_PROFILES[issuer], source, table.index, rowIndex)
              : null;
      if (!row) continue;
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
