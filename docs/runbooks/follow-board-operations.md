# Follow-board operations

## Prerequisites

1. Apply D1 migrations through `0015_follow_board_expiry.sql`.
2. Set the four-digit `FOLLOW_BOARD_VIEW_PIN` with Wrangler Secret input. Never place the PIN in a
   tracked file, command history, issue or chat.
3. Deploy the Worker/static assets, then copy only the approved static asset allowlist to the
   GitHub Pages snapshot repository.

## Publish a completed deal

Send from one of:

- `i14053@firstbank.com.tw`
- `i97293@firstbank.com.tw`
- `i11147@firstbank.com.tw`

Reply to the original inquiry mail thread so `In-Reply-To` / `References` survives. If no reply
thread is available, retain the existing opaque token. The completed issuer quote table must be
present as an HTML table in the message. Use:

```text
MMDD deal-N PRODUCTCODE ISSUER跟單YYYYMMDD
```

Example:

```text
0730 deal-03 PBZL BNP跟單20260730
```

Multiple completed deals from one issuer table:

```text
0728 deal2~4 PBZB, PBZC, PBZD, SG跟單20260815
```

Rules:

- `deal-N` remains 1–20 for subject compatibility and audit only; it does not select a quote.
- For multiple products, the inclusive `deal-START~END` range length must equal the number of
  comma-separated product codes. The range is an audit/count check and does not select rows.
- A hyphen after `deal` and the comma immediately before `ISSUER` are both optional for compatibility.
- `PRODUCTCODE` is 4–12 uppercase letters/digits and is case-insensitively unique.
- `ISSUER` is `BNP`, `MS`, `JPM`, `BARCLAYS`, `NOMURA`, `UBS`, `DBS`, `SG`, `CITI`, `GS` or `CA`.
- `YYYYMMDD` is the last Taiwan calendar date on which the product remains available. At 00:00
  on the following day the public manifest hides it, and the scheduled Worker archives it.
- The issuer is still recognized independently from distinctive table headers. The subject issuer
  must match that detected issuer exactly; it never selects an RFQ ranking or overrides the table.
- Incomplete and rejected rows are excluded. Repeated identical completed quote rows are collapsed.
- Product codes map in list order to the unique completed quote rows in their first table/row
  order. When a forwarded thread also contains a larger historical quote table, a table-local
  candidate with exactly the requested count takes precedence. Identical candidate copies collapse;
  different same-sized candidates remain manual review. The counts must match exactly, and the
  whole command fails if any code already exists.
- Every selected quote must have a finite Coupon. Its Coupon becomes
  「預估年化配息率，非保證收益」.
- Quotes from other inquiry channels are accepted when the approved publisher preserves unique
  reply-thread or opaque-token evidence.
- The sender must align with First Bank DKIM/SPF evidence.

Any mismatch is fail-closed and recorded as `MANUAL_REVIEW`, `UNMATCHED_RFQ` or
`SENDER_MISMATCH`; the Worker never guesses an issuer or substitutes a ranked quote.

## View and submit

- Application: `https://app.yintsun66.com/follow-board.html`
- Static compatibility site: `https://yintsun66-tech.github.io/fcnV2/follow-board.html`

Visitors enter the shared four-digit PIN. The PIN is stored only in browser `sessionStorage`.
The board displays the same full quote-card DOM used by image generation. 「下載商品圖」 opens a
new preview tab; the viewer explicitly downloads the PNG there. Images are generated in the
browser and are not saved to R2.

「我要跟單」 first tells the viewer to contact 高資產業務處同事 or 信託處 through LINE or
telephone, then keeps the existing intent form available.

Public rows display branch name/code, a masked employee number and intended amount. Complete
employee numbers are encrypted and visible only to an authenticated ADMIN/PS on the application
domain.

## Archive

An authenticated ADMIN/PS opens the application follow-board page and selects `下架`. Archiving
immediately removes the product from the public manifest but preserves the publication command,
source links, follow rows and audit history.

New products also archive automatically after the subject removal date. Automatic expiry uses the
same non-destructive `ARCHIVED` state and preserves the same records. Products created before
migration `0015` have no automatic expiry and remain under manual archive control.

## Diagnose a failed publication

Check, in order:

1. `follow_board_publication_commands.status` and `error_code`;
2. `inbound_messages.status`, `last_error_code`, `in_reply_to`, `references_header` and
   `authentication_results`;
3. whether reply-thread or opaque-token evidence exists and is conflict-free;
4. the extracted HTML table headers and detected parser profile;
5. whether more than one issuer signature was found;
6. whether the unique complete, non-rejected quote count matches the product-code count after
   duplicate copies are collapsed;
7. whether the table issuer exactly matches the issuer declared in the subject;
8. whether the removal date is valid and still in the future at publication time; and
9. whether the product code already exists.

Do not change D1 rows manually to force publication. Correct the source table/reference problem
and use a new unique command mail.
