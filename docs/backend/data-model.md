# D1 Data Model Draft

Status: Phase 1 conceptual schema only. This is not an executable migration.

## Design rules

- D1 stores structured metadata and workflow state; private binary/raw content belongs in R2.
- Every user-owned resource has a direct or traceable `user_id` relationship.
- IDs are opaque server-generated values, not sequential public identifiers.
- Timestamps are stored in UTC.
- Mutable workflows use version fields or conditional updates to prevent lost updates.
- Message, send, queue, ranking, and rendering operations have idempotency keys.
- Raw issuer values and normalized values are both retained.
- No table stores plaintext passwords or unprotected session tokens.

## Proposed entities

### `users`

Purpose: application-managed identity and approval state.

Key fields:

- `id`
- `username_normalized` (unique)
- `display_name`
- `branch_name`
- `employee_number_ciphertext`
- `employee_number_lookup_hash` (unique, keyed hash)
- `password_hash`
- `password_algorithm`
- `password_parameters_json`
- `status`: `PENDING_APPROVAL`, `ACTIVE`, `REJECTED`, `SUSPENDED`, `DISABLED`
- `role`: `USER`, `ADMIN`
- `approved_by_user_id`
- `approved_at`
- `rejected_at`
- `created_at`
- `updated_at`
- `credential_version`

The employee number is exactly five digits at input but is sensitive identity data. It should be encrypted for approved administrative display and separately keyed-hashed for uniqueness checks. Encryption/HMAC keys belong in Cloudflare Secrets, not D1.

### `user_sessions`

Purpose: revocable server-side login sessions.

Key fields:

- `id`
- `user_id`
- `token_hash` (unique)
- `csrf_secret_hash` or equivalent binding metadata
- `created_at`
- `last_seen_at`
- `expires_at`
- `revoked_at`
- `ip_prefix_hash` and `user_agent_hash` only if approved as necessary security metadata

The browser receives only the random session token in a `Secure`, `HttpOnly`, `SameSite` cookie. D1 stores only its hash.

### `rfqs`

Purpose: one user request containing 1 to 20 trades.

Key fields:

- `id`
- `user_id`
- `status`
- `correlation_token_hash` (unique)
- `created_at`
- `validated_at`
- `sent_at`
- `deadline_at`
- `finalized_at`
- `finalization_trigger`
- `expected_issuer_count`
- `outbound_batch_count`
- `current_ranking_version`
- `version`
- `cancelled_at`

### `rfq_trades`

Purpose: immutable trade conditions after send.

Key fields:

- `id`
- `rfq_id`
- `sequence` (1 to 20, unique within RFQ)
- `trade_code` (`T01` to `T20`, unique within RFQ)
- normalized condition fields corresponding to the Canonical RFQ Trade model
- `underlyings_json`
- `target_field`
- `matching_key_hash`
- `created_at`
- `frozen_at`

After `frozen_at`, conditions cannot be edited. A changed request must create a new RFQ or approved revision workflow.

### `rfq_expected_issuers`

Purpose: immutable completion snapshot for eleven possible issuers.

Key fields:

- `id`
- `rfq_id`
- `issuer`
- `outbound_batch_code`
- `status`
- `terminal_at`
- `terminal_reason`

Unique constraint: `(rfq_id, issuer)`.

### `outbound_email_batches`

Purpose: eight issuer-format requests sent to the bank mailbox.

Key fields:

- `id`
- `rfq_id`
- `batch_code`
- `recipient`
- `sender`
- `subject_without_prefix`
- `correlation_token_hash`
- `content_hash`
- `provider_message_id`
- `idempotency_key` (unique)
- `status`
- `attempt_count`
- `queued_at`
- `sent_at`
- `last_error_code`

Unique constraint: `(rfq_id, batch_code)` plus the send idempotency key.

### `inbound_messages`

Purpose: immutable metadata for forwarded issuer replies.

Key fields:

- `id`
- `r2_raw_mime_key`
- `message_id`
- `content_hash`
- `raw_subject`
- `normalized_subject`
- `requester_marker_hash` (never the raw marker)
- `subject_batch_code`
- envelope/from/return-path/DKIM evidence fields
- `sender_evidence_json` (issuer/domain/source only)
- `detected_issuer`
- `rfq_id` when matched
- `correlated_batch_id`
- `correlation_source`
- `correlation_token_hash`
- `r2_parsed_tables_key`
- `html_table_count`
- `attachment_count`
- `received_at`
- `parsed_at`
- `status`
- `parser_version`
- `parse_attempt_count`
- `last_error_code`

Deduplication uses both available Message-ID and content hash. Repeated forwarded wrappers must not create duplicate canonical quotes.

### `issuer_quotes`

Purpose: raw and normalized issuer quote rows.

Key fields:

- `id`
- `rfq_id`
- `trade_id`
- `inbound_message_id`
- `issuer`
- all Canonical Quote numeric fields
- raw price value/label and price semantics
- `raw_values_json`
- `quote_reference`
- `issuer_comment`
- `rejection_reason`
- `status`
- `parser_profile`
- `parser_version`
- `source_row_index`
- `normalization_warnings_json`
- `validation_errors_json`
- `received_at`
- `created_at`

A quote's status and target value determine ranking eligibility; database `NULL` remains distinct from zero.

### `quote_parse_errors`

Purpose: searchable, non-sensitive diagnostics without exposing full raw MIME.

Key fields:

- `id`
- `inbound_message_id`
- `issuer`
- `parser_version`
- `error_code`
- `safe_error_detail`
- `created_at`
- `resolved_at`
- `resolved_by_user_id`

### `ranking_runs`

Purpose: versioned finalization/recalculation audit.

Key fields:

- `id`
- `rfq_id`
- `version`
- `trigger`
- `target_field_rules_version`
- `started_at`
- `completed_at`
- `status`
- `idempotency_key` (unique)

Unique constraint: `(rfq_id, version)`.

### `ranking_results`

Purpose: top-three snapshot per trade.

Key fields:

- `id`
- `ranking_run_id`
- `rfq_id`
- `trade_id`
- `quote_id`
- `economic_rank`
- `display_order`
- `target_field`
- `normalized_value`
- `direction`
- `is_image_winner`
- `tie_group`
- `created_at`

The earliest valid received quote may be `is_image_winner` within a tie while retaining the shared economic rank.

### `generated_artifacts`

Purpose: private image metadata.

Key fields:

- `id`
- `rfq_id`
- `ranking_run_id`
- `issuer`
- `r2_object_key`
- `content_type`
- `content_hash`
- `byte_size`
- `status`
- `render_profile_version`
- `idempotency_key` (unique)
- `created_at`
- `expires_at`

### `jobs`

Purpose: observable workflow attempts across queues.

Key fields:

- `id`
- `job_type`
- `rfq_id`
- `related_entity_id`
- `idempotency_key` (unique)
- `status`
- `attempt_count`
- `last_error_code`
- `available_at`
- `created_at`
- `updated_at`
- `completed_at`

### `issuer_parser_versions`

Purpose: reproducibility of mapping/normalization behavior.

Key fields:

- `id`
- `issuer`
- `product`
- `version`
- `unit_profile_json`
- `enabled_at`
- `disabled_at`
- `change_summary`

### `audit_events`

Purpose: security and business workflow audit without storing secrets or raw mail bodies.

Key fields:

- `id`
- `actor_user_id` when applicable
- `action`
- `entity_type`
- `entity_id`
- `request_id`
- `safe_metadata_json`
- `created_at`

Events include registration approval/rejection, login security events, RFQ send/finalize/recalculate/cancel, sender mismatch, manual review, and artifact access.

## Planned indexes

- `users(username_normalized)` unique
- `users(employee_number_lookup_hash)` unique
- `user_sessions(token_hash)` unique
- `user_sessions(user_id, expires_at)`
- `rfqs(user_id, created_at)`
- `rfqs(status, deadline_at)`
- `rfq_trades(rfq_id, sequence)` unique
- `rfq_trades(rfq_id, matching_key_hash)`
- `rfq_expected_issuers(rfq_id, issuer)` unique
- `outbound_email_batches(rfq_id, batch_code)` unique
- `inbound_messages(message_id)` where usable
- `inbound_messages(content_hash)`
- `inbound_messages(rfq_id, received_at)`
- `issuer_quotes(rfq_id, trade_id, issuer)`
- `issuer_quotes(status, received_at)`
- `ranking_runs(rfq_id, version)` unique
- `ranking_results(ranking_run_id, trade_id, economic_rank)`
- `generated_artifacts(rfq_id, created_at)`
- `jobs(status, available_at)`
- `audit_events(entity_type, entity_id, created_at)`

Exact D1 syntax and query plans are deferred until an executable migration is separately approved and tested.

## Ownership and authorization path

Every user-facing access follows one of these joins:

- `rfqs.user_id -> users.id`
- `rfq_trades.rfq_id -> rfqs.user_id`
- `issuer_quotes.rfq_id -> rfqs.user_id`
- `ranking_results.rfq_id -> rfqs.user_id`
- `generated_artifacts.rfq_id -> rfqs.user_id`

An opaque ID alone never grants access. Administrative queries require the application `ADMIN` role and the protected administration boundary.

## Retention

Approved starting policy:

- Raw MIME and approved mail attachments in R2: 30 days
- Generated image artifacts in R2: 90 days
- Structured RFQ, quote, and ranking records in D1: 365 days
- Sessions: expire according to the approved session policy and remove/revoke promptly
- Security/audit retention: define before production based on operational need; it must not silently exceed the approved personal-data purpose

Cleanup jobs must be idempotent, auditable, scoped by explicit timestamps, and must not delete records before a legal hold or active investigation is resolved.

## Migration boundary

Before creating the first migration, Phase 2 must provide:

- exact D1 column types and constraints
- forward and rollback/compensating plan
- local D1 test commands
- seed strategy that contains no real personal data or mail
- initial administrator bootstrap design
- review of password and employee-number protection
- explicit user approval
