# ADR 0013: First-trade product label in outbound subjects

Status: Accepted
Date: 2026-07-27

## Context

ADR 0011 added the literal suffix ` DAC/DRA` after `FCN(T+7)` whenever any trade in an outbound
request belonged to the DAC family. Production evidence proved that issuer pricing systems use
the product shown in the subject to select a pricing module. Operations now requires a simpler
subject label: the T+7 segment itself must be `FCN(T+7)` or `DAC(T+7)`, chosen from the first
trade, with no separate ` DAC/DRA` marker.

An RFQ may still contain multiple trades and the current data model does not split outbound mail
by product. The requested first-trade rule is therefore the deterministic routing rule for a
mixed-product RFQ until a separately approved product-batch design exists.

## Decision

1. Normalize the first trade's product using NFKC, case folding and collapsed whitespace.
2. First product `FCN` produces:

   ```
   <issuer prefix> FCN(T+7) <branch label?> [RFQ:<code>][BATCH:<code>]
   ```

3. First product `DAC`, `DRA`, `WRA`, or `Range Accrual` produces:

   ```
   <issuer prefix> DAC(T+7) <branch label?> [RFQ:<code>][BATCH:<code>]
   ```

4. Remove the legacy literal segment ` DAC/DRA`; never append it to a newly generated subject.
5. Only the first trade controls the subject product. Later trades do not change it.
6. The shared browser/Worker email-format module owns this rule. The Worker saves the resulting
   product-aware base subject in `outbound_email_batches.base_subject`.
7. Queue consumers preserve the saved base-subject snapshot exactly. They do not reinterpret it
   from current code, so an already queued legacy batch remains retryable and auditable.
8. Branch-label and correlation-tag order, sender, recipient, HTML tables, issuer body Product
   values, authentication, ownership and inbound correlation rules remain unchanged.

## Consequences

- Browser/manual and Worker/automatic new requests use the same first-trade subject rule.
- Repeated construction is idempotent for both `FCN(T+7)` and `DAC(T+7)`, and also removes the
  legacy marker when converting an unsnapshotted subject.
- A mixed FCN/DAC request is routed according to its first row. This is explicit but still cannot
  guarantee that every later row is evaluated by the intended issuer module. Product-specific
  outbound batches remain the long-term design if mixed requests must be supported safely.
- Existing sent/archive records and already snapshotted Queue jobs are not rewritten.
- No D1 migration, dependency, lockfile, secret, binding, address or public API change is needed.

## Evidence / implementation links

- `backend/shared/email-formats.js` — `buildProductAwareSubject`, `buildInstitutionEmail`
- `backend/src/outbound.ts` — product-aware `base_subject` snapshot
- Tests: `backend/test/email-formats.test.ts`, `backend/test/outbound.test.ts`
- Supersedes ADR 0011.
