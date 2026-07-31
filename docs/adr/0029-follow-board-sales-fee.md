# ADR 0029: Follow-board sales-fee display

- Status: Accepted
- Date: 2026-07-30

## Context

Follow-board viewers need to see the sales fee (`手收`) beneath the final available date. Most
issuer tables quote a NotePrice, Cost or Offer Price, while CITI quotes an Upfront percentage.
Using one raw-column formula would therefore reverse the CITI meaning.

## Decision

1. For non-CITI issuer profiles, `salesFeePct = 100 - comparablePricePct`.
2. For CITI with `priceSemantics = UPFRONT`, `salesFeePct = rawPriceValue`.
3. New publication snapshots persist the public-safe `salesFeePct` and advance their schema version
   to 3.
4. Existing published snapshots remain compatible. If `salesFeePct` is absent, the client derives
   it as `100 - comparablePricePct`; CITI's already-approved normalization makes this equivalent
   to its raw Upfront value.
5. Missing or non-finite prices display an em dash and are never converted to zero.

## Consequences

- No D1 migration, dependency, binding, Secret or public endpoint is required.
- The value is display-only and does not change quote normalization, ranking or the PNG quote-card
  contents.
