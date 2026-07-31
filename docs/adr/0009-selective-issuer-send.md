# ADR 0009: Selective issuer send

Status: Accepted
Date: 2026-07-24

## Context

An RFQ previously always queried all eleven issuers (eight outbound batches). Users asked to
choose which issuers to query and compare per RFQ, from the automated (backend) send flow.

## Decision

1. `POST /api/v1/rfqs/:rfqId/send` accepts an optional body `{ issuers: [...] }` — a subset of the
   eleven canonical issuer names. Absent, empty, or all-invalid → **all eleven** (unchanged default,
   preserving existing behavior and tests).
2. Only the selected issuers are snapshotted as `rfq_expected_issuers` and therefore the only ones
   that count toward finalization/ranking. Only the outbound batches that cover a selected issuer
   are created and sent; `expected_issuer_count` / `outbound_batch_count` store the actual counts.
3. **BMJB grouping.** BNP/MS/JPM/BARCLAYS share one request email (`BMJB`) sent to the fixed bank
   recipient. It cannot be split. Selecting any BMJB issuer sends the shared BMJB batch (so the
   other three receive the request too), but only the selected BMJB issuers are snapshotted and
   ranked. This is the user-approved behavior ("send the shared email, compare only the selected").
4. The idempotency request hash includes the sorted selection, so different selections are not
   collapsed. The "all batches sent → WAITING" transition now compares the RFQ's own batch count
   (`total_count === sent_count`) instead of the fixed eight.
5. Frontend: the "發送詢價條件" button opens an issuer checklist (eleven issuers + an "all" toggle)
   before creating the RFQ; the selection is sent in the `/send` body.

## Consequences

- Unselected BMJB issuers still receive the request email (a limitation of the shared batch), but
  are excluded from expected issuers and ranking. All non-BMJB issuers are fully opt-in.
- No D1 schema, binding, address, or email-format change. The `/send` API gains an optional body.
- A per-RFQ selection lets users skip chronically slow/absent issuers (e.g. GS/CA) or focus a
  comparison, without changing the outbound formats.

## Evidence / implementation links

- `backend/src/outbound.ts` — `sendRfq` issuer/batch filtering and the all-sent check
- `backend-client.js` — issuer-picker dialog and `submitRfq(issuers)`
- `backend/test/outbound.test.ts` — selective-send test (BNP + SG → BMJB + SG batches)
