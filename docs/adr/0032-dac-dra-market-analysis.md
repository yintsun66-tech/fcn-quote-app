# ADR 0032: Extend owner-scoped market analysis to DAC/DRA

Status: Accepted
Date: 2026-08-03

## Context

ADR 0020 deliberately limited the first owner-scoped market and risk analysis to FCN. The current
canonical quote model and ranking results also support the DAC family, whose issuer-facing names
include DAC, DRA, WRA and Range Accrual. Hiding the analysis action for those completed trades left
users without the same reference-price and worst-of tools available for FCN.

DAC/DRA also has a product-specific income condition that must not be obscured by reusing FCN
wording: after the guaranteed-interest period, every linked underlying must be strictly above the
strike for that observation period to earn interest.

## Decision

1. Keep the ADR 0020 owner, completed-RFQ and ranked/custom-fifth quote authorization unchanged.
2. Accept FCN plus DAC-family aliases (`DAC`, `DRA`, `WRA`, `Range Accrual`) at the analysis
   boundary. Normalize every DAC-family alias to canonical product `DAC` in the API response and
   browser model. Unknown products continue to fail closed with `ANALYSIS_PRODUCT_UNSUPPORTED`.
3. Keep the existing indicative-price and worst-of scenario calculations. For DAC, additionally
   display a prominent rule and a scenario-level assessment using strict comparison
   `worstOfIndexPct > strikePct`.
4. The DAC rule shown to users is: after the guaranteed-interest period, all linked underlyings
   must be above the strike for that period to earn interest; if any underlying is not above the
   strike, that period does not meet the interest condition. Formal documents remain authoritative.
5. Replace the selected-quote `Note Price` display tile with the linked-underlying list. The API
   retains `upfrontOrNotePricePct` for backward compatibility and other consumers.
6. Preserve the exported browser function name `buildFcnAnalysis` so existing imports remain
   compatible; its supported product scope is now FCN plus DAC/DRA.

This decision supersedes only Decision 4 (FCN-only scope) of ADR 0020. All ADR 0020 ownership,
local-storage, data-source, authorization and non-advice constraints remain in force.

## Consequences

- No D1 migration, Cloudflare binding, Secret, dependency or lockfile change is required.
- Completed DAC/DRA rankings expose the same owner-only analysis link as FCN.
- The additional DAC wording is educational and does not alter ranking, quote normalization,
  artifacts, issuer parsing or contractual cash flow.
- Existing FCN output remains unchanged except that its selected-quote tile now also shows linked
  underlyings instead of Note Price.

## Evidence / implementation links

- `backend/src/analysis.ts`
- `market-analysis.mjs`
- `backend-client.js`
- `backend/test/market-analysis.test.ts`
- `backend/test/ranking-integration.test.ts`
