CREATE UNIQUE INDEX idx_rfqs_correlation_token_hash
  ON rfqs(correlation_token_hash)
  WHERE correlation_token_hash IS NOT NULL;
