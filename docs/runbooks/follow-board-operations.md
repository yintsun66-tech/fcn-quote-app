# Follow-board operations

## Prerequisites

1. Apply D1 migration `0013_follow_board.sql`.
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
MMDD deal-N PRODUCTCODE BATCH跟單
```

Example:

```text
0730 deal-1 PBZY BMJB跟單
```

Rules:

- `deal-N` is 1–20 and selects that RFQ trade sequence.
- `PRODUCTCODE` is 4–12 uppercase letters/digits and is case-insensitively unique.
- `BATCH` is `BMJB`, `NOMURA`, `UBS`, `DBS`, `SG`, `CITI`, `GS` or `CA`.
- The issuer is recognized only from distinctive table headers. BATCH is a consistency check and
  never selects an RFQ ranking.
- `deal-N` selects the Nth parsed quote row from that uniquely recognized issuer table.
- The selected row must be complete, non-rejected and have a finite Coupon. Its Coupon becomes
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
Product images are generated in the browser and are not saved to R2.

Public rows display branch name/code, a masked employee number and intended amount. Complete
employee numbers are encrypted and visible only to an authenticated ADMIN/PS on the application
domain.

## Archive

An authenticated ADMIN/PS opens the application follow-board page and selects `下架`. Archiving
immediately removes the product from the public manifest but preserves the publication command,
source links, follow rows and audit history.

## Diagnose a failed publication

Check, in order:

1. `follow_board_publication_commands.status` and `error_code`;
2. `inbound_messages.status`, `last_error_code`, `in_reply_to`, `references_header` and
   `authentication_results`;
3. whether reply-thread or opaque-token evidence exists and is conflict-free;
4. the extracted HTML table headers and detected parser profile;
5. whether more than one issuer signature was found;
6. whether `deal-N` exists and contains complete, non-rejected terms with a finite Coupon;
7. whether the table issuer is consistent with BATCH; and
8. whether the product code already exists.

Do not change D1 rows manually to force publication. Correct the source table/reference problem
and use a new unique command mail.
