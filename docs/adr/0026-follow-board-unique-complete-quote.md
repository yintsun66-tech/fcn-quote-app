# ADR 0026: Select one unique complete quote for follow-board publication

- Status: Accepted
- Date: 2026-07-30

## Context

Follow-board publication subjects contain `deal-N` for compatibility with the original command
format and database audit record. In practice, the number does not identify the completed quote:
forwarded mail can repeat the same completed issuer table and can also contain the original request
table. Using `deal-N` as a parsed-row index can therefore select the wrong row or reject a valid
single completed quote.

## Decision

1. Continue accepting and recording `deal-N` so existing mail subjects and D1 constraints remain
   compatible. It is audit metadata only.
2. Do not use `deal-N` to select a quote row and do not copy it into new public product snapshots.
3. Continue identifying the issuer from distinctive table headers, never from BATCH, an RFQ
   ranking or the deal number.
4. Exclude incomplete, rejected and non-quotable rows before selection.
5. Collapse repeated copies only when every parsed public term, price semantic and quote reference
   is identical.
6. For a single-product command, publish only when exactly one unique complete quote remains.
   ADR 0027 extends the same rule to an explicit product-code count for multi-product commands.
   Unexpected additional quotes, conflicting issuer signatures or missing complete quotes remain
   manual-review cases.

## Consequences

- Forwarded threads containing duplicate copies of one completed quote can publish safely.
- Original request tables and disclaimer/layout tables do not become publication candidates.
- A message with two genuinely different completed quotes still fails closed rather than guessing.
- No D1 migration, dependency, binding or public API change is required.
- ADR 0025 remains authoritative except that its row-selection rule is replaced by this decision.
