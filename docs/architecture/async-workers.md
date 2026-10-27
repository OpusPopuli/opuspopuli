# Async Workers Architecture

Workers are standalone NestJS services that consume BullMQ queues. They run long-lived tasks — web scraping, AI enrichment, bulk data ingestion — off the GraphQL request cycle so mutations return immediately.

## Why workers

Region sync can take several minutes (AI structural analysis, bulk file downloads, LLM bio generation). Running that inline inside a GraphQL mutation creates connection timeouts, blocks the Node event loop, and makes retries impossible. Workers solve all three:

- **Mutations return in <100ms** with a job handle the caller polls
- **Retries are automatic** — BullMQ re-queues failed jobs with exponential backoff
- **Resource isolation** — workers can be given more CPU/memory than API-serving microservices without affecting gateway latency

## Folder layout

```
apps/backend/src/apps/workers/
├── region-worker/
│   ├── src/
│   │   ├── main.ts                        # NestJS bootstrap (REGION_WORKER_PORT)
│   │   ├── region-worker.module.ts        # Root module
│   │   ├── region-sync.processor.ts       # BullMQ Worker — dequeues and runs sync
│   │   └── region-sync.scheduler.ts       # Registers daily repeatable cron job
│   └── tsconfig.app.json
└── structural-analysis-worker/
    ├── src/
    │   ├── main.ts                        # NestJS bootstrap (STRUCTURAL_ANALYSIS_WORKER_PORT)
    │   ├── structural-analysis-worker.module.ts
    │   └── structural-analysis.processor.ts  # Fetches HTML → LLM → saves manifest
    └── tsconfig.app.json
```

Each worker gets its own directory under `workers/`. They share workspace packages but have no runtime dependencies on each other.

## The `@opuspopuli/queue-provider` package

`packages/queue-provider` is the shared substrate for all async jobs:

| Export | Purpose |
|--------|---------|
| `QueueModule.forRootAsync()` | NestJS module that wires `IORedis` connection + `QueueService` |
| `QueueService.enqueue()` | Add a job to a named queue |
| `QueueService.upsertScheduler()` | Create/update a BullMQ repeatable job |
| `createWorker()` | Factory that creates a `bullmq.Worker` with standard error handling |
| `QUEUE_CONNECTION` | Injection token for the raw `IORedis` instance |
| `REGION_SYNC_QUEUE` | Queue name constant (`'region-sync'`) |
| `STRUCTURAL_ANALYSIS_QUEUE` | Queue name constant (`'pipeline-structural-analysis'`) |
| `TRIGGER_SOURCE` | Enum: `MANUAL \| CRON \| STARTUP` |
| `ANALYSIS_REQUEST_SOURCE` | Enum: `CACHE_MISS \| CACHE_STALE \| MANUAL` |

## Job lifecycles

### Region sync

```
syncRegionData mutation
  │
  ├─ pipelineJobService.create({ status: QUEUED, bullmqJobId: <uuid> })
  ├─ queueService.enqueue(REGION_SYNC_QUEUE, data, { jobId: <uuid> })
  └─ returns RegionSyncJob{ status: QUEUED } to caller

region-worker (RegionSyncProcessor)
  │
  ├─ picks up job from Redis queue
  ├─ pipelineJobService.markRunning(id, bullmqJobId)   → status: RUNNING
  ├─ regionService.syncAll(...)
  │   ├─ for each html_scrape source:
  │   │   ├─ cache hit  → extract with existing manifest
  │   │   ├─ cache stale → MANIFEST_MISSING_CALLBACK fires (see below)
  │   │   └─ cache miss  → MANIFEST_MISSING_CALLBACK fires → returns pendingManifestAnalysis=true
  │   ├─ success → pipelineJobService.markSucceeded()   → status: SUCCEEDED
  │   └─ error   → pipelineJobService.markFailed()      → status: FAILED
  └─ BullMQ retries on throw (exponential backoff, 3 attempts by default)
```

**One job per data type (S2, `docs/plans/S2-per-type-sync-jobs.md`).** A job
with no `dataTypes`, or several, is a *parent*: the worker creates one child
`pipeline_jobs` row per type (`parent_job_id`), enqueues one child job per type
(`<parentId>-<dataType>`), and returns without syncing anything itself. Each
child runs the flow above for its one type, and the last to finish *settles*
the parent: its `results` become the children's, its status SUCCEEDED, FAILED
(naming the failed types) or CANCELLED. `regionSyncJob(parentId)` therefore
still answers "is it done", and `recentRegionSyncJobs` lists parents only.

**One running sync per type.** A single-type job takes a Redis lock on its
type (`<prefix>:region-sync:lock:<dataType>`) before `markRunning`; when
another sync of the type holds it, the job goes back to the delayed set for
`REGION_SYNC_LOCK_RETRY_MS` without using an attempt. Two syncs of one type
are unsafe (prunes and linkers race); two of different types run side by side
at `BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY` ≥ 2. Cancelling a parent cancels its
children.

### Structural analysis (on cache miss / stale)

The `MANIFEST_MISSING_CALLBACK` token is registered in `RegionDomainModule`. It fires during the scrape loop whenever the pipeline finds no manifest (cold miss) or a stale one (structure/prompt changed).

```
MANIFEST_MISSING_CALLBACK (fires inside ScrapingPipelineService)
  │
  ├─ check structural_analysis_jobs for active (QUEUED|RUNNING) job for this source → skip if exists
  ├─ queueService.enqueue(STRUCTURAL_ANALYSIS_QUEUE, { structuralAnalysisJobId, regionId, sourceUrl, ... })
  └─ structuralAnalysisJobService.create({ status: QUEUED })

  On cache_miss:  pipeline returns items=[] + pendingManifestAnalysis=true (skip extraction this run)
  On cache_stale: pipeline extracts with old manifest this run; worker refreshes in background

structural-analysis-worker (StructuralAnalysisProcessor)
  │
  ├─ picks up job from Redis queue
  ├─ structuralAnalysisJobService.markRunning(id, bullmqJobId)  → status: RUNNING (upserts if no DB record)
  ├─ pipeline.performManifestAnalysis(regionId, sourceUrl, dataType, ...)
  │   ├─ ExtractionProvider.fetchWithRetry(sourceUrl)           → HTML
  │   ├─ StructuralAnalyzerService.analyze(html, source)        → LLM call (2–10 min)
  │   └─ ManifestStoreService.save(manifest)                    → new version persisted
  ├─ success → structuralAnalysisJobService.markSucceeded(id, manifestId)
  └─ error   → structuralAnalysisJobService.markFailed(id, message)
```

`markFailed` is only called on the **final** retry attempt — intermediate failures just throw and let BullMQ retry, so `attempts` in the DB tracks retries correctly.

### Recovering stuck `RUNNING` rows on startup (#730)

The path above marks `pipeline_jobs` terminal on the worker's `catch` block, but two failure modes leave rows in `RUNNING` indefinitely:

1. **BullMQ stall + worker death**: a slow upstream (e.g. leginfo 503 backoff) blocks the worker long enough that BullMQ's lock-renewal heartbeat fails. BullMQ pushes the job back to `wait` for redelivery — the worker's `catch` never runs. If the worker also dies (OOM, deploy, host reboot), no future attempt marks the row.
2. **Hard crash**: SIGKILL, OOM, container restart — `catch` never runs.

`RegionSyncProcessor.onApplicationBootstrap` calls `PipelineJobService.sweepStaleRunning(maxAgeMs)` before starting the BullMQ worker. Any row in `RUNNING` with `started_at` older than `PIPELINE_JOB_STALE_AGE_MS` (default 600000ms = 10 min) gets flipped to `FAILED` with `error_message = 'Abandoned: worker startup detected stale RUNNING row past lock-renewal window'`. Idempotent + non-fatal — DB blip on startup doesn't block the worker.

Since S2 the sweep never touches a parent, which stays `RUNNING` for as long as its longest child, and a swept child settles its parent. With `WORKER_HOST` set it touches only rows this worker ran (`worker_host` = `WORKER_HOST`, or null for rows written before the column existed); unset, every host's rows, as before. Set it to something stable — a container's hostname changes on every recreate — and unique per worker process: two sharing one sweep each other's live rows.

## Outbound HTTP resilience (region-sync)

Long-running scrape loops talk to government sites that throttle (`HTTP 503`, `429`) or stall mid-response. A bare `fetch()` exposes the worker to two compounding problems:

- Each hung fetch eats into the BullMQ lock-renewal window. Long enough and the lock expires → BullMQ marks the job stalled → redelivery loop.
- A 503 burst can flood `attempts` and exhaust BullMQ's retry budget on a single source-side hiccup.

`apps/backend/src/apps/region/src/domains/resilient-fetch.ts` provides three composable primitives:

- The per-host rate limit is **not** in this module any more (S1, `docs/plans/S1-per-host-rate-limiter.md`). `fetchTextWithRetry` takes a `throttle` with an `acquire(url)` method, which is the shared `IHostRateLimiter`: one token bucket per host in Redis, with that host's policy stored beside it, so every process and DI scope enforces one budget per government site. The old in-process `HostThrottle` gave each process its own budget.
- `withRetry(fn, opts)` — generic exponential backoff (default 3 attempts, base 2s → 4s → 8s, max 60s, ±10% jitter). `isRetryable` predicate decides which errors are eligible.
- `fetchTextWithRetry(url, opts)` — composes the above with a 20s per-attempt timeout (kept well below the BullMQ 5-min lock so a hung fetch can't break renewal) and content-type validation. Retries 5xx, 429, timeouts, transport-level errors (`ECONNRESET`, `socket hang up`, `terminated`, etc.). `RetryableHttpError` is the marker class for retryable 5xx/429.

`RegionSyncService.fetchUrlText` delegates to `fetchTextWithRetry` with the `HOST_RATE_LIMITER` from the region module. Per-host policies — `rateLimitOverride` > the region's `rateLimit` > the default, strictest across regions — are published by `RegionPluginService` whenever plugins load, and hourly.

**Retry semantics — two layers:**
- *Inner retry (this module)*: handles transient network failures so a 503 burst on a single bill doesn't bubble up at all. The job sees only the final outcome.
- *Outer retry (BullMQ)*: handles failures that survive the inner retries — typically genuine logic bugs, schema mismatches, or extended outages. Still 3 attempts with BullMQ's own exponential backoff.

## Status tables

BullMQ's Redis state is ephemeral (`removeOnComplete`, `removeOnFail` are set). Every queue family has a paired PostgreSQL table as its durable job-history store.

### `pipeline_jobs` — region sync

| Column | Notes |
|--------|-------|
| `id` | UUID; also used as the BullMQ `jobId` |
| `bullmq_job_id` | Same as `id` for manually-enqueued jobs; `startup-YYYYMMDD` for startup jobs |
| `status` | `queued → running → succeeded \| failed` |
| `trigger_source` | `manual \| cron \| startup` |
| `attempts` | Incremented by the worker on each `markRunning` call |
| `result` | `JSONB` array of `SyncResult` objects (populated on success) |
| `error_message` | Final failure reason |

### `structural_analysis_jobs` — manifest analysis

| Column | Notes |
|--------|-------|
| `id` | UUID; also the `structuralAnalysisJobId` passed in job data |
| `bullmq_job_id` | BullMQ job ID (may differ from `id` on retry) |
| `status` | `queued → running → succeeded \| failed` |
| `region_id` | Region the source belongs to |
| `source_url` | URL that triggered the analysis |
| `data_type` | e.g. `representatives`, `meetings` |
| `requested_by` | `cache_miss \| cache_stale \| manual` |
| `manifest_id` | UUID of the saved manifest (set on success) |
| `attempts` | Incremented on each `markRunning` call |
| `error_message` | Final failure reason |

Indexed on `(region_id, source_url, data_type, enqueued_at DESC)` to support the deduplication check (skip enqueue if a QUEUED/RUNNING job already exists for a source).

## Polling from the frontend / API clients

```graphql
# Trigger
mutation {
  syncRegionData(dataTypes: [REPRESENTATIVES], maxReps: 5) {
    jobId
    status
    enqueuedAt
  }
}

# Poll (re-run until status is SUCCEEDED or FAILED)
query {
  regionSyncJob(jobId: "<id>") {
    jobId
    status
    startedAt
    finishedAt
    elapsedMs
    errorMessage
    results { dataType itemsProcessed itemsCreated itemsUpdated errors }
  }
}

# Recent history
query {
  recentRegionSyncJobs(limit: 10) {
    jobId
    status
    triggerSource
    enqueuedAt
    finishedAt
    elapsedMs
  }
}
```

## Worker env vars

### region-worker

| Env Var | Default | Effect |
|---------|---------|--------|
| `REGION_WORKER_PORT` | `3005` | HTTP port for `/health` and `/metrics` |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ connection |
| `BULLMQ_PREFIX` | `bullmq` | Key prefix in Redis (must match across producer and worker) |
| `BULLMQ_QUEUE_REGION_SYNC_LOCK_DURATION_MS` | `300000` | BullMQ lock duration for `region-sync` jobs. Heartbeat is half this. Longer values tolerate slower per-bill iterations at the cost of slower stalled-job detection. |
| `REGION_SYNC_CRON_ENABLED` | enabled | Set to `false` to stop the daily 2 AM repeatable job |
| `REGION_SYNC_RUN_ON_STARTUP` | disabled | Set to `true` to enqueue a full sync on every worker boot |
| `BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY` | `1` | Syncs run at once per worker — of different types only (S2). UAT runs 2; prod stays 1 until the GPU lane queue is on |
| `REGION_SYNC_LOCK_RETRY_MS` | `60000` | How long a job waits before retrying when another sync of its type is running |
| `WORKER_HOST` | hostname | Recorded on each `pipeline_jobs` row; when set, scopes the startup sweep to this worker. Stable and unique per worker process |
| `PIPELINE_JOB_STALE_AGE_MS` | `600000` | Age threshold for the startup sweep of stuck `RUNNING` `pipeline_jobs` rows. Set well above the BullMQ lock duration. Malformed or non-positive values fall back to the default with a warn log. See [Recovering stuck `RUNNING` rows](#recovering-stuck-running-rows-on-startup-730). |

In UAT, set `REGION_SYNC_CRON_ENABLED=false` so the cron does not fire during manual testing sessions.

### structural-analysis-worker

| Env Var | Default | Effect |
|---------|---------|--------|
| `STRUCTURAL_ANALYSIS_WORKER_PORT` | `3006` | HTTP port for `/health` and `/metrics` |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ connection |
| `BULLMQ_PREFIX` | `bullmq` | Key prefix in Redis (must match across producer and worker) |
| `LLM_URL` | `http://localhost:11434` | Ollama endpoint for structural analysis |
| `LLM_MODEL` | `qwen3.5:9b` | Model used for manifest derivation |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `600000` | Timeout for LLM calls (analysis can take several minutes) |

## Adding a new worker

1. **Create the directory**: `apps/backend/src/apps/workers/<name>/src/`
2. **Write the module, processor, scheduler**: follow `region-worker` as the template
3. **Add a tsconfig**: copy `region-worker/tsconfig.app.json`, adjust `outDir` to `../../../../dist/src/apps/workers/<name>`
4. **Register in `nest-cli.json`**:
   ```json
   "<name>": {
     "type": "application",
     "root": "src/apps/workers/<name>",
     "entryFile": "main",
     "sourceRoot": "src/apps/workers/<name>/src",
     "compilerOptions": { "tsConfigPath": "src/apps/workers/<name>/tsconfig.app.json" }
   }
   ```
5. **Add build/start scripts** in `apps/backend/package.json`:
   ```json
   "build:<name>": "nest build --tsc <name>",
   "start:<name>": "pnpm build:<name> && NODE_ENV=dev nest start <name> --watch"
   ```
6. **Write a Dockerfile**: copy `Dockerfile.region-worker`, change `pnpm build:region-worker` → `pnpm build:<name>` and the `CMD` path
7. **Add to `docker-compose-prod.yml`** and **`docker-compose-uat.yml`**
8. **Add a `pipeline_<name>_jobs` table** (or equivalent status table) in a new Prisma migration
9. **Add Prometheus scrape config** in `observability/prometheus.yml`

## Observability

Workers expose `/metrics` via `@willsoto/nestjs-prometheus` and log structured JSON via `@opuspopuli/logging-provider`. Prometheus scrapes each worker independently:

```yaml
# observability/prometheus.yml
- job_name: 'region-worker'
  static_configs:
    - targets: ['host.docker.internal:4005']   # host metrics port
  metrics_path: /metrics
  scrape_interval: 10s
```

BullMQ job counts (waiting, active, completed, failed) are visible in the Grafana dashboard.

---

**Related**:
- [System Overview](system-overview.md) — overall architecture including the workers section
- [Region Setup Guide](../guides/region-setup-and-validation-guide.md) — how to trigger and monitor a sync
- [Region Provider Guide](../guides/region-provider.md) — adding a new civic region
