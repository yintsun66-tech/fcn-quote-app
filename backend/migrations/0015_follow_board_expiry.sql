ALTER TABLE follow_board_products
  ADD COLUMN expires_at TEXT;

ALTER TABLE follow_board_publication_commands
  ADD COLUMN declared_issuer TEXT;

ALTER TABLE follow_board_publication_commands
  ADD COLUMN expiry_date_yyyymmdd TEXT;

CREATE INDEX idx_follow_board_products_status_expiry
  ON follow_board_products(status, expires_at, published_at DESC);
