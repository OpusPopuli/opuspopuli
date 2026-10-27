# The DB lane — measure the database as a resource

Companion to `ingestion-resource-lanes.md`. Owner, 2026-10-26: *"I doubt that
we will be disk / IO bound but should we complete the thought and have a IO /
DB / Disk lane? If we ever move the DB to the cloud, we might want to know how
long IO is taking."*

Lanes are named for the resource they consume (`feedback`: network, CPU, GPU
— each model a GPU sublane). The database is the fourth resource every sync
touches, and today it is the one nobody can see.

## What is true today (read 2026-10-26)

- `db_query_duration_seconds{service,operation,table}` is **declared** in
  `metrics.module.ts` and has a `recordDbQuery()` on `MetricsService` —
  **nothing calls it**. The `db_write` pipeline stage is in `PipelineStage`
  and **nothing uses it**.
- The pool gauges work: `db_pool_connections_{open,idle,busy}`, read every
  15 s from Prisma's `$metrics.json()` (`previewFeatures = ["metrics"]`,
  Prisma 5). UAT region-worker: 3 open, 0 busy at rest.
- The same `$metrics.json()` already carries three **histograms** we discard:
  `prisma_client_queries_wait_histogram_ms` (time waiting for a pool
  connection), `prisma_datasource_queries_duration_histogram_ms` (time in the
  database), `prisma_client_queries_duration_histogram_ms` (the total).
- The lane's concurrency bound already exists: Prisma's pool,
  `PRISMA_CONNECTION_LIMIT` (`DbService.buildDatasourceUrl`). Unset, Prisma
  uses `num_cpus * 2 + 1`.

## Decision: a measured lane, not a queue

The other lanes needed queues because their resource was oversubscribed (one
GPU, two cores, a per-host rate). The DB lane's bound is the pool, and a
query waiting for a connection is exactly what the GPU lane's
`lane_wait_seconds` measures for the GPU. So the DB lane is the pool, made
visible — a queue in front of it is warranted only if the wait histogram ever
says the pool is contended.

## Design

1. **Export Prisma's histograms as they are** — wait, database time, total —
   as `db_lane_wait_seconds`, `db_lane_query_seconds` and
   `db_lane_total_seconds` (Prometheus histograms, seconds), from the 15 s
   collection that already reads `$metrics.json()`. Cumulative buckets are
   republished, not re-observed, so no query is counted twice.
2. **Busy time per table:** `DbService` adds each SQL statement's
   engine-measured duration (Prisma's `query` EVENT) to
   `db_lane_busy_seconds_total{table,statement}` — a counter, not a
   histogram, so it costs one series per (table, statement) pair in use
   (#1344). `table` is parsed from the statement's schema-qualified name
   (`none` when it names none), `statement` is a closed set. `rate()` of it is
   "seconds of DB per second" by table, which is what a cloud move would
   multiply.

   *Changed in UAT, 2026-10-26:* the first version timed Prisma's MIDDLEWARE
   (`$use`), which sees the model name. A batched `$transaction([...])`
   resolves every operation in it together, so each of 50 proposition upserts
   was timed as the whole batch — **14.3 s of "busy" where Prisma's own
   histograms measured 0.62 s for all 588 queries**. The query event carries
   one duration per statement, so nothing is counted twice; the price is
   table names instead of model names. Prisma reports the event's duration
   in whole milliseconds, so sub-millisecond statements count as 0: this
   counter RANKS tables; the histograms (microsecond precision) are the
   totals. Measured after the change, an unchanged propositions run: busy
   ~0.26 s against Prisma's 0.49 s in-database, `propositions INSERT` (the
   upserts) on top.
3. **Retire the dead declarations:** `db_query_duration_seconds` and
   `recordDbQuery()` go (nothing ever wrote them); `PipelineStage.DbWrite`
   stays until a stage needs it, documented as unused.
4. **Pool size is reported**, `db_lane_pool_size`, so a panel can draw busy
   connections against the bound.
5. **Dashboard:** a **DB lane** row — wait p95, query p95, busy connections
   against pool size, top tables by busy time.

## Acceptance

- UAT: a propositions sync shows non-zero DB busy time, query and wait
  histograms, and the top tables are the ones the sync writes (`propositions`,
  `source_versions`).
- The wait p95 is near zero on the local stack — the baseline a cloud
  database would be compared against.
- No new series per row or per request; series count bounded by
  (table, statement) pairs in use.

## Data classification

Timings and table names only; no query text, parameters or values reach a
label.
