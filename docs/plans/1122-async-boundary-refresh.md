# #1122 — Make `refreshBoundaries` asynchronous (enqueue + poll)

- **Issue:** OpusPopuli/opuspopuli#1122
- **Date:** 2026-09-06
- **Author:** Rodney Gagnon
- **Branch:** `fix/async-boundary-refresh-1122`
- **Data classification:** None — jurisdiction identity + public TIGER/Geoportal geometry. No PII/PHI.

## Problem (confirmed in production 2026-09-06)

`refreshBoundaries(force: true)` runs the entire ~5-minute, ~6.3k-geometry load
**inside the GraphQL request**. Two independent interruption vectors both truncate
it, and because county-published boundaries (#1136 supervisorial districts) are
appended **last** in the batch and every row is upserted only after the whole set
is fetched, the county rows are the guaranteed casualty:

1. **Cloudflare 524** at ~100s aborts the client; the server load then dies.
2. **Any region-container restart** mid-load (config re-sync, redeploy, health
   recycle) aborts the boot/request load. Observed: region `restarts=2` while every
   other service stayed at 0; congressional districts persisted (early in the batch)
   but the 5 Sonoma supervisorial rows never did (`count = 0`), and no
   `BoundaryLoader: N upserted` summary ever printed.

Re-running never helps: `force` restarts from the first layer in the same order and
aborts at the same point.

## Fix

Two parts, both required for "works every time":

1. **Move the load off the request path onto the `region-sync` BullMQ queue**, exactly
   like `syncRegionData`. `refreshBoundaries` enqueues a job and returns a
   `RegionSyncJob` immediately (well inside any proxy timeout); the region-worker runs
   `boundaryLoader.loadAll({ force })`; progress + counts are pollable via
   `regionSyncJob(jobId)` and survive client disconnect. BullMQ retries a failed attempt.
2. **Upsert incrementally per source-group** inside `loadAll` (state group, then each
   county group) instead of accumulating every row and upserting once at the end. A load
   interrupted mid-run then persists whatever groups already completed — the county rows
   are no longer hostage to the entire state batch finishing.

## Subtasks

1. `packages/common` — add `BOUNDARIES = "boundaries"` to `DataType`; rebuild dist.
2. `packages/queue-provider` — add `force?: boolean` to `RegionSyncJobData`; rebuild dist.
3. `region-info.model.ts` — add `BOUNDARIES` to `DataTypeGQL` (GraphQL enum) so a
   boundary result can be stored as a `SyncResultModel`.
4. `region.resolver.ts` — `refreshBoundaries(force)` now enqueues via a new
   `enqueueBoundaryJob` helper and returns `RegionSyncJobModel` (was `BoundaryLoadResultModel`).
5. `region-sync.processor.ts` — inject `BoundaryLoaderService`; when
   `dataTypes` includes `boundaries`, run the boundary load and map its counts to a
   `SyncResultModel` (`itemsCreated=upserted`, `itemsSkipped=missingKey`,
   `errors=[failed]`) instead of calling `syncAll`.
6. `boundary-loader.service.ts` — `loadAll` upserts each source-group as it is fetched,
   accumulating counts (durable partial progress).
7. Update `region.resolver.spec.ts`, `region-sync.processor.spec.ts`,
   `boundary-loader.service.spec.ts`.
8. Update the Postman collection's two boundary entries to the enqueue+poll shape (#1121).

## GraphQL / federation impact

`refreshBoundaries` return type changes `BoundaryLoadResult` → `RegionSyncJob`. Both types
already exist in the region subgraph SDL; no new federated type is introduced and the
gateway composition is unaffected. `refreshBoundaries` is admin-only and is not referenced
by the frontend (only the Postman collection).

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Return-type change breaks an admin caller | low × possible | Only caller is the Postman collection (updated here); not in frontend. |
| Boundary load blocks the worker event loop and stalls other region-sync jobs | medium × possible | loadAll is I/O-bound (awaited HTTP + bounded-concurrency awaited upserts) and yields; it already ran detached at boot. Runs as one queue job, serialized with other syncs by design. |
| Incremental upsert changes counts semantics | low × rare | Counts are summed across groups; totals identical to the single-batch path. Covered by loader spec. |
| `boundaries` leaking into the civic `syncAll` dispatch | low × rare | Processor intercepts `boundaries` before `syncAll`; resolver never mixes boundaries with civic data types. |

## Verification

- Unit: resolver enqueues + returns a job; processor dispatches boundaries → loadAll and
  maps counts; loader upserts per group and sums counts.
- Prod fitness: enqueue returns immediately; poll `regionSyncJob` shows SUCCEEDED with
  `itemsCreated`/`itemsSkipped`; killing the client does not abort; the 5 Sonoma
  supervisorial rows land.
