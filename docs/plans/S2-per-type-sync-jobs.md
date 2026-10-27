# S2 — one region-sync job per data type

Phase A, step 5 of `ingestion-resource-lanes.md` (§6 S2, §7 H1). The row:
"make the startup/manual 'all types' path enqueue one job per type. Run
`region-sync` at concurrency ≥ 2 so bills never holds the only slot. Record
`worker_host` on `markRunning` and scope `sweepStaleRunning` to this host's
rows. `cancelRegionSync` cancels the children of a fanned-out request."
Depends on S7 (#1402), which bounds GPU access before this raises sync
concurrency. This is the last Phase A item before Phase B.

## What is true today

**One slot, every type in series.** `region-sync` runs at concurrency 1
(`createWorker` default; `BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY` unset). The
crons are already per (region, dataType) (`region-sync.scheduler.ts`), but a
startup job, or a `syncRegionData` call with no or several `dataTypes`, runs
`syncAll`, which walks every plugin and every type one after another in one
job (`region-sync.service.ts:757`). A ~48 h bills run therefore holds the only
slot, and every cron behind it waits.

**Concurrency in one process has never happened**, so nothing has been made
safe for it. An audit of the sync path (2026-10-23) found:

- **Different types are safe to overlap, with two exceptions.** Every
  per-type sync service keeps its per-run state in locals and parameters —
  trackers, discovery sets, indexes, counters — and the shared state
  (rate limiter, HTTP pool, GPU lanes, manifest store, watermarks) is
  either keyed by type or shared by design. Prunes and deletes are all
  scoped to their own type's tables.
  1. **`syncAll` tears down and rebuilds the local plugins at the start of
     every job** (`refreshActiveLocalPlugin` → `reloadActiveLocalPlugin`,
     `region-plugin.service.ts:353`): `unregister()` destroys every local
     plugin and empties the registry, then re-creates them. Its own comment
     says this "fires only on admin toggles" — it fires on every sync. A
     second job starting mid-run destroys the instance the first is using.
     Harmless today only because `destroy()` is `initialized = false` and
     nothing in the empty window does IO, so it drains in one microtask.
     Both are invariants nothing enforces: add IO to plugin init, or real
     teardown to `destroy()`, and concurrent syncs silently sync zero types
     (reported SUCCEEDED) or fail.
  2. **Meetings beside bills can fail the meetings run.**
     `legislativeActionLinker.linkMinutes` snapshots all bills once, then
     writes each minutes row's actions in a transaction with no error
     handling (`legislative-action-linker.service.ts:205-233, 1018`). A
     concurrent bills prune that deletes a snapshotted bill makes the
     `createMany` fail on the `billId` foreign key, and the rest of the
     minutes go unlinked.
- **The same type twice is unsafe**: two bills prunes from different
  discovery snapshots can delete each other's new bills; the co-author /
  committee / vote linkers do non-transactional delete-then-create; two
  civics glossary prunes can delete terms whose provenance the other has not
  written; two campaign-finance linker passes are deadlock-prone; every type
  doubles its LLM calls. Concurrency 1 is what prevents all of it today.
  Note that a job with no `dataTypes` means _every_ type.

**`sweepStaleRunning` fails every `running` row older than 10 minutes**
(`pipeline-job.service.ts:127`), whoever owns it (§7 H1).

## Design

1. **Fan-out in the worker.** A job whose `dataTypes` is absent or names more
   than one type is a _parent_. The worker resolves its type list — the
   union of the supported types of the plugins it would have synced (state
   plugins scoped by `regionId`, plus county plugins at `depth`
   COUNTY/ALL), and `boundaries` only if named, as today — creates one child
   `pipeline_jobs` row per type, and enqueues one child job per type with
   the parent's limits and a single `dataTypes` entry. The worker does it,
   not the resolver, because the worker is where the plugin set is known
   (it re-reads enabled plugins before each run). Bills is enqueued first,
   since it is the longest.
   - Child job id `<parentId>-<dataType>` (BullMQ forbids `:`); child rows
     are looked up by `(parent_job_id, dataType)` before creating, so a
     redelivered parent does not fan out twice.
   - **The parent does not wait** for its children — it returns once they
     are enqueued, so it never holds a slot a child needs.
   - A single-type job — every cron, and most manual calls — runs exactly
     as today.
2. **The parent's row reports its children**, with no GraphQL schema
   change: when a child reaches a terminal state it settles the parent —
   `results` is the children's results concatenated, `status` SUCCEEDED
   when every child succeeded, FAILED (naming the failed types) when any
   failed, CANCELLED when it was cancelled; `startedAt`/`finishedAt` span
   the children. Settling is recomputed whenever every child is closed —
   not only while the parent is open, because a child the startup sweep
   failed can be redelivered and succeed, and the parent must follow it —
   and written only when the outcome changes, so two children finishing
   together write it once and a parent cancelled outright stays cancelled.
   The parent is marked running only from QUEUED or RUNNING: a redelivered
   parent that already settled, or one cancelled since its check, fans out
   nothing; only children still `queued` are enqueued, and the fan-out ends
   by settling. A fan-out that fails on its last attempt fails the children
   it never enqueued, rather than leaving them `queued` for a job that does
   not exist. A cron job (no row id) finds the row its previous delivery
   made instead of creating a second request. `syncRegionData` still returns the parent, and `regionSyncJob`
   on it still answers "is it done" — operators' existing workflow.
   `recentRegionSyncJobs` lists top-level rows only, so one request is one
   line, as today.
3. **One running job per data type**, across processes. Before any work a
   job takes a Redis lock `<prefix>:locks:region-sync:<dataType>` (SET NX
   with a TTL equal to the job's own BullMQ lock duration — shorter, a
   stall the job survives would free the type for a second sync — renewed
   at a third of it, taken back if it lapsed while nobody else holds it,
   released by compare-and-delete). Its own keyspace, outside the queue's.
   A Redis error taking it on the last attempt fails the row. Held, the job is
   moved back to the delayed set for a minute (`moveToDelayed` +
   `DelayedError`, which costs no attempt) instead of running. Per type,
   not per (region, type): a job with no `regionId` syncs every region's
   plugins of that type, so a narrower key would let it overlap a scoped
   one. A crashed holder's lock expires within its TTL.
4. **Concurrency** is the existing `BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY`
   knob. **The default stays 1** — Phase A is "merged to main, inert" —
   UAT sets 2, and prod raises it in the Phase C release together with
   `GPU_LANE_QUEUE_ENABLED`: two LLM-heavy types at once on an unbounded
   Ollama is the contention S7 exists to stop.
5. **`worker_host`** (additive nullable column) is written by `markRunning`
   from `WORKER_HOST`, falling back to `os.hostname()`. **The sweep is
   scoped only when `WORKER_HOST` is set** — to rows whose `worker_host` is
   it, or null (rows written before this change). Unset, it sweeps every
   host's rows, as before S2: the hostname is a container id that changes
   on every recreate, and scoping by it would strand every row a previous
   container left. (Review round 1 caught this: prod's compose, in the
   node repo, sets no `WORKER_HOST`.) `WORKER_HOST` must be unique per
   worker **process** — two sharing one sweep each other's live rows. The
   sweep never touches a parent — a parent stays `running` for as long as
   its longest child, legitimately — and a swept child settles its parent.
   `markRunning` never reopens a CANCELLED row (a cancel landing after the
   job's own check would be lost), and `markSucceeded`/`markFailed` never
   overwrite one: a cancelled running child finishes its item and ends
   cancelled.
6. **Cancellation fans out.** Cancelling a parent cancels its open children
   and removes any still waiting from the queue — by each row's stored
   queue id, which for a child is `<parent>-<type>` and for a startup job
   `startup-<date>`, not the row id; a running child stops at its next
   boundary, as today. A child created just after the cancel escaped its
   fan-out; it reads its parent's cancel, and closes its own row. A child
   is cancellable on its own and settles its parent.
7. **The plugin refresh becomes build-then-swap**, and skips when nothing
   changed. The new local plugins are built and initialised first, then
   swapped into the registry in one synchronous step, and the old ones
   destroyed after — so no reader can ever see an empty registry. A running
   sync's instance is still destroyed after the swap; that is harmless only
   while `destroy()` is a flag reset, as it is for every declarative plugin
   today. A fingerprint of the enabled local plugin rows (name, parent,
   config — the version lives in the config) skips the rebuild when it
   matches the last successful load, which is every sync but the one after
   an admin toggle. It is not recorded when a plugin failed to load or the
   fallback stood in, so those are retried every sync, as before; and the
   recovery mutation and admin toggles force a rebuild. Needs an atomic
   `replaceLocal` on the registry (`packages/region-provider`).
8. **`linkMinutes` survives a concurrent bill delete.** A minutes row whose
   write fails on the bill foreign key is retried once with its bill
   references re-resolved against the current bills, and, if it still
   fails, counted as an error and skipped, so one deleted bill no longer
   abandons every remaining minutes row.

## Schema

One additive migration, via `/op-migration`, on `pipeline_jobs`:
`worker_host text NULL`, `parent_job_id text NULL` (matching `id`, which is TEXT) referencing
`pipeline_jobs(id) ON DELETE CASCADE`, and an index on `parent_job_id`. No
backfill: existing rows are top-level, and a null host keeps the old sweep
behaviour for them.

## Data classification

No personal data. `worker_host` is a machine name; parent/child ids are
row ids. Sync payloads are unchanged. One caveat: on a developer machine
the `os.hostname()` fallback is often a person's laptop name (`Someones-
MacBook-Pro.local`), which lands in the dev and integration databases —
neither leaves the machine, and deployments set `WORKER_HOST`.

## Not in this change

- **Fan-out per plugin.** Per type is what the row asks for and what the
  lock needs; a type's plugins still run in series inside its job.
- **Coalescing duplicate waiting jobs.** A daily bills cron that fires while
  a 48 h bills run holds the lock waits behind it, as it does today behind
  the single slot. Dropping a cron firing when an identical job is already
  waiting is a separate change.
- **A `children` field on `RegionSyncJob`** — a federation schema change
  that nothing needs yet; the parent's results already carry every type.

## Tests

Integration (real Postgres and Redis):

- A parent with no `dataTypes` fans out one child per supported type, does
  not run any sync itself, and settles SUCCEEDED with every child's results
  once they finish; FAILED naming the type when one child fails.
- A redelivered parent does not fan out twice.
- Two jobs of one type never run at once across two worker processes; the
  second runs after the first, without using an attempt.
- Two jobs of different types run at once at concurrency 2.
- Cancelling a parent cancels its waiting and running children.
- The sweep fails a stale row of this host and a legacy null-host row,
  leaves another host's and a parent's alone, and settles a swept child's
  parent.
- `markRunning` writes `worker_host`.
- The refresh never exposes an empty registry to a concurrent reader,
  never destroys an instance before its replacement is registered, and
  skips the rebuild when the plugin rows are unchanged.
- A minutes row whose bill is deleted mid-link is retried, and the rest of
  the minutes are still linked.

Each verified by reintroducing its defect. UAT: a full startup sync at
concurrency 2 — bills and another type running side by side, the parent
settling, a cancel mid-run.

## Risks

| Risk                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An unknown shared-state race between two types         | Audited (above); concurrency stays 1 in prod until Phase C, after UAT has run it                                                                                                                                                                                                                                                                                                                                 |
| The lock outlives a crashed holder and blocks its type | TTL renewed while running, so it expires within the TTL of a crash                                                                                                                                                                                                                                                                                                                                               |
| A parent never settles                                 | Every child's terminal state settles it; the startup sweep also closes any running parent whose children have all finished (`settleFinishedParents`). Not covered: a child row left `queued` whose job is gone (a parent job failed for stalling twice mid-fan-out) — the operator cancels the parent, which closes its open children. Results appear on the parent only when it settles, not as children finish |
| Two LLM-heavy types contend at Ollama                  | Concurrency 1 in prod until lanes are on; UAT measures it                                                                                                                                                                                                                                                                                                                                                        |
| `WORKER_HOST` unset in a deployment                    | The sweep keeps its pre-S2 behaviour (every host's rows), which is right on one host; set it per process before running a second host. Prod's compose (node repo) does not set it yet                                                                                                                                                                                                                            |
| Two processes share one `WORKER_HOST`                  | They sweep each other's live rows — the H1 hazard back. It must be unique per worker process                                                                                                                                                                                                                                                                                                                     |
| The type lock lapses under a long stall                | Taken back on the next renewal when nobody else holds it; a second sync that took it meanwhile is not stopped (warned)                                                                                                                                                                                                                                                                                           |

## Owner decisions (2026-10-23)

- **Concurrency:** 1 in prod, 2 on UAT; prod raises it with
  `GPU_LANE_QUEUE_ENABLED` in the Phase C release.
- **Same-type exclusivity:** one Redis lock per data type, across regions.
- **`recentRegionSyncJobs`:** top-level (parent) rows only; children roll up.

## Review and verification (2026-10-23)

Reviews were self-reviews (Claude, for a sole author) and need a human
countersign.

- **Round 1** — code and security in parallel, on the first complete diff.
  Security: no blockers; code: three blockers — a parent the sweep closed
  never followed its redelivered child's success; `markRunning` reopened
  CANCELLED rows (a lost cancel, a parent stuck running); and the scoped
  sweep stranded prod rows because prod sets no `WORKER_HOST`. All fixed,
  with the suggestions (fan-out and lock failures on the last attempt, the
  lock's TTL and keyspace, cancel by stored queue id, forced refresh, a
  test that could not fail, real-database tests for the linker retry and a
  cancel mid-run).
- **Round 2** — combined, on the fixed diff. No blockers; five
  suggestions, all fixed: fail only children never enqueued; settle writes
  idempotently (a fan-out-failed parent was losing its children's results);
  the startup sweep closes finished parents; the cron-row lookup is
  bounded by the job's queue time; the per-retry log is at debug.
- **Found along the way, fixed here:** manifest-ready follow-up syncs used
  a job id BullMQ rejects (`:` in five segments — "Custom Id cannot contain
  :"), caught as a warning since the #1172/#1185 dedup fix, so none ran.
  Reproduced against BullMQ in the worker image; the test runs BullMQ's own
  validator, as does one for S2's child ids.
- **Mutation testing:** every guard verified by reintroducing its defect
  (about 40 mutants across the rounds), each failing on an assertion.
- **UAT:** a representatives + propositions request fanned out into two
  children that ran side by side; the parent settled at the last child's
  finish with both results; a second representatives job waited for the
  first (for a slot — the lock's re-delay path is proven by the
  cross-process integration test instead).
- **Not run locally:** the eight integration suites that call live services
  on :3000–:3004 — those ports are UAT's, whose services read the dev
  database, so they cannot pass with UAT up. CI runs them on its own stack.
