import { keyedHash } from "./crypto";
import { nowIso } from "./db";
import { AppError } from "./errors";
import { clientAddress, jsonResponse } from "./http";
import type { AppEnv, SessionContext } from "./types";

const SEC_TICKER_DIRECTORY_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const SEC_SUBMISSIONS_ORIGIN = "https://data.sec.gov";
const SEC_ARCHIVES_ORIGIN = "https://www.sec.gov";
const FRED_ORIGIN = "https://api.stlouisfed.org";
const FRED_SERIES = Object.freeze(["DGS10", "FEDFUNDS", "VIXCLS"]);
const CACHE_LEASE_SECONDS = 30;
const ERROR_DIAGNOSTIC_SECONDS = 10 * 60;
const INSTRUMENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_SEC_DIRECTORY_BYTES = 5_000_000;
const MAX_SEC_SUBMISSIONS_BYTES = 5_000_000;
const MAX_FRED_BYTES = 500_000;
const TRANSIENT_UPSTREAM_STATUSES = new Set([502, 503, 504, 520]);

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SourceName = "SEC" | "FRED";

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

interface FredObservation {
  seriesId: string;
  title: string;
  units: string;
  unitsShort: string;
  observationDate: string;
  value: number;
  previousObservationDate: string | null;
  previousValue: number | null;
  change: number | null;
}

interface FredContext {
  series: FredObservation[];
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

interface FredSeriesResponse {
  seriess?: Array<Record<string, unknown>>;
}

interface FredObservationsResponse {
  observations?: Array<Record<string, unknown>>;
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
    .replace(/([?&]api_key=)[^&\s]+/giu, "$1[REDACTED]")
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

async function fetchFredSeries(
  apiKey: string,
  seriesId: string,
  fetcher: Fetcher
): Promise<FredObservation> {
  const metadataUrl = new URL("/fred/series", FRED_ORIGIN);
  metadataUrl.searchParams.set("series_id", seriesId);
  metadataUrl.searchParams.set("api_key", apiKey);
  metadataUrl.searchParams.set("file_type", "json");
  const observationsUrl = new URL("/fred/series/observations", FRED_ORIGIN);
  observationsUrl.searchParams.set("series_id", seriesId);
  observationsUrl.searchParams.set("api_key", apiKey);
  observationsUrl.searchParams.set("file_type", "json");
  observationsUrl.searchParams.set("sort_order", "desc");
  observationsUrl.searchParams.set("limit", "10");

  const { data: metadata } = await fetchJson<FredSeriesResponse>(
    metadataUrl,
    MAX_FRED_BYTES,
    { accept: "application/json" },
    fetcher,
    true
  );
  const { data: observations } = await fetchJson<FredObservationsResponse>(
    observationsUrl,
    MAX_FRED_BYTES,
    { accept: "application/json" },
    fetcher,
    true
  );
  const series = metadata.seriess?.[0];
  const validObservations = (observations.observations ?? [])
    .map(item => ({
      date: validDate(item.date),
      value: finiteNumber(item.value)
    }))
    .filter((item): item is { date: string; value: number } => !!item.date && item.value !== null);
  const latest = validObservations[0];
  if (!series || !latest) {
    throw new AppError(503, "FRED_SERIES_INVALID", "FRED 資料無法正規化。 ");
  }
  const previous = validObservations[1] ?? null;
  const title = String(series.title ?? "").trim();
  const units = String(series.units ?? "").trim();
  const unitsShort = String(series.units_short ?? "").trim();
  if (!title || !units) {
    throw new AppError(503, "FRED_SERIES_INVALID", "FRED 系列欄位不完整。 ");
  }
  return {
    seriesId,
    title,
    units,
    unitsShort,
    observationDate: latest.date,
    value: latest.value,
    previousObservationDate: previous?.date ?? null,
    previousValue: previous?.value ?? null,
    change: previous ? latest.value - previous.value : null
  };
}

export async function fetchFredContext(
  env: AppEnv,
  fetcher: Fetcher = runtimeFetch
): Promise<CacheLoadResult<FredContext>> {
  const apiKey = String(env.FRED_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new AppError(503, "FRED_NOT_CONFIGURED", "FRED API 尚未設定。 ");
  }
  if (!/^[a-z0-9]{32}$/u.test(apiKey)) {
    throw new AppError(503, "FRED_KEY_INVALID_FORMAT", "FRED API Key 格式不正確。 ");
  }
  const series: FredObservation[] = [];
  for (const seriesId of FRED_SERIES) {
    series.push(await fetchFredSeries(apiKey, seriesId, fetcher));
  }
  const sourceAsOf = series.map(item => item.observationDate).sort().at(-1) ?? null;
  return { data: { series }, sourceAsOf };
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
              stale_until = CASE WHEN fetched_at IS NULL THEN ? ELSE stale_until END,
              refresh_lease_expires_at = NULL, updated_at = ?
        WHERE cache_key = ?`
    ).bind(code, diagnosticUntil, now, options.cacheKey).run();
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
  const [sec, fred] = await Promise.all([
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
      cacheKey: "fred:macro:v1",
      source: "FRED",
      symbol: null,
      dataType: "MACRO_SERIES",
      ttlSeconds,
      staleSeconds,
      loader: () => fetchFredContext(env, fetcher)
    })
  ]);
  console.info("market_context_served", {
    secStatus: sec.status,
    fredStatus: fred.status
  });

  return jsonResponse({
    marketContext: {
      symbol,
      generatedAt: nowIso(),
      sec,
      fred
    }
  });
}

export async function cleanupExpiredMarketData(env: AppEnv): Promise<{ cacheRows: number; rateLimitRows: number }> {
  const now = nowIso();
  const rateLimitCutoff = new Date(
    Date.now() - positiveInteger(env.MARKET_CONTEXT_RATE_LIMIT_WINDOW_SECONDS, 60) * 10 * 1_000
  ).toISOString();
  const [cache, rateLimits] = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM public_data_cache
        WHERE stale_until < ? AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at < ?)`
    ).bind(now, now),
    env.DB.prepare(
      "DELETE FROM market_context_rate_limits WHERE window_started_at < ?"
    ).bind(rateLimitCutoff)
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
}> {
  const now = nowIso();
  const [sources, summary] = await Promise.all([
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
    }>()
  ]);
  return {
    sources: sources.results,
    expiredRows: Number(summary?.expired_rows ?? 0),
    staleRows: Number(summary?.stale_rows ?? 0),
    rateLimitRows: Number(summary?.rate_limit_rows ?? 0)
  };
}
