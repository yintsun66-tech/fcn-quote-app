-- Opens the public-data cache to more than one equity price provider, and keeps a failure long
-- enough to be read.
--
-- Two problems this addresses:
--   1. `source` and `provider` carry CHECK constraints that admit only SEC/FRED/ALPHA_VANTAGE, so a
--      replacement provider cannot be written at all.
--   2. Every equity refresh failure was erased ~10 minutes later by the two-minute cleanup, because
--      the ERROR row's `stale_until` doubles as both the retry gate and the deletion gate. Alpha
--      Vantage therefore failed for weeks while leaving no diagnosable trace: the usage counter
--      recorded requests, and the cache held not one row of any status.
--
-- The cache stays reconstructable. This migration adds no financial record and deletes no RFQ,
-- ranking, quote or follow-board data.

CREATE TABLE public_data_cache_v3 (
  cache_key TEXT PRIMARY KEY,
  -- A logical source, not the provider that happened to serve it. Equity daily bars are cached
  -- under EQUITY_DAILY whichever provider answered, so a provider swap does not fragment the cache
  -- or strand rows under a name nothing reads any more. The serving provider is recorded inside
  -- normalized_payload_json.
  source TEXT NOT NULL CHECK (source IN ('SEC', 'FRED', 'ALPHA_VANTAGE', 'EQUITY_DAILY')),
  symbol TEXT,
  data_type TEXT NOT NULL,
  normalized_payload_json TEXT NOT NULL DEFAULT '{}',
  source_as_of TEXT,
  fetched_at TEXT,
  expires_at TEXT NOT NULL,
  stale_until TEXT NOT NULL,
  etag TEXT,
  status TEXT NOT NULL CHECK (status IN ('FRESH', 'REFRESHING', 'ERROR')),
  last_error_code TEXT,
  refresh_lease_expires_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO public_data_cache_v3 (
  cache_key, source, symbol, data_type, normalized_payload_json, source_as_of, fetched_at,
  expires_at, stale_until, etag, status, last_error_code, refresh_lease_expires_at, updated_at
)
SELECT
  cache_key, source, symbol, data_type, normalized_payload_json, source_as_of, fetched_at,
  expires_at, stale_until, etag, status, last_error_code, refresh_lease_expires_at, updated_at
FROM public_data_cache;

DROP TABLE public_data_cache;
ALTER TABLE public_data_cache_v3 RENAME TO public_data_cache;

CREATE INDEX idx_public_data_expiry ON public_data_cache(expires_at);
CREATE INDEX idx_public_data_stale_until ON public_data_cache(stale_until);
CREATE INDEX idx_public_data_source_symbol_expiry ON public_data_cache(source, symbol, expires_at);
-- The cleanup now has to find recent failures to spare them, and the ADMIN health panel reads
-- them; without this it scans the whole table for both.
CREATE INDEX idx_public_data_status_updated ON public_data_cache(status, updated_at);

-- Same constraint problem on the per-provider daily counter.
CREATE TABLE market_provider_daily_usage_v2 (
  provider TEXT NOT NULL CHECK (provider IN ('ALPHA_VANTAGE', 'TWELVE_DATA', 'YAHOO')),
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, usage_date)
);

INSERT INTO market_provider_daily_usage_v2 (provider, usage_date, request_count, updated_at)
SELECT provider, usage_date, request_count, updated_at FROM market_provider_daily_usage;

DROP TABLE market_provider_daily_usage;
ALTER TABLE market_provider_daily_usage_v2 RENAME TO market_provider_daily_usage;

CREATE INDEX idx_market_provider_usage_date ON market_provider_daily_usage(usage_date);
