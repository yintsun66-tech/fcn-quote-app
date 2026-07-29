PRAGMA foreign_keys = ON;

CREATE TABLE public_data_cache_v2 (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('SEC', 'FRED', 'ALPHA_VANTAGE')),
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

INSERT INTO public_data_cache_v2 (
  cache_key, source, symbol, data_type, normalized_payload_json, source_as_of,
  fetched_at, expires_at, stale_until, etag, status, last_error_code,
  refresh_lease_expires_at, updated_at
)
SELECT
  cache_key, source, symbol, data_type, normalized_payload_json, source_as_of,
  fetched_at, expires_at, stale_until, etag, status, last_error_code,
  refresh_lease_expires_at, updated_at
FROM public_data_cache;

DROP TABLE public_data_cache;
ALTER TABLE public_data_cache_v2 RENAME TO public_data_cache;

CREATE INDEX idx_public_data_source_symbol_expiry
  ON public_data_cache(source, symbol, expires_at);
CREATE INDEX idx_public_data_expiry
  ON public_data_cache(expires_at);
CREATE INDEX idx_public_data_stale_until
  ON public_data_cache(stale_until);

CREATE TABLE market_provider_daily_usage (
  provider TEXT NOT NULL CHECK (provider IN ('ALPHA_VANTAGE')),
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, usage_date)
);

CREATE INDEX idx_market_provider_usage_date
  ON market_provider_daily_usage(usage_date);
