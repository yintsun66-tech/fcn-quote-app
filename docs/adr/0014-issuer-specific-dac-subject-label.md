# ADR 0014: Issuer-specific DAC-family subject labels

Status: Accepted
Date: 2026-07-27

## Context

ADR 0013 made the first RFQ trade select `FCN(T+7)` or `DAC(T+7)` for every outbound batch.
Several issuer pricing systems instead call the DAC family DRA and use the mail subject to select
their pricing module. The first-trade rule, correlation order and frozen-subject retry behavior
remain correct, but the DAC-family display name must vary by outbound institution.

## Decision

1. The first trade remains the sole source for selecting FCN versus the DAC family.
2. First product FCN always produces `FCN(T+7)` for all eight batches.
3. For a DAC-family first product (`DAC`, `DRA`, `WRA`, or `Range Accrual`), use:

   | Outbound batch | T+7 subject label |
   | --- | --- |
   | BMJB | `DAC(T+7)` |
   | NOMURA | `DRA(T+7)` |
   | UBS | `DAC(T+7)` |
   | DBS | `DRA(T+7)` |
   | SG | `DRA(T+7)` |
   | CITI | `DAC(T+7)` |
   | GS | `DRA(T+7)` |
   | CA | `DRA(T+7)` |

4. Store the choice in each shared email institution profile. Browser/manual email and
   Worker/automatic email must use that same profile.
5. Newly created Worker batches snapshot the resulting subject. Queue consumers preserve an
   already saved subject exactly, including a legacy `DAC(T+7)` value.
6. Continue removing the obsolete separate ` DAC/DRA` marker from newly constructed subjects.
7. Branch label, correlation tags, sender, recipient, HTML body, issuer-specific body Product
   values, inbound parsing, authentication and ownership are unchanged.

## Consequences

- The subject label matches the institution terminology without splitting the eight existing
  outbound batches.
- BMJB remains `DAC(T+7)` because it is shared by BNP, MS, JPM and BARCLAYS; this change does not
  guess or alter the shared body Product value.
- UBS and CITI remain `DAC(T+7)` because they were not included in the approved DRA-subject list,
  even though their body/profile terminology may differ.
- Mixed FCN/DAC requests are still routed by the first row and retain the ambiguity documented in
  ADR 0013.
- No D1 migration, dependency, lockfile, secret, binding, address or public API change is needed.

## Evidence / implementation links

- `backend/shared/email-formats.js` — per-institution `dacSubjectProduct`
- `backend/src/outbound.ts` — profile-aware `base_subject` snapshot
- Tests: `backend/test/email-formats.test.ts`, `backend/test/outbound.test.ts`
- Supersedes only the single DAC-family subject-name portion of ADR 0013.
