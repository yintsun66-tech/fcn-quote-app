# ADR 0031: selected-issuer ranking boundary and accelerated small-RFQ submission

Status: Accepted
Date: 2026-08-01

## Context

Selective sending already snapshots the issuers chosen by the user. The BMJB outbound format is
shared by BNP, MS, JPM and BARCLAYS, so one physical email can still cause a reply from a BMJB
issuer that was not selected. Raw replies must remain available for audit, but allowing such a
quote into provisional ranking, final ranking or quote-card authorization would violate the user's
selection.

The browser also performed create, validate and send as three sequential HTTP round trips. That
added avoidable latency before the outbound queue could start, especially on mobile networks. RFQs
with no more than three selected issuers need clearer progress and an explicit, safe early-close
path without changing the approved 15-minute reply window or 60-second mail grace.

## Decision

1. `rfq_expected_issuers` is the immutable comparison and image-authorization boundary. An inbound
   quote from an unselected issuer is retained, but is excluded from provisional/final ranking,
   result change detection, custom-fifth candidates and quote-card authorization.
2. Add `POST /api/v1/rfqs/submit` as an additive compatibility workflow. It reuses the existing
   create, validate and send implementations and derives deterministic child idempotency keys from
   the caller's idempotency key. Existing individual endpoints remain supported.
3. The issuer picker shows selected issuer count and physical outbound-batch count. Selecting at
   most three issuers does not shorten the server deadline. If each trade has at least
   `min(2, selectedIssuerCount)` valid quotes after the seven-minute soft deadline, the UI highlights
   the existing owner-authorized early-finalize action and names pending issuers in the confirmation.
4. While a small RFQ remains provisional, unchanged snapshot polling is capped at eight seconds.
   All-terminal completion, the 15-minute reply window and the final 60-second transport grace stay
   unchanged.

## Consequences

- A user's issuer selection now governs every comparison and image path, including shared BMJB
  responses.
- Browser submission reaches the outbound queue with one network round trip instead of three.
- Three-or-fewer issuer RFQs feel more responsive, but no unproven issuer-response SLA is encoded in
  the backend and no reply is discarded merely because the selected set is small.
- No D1 migration, Cloudflare binding, environment variable or production dependency is added.

## Evidence / implementation links

- `backend/src/rfq-submit.ts`
- `backend/src/ranking.ts`
- `backend/src/results.ts`
- `backend/src/artifacts.ts`
- `backend-client.js`
- `backend/test/outbound.test.ts`
- `backend/test/ranking-integration.test.ts`
