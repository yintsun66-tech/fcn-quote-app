# ADR 0030: Scheduled retention for mail, images and structured results

Status: Accepted
Date: 2026-07-31

## Context

`docs/backend/architecture.md` had listed a retention policy (raw mail 30 days, images 90 days,
results 365 days) since the first backend build, but **none of it was ever implemented**: no code
deleted an R2 object, and the scheduled job only purged cache, rate-limit, provider-usage and
follow-board operational tables. The private bucket therefore only ever grew — measured at 94.6 MB
across 1,233 objects after six days of light use, with generated quote images the single largest
category.

The operator confirmed that the RFQ, quote and ranking data in this application is an operational
convenience tool and an alternative workflow, **not the bank's official financial record**. That
removes the record-keeping objection to deleting it on a short cycle, and the approved windows were
shortened accordingly.

## Decision

1. Retention windows are **raw mail 10 days, generated images 10 days, structured results 30
   days**, configured as the non-secret Worker variables `RETENTION_RAW_MAIL_DAYS`,
   `RETENTION_IMAGE_DAYS` and `RETENTION_RESULT_DAYS`.
2. **`RETENTION_ENABLED` defaults to `"0"`.** Deploying the code deletes nothing. Enabling deletion
   is a separate, explicitly authorized change, because it is irreversible.
3. R2 objects are expired by their own `uploaded` timestamp via `list()`, not by a D1 pointer, so
   an orphaned object is still collected. Mail covers `raw-email/` (inbound MIME and the outbound
   archive) and `parsed-email/`; images cover `quote-images/`.
4. Structured results delete the `rfqs` row and let the existing 17 `ON DELETE CASCADE` children
   follow.
5. **Follow-board products pin their source rows.** `follow_board_products` holds three
   `ON DELETE RESTRICT` references — `source_rfq_id`, `source_inbound_message_id` and
   `source_outbound_batch_id` — and an RFQ reaches all three, the latter two through their own
   cascade from `rfqs`. Because `source_rfq_id` is nullable, excluding by it alone would still let
   a cascade hit a RESTRICT and abort the whole run, so the query excludes all three paths.
6. Work is bounded per run (200 objects per prefix, 50 RFQs) and runs on the existing two-minute
   tick, so a backlog drains steadily. A failure is logged as `retention_failed` and never
   interrupts RFQ recovery or the other cleanups.
7. One `RETENTION_APPLIED` audit event records **counts and window sizes only** — never an RFQ id,
   object key, mail content or account identifier.

## Consequences

- Bucket growth becomes bounded instead of monotonic. Under the measured load the steady state is a
  small fraction of the previous unbounded trajectory.
- `inbound_messages.r2_raw_mime_key` is `NOT NULL`, so it is deliberately **not** cleared; doing so
  would abort every scheduled run. The key becomes a dangling reference by design — nothing reads
  it after parsing, which completes minutes after receipt. Only the nullable
  `r2_parsed_tables_key` and `generated_artifacts.r2_object_key` are cleared.
- A published follow-board product keeps its source RFQ alive past 30 days. That is intended: the
  product must remain explicable while it is public.
- Deletion is irreversible. There is no undo, and no backup is created by this ADR.
