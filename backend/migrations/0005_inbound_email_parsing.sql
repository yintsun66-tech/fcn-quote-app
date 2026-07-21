PRAGMA foreign_keys = ON;

ALTER TABLE inbound_messages ADD COLUMN normalized_subject TEXT;
ALTER TABLE inbound_messages ADD COLUMN requester_marker_hash TEXT;
ALTER TABLE inbound_messages ADD COLUMN subject_batch_code TEXT
  CHECK (subject_batch_code IS NULL OR subject_batch_code IN ('BMJB', 'NOMURA', 'UBS', 'DBS', 'SG', 'CITI', 'GS', 'CA'));
ALTER TABLE inbound_messages ADD COLUMN sender_evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE inbound_messages ADD COLUMN correlated_batch_id TEXT;
ALTER TABLE inbound_messages ADD COLUMN correlation_source TEXT
  CHECK (correlation_source IS NULL OR correlation_source IN ('TOKEN', 'REPLY_HEADER'));
ALTER TABLE inbound_messages ADD COLUMN correlation_token_hash TEXT;
ALTER TABLE inbound_messages ADD COLUMN r2_parsed_tables_key TEXT;
ALTER TABLE inbound_messages ADD COLUMN html_table_count INTEGER NOT NULL DEFAULT 0 CHECK (html_table_count >= 0);
ALTER TABLE inbound_messages ADD COLUMN attachment_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_count >= 0);
ALTER TABLE inbound_messages ADD COLUMN parsed_at TEXT;

CREATE INDEX idx_inbound_messages_issuer_status_received
  ON inbound_messages(detected_issuer, status, received_at);
CREATE INDEX idx_inbound_messages_correlation_hash
  ON inbound_messages(correlation_token_hash)
  WHERE correlation_token_hash IS NOT NULL;
