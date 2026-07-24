# ADR 0011: DAC-family subject routing marker

Status: Accepted
Date: 2026-07-24

## Context

Issuer pricing systems use the outbound RFQ subject to choose a product-pricing module.
Canonical product `DAC` may be called `DRA`, `WRA`, or `Range Accrual` by different issuers.
The existing subjects always ended their issuer prefix with `FCN(T+7)`, so a correctly
formatted DAC request could be routed to the FCN module and produce no quote.

The branch label and the `[RFQ:...][BATCH:...]` correlation suffix are already ordered and
snapshotted according to ADR 0002. The new product marker must not change either mechanism.

## Decision

1. If an outbound email contains a DAC-family product (`DAC`, `DRA`, `WRA`, or
   `Range Accrual`, after NFKC/case/space normalization), insert the literal marker
   `DAC/DRA` immediately after `FCN(T+7)`.
2. The complete subject order is:

   ```
   <issuer prefix> FCN(T+7) DAC/DRA <branch label> [RFQ:<code>][BATCH:<code>]
   ```

3. FCN-only email subjects remain unchanged.
4. Product-marker insertion is idempotent, so a snapshotted subject is not marked twice when
   the Queue consumer rebuilds an email.
5. The shared browser/Worker email-format module owns this rule. The Worker snapshots the
   product-aware base subject in `outbound_email_batches.base_subject` before queuing.
6. The marker is routing metadata only. It is not authentication, authorization, issuer
   identity, RFQ ownership, or reply-correlation evidence.

## Consequences

- Browser-generated and Worker-generated DAC request subjects remain consistent.
- Admin outbound archives and retry processing display/reuse the exact product-aware subject.
- Existing FCN subjects, table formats, recipients, and correlation parsing are unchanged.
- The current RFQ model permits a request to contain both FCN and DAC trades. Because one
  email has only one subject and issuers use that subject to select one pricing module, mixed
  product requests remain operationally ambiguous. Until a separately approved product-batch
  design is implemented, any email containing DAC receives the `DAC/DRA` marker.
- A controlled live DAC RFQ is still required to prove issuer-side module routing end to end.

## Evidence / implementation links

- `backend/shared/email-formats.js` — `buildProductAwareSubject`, `buildInstitutionEmail`
- `backend/src/outbound.ts` — product-aware `base_subject` snapshot
- Tests: `backend/test/email-formats.test.ts`, `backend/test/outbound.test.ts`
