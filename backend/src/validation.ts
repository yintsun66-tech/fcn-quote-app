import { sha256Text, stableStringify } from "./crypto";
import { AppError } from "./errors";
import type { NormalizedTrade, TargetField } from "./types";

const CURRENCIES = new Set(["USD", "JPY", "EUR", "HKD", "CNH", "CAD", "GBP", "AUD"]);
const KO_TYPES = new Set(["Daily", "Daily Memory", "Period End", "Period End Memory"]);
const BARRIER_TYPES = new Set(["EKI", "AKI", "NONE"]);
const MONTHS = new Map([
  ["Jan", 0], ["Feb", 1], ["Mar", 2], ["Apr", 3], ["May", 4], ["Jun", 5],
  ["Jul", 6], ["Aug", 7], ["Sep", 8], ["Oct", 9], ["Nov", 10], ["Dec", 11]
]);

function record(value: unknown, message = "請求內容格式不正確。 "): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(422, "VALIDATION_ERROR", message);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") throw fieldError(field, "必須為文字。 ");
  const normalized = value.trim().replace(/\s+/g, " ");
  const length = Array.from(normalized).length;
  if (length < min || length > max) throw fieldError(field, `長度必須介於 ${min} 至 ${max} 個字元。 `);
  if (/\p{Cc}/u.test(normalized)) throw fieldError(field, "不得包含控制字元。 ");
  return normalized;
}

function fieldError(field: string, message: string): AppError {
  return new AppError(422, "VALIDATION_ERROR", "輸入資料驗證失敗。 ", { [field]: message });
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw fieldError(field, `必須為 ${min} 至 ${max} 的整數。 `);
  }
  return parsed;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) throw fieldError(field, "必須為有效數字或空值。 ");
  return parsed;
}

function validTradeDate(value: unknown, field: string): string {
  const result = text(value, field, 9, 9);
  const match = /^(\d{2})-([A-Z][a-z]{2})-(\d{2})$/.exec(result);
  if (!match) throw fieldError(field, "格式必須為 DD-MMM-YY。 ");
  const day = Number(match[1]);
  const month = MONTHS.get(match[2] ?? "");
  const year = 2000 + Number(match[3]);
  if (month === undefined) throw fieldError(field, "月份縮寫不正確。 ");
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw fieldError(field, "日期不存在。 ");
  }
  return result;
}

export function normalizeUsername(value: unknown): string {
  const username = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9._-]{5,50}$/.test(username)) {
    throw fieldError("username", "須為 5 至 50 個小寫英數字或 . _ -。 ");
  }
  return username;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string") throw fieldError("password", "必須為文字。 ");
  const length = Array.from(value).length;
  if (length < 12 || length > 128) throw fieldError("password", "長度必須介於 12 至 128 個字元。 ");
  return value;
}

export interface RegistrationInput {
  employeeNumber: string;
  branchName: string;
  displayName: string;
  username: string;
  password: string;
}

export function normalizeRegistrationInput(value: unknown): RegistrationInput {
  const input = record(value);
  const employeeNumber = typeof input.employeeNumber === "string" ? input.employeeNumber.trim() : "";
  if (!/^\d{5}$/.test(employeeNumber)) throw fieldError("employeeNumber", "行編必須為五碼數字。 ");
  return {
    employeeNumber,
    branchName: text(input.branchName, "branchName", 1, 100),
    displayName: text(input.displayName, "displayName", 1, 100),
    username: normalizeUsername(input.username),
    password: validatePassword(input.password)
  };
}

export interface LoginInput {
  username: string;
  password: string;
}

export function normalizeLoginInput(value: unknown): LoginInput {
  const input = record(value);
  return {
    username: normalizeUsername(input.username),
    password: typeof input.password === "string" ? input.password : ""
  };
}

function normalizeUnderlying(value: unknown, field: string): string {
  const result = text(value, field, 1, 40).toUpperCase();
  if (!/^[A-Z0-9.\- /]+$/.test(result)) throw fieldError(field, "包含不允許的字元。 ");
  return result;
}

async function normalizeTrade(value: unknown, sequence: number): Promise<NormalizedTrade> {
  const input = record(value, `第 ${sequence} 筆交易格式不正確。 `);
  const product = text(input.product, `trades.${sequence - 1}.product`, 3, 3).toUpperCase();
  if (product !== "FCN" && product !== "DAC") throw fieldError(`trades.${sequence - 1}.product`, "只允許 FCN 或 DAC。 ");
  const currency = text(input.currency, `trades.${sequence - 1}.currency`, 3, 3).toUpperCase();
  if (!CURRENCIES.has(currency)) throw fieldError(`trades.${sequence - 1}.currency`, "不支援此幣別。 ");

  if (!Array.isArray(input.underlyings) || input.underlyings.length < 1 || input.underlyings.length > 5) {
    throw fieldError(`trades.${sequence - 1}.underlyings`, "必須包含 1 至 5 個連結標的。 ");
  }
  const underlyings = input.underlyings.map((underlying, index) => normalizeUnderlying(underlying, `trades.${sequence - 1}.underlyings.${index}`));
  if (new Set(underlyings).size !== underlyings.length) {
    throw fieldError(`trades.${sequence - 1}.underlyings`, "同一筆交易不得包含重複標的。 ");
  }

  const tenorMonths = integer(input.tenorMonths, `trades.${sequence - 1}.tenorMonths`, 1, 24);
  const guaranteedPeriodsMonths = integer(input.guaranteedPeriodsMonths, `trades.${sequence - 1}.guaranteedPeriodsMonths`, 1, tenorMonths);
  const strikePct = nullableNumber(input.strikePct, `trades.${sequence - 1}.strikePct`);
  if (strikePct !== null && (strikePct < 50 || strikePct > 100)) {
    throw fieldError(`trades.${sequence - 1}.strikePct`, "必須介於 50 至 100。 ");
  }
  const koBarrierPct = nullableNumber(input.koBarrierPct, `trades.${sequence - 1}.koBarrierPct`);
  const couponPaPct = nullableNumber(input.couponPaPct, `trades.${sequence - 1}.couponPaPct`);
  const upfrontOrNotePricePct = nullableNumber(input.upfrontOrNotePricePct, `trades.${sequence - 1}.upfrontOrNotePricePct`);
  const kiBarrierPct = nullableNumber(input.kiBarrierPct, `trades.${sequence - 1}.kiBarrierPct`);
  const koType = text(input.koType, `trades.${sequence - 1}.koType`, 5, 17);
  if (!KO_TYPES.has(koType)) throw fieldError(`trades.${sequence - 1}.koType`, "KO Type 不正確。 ");
  const barrierType = text(input.barrierType, `trades.${sequence - 1}.barrierType`, 3, 4).toUpperCase();
  if (!BARRIER_TYPES.has(barrierType)) throw fieldError(`trades.${sequence - 1}.barrierType`, "Barrier Type 不正確。 ");

  if (barrierType === "NONE" && kiBarrierPct !== null) {
    throw fieldError(`trades.${sequence - 1}.kiBarrierPct`, "Barrier Type 為 NONE 時必須為空值。 ");
  }
  const quoteValues: Array<[TargetField, number | null]> = barrierType === "NONE"
    ? [["STRIKE", strikePct], ["KO_BARRIER", koBarrierPct], ["COUPON", couponPaPct], ["PRICE", upfrontOrNotePricePct]]
    : [["STRIKE", strikePct], ["KO_BARRIER", koBarrierPct], ["COUPON", couponPaPct], ["PRICE", upfrontOrNotePricePct], ["KI_BARRIER", kiBarrierPct]];
  const blanks = quoteValues.filter(([, item]) => item === null);
  if (blanks.length !== 1) {
    throw fieldError(`trades.${sequence - 1}`, "價格相關欄位必須且只能有一個空值。 ");
  }
  const targetField = blanks[0]?.[0];
  if (!targetField) throw fieldError(`trades.${sequence - 1}`, "無法判斷求值欄位。 ");
  if (input.targetField !== undefined && input.targetField !== targetField) {
    throw fieldError(`trades.${sequence - 1}.targetField`, "與伺服器判斷的求值欄位不一致。 ");
  }

  const observation = integer(input.observationFrequencyMonths, `trades.${sequence - 1}.observationFrequencyMonths`, 1, 1);
  const offset = integer(input.effectiveDateOffsetCalendarDays, `trades.${sequence - 1}.effectiveDateOffsetCalendarDays`, 7, 7);
  const otc = text(input.otc, `trades.${sequence - 1}.otc`, 4, 4);
  if (otc !== "Note") throw fieldError(`trades.${sequence - 1}.otc`, "固定為 Note。 ");

  const matchingMaterial = {
    product,
    currency,
    tradeDate: validTradeDate(input.tradeDate, `trades.${sequence - 1}.tradeDate`),
    effectiveDateOffsetCalendarDays: offset,
    tenorMonths,
    guaranteedPeriodsMonths,
    underlyings,
    strikePct,
    koType,
    koBarrierPct,
    couponPaPct,
    upfrontOrNotePricePct,
    barrierType,
    kiBarrierPct,
    observationFrequencyMonths: observation,
    otc,
    targetField
  };

  return {
    sequence,
    tradeCode: `T${String(sequence).padStart(2, "0")}`,
    ...matchingMaterial,
    matchingKeyHash: await sha256Text(stableStringify(matchingMaterial))
  } as NormalizedTrade;
}

export async function normalizeRfqInput(value: unknown): Promise<NormalizedTrade[]> {
  const input = record(value);
  if (!Array.isArray(input.trades) || input.trades.length < 1 || input.trades.length > 20) {
    throw fieldError("trades", "交易筆數必須介於 1 至 20 筆。 ");
  }
  return Promise.all(input.trades.map((trade, index) => normalizeTrade(trade, index + 1)));
}
