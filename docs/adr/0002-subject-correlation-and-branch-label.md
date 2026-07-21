# ADR 0002: Subject-line correlation code and branch label

Status: Accepted
Date: 2026-07-22

## Context

Outbound RFQ emails to `i14053@firstbank.com.tw` currently carry the reply-correlation
token in the **subject**, appended after the issuer base subject:

```
SG[詢價]FCBKTPE: FCN(T+7) [RFQ:HUJODguEIau3KsxrW_rEtV-JtDVndOh_ohAEbLkt4So][BATCH:SG]
```

The `[RFQ:...]` value is a 43-character base64url HMAC (`keyedHash`), hashed with SHA-256 and
stored as `outbound_email_batches.correlation_token_hash`. On inbound, `correlationTags`
extracts the token from the **subject only**, re-hashes it, and matches the batch
(`inbound-parser.ts` → `correlateRfq`, `source = "TOKEN"`). A weaker `In-Reply-To` /
`References` fallback exists but is unreliable across the bank's human forward chain
(us → i14053 → issuer desks → i14053 → `reply@yintsun66.com`), so the subject token is in
practice the primary and most forward-survivable correlation carrier.

Operational symptom: correctly formatted and titled RFQs are delivered but receive no issuer
reply. The current working hypothesis is that bank-side security is filtering messages whose
subject contains the long, opaque, gibberish-looking token.

The user requested: (1) show the registrant's `branch_name` followed by the literal text
`分行` in the subject, immediately after `FCN(T+7)`; and (2) keep the correlation reference in
the subject (not move it to the body) but as a **short, human-readable code** rather than the
long opaque token.

## Decision

1. **Keep correlation in the subject.** The inbound parser is not changed to read the body.
   The earlier idea of moving the token to the email body (below the table) is dropped.

2. **Shorten the subject correlation code.** `correlationToken(rfqId)` returns a deterministic
   10-character Crockford base32 code (uppercase, excludes `I L O U`) derived from
   `HMAC-SHA256(EMPLOYEE_LOOKUP_KEY, "RFQ_CORRELATION_V1:" + rfqId)`. It remains deterministic
   per RFQ, so idempotent re-sends and the worker's `sha256(code) === correlation_token_hash`
   check stay consistent. Storage and lookup continue to key on `sha256(code)`, so no schema
   change is required.

3. **Add a sanitized branch label to the subject**, folded into the per-send `base_subject`
   snapshot (no new column). New subject shape:

   ```
   SG[詢價]FCBKTPE: FCN(T+7) 營業部分行 [RFQ:K7P2R9QTBM][BATCH:SG]
   ```

   The base issuer subject (`SG[詢價]FCBKTPE: FCN(T+7)`, which varies by issuer:
   CITI/GS/UBS/…) is preserved unchanged, so `subjectBatchCode` still identifies the batch.

4. **Sanitize the branch label** before it enters the subject: NFKC-normalize; keep only CJK
   ideographs, digits, and spaces; drop ASCII letters, brackets, `#`, `:`, and control
   characters; collapse whitespace; cap length; then append `分行`. If the sanitized value is
   empty, the branch segment is omitted entirely. Stripping ASCII letters guarantees the
   user-entered branch text cannot inject an issuer code (e.g. `CITI`, `SG`) or the
   `[RFQ:]/[BATCH:]/##` markers that would confuse `subjectBatchCode`, `correlationTags`, or
   `requesterMarker`.

5. **Relax, do not replace, the inbound token pattern.** `correlationTags` accepts token
   length `{10,128}` over the existing `[A-Za-z0-9_-]` charset, so both the new short code and
   any in-flight long tokens correlate during and after rollout (backward compatible).

## Consequences

- **Reduced token entropy** from ~256-bit hash material to ~50 bits (10 × 5 bits). Guessing a
  code still requires the server secret (HMAC), and a forged reply must additionally originate
  from a verified issuer sender, match the `[BATCH]` and the sender's expected batch, and land
  inside the 10-minute deadline. Cross-RFQ collision at 50 bits is negligible for the expected
  volume. Accepted.
- **Branch name is mildly identifying data now placed in the subject**, reversing the earlier
  "no personal data in the subject" position. This is an explicit, user-approved operational
  choice recorded here.
- **Branch sanitization strips ASCII letters**, so a branch such as `OBU` would lose those
  characters. Acceptable for the stated cases (Chinese names or numeric branch codes); can be
  revisited with a targeted issuer-token filter if latin branch names are required.
- Literal `分行` is appended even when `branch_name` already ends with `分行` (e.g. `信義分行`
  → `信義分行分行`), per the explicit request. Easily switched to "append only if absent".
- No D1 migration, no binding, no public-API, and no email-address change. The outbound
  subject-format guard (`startsWith(base_subject + " ")`) and the admin archive continue to
  work; the admin outbound list will display the branch-inclusive subject.
- The hypothesis that the long token caused filtering is **not yet proven**. This change makes
  the subject look less like a machine token, but delivery must still be confirmed with a real
  forwarded issuer reply before automatic recognition is treated as production-proven.

## Evidence / implementation links

- `backend/shared/email-formats.js` — `buildCorrelatedSubject`, `buildInstitutionEmail`, new `branchSubjectLabel`
- `backend/src/crypto.ts` — new `keyedShortCode`
- `backend/src/outbound.ts` — `correlationToken`, `sendRfq` base-subject snapshot, worker `subjectBase`
- `backend/src/inbound-parser.ts` — `correlationTags` length relaxation
- Tests: `email-formats.test.ts`, `crypto.test.ts`, `inbound-parser.test.ts`, `outbound.test.ts`, `inbound.test.ts`
- Supersedes the subject portion of the correlation design in `docs/backend/architecture.md`
  ("Adds an opaque token without personal data").
