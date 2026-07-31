PRAGMA foreign_keys = ON;

CREATE TABLE market_instruments (
  symbol_normalized TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  exchange TEXT,
  sec_cik TEXT NOT NULL,
  sec_ticker TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  updated_at TEXT NOT NULL
);

CREATE TABLE public_data_cache (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('SEC', 'FRED')),
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

CREATE TABLE market_context_rate_limits (
  request_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('USER', 'IP')),
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_market_instruments_updated
  ON market_instruments(updated_at);
CREATE INDEX idx_public_data_source_symbol_expiry
  ON public_data_cache(source, symbol, expires_at);
CREATE INDEX idx_public_data_expiry
  ON public_data_cache(expires_at);
CREATE INDEX idx_public_data_stale_until
  ON public_data_cache(stale_until);
CREATE INDEX idx_market_rate_limit_window
  ON market_context_rate_limits(window_started_at);
