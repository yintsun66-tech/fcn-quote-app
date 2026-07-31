# ADR 0027: Atomic multi-product follow-board publication

- Status: Accepted
- Date: 2026-07-30

> ADR 0028 replaces the subject suffix with `ISSUER跟單YYYYMMDD`. The atomic multi-product
> selection and mapping rules in this ADR remain in force.

## Context

An approved publisher may publish several completed deals from one issuer email. The observed
publisher subject form is:

```text
0728 deal2~4 PBZB, PBZC, PBZD, BMJB跟單
```

The original schema allowed only one `follow_board_products` row per inbound message and one
product link per publication command. ADR 0026 also established that deal numbers must not select
quote rows.

## Decision

1. A single command accepts `MMDD deal-N PRODUCTCODE BATCH跟單` and the observed compatible
   spelling `MMDD dealN PRODUCTCODE, BATCH跟單`.
2. A multi-product command accepts both
   `MMDD deal-START~END CODE1, CODE2, ... BATCH跟單` and
   `MMDD dealSTART~END CODE1, CODE2, ..., BATCH跟單`.
3. The inclusive range length must equal the number of unique product codes. The range is
   compatibility/audit metadata and a count check only; it does not locate an RFQ, ranking, table
   or quote row.
4. The issuer is still detected only from one issuer table profile. Incomplete and rejected rows
   are excluded. If a forwarded message includes one or more table-local candidates whose unique
   complete row count equals the product-code count, identical copies are collapsed and the first
   source-table/source-row order is retained. Two different same-sized candidates fail closed.
   Only when no table-local candidate exists may the parser use the unique complete rows across
   the message.
5. Product codes map to completed quote rows by list order. The number of codes and unique complete
   rows must match exactly.
6. Publication is atomic. A duplicate code, count mismatch, conflicting issuer signature,
   table/BATCH mismatch or invalid quote rejects the whole command; partial publication is not
   allowed.
7. Migration `0014` removes the one-product-per-inbound-message uniqueness constraint, extends the
   command audit snapshot, and adds `follow_board_publication_items` for ordered command-to-product
   links. The legacy `product_id`, `product_code` and `deal_sequence` command columns retain the
   first item for compatibility.

## Consequences

- Existing single-product commands and stored interests remain valid.
- One inbound message can publish up to 20 products without duplicating the raw message.
- The public manifest and existing follow-board clients need no API or UI change because each
  product remains a normal `follow_board_products` row.
- Applying migration `0014` is required before deploying publication version
  `follow-board-publication-v5`.
- Existing failed commands are not automatically reprocessed.

## Evidence / implementation links

- `backend/migrations/0014_follow_board_multi_product_publication.sql`
- `backend/src/follow-board-publication.ts`
- `backend/test/follow-board.test.ts`
- `backend/test/follow-board-migration.test.ts`
