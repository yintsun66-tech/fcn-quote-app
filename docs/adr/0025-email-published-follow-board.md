# ADR 0025: Email-published follow board with browser-rendered product images

- Status: Accepted
- Date: 2026-07-30

## Context

The public GitHub Pages compatibility site and the authenticated Cloudflare application need one
shared follow-board. ADMIN/PS staff publish a completed deal by replying to its RFQ mail thread
from an approved First Bank mailbox with a strict command subject such as:

```text
0730 deal-1 PBZY BMJB跟單
```

Visitors do not register. They enter a shared four-digit PIN, inspect published product terms,
render/download a product image, and submit branch, employee-number and intended-amount data.
The downloaded image must display the public product code instead of the RFQ correlation code.
Deal documents prove eligibility but are not published.

## Decision

1. `follow_board_products` stores an immutable, public-safe snapshot of the selected email-table
   row. It never exposes the source RFQ, user, branch, correlation token or mail subject.
2. Publication commands are processed before issuer quote parsing. Only the three explicitly
   approved mailboxes are accepted, and First Bank-aligned DKIM/SPF evidence is required.
3. A command must carry unique source evidence through reply headers or an opaque token. Internal
   RFQ correlation is retained when available but is not required, because the completed quote may
   come from another inquiry channel.
4. Distinctive table headers determine the issuer. The existing issuer profile parses the
   requested `deal-N` row. BATCH validates consistency only; it must never select a quote from an
   RFQ ranking.
5. A case-insensitive product code is unique. Duplicate codes, multiple issuer signatures,
   unrecognized layouts, missing/incomplete/rejected rows or table/BATCH mismatches become manual
   review and never guess a product.
6. The four-digit PIN is a Worker Secret and is verified by the Worker. The browser stores it only
   in `sessionStorage`. This keeps the no-registration experience while avoiding a literal PIN in
   the public GitHub source. Failed attempts are rate-limited.
7. Public clients use only:
   - `GET /api/v1/public/follow-board/manifest`
   - `POST /api/v1/public/follow-board/interests`
8. Intended-follow submissions encrypt the complete employee number at rest, retain a keyed
   lookup hash for deterministic upsert, and expose only a masked value publicly. ADMIN/PS may
   view the decrypted value through the authenticated application route.
9. Product PNGs are rendered on demand by the viewer's browser with the vendored html2canvas.
   No follow-board PNG is persisted in R2 and Browser Rendering is not queued.
10. Products are archived rather than deleted. Archived products disappear from the public
   manifest while source, command and audit records remain.

## Consequences

- Both frontends share one D1 source and one page implementation copied by the existing static
  asset allowlist.
- GitHub Pages must call the application Worker cross-origin; only the approved GitHub Pages and
  application origins receive CORS headers.
- The shared PIN is not user identity and must never authorize ADMIN/PS data. It can be rotated as
  a Secret, but all current visitors share the same access.
- Intended-follow data is an expression of interest, not a confirmed trade. The UI must display
  that distinction and label Coupon as an estimated annualized distribution rate, not guaranteed
  return.
- No new production dependency, R2 object class, queue or Durable Object is introduced.
