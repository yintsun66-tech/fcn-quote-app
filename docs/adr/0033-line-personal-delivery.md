# ADR 0033: Deliver follow-board LINE pushes to one personal chat

Status: Accepted
Date: 2026-08-04

## Context

Follow-board publication notifications were addressed to a configured private LINE group through
`LINE_GROUP_ID`. The operator now requires the quote-card image and its companion Flex message to
be delivered to one designated person's chat with the LINE Official Account instead.

The LINE push endpoint accepts personal, group and room destinations in the same `to` field. A
configuration mistake could therefore silently keep delivering financial product information to
the old group unless the application distinguishes the destination type itself.

## Decision

- Replace the runtime destination with the Secret `LINE_USER_ID`.
- Accept only LINE personal-user IDs matching `U` plus 32 hexadecimal characters.
- Do not fall back to `LINE_GROUP_ID`, a group (`C...`) destination or a room (`R...`) destination.
- Keep `LINE_CHANNEL_ACCESS_TOKEN` as a Secret and keep the existing fixed LINE push endpoint.
- Preserve the existing message contents, image access controls, retry key, timeout, audit
  redaction and post-publication failure isolation.
- Keep the webhook endpoint disabled during normal operation. Personal delivery does not require
  an always-on webhook once the designated user ID is known.

## Consequences

- A deployment without a valid `LINE_USER_ID` safely records/skips the push as `NOT_CONFIGURED`;
  it never sends to the former group.
- The designated person must add and not block the LINE Official Account before push delivery can
  succeed.
- The old `LINE_GROUP_ID` Secret becomes unused and may be deleted only after a successful personal
  delivery test.
- No D1 migration, public API change, dependency or message-format change is required.

## Evidence / implementation links

- `backend/src/line-push.ts`
- `backend/src/types.ts`
- `backend/test/line-push.test.ts`
- `backend/wrangler.jsonc`
- `docs/backend/contracts.md`
