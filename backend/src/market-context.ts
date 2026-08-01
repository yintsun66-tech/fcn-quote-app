import { keyedHash } from "./crypto";
import { nowIso } from "./db";
import { AppError } from "./errors";
import { clientAddress, jsonResponse } from "./http";
import type { AppEnv, SessionContext } from "./types";

const SEC_TICKER_DIRECTORY_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SEC_SUBMISSIONS_ORIGIN = "https://data.sec.gov";
const SEC_ARCHIVES_ORIGIN = "https://www.sec.gov";
const ALPHA_VANTAGE_ORIGIN = "https://www.alphavantage.co";
const TWELVE_DATA_ORIGIN = "https://api.twelvedata.com";
// Yahoo's keyless chart endpoint was tried as a fallback and removed on 2026-08-01. It answers 200
// from a residential address and 429 from this Worker: Cloudflare's shared egress is rate-limited by
// Yahoo, so it failed every time in production while passing every test from a developer machine.
// Do not re-add it without measuring from the Worker itself — a local curl proves nothing here.
const CACHE_LEASE_SECONDS = 30;
// How long a failed source waits before it is retried.
const ERROR_DIAGNOSTIC_SECONDS = 10 * 60;
// How long a failed source's row is *kept* — a different question from when to retry, and the two
// were previously the same number. `stale_until` gated both the retry and the deletion, so the
// two-minute cleanup erased every failure ten minutes after it happened. A provider could then fail
// for weeks while leaving nothing to diagnose: the usage counter showed requests, and the cache held
// no row of any status. Keeping the row costs one row per symbol and is the only reason anyone can
// answer "why is there no price?".
const ERROR_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const INSTRUMENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_SEC_DIRECTORY_BYTES = 5_000_000;
const MAX_SEC_SUBMISSIONS_BYTES = 5_000_000;
const MAX_ALPHA_VANTAGE_BYTES = 3_000_000;
const MAX_EQUITY_PROVIDER_BYTES = 3_000_000;
const TRANSIENT_UPSTREAM_STATUSES = new Set([502, 503, 504, 520]);
// Daily bars are requested for a window, then filtered down to completed sessions. Twenty-one
// completed sessions are needed for the 20-day derived metrics, so ask for comfortably more.
const EQUITY_BAR_WINDOW_DAYS = 60;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
// The logical source stored in the cache. `EQUITY_DAILY` is deliberately provider-independent: the
// provider that actually answered is recorded in the payload, so swapping providers does not strand
// cached rows under a name nothing reads.
type SourceName = "SEC" | "FRED" | "ALPHA_VANTAGE" | "EQUITY_DAILY";
export type EquityProvider = "TWELVE_DATA" | "ALPHA_VANTAGE";

const runtimeFetch: Fetcher = (input, init) => globalThis.fetch(input, init);

interface CacheRow {
  cache_key: string;
  source: SourceName;
  symbol: string | null;
  data_type: string;
  normalized_payload_json: string;
  source_as_of: string | null;
  fetched_at: string | null;
  expires_at: string;
  stale_until: string;
  etag: string | null;
  status: "FRESH" | "REFRESHING" | "ERROR";
  last_error_code: string | null;
  refresh_lease_expires_at: string | null;
}

interface InstrumentRow {
  symbol_normalized: string;
  company_name: string;
  exchange: string | null;
  sec_cik: string;
  sec_ticker: string;
  country: string;
  updated_at: string;
}

interface CacheLoadResult<T> {
  data: T;
  sourceAsOf: string | null;
  etag?: string | null;
}

export interface PublicSourceEnvelope<T> {
  source: SourceName;
  status: "FRESH" | "STALE" | "UNAVAILABLE";
  sourceAsOf: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  isStale: boolean;
  errorCode: string | null;
  data: T | null;
}

interface SecInstrument {
  symbol: string;
  companyName: string;
  exchange: string | null;
  cik: string;
  ticker: string;
  country: "US";
}

interface SecFiling {
  form: "10-K" | "10-Q" | "8-K";
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  officialUrl: string;
}

interface SecContext {
  company: SecInstrument;
  recentFilings: SecFiling[];
}

interface AlphaDailyPoint {
  tradingDate: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
}

export interface AlphaEquityContext extends AlphaDailyPoint {
  symbol: string;
  // Which provider actually answered. The cache row's source is the provider-independent
  // EQUITY_DAILY, so this is the only place that records it — and a reader must never assume the
  // price came from the provider they expected.
  provider: EquityProvider;
  providerAttempts: string[];
  priorTradingDate: string;
  priorClosePrice: number;
  dailyChangePct: number;
  averageVolume20d: number | null;
  relativeVolume20d: number | null;
  realizedVolatility20dPct: number | null;
  range20dPct: number | null;
}

interface AlphaDailyResponse {
  "Meta Data"?: Record<string, unknown>;
  "Time Series (Daily)"?: Record<string, Record<string, unknown>>;
  Information?: unknown;
  Note?: unknown;
  "Error Message"?: unknown;
}

interface SecTickerDirectory {
  fields?: unknown;
  data?: unknown;
}

interface SecSubmissions {
  filings?: {
    recent?: Record<string, unknown>;
  };
}

const inFlightRefreshes = new Map<string, Promise<PublicSourceEnvelope<unknown>>>();

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function plusSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1_000).toISOString();
}

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * What gets written to `last_error_code`, which is the row an operator actually reads.
 *
 * The outward API code stays stable and coarse; this keeps the per-provider detail alongside it, so
 * "there is no price" is never again the whole of what was recorded.
 */
function diagnosticCode(error: unknown): string {
  const code = errorCode(error);
  const attempts = error instanceof AppError ? error.fieldErrors?.providerAttempts : undefined;
  return attempts ? `${code} (${attempts})`.slice(0, 300) : code;
}

function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "UPSTREAM_TIMEOUT";
  if (error instanceof Error && /illegal invocation/i.test(error.message)) {
    return "UPSTREAM_RUNTIME_INVOCATION";
  }
  if (error instanceof Error && /network connection lost/i.test(error.message)) {
    return "UPSTREAM_NETWORK_ERROR";
  }
  return "UPSTREAM_UNAVAILABLE";
}

function safeErrorMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/([?&](?:api_key|apikey)=)[^&\s]+/giu, "$1[REDACTED]")
    .replace(/https?:\/\/\S+/giu, "[URL]")
    .replace(/[A-Za-z0-9_-]{24,}/gu, "[TOKEN]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240);
}

function safeErrorDiagnostic(error: unknown): Record<string, string | null> {
  const cause = error instanceof Error ? error.cause : null;
  const causeCode = cause && typeof cause === "object" && "code" in cause
    ? String(cause.code ?? "")
    : "";
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: safeErrorMessage(error instanceof Error ? error.message : ""),
    causeName: cause instanceof Error ? cause.name : null,
    causeMessage: safeErrorMessage(cause instanceof Error ? cause.message : ""),
    causeCode: /^[A-Z0-9_:-]{1,64}$/u.test(causeCode) ? causeCode : null
  };
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === ".") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMarketSymbol(value: string): string {
  const normalized = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/[/.]/g, "-");
  if (!/^[A-Z0-9]{1,8}(?:-[A-Z0-9]{1,3})?$/.test(normalized)) {
    throw new AppError(422, "INVALID_MARKET_SYMBOL", "股票代碼格式不正確。 ");
  }
  return normalized;
}

async function fetchJson<T>(
  url: URL,
  maximumBytes: number,
  headers: HeadersInit,
  fetcher: Fetcher,
  retryTransient = false
): Promise<{ data: T; etag: string | null }> {
  const request = () => fetcher(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(8_000)
  });
  let response = await request();
  if (retryTransient && TRANSIENT_UPSTREAM_STATUSES.has(response.status)) {
    await new Promise(resolve => setTimeout(resolve, 250));
    response = await request();
  }
  if (response.status >= 300 && response.status < 400) {
    throw new AppError(503, "UPSTREAM_REDIRECT_REJECTED", "公開資料來源回傳未允許的重新導向。");
  }
  if (!response.ok) {
    const code = response.status === 429 ? "UPSTREAM_RATE_LIMITED" : `UPSTREAM_HTTP_${response.status}`;
    throw new AppError(503, code, "公開資料來源暫時無法使用。 ");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AppError(503, "UPSTREAM_RESPONSE_TOO_LARGE", "公開資料回應超過安全限制。 ");
  }
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) {
    throw new AppError(503, "UPSTREAM_RESPONSE_TOO_LARGE", "公開資料回應超過安全限制。 ");
  }
  const data = safeJson<T>(raw);
  if (!data) throw new AppError(503, "UPSTREAM_INVALID_JSON", "公開資料格式不正確。 ");
  return { data, etag: response.headers.get("etag") };
}

function secHeaders(env: AppEnv): HeadersInit {
  return {
    accept: "application/json",
    "user-agent": env.SEC_USER_AGENT
  };
}

export async function fetchSecInstrument(
  env: AppEnv,
  symbol: string,
  fetcher: Fetcher = runtimeFetch
): Promise<CacheLoadResult<SecInstrument>> {
  const url = new URL(SEC_TICKER_DIRECTORY_URL);
  const { data, etag } = await fetchJson<SecTickerDirectory>(
    url,
    MAX_SEC_DIRECTORY_BYTES,
    secHeaders(env),
    fetcher
  );
  if (!Array.isArray(data.fields) || !Array.isArray(data.data)) {
    throw new AppError(503, "SEC_TICKER_DIRECTORY_INVALID", "SEC 股票代碼資料格式不正確。 ");
  }
  const cikIndex = data.fields.indexOf("cik");
  const nameIndex = data.fields.indexOf("name");
  const tickerIndex = data.fields.indexOf("ticker");
  const exchangeIndex = data.fields.indexOf("exchange");
  if ([cikIndex, nameIndex, tickerIndex, exchangeIndex].some(index => index < 0)) {
    throw new AppError(503, "SEC_TICKER_DIRECTORY_INVALID", "SEC 股票代碼欄位不完整。 ");
  }
  const match = data.data.find(item =>
    Array.isArray(item) && String(item[tickerIndex] ?? "").toUpperCase() === symbol
  );
  if (!Array.isArray(match)) {
    throw new AppError(404, "SEC_SYMBOL_NOT_FOUND", "SEC 找不到此股票代碼。 ");
  }
  const cikNumber = Number(match[cikIndex]);
  const companyName = String(match[nameIndex] ?? "").trim();
  const ticker = String(match[tickerIndex] ?? "").trim().toUpperCase();
  const exchange = String(match[exchangeIndex] ?? "").trim() || null;
  if (!Number.isInteger(cikNumber) || cikNumber <= 0 || !companyName || ticker !== symbol) {
    throw new AppError(503, "SEC_TICKER_DIRECTORY_INVALID", "SEC 股票代碼資料無法正規化。 ");
  }
  return {
    data: {
      symbol,
      companyName,
      exchange,
      cik: String(cikNumber).padStart(10, "0"),
      ticker,
      country: "US"
    },
    sourceAsOf: null,
    etag
  };
}

export async function fetchSecFilings(
  env: AppEnv,
  instrument: SecInstrument,
  fetcher: Fetcher = runtimeFetch
): Promise<CacheLoadResult<SecContext>> {
  const url = new URL(`/submissions/CIK${instrument.cik}.json`, SEC_SUBMISSIONS_ORIGIN);
  const { data, etag } = await fetchJson<SecSubmissions>(
    url,
    MAX_SEC_SUBMISSIONS_BYTES,
    secHeaders(env),
    fetcher
  );
  const recent = data.filings?.recent;
  const forms = Array.isArray(recent?.form) ? recent.form : [];
  const dates = Array.isArray(recent?.filingDate) ? recent.filingDate : [];
  const accessions = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber : [];
  const documents = Array.isArray(recent?.primaryDocument) ? recent.primaryDocument : [];
  const filings: SecFiling[] = [];
  for (let index = 0; index < forms.length && filings.length < 5; index += 1) {
    const form = forms[index];
    if (form !== "10-K" && form !== "10-Q" && form !== "8-K") continue;
    const filingDate = validDate(dates[index]);
    const accessionNumber = String(accessions[index] ?? "");
    const primaryDocument = String(documents[index] ?? "");
    if (
      !filingDate
      || !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)
      || !/^[A-Za-z0-9._-]+$/.test(primaryDocument)
    ) continue;
    const cikWithoutZeros = String(Number(instrument.cik));
    const accessionPath = accessionNumber.replace(/-/g, "");
    filings.push({
      form,
      filingDate,
      accessionNumber,
      primaryDocument,
      officialUrl: new URL(
        `/Archives/edgar/data/${cikWithoutZeros}/${accessionPath}/${primaryDocument}`,
        SEC_ARCHIVES_ORIGIN
      ).toString()
    });
  }
  return {
    data: { company: instrument, recentFilings: filings },
    sourceAsOf: filings[0]?.filingDate ?? null,
    etag
  };
}

function rounded(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values);
  if (mean === null) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function alphaVantageKey(env: AppEnv): string {
  const apiKey = String(env.ALPHA_VANTAGE_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new AppError(503, "ALPHA_VANTAGE_NOT_CONFIGURED", "Alpha Vantage API 尚未設定。 ");
  }
  if (!/^[A-Za-z0-9]{4,128}$/u.test(apiKey)) {
    throw new AppError(503, "ALPHA_VANTAGE_KEY_INVALID_FORMAT", "Alpha Vantage API Key 格式不正確。 ");
  }
  return apiKey;
}

// One counter per provider, so a fallback cannot silently consume the primary's allowance and each
// provider's own free-tier limit is respected independently.
async function consumeProviderBudget(
  env: AppEnv,
  provider: EquityProvider,
  maximum: number
): Promise<void> {
  const now = nowIso();
  const usageDate = now.slice(0, 10);
  const result = await env.DB.prepare(
    `INSERT INTO market_provider_daily_usage
      (provider, usage_date, request_count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(provider, usage_date) DO UPDATE SET
       request_count = market_provider_daily_usage.request_count + 1,
       updated_at = excluded.updated_at
     WHERE market_provider_daily_usage.request_count < ?`
  ).bind(provider, usageDate, now, maximum).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new AppError(
      503,
      `${provider}_DAILY_BUDGET_EXHAUSTED`,
      "今日公開股價資料額度已用完，請使用快取資料或稍後再試。 "
    );
  }
}

async function consumeAlphaVantageBudget(env: AppEnv): Promise<void> {
  await consumeProviderBudget(env, "ALPHA_VANTAGE", positiveInteger(env.ALPHA_VANTAGE_DAILY_REQUEST_LIMIT, 24));
}

function alphaVantagePayloadError(payload: AlphaDailyResponse): AppError | null {
  if (typeof payload["Error Message"] === "string") {
    return new AppError(404, "ALPHA_VANTAGE_SYMBOL_NOT_FOUND", "Alpha Vantage 找不到此股票代碼。 ");
  }
  if (typeof payload.Note === "string" || typeof payload.Information === "string") {
    return new AppError(503, "ALPHA_VANTAGE_RATE_LIMITED", "Alpha Vantage 今日額度或頻率已達限制。 ");
  }
  return null;
}

async function fetchAlphaVantageJson<T extends AlphaDailyResponse>(
  env: AppEnv,
  parameters: Record<string, string>,
  fetcher: Fetcher
): Promise<T> {
  const apiKey = alphaVantageKey(env);
  await consumeAlphaVantageBudget(env);
  const url = new URL("/query", ALPHA_VANTAGE_ORIGIN);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  const { data } = await fetchJson<T>(
    url,
    MAX_ALPHA_VANTAGE_BYTES,
    { accept: "application/json" },
    fetcher
  );
  const payloadError = alphaVantagePayloadError(data);
  if (payloadError) throw payloadError;
  return data;
}

/**
 * One validation gate for every provider. Each returns a different JSON shape, but a bar is only
 * usable on the same terms: a real date and four positive prices. Sharing the gate means a new
 * provider cannot quietly introduce a zero, a null or a string price into the derived metrics.
 */
function normalizeDailyBar(
  tradingDateRaw: string,
  openRaw: unknown,
  highRaw: unknown,
  lowRaw: unknown,
  closeRaw: unknown,
  volumeRaw: unknown
): AlphaDailyPoint | null {
  const tradingDate = validDate(tradingDateRaw);
  const openPrice = finiteNumber(openRaw);
  const highPrice = finiteNumber(highRaw);
  const lowPrice = finiteNumber(lowRaw);
  const closePrice = finiteNumber(closeRaw);
  // Volume is optional across providers; a missing volume must not discard an otherwise good bar,
  // it only makes the volume-derived metrics unavailable.
  const volume = finiteNumber(volumeRaw) ?? 0;
  if (
    !tradingDate
    || openPrice === null
    || highPrice === null
    || lowPrice === null
    || closePrice === null
    || openPrice <= 0
    || highPrice <= 0
    || lowPrice <= 0
    || closePrice <= 0
    || volume < 0
  ) return null;
  return {
    tradingDate,
    openPrice: rounded(openPrice),
    highPrice: rounded(highPrice),
    lowPrice: rounded(lowPrice),
    closePrice: rounded(closePrice),
    volume: Math.round(volume)
  };
}

function normalizeAlphaDailyPoint(
  tradingDateRaw: string,
  values: Record<string, unknown>
): AlphaDailyPoint | null {
  const tradingDate = validDate(tradingDateRaw);
  const openPrice = finiteNumber(values["1. open"]);
  const highPrice = finiteNumber(values["2. high"]);
  const lowPrice = finiteNumber(values["3. low"]);
  const closePrice = finiteNumber(values["4. close"]);
  const volume = finiteNumber(values["5. volume"]);
  if (
    !tradingDate
    || openPrice === null
    || highPrice === null
    || lowPrice === null
    || closePrice === null
    || volume === null
    || openPrice <= 0
    || highPrice <= 0
    || lowPrice <= 0
    || closePrice <= 0
    || volume < 0
  ) return null;
  return {
    tradingDate,
    openPrice: rounded(openPrice),
    highPrice: rounded(highPrice),
    lowPrice: rounded(lowPrice),
    closePrice: rounded(closePrice),
    volume: Math.round(volume)
  };
}

function alphaVantageProviderSymbol(symbol: string): string {
  return symbol.replace(/-([A-Z0-9]{1,3})$/u, ".$1");
}

/**
 * The New York calendar date and minute-of-day for an instant, via the runtime's own time-zone
 * database so US daylight saving is handled rather than approximated with a fixed offset.
 */
export function easternMoment(instant: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(instant);
  const field = (type: string): string => parts.find(part => part.type === type)?.value ?? "";
  const hour = Number(field("hour")) % 24;
  return {
    date: `${field("year")}-${field("month")}-${field("day")}`,
    minutes: hour * 60 + Number(field("minute"))
  };
}

// 16:00 New York is the close; the extra margin lets the provider settle the final bar before it is
// treated as final.
const SESSION_CLOSE_MINUTES = 16 * 60 + 15;

/**
 * Whether a daily bar represents a session that has actually finished.
 *
 * This is the difference between a closing price and a live one. A provider returns a bar for the
 * session in progress with the last traded price in the close field, so "the most recent bar" is
 * only a close outside US trading hours. The operator opens this page on a Taipei morning, when the
 * US session that ended a few hours earlier is the one they mean by 前一天晚上的收盤價 — that bar is
 * dated *today* in New York, so a naive "previous day" rule would return the session before it.
 */
export function isCompletedSession(tradingDate: string, now: Date): boolean {
  const eastern = easternMoment(now);
  if (tradingDate < eastern.date) return true;
  if (tradingDate > eastern.date) return false;
  return eastern.minutes >= SESSION_CLOSE_MINUTES;
}

function completedSessions(bars: AlphaDailyPoint[], now: Date): AlphaDailyPoint[] {
  return bars
    .filter(bar => isCompletedSession(bar.tradingDate, now))
    .sort((left, right) => right.tradingDate.localeCompare(left.tradingDate));
}

async function fetchAlphaVantageBars(
  env: AppEnv,
  symbol: string,
  fetcher: Fetcher
): Promise<AlphaDailyPoint[]> {
  const data = await fetchAlphaVantageJson<AlphaDailyResponse>(
    env,
    {
      function: "TIME_SERIES_DAILY",
      symbol: alphaVantageProviderSymbol(symbol),
      outputsize: "compact"
    },
    fetcher
  );
  return Object.entries(data["Time Series (Daily)"] ?? {})
    .map(([tradingDate, values]) => normalizeAlphaDailyPoint(tradingDate, values))
    .filter((point): point is AlphaDailyPoint => point !== null);
}

function twelveDataProviderSymbol(symbol: string): string {
  return symbol.replace(/-([A-Z0-9]{1,3})$/u, ".$1");
}

interface TwelveDataResponse {
  status?: string;
  code?: number;
  message?: string;
  values?: { datetime?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown }[];
}

async function fetchTwelveDataBars(
  env: AppEnv,
  symbol: string,
  fetcher: Fetcher
): Promise<AlphaDailyPoint[]> {
  const apiKey = String(env.TWELVE_DATA_API_KEY ?? "").trim();
  if (!apiKey) throw new AppError(503, "TWELVE_DATA_NOT_CONFIGURED", "Twelve Data API 尚未設定。 ");
  if (!/^[A-Za-z0-9]{8,64}$/u.test(apiKey)) {
    throw new AppError(503, "TWELVE_DATA_KEY_INVALID_FORMAT", "Twelve Data API Key 格式不正確。 ");
  }
  await consumeProviderBudget(env, "TWELVE_DATA", positiveInteger(env.TWELVE_DATA_DAILY_REQUEST_LIMIT, 700));
  const url = new URL("/time_series", TWELVE_DATA_ORIGIN);
  url.searchParams.set("symbol", twelveDataProviderSymbol(symbol));
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(EQUITY_BAR_WINDOW_DAYS));
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("apikey", apiKey);
  const { data } = await fetchJson<TwelveDataResponse>(
    url, MAX_EQUITY_PROVIDER_BYTES, { accept: "application/json" }, fetcher
  );
  // Twelve Data answers HTTP 200 with an error object, so the status must be read from the body.
  if (data.status === "error" || !Array.isArray(data.values)) {
    const code = Number(data.code);
    if (code === 429) throw new AppError(503, "TWELVE_DATA_RATE_LIMITED", "Twelve Data 額度或頻率已達限制。 ");
    if (code === 404) throw new AppError(404, "TWELVE_DATA_SYMBOL_NOT_FOUND", "Twelve Data 找不到此股票代碼。 ");
    throw new AppError(503, "TWELVE_DATA_UNAVAILABLE", "Twelve Data 目前無法提供資料。 ");
  }
  return data.values
    .map(value => normalizeDailyBar(
      String(value.datetime ?? "").slice(0, 10),
      value.open, value.high, value.low, value.close, value.volume
    ))
    .filter((point): point is AlphaDailyPoint => point !== null);
}

interface EquityProviderAttempt {
  provider: EquityProvider;
  errorCode: string;
}

/**
 * Fetches daily bars from the first provider that answers.
 *
 * Order is deliberate: a contracted, keyed provider first, then the keyless fallback. Every failure
 * is carried forward in `providerAttempts` so the cache row records what each provider said rather
 * than only that "there is no price" — the exact blindness that left the previous provider broken
 * and undiagnosed.
 */
export async function fetchEquityDailyContext(
  env: AppEnv,
  symbol: string,
  fetcher: Fetcher = runtimeFetch,
  now: Date = new Date()
): Promise<CacheLoadResult<AlphaEquityContext>> {
  const chain: { provider: EquityProvider; load: () => Promise<AlphaDailyPoint[]> }[] = [
    { provider: "TWELVE_DATA", load: () => fetchTwelveDataBars(env, symbol, fetcher) },
    { provider: "ALPHA_VANTAGE", load: () => fetchAlphaVantageBars(env, symbol, fetcher) }
  ];

  const attempts: EquityProviderAttempt[] = [];
  let served: { provider: EquityProvider; points: AlphaDailyPoint[] } | null = null;
  for (const step of chain) {
    try {
      const points = completedSessions(await step.load(), now).slice(0, 100);
      // Fewer than two completed sessions cannot produce a previous close or a change, so this
      // provider has not actually answered the question and the chain continues.
      if (points.length < 2) throw new AppError(503, "EQUITY_DAILY_INSUFFICIENT_SESSIONS", "日線資料不足。 ");
      served = { provider: step.provider, points };
      break;
    } catch (error) {
      attempts.push({ provider: step.provider, errorCode: errorCode(error) });
    }
  }
  if (!served) {
    throw new AppError(
      503,
      "EQUITY_DAILY_UNAVAILABLE",
      "目前無法取得收盤價，請手動輸入參考現價。 ",
      // The outward code stays stable for the contract; this carries what each provider actually
      // said, which is the part that was missing when the previous provider failed silently.
      { providerAttempts: attempts.map(attempt => `${attempt.provider}=${attempt.errorCode}`).join(", ") }
    );
  }

  const points = served.points;
  const latest = points[0]!;
  const prior = points[1]!;

  const priorVolumes = points.slice(1, 21).map(point => point.volume);
  const averageVolume20d = average(priorVolumes);
  const returnPoints = points.slice(0, 21);
  const logReturns = returnPoints.slice(0, -1).map((point, index) =>
    Math.log(point.closePrice / returnPoints[index + 1]!.closePrice)
  );
  const dailyVolatility = sampleStandardDeviation(logReturns);
  const rangePoints = points.slice(0, 20);
  const highest = Math.max(...rangePoints.map(point => point.highPrice));
  const lowest = Math.min(...rangePoints.map(point => point.lowPrice));

  return {
    data: {
      symbol,
      provider: served.provider,
      // Non-empty whenever a preferred provider failed. It is kept in the payload so a working but
      // degraded state is visible instead of looking identical to a healthy one.
      providerAttempts: attempts.map(attempt => `${attempt.provider}=${attempt.errorCode}`),
      ...latest,
      priorTradingDate: prior.tradingDate,
      priorClosePrice: prior.closePrice,
      dailyChangePct: rounded((latest.closePrice / prior.closePrice - 1) * 100, 4),
      averageVolume20d: averageVolume20d === null ? null : rounded(averageVolume20d, 2),
      relativeVolume20d: averageVolume20d && averageVolume20d > 0
        ? rounded(latest.volume / averageVolume20d, 4)
        : null,
      realizedVolatility20dPct: dailyVolatility === null
        ? null
        : rounded(dailyVolatility * Math.sqrt(252) * 100, 4),
      range20dPct: lowest > 0 ? rounded((highest / lowest - 1) * 100, 4) : null
    },
    sourceAsOf: latest.tradingDate
  };
}

async function cacheRow(env: AppEnv, cacheKey: string): Promise<CacheRow | null> {
  return env.DB.prepare(
    `SELECT cache_key, source, symbol, data_type, normalized_payload_json, source_as_of,
            fetched_at, expires_at, stale_until, etag, status, last_error_code,
            refresh_lease_expires_at
       FROM public_data_cache WHERE cache_key = ?`
  ).bind(cacheKey).first<CacheRow>();
}

function cacheEnvelope<T>(row: CacheRow | null, now: string, fallbackError: string | null = null): PublicSourceEnvelope<T> {
  const payload = row ? safeJson<T>(row.normalized_payload_json) : null;
  const fresh = !!row && row.status === "FRESH" && Date.parse(row.expires_at) > Date.parse(now);
  const stale = !!payload && !!row?.fetched_at && Date.parse(row.stale_until) > Date.parse(now);
  if (fresh || stale) {
    return {
      source: row.source,
      status: fresh ? "FRESH" : "STALE",
      sourceAsOf: row.source_as_of,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
      isStale: !fresh,
      errorCode: fresh ? null : row.last_error_code ?? fallbackError,
      data: payload
    };
  }
  return {
    source: row?.source ?? "SEC",
    status: "UNAVAILABLE",
    sourceAsOf: row?.source_as_of ?? null,
    fetchedAt: row?.fetched_at ?? null,
    expiresAt: row?.expires_at ?? null,
    isStale: false,
    errorCode: row?.last_error_code ?? fallbackError ?? "SOURCE_UNAVAILABLE",
    data: null
  };
}

async function claimCacheRefresh(
  env: AppEnv,
  cacheKey: string,
  source: SourceName,
  symbol: string | null,
  dataType: string,
  now: string
): Promise<boolean> {
  const lease = plusSeconds(now, CACHE_LEASE_SECONDS);
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO public_data_cache
      (cache_key, source, symbol, data_type, normalized_payload_json, expires_at,
       stale_until, status, refresh_lease_expires_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?, 'REFRESHING', ?, ?)`
  ).bind(cacheKey, source, symbol, dataType, now, now, lease, now).run();
  if (Number(inserted.meta.changes ?? 0) > 0) return true;

  const updated = await env.DB.prepare(
    `UPDATE public_data_cache
        SET status = 'REFRESHING', refresh_lease_expires_at = ?, updated_at = ?
      WHERE cache_key = ?
        AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= ?)`
  ).bind(lease, now, cacheKey, now).run();
  return Number(updated.meta.changes ?? 0) > 0;
}

async function refreshCache<T>(
  env: AppEnv,
  options: {
    cacheKey: string;
    source: SourceName;
    symbol: string | null;
    dataType: string;
    ttlSeconds: number;
    staleSeconds: number;
    loader: () => Promise<CacheLoadResult<T>>;
  }
): Promise<PublicSourceEnvelope<T>> {
  const now = nowIso();
  const startedAt = Date.now();
  const claimed = await claimCacheRefresh(
    env,
    options.cacheKey,
    options.source,
    options.symbol,
    options.dataType,
    now
  );
  if (!claimed) {
    const current = await cacheRow(env, options.cacheKey);
    return cacheEnvelope<T>(current, now, "REFRESH_IN_PROGRESS");
  }

  try {
    const loaded = await options.loader();
    const expiresAt = plusSeconds(now, options.ttlSeconds);
    const staleUntil = plusSeconds(expiresAt, options.staleSeconds);
    await env.DB.prepare(
      `UPDATE public_data_cache
          SET normalized_payload_json = ?, source_as_of = ?, fetched_at = ?,
              expires_at = ?, stale_until = ?, etag = ?, status = 'FRESH',
              last_error_code = NULL, refresh_lease_expires_at = NULL, updated_at = ?
        WHERE cache_key = ?`
    ).bind(
      JSON.stringify(loaded.data),
      loaded.sourceAsOf,
      now,
      expiresAt,
      staleUntil,
      loaded.etag ?? null,
      now,
      options.cacheKey
    ).run();
    console.info("market_context_refresh", {
      source: options.source,
      dataType: options.dataType,
      outcome: "FRESH",
      durationMs: Date.now() - startedAt
    });
    return cacheEnvelope<T>(await cacheRow(env, options.cacheKey), now);
  } catch (error) {
    const code = errorCode(error);
    const diagnosticUntil = plusSeconds(now, ERROR_DIAGNOSTIC_SECONDS);
    await env.DB.prepare(
      `UPDATE public_data_cache
          SET status = 'ERROR', last_error_code = ?,
              -- stored with per-provider detail; see diagnosticCode
              stale_until = CASE WHEN fetched_at IS NULL THEN ? ELSE stale_until END,
              refresh_lease_expires_at = ?, updated_at = ?
        WHERE cache_key = ?`
    ).bind(diagnosticCode(error), diagnosticUntil, diagnosticUntil, now, options.cacheKey).run();
    console.warn("market_context_refresh", {
      source: options.source,
      dataType: options.dataType,
      outcome: "ERROR",
      errorCode: code,
      durationMs: Date.now() - startedAt,
      ...safeErrorDiagnostic(error)
    });
    return cacheEnvelope<T>(await cacheRow(env, options.cacheKey), now, code);
  }
}

export async function getCachedPublicData<T>(
  env: AppEnv,
  options: {
    cacheKey: string;
    source: SourceName;
    symbol: string | null;
    dataType: string;
    ttlSeconds: number;
    staleSeconds: number;
    loader: () => Promise<CacheLoadResult<T>>;
  }
): Promise<PublicSourceEnvelope<T>> {
  const now = nowIso();
  const current = await cacheRow(env, options.cacheKey);
  if (current?.status === "FRESH" && Date.parse(current.expires_at) > Date.parse(now)) {
    return cacheEnvelope<T>(current, now);
  }
  const existing = inFlightRefreshes.get(options.cacheKey);
  if (existing) return existing as Promise<PublicSourceEnvelope<T>>;
  const refresh = refreshCache(env, options) as Promise<PublicSourceEnvelope<unknown>>;
  inFlightRefreshes.set(options.cacheKey, refresh);
  try {
    return await refresh as PublicSourceEnvelope<T>;
  } finally {
    if (inFlightRefreshes.get(options.cacheKey) === refresh) inFlightRefreshes.delete(options.cacheKey);
  }
}

async function upsertInstrument(env: AppEnv, instrument: SecInstrument): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO market_instruments
      (symbol_normalized, company_name, exchange, sec_cik, sec_ticker, country, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol_normalized) DO UPDATE SET
       company_name = excluded.company_name,
       exchange = excluded.exchange,
       sec_cik = excluded.sec_cik,
       sec_ticker = excluded.sec_ticker,
       country = excluded.country,
       updated_at = excluded.updated_at`
  ).bind(
    instrument.symbol,
    instrument.companyName,
    instrument.exchange,
    instrument.cik,
    instrument.ticker,
    instrument.country,
    nowIso()
  ).run();
}

async function instrumentForSymbol(
  env: AppEnv,
  symbol: string,
  fetcher: Fetcher
): Promise<PublicSourceEnvelope<SecInstrument>> {
  const existing = await env.DB.prepare(
    `SELECT symbol_normalized, company_name, exchange, sec_cik, sec_ticker, country, updated_at
       FROM market_instruments WHERE symbol_normalized = ?`
  ).bind(symbol).first<InstrumentRow>();
  const cutoff = Date.now() - INSTRUMENT_TTL_SECONDS * 1_000;
  if (existing && Date.parse(existing.updated_at) > cutoff) {
    return {
      source: "SEC",
      status: "FRESH",
      sourceAsOf: null,
      fetchedAt: existing.updated_at,
      expiresAt: plusSeconds(existing.updated_at, INSTRUMENT_TTL_SECONDS),
      isStale: false,
      errorCode: null,
      data: {
        symbol: existing.symbol_normalized,
        companyName: existing.company_name,
        exchange: existing.exchange,
        cik: existing.sec_cik,
        ticker: existing.sec_ticker,
        country: "US"
      }
    };
  }

  const staleSeconds = positiveInteger(env.MARKET_CACHE_STALE_SECONDS, 604_800);
  const result = await getCachedPublicData(env, {
    cacheKey: `sec:instrument:v1:${symbol}`,
    source: "SEC",
    symbol,
    dataType: "INSTRUMENT",
    ttlSeconds: INSTRUMENT_TTL_SECONDS,
    staleSeconds,
    loader: () => fetchSecInstrument(env, symbol, fetcher)
  });
  if (result.data) await upsertInstrument(env, result.data);
  return result;
}

async function enforceRateLimit(
  request: Request,
  env: AppEnv,
  session: SessionContext
): Promise<void> {
  const windowSeconds = positiveInteger(env.MARKET_CONTEXT_RATE_LIMIT_WINDOW_SECONDS, 60);
  const maximum = positiveInteger(env.MARKET_CONTEXT_RATE_LIMIT_MAX_REQUESTS, 30);
  const now = nowIso();
  const cutoff = new Date(Date.now() - windowSeconds * 1_000).toISOString();
  const keys = await Promise.all([
    keyedHash(env.EMPLOYEE_LOOKUP_KEY, `MARKET:USER:${session.user.id}`),
    keyedHash(env.EMPLOYEE_LOOKUP_KEY, `MARKET:IP:${clientAddress(request)}`)
  ]);
  for (const [index, key] of keys.entries()) {
    const scope = index === 0 ? "USER" : "IP";
    await env.DB.prepare(
      `INSERT INTO market_context_rate_limits
        (request_key, scope, window_started_at, request_count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(request_key) DO UPDATE SET
         window_started_at = CASE
           WHEN market_context_rate_limits.window_started_at < ? THEN excluded.window_started_at
           ELSE market_context_rate_limits.window_started_at
         END,
         request_count = CASE
           WHEN market_context_rate_limits.window_started_at < ? THEN 1
           ELSE market_context_rate_limits.request_count + 1
         END,
         updated_at = excluded.updated_at`
    ).bind(key, scope, now, now, cutoff, cutoff).run();
    const row = await env.DB.prepare(
      "SELECT request_count FROM market_context_rate_limits WHERE request_key = ?"
    ).bind(key).first<{ request_count: number }>();
    if (Number(row?.request_count ?? 0) > maximum) {
      throw new AppError(429, "MARKET_CONTEXT_RATE_LIMITED", "公開資料查詢次數過多，請稍後再試。 ");
    }
  }
}

export async function getMarketContext(
  request: Request,
  env: AppEnv,
  session: SessionContext,
  rawSymbol: string,
  fetcher: Fetcher = runtimeFetch
): Promise<Response> {
  if (env.MARKET_CONTEXT_ENABLED !== "1") {
    throw new AppError(503, "MARKET_CONTEXT_DISABLED", "公開市場資料功能目前暫停。 ");
  }
  await enforceRateLimit(request, env, session);
  const symbol = normalizeMarketSymbol(rawSymbol);
  const instrument = await instrumentForSymbol(env, symbol, fetcher);
  const ttlSeconds = positiveInteger(env.MARKET_CACHE_TTL_SECONDS, 86_400);
  const staleSeconds = positiveInteger(env.MARKET_CACHE_STALE_SECONDS, 604_800);
  const [sec, equityDaily] = await Promise.all([
    instrument.data
      ? getCachedPublicData(env, {
        cacheKey: `sec:filings:v1:${instrument.data.cik}`,
        source: "SEC",
        symbol,
        dataType: "RECENT_FILINGS",
        ttlSeconds,
        staleSeconds,
        loader: () => fetchSecFilings(env, instrument.data as SecInstrument, fetcher)
      })
      : Promise.resolve(instrument),
    getCachedPublicData(env, {
      // The key is provider-independent: whichever provider answers, the cached previous close for
      // a symbol is the same fact, and a provider change must not silently start a second cache.
      cacheKey: `equity:daily:v2:${symbol}`,
      source: "EQUITY_DAILY",
      symbol,
      dataType: "DAILY_EQUITY",
      ttlSeconds,
      staleSeconds,
      loader: () => fetchEquityDailyContext(env, symbol, fetcher)
    })
  ]);
  console.info("market_context_served", {
    secStatus: sec.status,
    equityStatus: equityDaily.status,
    equityProvider: equityDaily.data?.provider ?? null
  });

  return jsonResponse({
    marketContext: {
      symbol,
      generatedAt: nowIso(),
      sec,
      equityDaily,
      // Deprecated alias. The field is no longer accurate — the data may come from any provider in
      // the chain — but the Worker and the static front end deploy separately, so removing it
      // outright would break whichever side updates second. Drop it once both are known current.
      alphaVantage: equityDaily
    }
  });
}

export async function cleanupExpiredMarketData(env: AppEnv): Promise<{ cacheRows: number; rateLimitRows: number }> {
  const now = nowIso();
  const rateLimitCutoff = new Date(
    Date.now() - positiveInteger(env.MARKET_CONTEXT_RATE_LIMIT_WINDOW_SECONDS, 60) * 10 * 1_000
  ).toISOString();
  const providerUsageCutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const errorRetentionCutoff = new Date(Date.now() - ERROR_RETENTION_SECONDS * 1_000).toISOString();
  const [cache, rateLimits] = await env.DB.batch([
    env.DB.prepare(
      // A recent failure is spared. `stale_until` gates when a source is retried, and it used to
      // gate deletion too, so every ERROR row was removed ten minutes after it was written — by
      // this very sweep, which runs every two minutes. The retry timing is unchanged; only the
      // evidence now survives long enough to be read in the ADMIN health panel.
      `DELETE FROM public_data_cache
        WHERE stale_until < ?
          AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at < ?)
          AND NOT (status = 'ERROR' AND updated_at >= ?)`
    ).bind(now, now, errorRetentionCutoff),
    env.DB.prepare(
      "DELETE FROM market_context_rate_limits WHERE window_started_at < ?"
    ).bind(rateLimitCutoff),
    env.DB.prepare(
      "DELETE FROM market_provider_daily_usage WHERE usage_date < ?"
    ).bind(providerUsageCutoff)
  ]);
  return {
    cacheRows: Number(cache?.meta.changes ?? 0),
    rateLimitRows: Number(rateLimits?.meta.changes ?? 0)
  };
}

export async function marketContextHealth(env: AppEnv): Promise<{
  sources: Array<Record<string, unknown>>;
  expiredRows: number;
  staleRows: number;
  rateLimitRows: number;
  providerUsageToday: Array<Record<string, unknown>>;
}> {
  const now = nowIso();
  const [sources, summary, providerUsage] = await Promise.all([
    env.DB.prepare(
      `SELECT source, status, COUNT(*) AS row_count,
              SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END) AS fresh_count,
              SUM(CASE WHEN expires_at <= ? AND stale_until > ? THEN 1 ELSE 0 END) AS stale_count,
              SUM(CASE WHEN stale_until <= ? THEN 1 ELSE 0 END) AS expired_count,
              MIN(fetched_at) AS oldest_fetched_at,
              MAX(fetched_at) AS newest_fetched_at
         FROM public_data_cache
        GROUP BY source, status
        ORDER BY source, status`
    ).bind(now, now, now, now).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT
          (SELECT COUNT(*) FROM public_data_cache WHERE stale_until <= ?) AS expired_rows,
          (SELECT COUNT(*) FROM public_data_cache WHERE expires_at <= ? AND stale_until > ?) AS stale_rows,
          (SELECT COUNT(*) FROM market_context_rate_limits) AS rate_limit_rows`
    ).bind(now, now, now).first<{
      expired_rows: number;
      stale_rows: number;
      rate_limit_rows: number;
    }>(),
    env.DB.prepare(
      `SELECT provider, usage_date, request_count, updated_at
         FROM market_provider_daily_usage
        WHERE usage_date = ?
        ORDER BY provider`
    ).bind(now.slice(0, 10)).all<Record<string, unknown>>()
  ]);
  return {
    sources: sources.results,
    expiredRows: Number(summary?.expired_rows ?? 0),
    staleRows: Number(summary?.stale_rows ?? 0),
    rateLimitRows: Number(summary?.rate_limit_rows ?? 0),
    providerUsageToday: providerUsage.results
  };
}
