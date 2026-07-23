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

The current technical decisions are also summarized in `docs/backend/architecture.md`; when an ADR and a historical phase document disagree, verify current code/configuration and update the documentation in a dedicated change.
