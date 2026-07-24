# ADR 0010: Efficient RFQ polling and versioned snapshots

Status: Accepted
Date: 2026-07-24

## Context

The result dialog polled separate status and results endpoints every four seconds, accelerated to
two seconds near finalization, and added a third artifacts request while images were rendering.
The persistent active-RFQ badge also called the full card-list endpoint every thirty seconds.
With many users keeping result dialogs open, repeated authentication reads, provisional quote
loads, ranking calculations and HTTP round trips dominated the read path even when no RFQ state
had changed.

## Decision

1. Add owner-scoped `GET /api/v1/rfqs/summary`, returning only `{ activeCount }`, for the badge.
2. Add owner-scoped `GET /api/v1/rfqs/:rfqId/snapshot?since=<version>`. A changed snapshot
   combines status, results and current-ranking artifacts in one response. An unchanged version
   returns only `{ changed: false, version }`.
3. Build the opaque snapshot version from safe status/issuer/artifact state. While an RFQ is
   provisional, include a lightweight quote count/latest-created aggregate so a second reply from
   an already-terminal issuer still invalidates the snapshot.
4. Stop result and badge timers while the document is hidden. Refresh immediately when it becomes
   visible.
5. Use an adaptive foreground interval: four seconds after a change, then eight and fifteen
   seconds while unchanged. Use two seconds during finalization, the last minute before deadline,
   or while an artifact is queued/rendering.
6. Preserve the existing status, results and artifacts endpoints as public compatibility
   interfaces. The snapshot version is a change detector only and never authorization evidence.

## Consequences

- Unchanged polls perform one authenticated snapshot request and skip full quote/result/artifact
  loading and provisional ranking.
- The badge no longer executes RFQ-card correlated issuer/artifact counts.
- Background tabs generate no application timers until visible again.
- Changed snapshots still use the existing ranking and artifact contracts, so ranking semantics
  and persisted snapshots do not change.
- The provisional quote aggregate reads matching rows for one RFQ but returns only count/latest
  state; no migration, dependency, binding, environment variable or lockfile change is required.
- Cursor-list behavior and every existing public endpoint remain compatible.

## Evidence / implementation links

- `backend-client.js`
- `backend/src/rfqs.ts`, `backend/src/results.ts`, `backend/src/index.ts`
- `backend/test/rfqs.test.ts`
- `docs/backend/contracts.md`, `docs/backend/architecture.md`
