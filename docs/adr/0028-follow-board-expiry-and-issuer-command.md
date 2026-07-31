# ADR 0028: Issuer-declared follow-board commands and automatic expiry

- Status: Accepted
- Date: 2026-07-30

## Context

Follow-board publishers now name the completed quote issuer directly and append the product removal
date to the mail subject:

```text
0730 deal-03 PBZL BNP跟單20260730
```

The previous `BATCH跟單` suffix cannot distinguish BNP, MS, JPM and BARCLAYS because they share
BMJB. Published products also had no persistent expiry and required ADMIN/PS to archive them.

## Decision

1. A publication subject declares one of the eleven canonical issuers and an eight-digit
   `YYYYMMDD` removal date.
2. The declared issuer determines the compatibility batch. Correlation evidence must still match
   that batch, while the parsed table issuer must exactly match the declared issuer.
3. The removal date is interpreted in `Asia/Taipei`. A product remains available through that
   calendar date and expires at 00:00 on the following day.
4. Expired products are hidden from the manifest and rejected by the interest endpoint
   immediately. The existing two-minute scheduled job then changes them to `ARCHIVED`.
5. Automatic expiry never permanently deletes the product, publication command, interest rows or
   audit history. Existing products migrated with a null expiry remain manually archived.
6. The manifest may expose the public-safe expiry timestamp. No RFQ, correlation, sender or user
   data is added to the public response.
7. The product list renders the same quote-card DOM used for PNG output. Its existing
   「下載商品圖」 action opens a dedicated browser tab for preview and explicit PNG download.

## Consequences

- Migration `0015_follow_board_expiry.sql` is required before deploying publication parser v6.
- Incorrect issuer declarations, expired removal dates and parsed-table issuer mismatches fail
  closed and never publish a product.
- The static and application sites continue sharing one PIN-protected manifest and one frontend.
- No production dependency, R2 object, Queue, Durable Object or new public endpoint is introduced.
