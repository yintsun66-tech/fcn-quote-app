# Architecture Decision Records (ADR)

ADRs preserve decisions that should not need to be reconstructed from chat messages, Git diffs, or Cloudflare dashboard state.

## When to add an ADR

Add a numbered ADR for a decision that changes any of these boundaries:

- authentication, authorization, or sensitive-data handling;
- D1 schema/data retention or R2 visibility;
- issuer parsing, normalization, ranking, or financial comparison semantics;
- public API, email correlation, or email delivery design;
- Cloudflare binding, deployment, or recovery design.

Use the next sequential number and this structure:

```markdown
# ADR NNNN: short title

Status: Proposed | Accepted | Superseded  
Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Evidence / implementation links
```

Do not put secrets, raw mail, user records, or personal data in an ADR.

## Existing decisions

- [ADR 0001: Repository governance and multi-agent handoff](0001-repository-governance.md)
- [ADR 0002: Subject-line correlation code and branch label](0002-subject-correlation-and-branch-label.md)
- [ADR 0003: Quote-turnaround tuning (configurable deadline, coalesced session writes)](0003-quote-turnaround-tuning.md)
- [ADR 0004: User-initiated early finalization of an RFQ](0004-user-early-finalize.md)
- [ADR 0005: One quote image per trade](0005-per-trade-quote-images.md)
- [ADR 0006: Live provisional ranking, two-stage deadline, and on-demand images](0006-live-results-and-on-demand-images.md)
- [ADR 0007: Top-five ranking and ranked-quote images](0007-top-five-and-ranked-quote-images.md)
- [ADR 0008: Recoverable user RFQ workspace](0008-recoverable-rfq-workspace.md)
- [ADR 0009: Selective issuer send](0009-selective-issuer-send.md)
- [ADR 0010: Efficient RFQ polling and versioned snapshots](0010-efficient-rfq-polling.md)
- [ADR 0011: DAC-family subject routing marker](0011-dac-subject-routing-marker.md)
- [ADR 0012: PS support tier and account management](0012-ps-tier-and-account-management.md)
- [ADR 0013: First-trade product label in outbound subjects](0013-first-trade-product-subject-label.md)
- [ADR 0014: Issuer-specific DAC-family subject labels](0014-issuer-specific-dac-subject-label.md)
- [ADR 0015: Mail-transport grace, custom fifth issuer, and late-reply recalculation](0015-mail-grace-custom-fifth-and-late-recalculation.md)
- [ADR 0016: On-demand quote images](0016-on-demand-quote-images.md)
- [ADR 0017: Client-side quote-card rasterization](0017-client-side-quote-card-rendering.md)
- [ADR 0018: Employee-number login for new registrations](0018-employee-number-login-registration.md)
- [ADR 0019: Guarded permanent deletion of empty user accounts](0019-guarded-empty-account-deletion.md)
- [ADR 0020: Owner-scoped FCN market and risk analysis](0020-owner-scoped-fcn-market-analysis.md)
- [ADR 0021: Opt-in public market resources](0021-opt-in-public-market-resources.md)
- [ADR 0022: Worker-normalized SEC and FRED market context](0022-worker-normalized-sec-fred-context.md)
- [ADR 0023: Alpha Vantage end-of-day prices and market ideas](0023-alpha-vantage-eod-market-ideas.md)
- [ADR 0024: Homepage TradingView hot lists; Alpha Vantage narrowed to previous close](0024-homepage-tradingview-hotlists.md)
- [ADR 0025: Email-published follow board with browser-rendered product images](0025-email-published-follow-board.md)
- [ADR 0026: Select one unique complete quote for follow-board publication](0026-follow-board-unique-complete-quote.md)
- [ADR 0027: Atomic multi-product follow-board publication](0027-multi-product-follow-board-publication.md)
- [ADR 0028: Issuer-declared follow-board commands and automatic expiry](0028-follow-board-expiry-and-issuer-command.md)
- [ADR 0029: Follow-board sales-fee display](0029-follow-board-sales-fee.md)
- [ADR 0030: Scheduled retention for mail, images and structured results](0030-scheduled-retention.md)
- [ADR 0031: Selected-issuer ranking boundary and accelerated small-RFQ submission](0031-selected-issuer-boundary-and-small-rfq-submit.md)
- [ADR 0032: Extend owner-scoped market analysis to DAC/DRA](0032-dac-dra-market-analysis.md)
- [ADR 0033: Deliver follow-board LINE pushes to one personal chat](0033-line-personal-delivery.md)
- [ADR 0034: Earnings-date advisory](0034-earnings-date-advisory.md)
- [ADR 0035: Self-service password reset and account anonymization](0035-self-service-password-reset-and-account-anonymization.md)

The current technical decisions are also summarized in `docs/backend/architecture.md`; when an ADR and a historical phase document disagree, verify current code/configuration and update the documentation in a dedicated change.
