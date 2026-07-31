# ADR 0008: Recoverable user RFQ workspace

Status: Accepted  
Date: 2026-07-23

## Context

The application kept the current RFQ ID only in the in-memory `backend-client.js` state. Closing
the result dialog left no reopen control, and reloading or leaving the page discarded the ID.
The RFQ and ranking remained in D1, but the authenticated user had no API or UI for finding it
again.

## Decision

1. Add `GET /api/v1/rfqs` as an owner-scoped, read-only collection endpoint. It supports
   `scope=active|completed|all`, `limit=1..50`, and an opaque cursor ordered by
   `(created_at DESC, id DESC)`.
2. The response exposes only safe workspace summary data: workflow/dispatch status, timestamps,
   trade count, first-trade underlyings and target, issuer completion counts, ranking version and
   ready-artifact count. The query always filters by the authenticated `user_id`.
3. Add a permanent **新增詢價 / 我的詢價** launcher, an active-RFQ badge, responsive RFQ cards,
   status filters and pagination. Users can return to any owned active or completed RFQ.
4. Use `?rfq=<opaque-id>` as the stable result deep link. The Cloudflare static-assets setting
   currently returns a 404 for unknown paths, so a query route provides reload/back-button
   recovery without changing deployment fallback behavior or breaking GitHub Pages compatibility.
5. D1 remains authoritative. No trade terms, rankings or artifacts are copied into local storage.
   A URL RFQ ID is only a locator; every status/result/artifact request still performs server-side
   ownership authorization.
6. Closing a result view stops its foreground polling and removes the query parameter. The
   server-side workflow continues independently, and the workspace badge/list can reopen it.

## Consequences

- Reloading a result URL or logging back in returns to the same owned RFQ.
- Multiple simultaneous RFQs are discoverable; leaving a waiting view no longer strands results.
- Existing `rfqs(user_id, created_at)` and related RFQ indexes support the initial list query, so
  no D1 migration or production dependency is required.
- The badge performs a lightweight active-list refresh every 30 seconds while logged in. Exact
  progress remains on the selected RFQ's existing status endpoint.

## Evidence / implementation links

- `backend/src/rfqs.ts`, `backend/src/index.ts`
- `backend-client.js`, `styles.css`
- `backend/test/rfqs.test.ts`
- `docs/backend/contracts.md`, `docs/backend/architecture.md`
