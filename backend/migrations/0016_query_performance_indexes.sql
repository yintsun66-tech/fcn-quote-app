-- Indexes only. This migration adds no table, column, constraint or row and changes no
-- application behaviour; it exists so four queries that already grow with the data stop
-- degrading into full scans or sorts.

-- register() writes a REGISTRATION_DUPLICATE audit event on every duplicate application, and the
-- ADMIN duplicate summary reads them back with `action = ? AND created_at >= ?`. The only existing
-- audit index leads with entity_type, so this query scans the whole (append-only) audit table.
CREATE INDEX idx_audit_action_created ON audit_events(action, created_at DESC);

-- The RFQ list is keyed by owner and paginated with a (created_at, id) cursor.
-- idx_rfqs_user_created stops at created_at, so the id tiebreak still forces a sort on every page.
-- Kept alongside the older index rather than replacing it, to avoid dropping a production index.
CREATE INDEX idx_rfqs_user_created_id ON rfqs(user_id, created_at DESC, id DESC);

-- The ADMIN outbound-mail list is ordered by queued_at DESC, id DESC with no filter at all. Both
-- existing indexes on this table lead with rfq_id or status, so the list sorts the whole table.
CREATE INDEX idx_outbound_batches_queued ON outbound_email_batches(queued_at DESC, id DESC);

-- Results/snapshot loading reads exclusions by rfq_id joined to the current ranking run. The
-- existing index leads with ranking_run_id, which the query does not filter on directly.
CREATE INDEX idx_ranking_exclusions_rfq_run ON ranking_exclusions(rfq_id, ranking_run_id, trade_id);
