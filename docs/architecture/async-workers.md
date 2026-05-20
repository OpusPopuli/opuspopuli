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
└── region-worker/
    ├── src/
    │   ├── main.ts                    # NestJS bootstrap (listens on REGION_WORKER_PORT)
    │   ├── region-worker.module.ts    # Root module
    │   ├── region-sync.processor.ts  # BullMQ Worker — dequeues and runs sync
    │   └── region-sync.scheduler.ts  # Registers daily repeatable cron job
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
| `TRIGGER_SOURCE` | Enum: `MANUAL | CRON | STARTUP` |

## Job lifecycle

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
  │   ├─ success → pipelineJobService.markSucceeded()   → status: SUCCEEDED
  │   └─ error   → pipelineJobService.markFailed()      → status: FAILED
  └─ BullMQ retries on throw (exponential backoff, 3 attempts by default)
```

`markFailed` is only called on the **final** retry attempt — intermediate failures just throw and let BullMQ retry, so `attempts` in the DB tracks retries correctly.

## `pipeline_jobs` table

`pipeline_jobs` is the canonical job-history store. BullMQ's Redis state is ephemeral (`removeOnComplete`, `removeOnFail` are set); the DB row is the durable record.

| Column | Notes |
|--------|-------|
| `id` | UUID; also used as the BullMQ `jobId` |
| `bullmq_job_id` | Same as `id` for manually-enqueued jobs; `startup-YYYYMMDD` for startup jobs |
| `status` | `queued → running → succeeded | failed` |
| `trigger_source` | `manual | cron | startup` |
| `attempts` | Incremented by the worker on each `markRunning` call |
| `result` | `JSONB` array of `SyncResult` objects (populated on success) |
| `error_message` | Final failure reason |

Every queue family gets its own peer table following this template (e.g., a future `bill_watch_jobs` table for bill-watch notifications).

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

| Env Var | Default | Effect |
|---------|---------|--------|
| `REGION_WORKER_PORT` | `3005` | HTTP port for `/health` and `/metrics` |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ connection |
| `BULLMQ_PREFIX` | `bullmq` | Key prefix in Redis (must match across producer and worker) |
| `REGION_SYNC_CRON_ENABLED` | enabled | Set to `false` to stop the daily 2 AM repeatable job |
| `REGION_SYNC_RUN_ON_STARTUP` | disabled | Set to `true` to enqueue a full sync on every worker boot |

In UAT, set `REGION_SYNC_CRON_ENABLED=false` so the cron does not fire during manual testing sessions.

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
