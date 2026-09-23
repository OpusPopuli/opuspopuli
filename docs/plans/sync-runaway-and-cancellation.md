# Plan of record — a sync that is failing everything must stop, and an operator must be able to stop one

| | |
|---|---|
| **Date** | 2026-09-22 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `fix/sync-abort-and-cancel` |
| **Data classification** | No new data flow. Job bookkeeping only. |

## 1. What happened

A civics sync failed item 1 of 24 after 24.5 minutes — the model ran its entire
32,000-token budget and produced no JSON. The run then continued to item 2, and
would have continued through all 24: **roughly ten hours to produce nothing.**

Stopping it was worse. There is no cancel mutation, no CLI, and no supported
path of any kind. Stopping the worker released the BullMQ lock, and on restart
the job was re-delivered as a stalled job and began again from item 1. The only
remaining options were hand-editing Redis or waiting out the ten hours.

Two separate defects, and neither is about the model:

1. **A run with a 100% failure rate runs to completion.** Nothing notices that
   every single item is failing.
2. **A running job cannot be stopped**, and cannot even be prevented from
   restarting.

## 2. Why the tracker is the right place for the first one

`sync-phase-logger.ts` already sees every item's outcome — it counts
`created`/`updated`/`skipped`/`error` for the phase line — and **every** sync
family routes through it: civics, propositions, bills, representatives,
meetings. One change there protects all of them, and no sync service needs to
know about it.

The alternative — a check inside each sync service — is five copies of one
rule, which is how `num_ctx` came to be missing from three call sites at once.

## 3. Subtasks

| # | Work | Where | Migration |
|---|---|---|---|
| **S1** | Abort a phase after N consecutive item failures (default 5, `SYNC_CONSECUTIVE_FAILURE_LIMIT`). Throws a typed `SyncAbortedError` carrying the count and the last error, so the job fails loudly with a reason rather than ending quietly. | `sync-phase-logger.ts` | — |
| **S2** | `cancelRegionSync(pipelineJobId)` admin mutation: sets `status='cancelled'`, and removes the BullMQ job when it is still waiting. | region resolver + service | — |
| **S3** | Processor checks the `pipeline_jobs` row before doing any work and exits immediately when it is `cancelled`. This is what stops a re-delivered stalled job from starting over — the failure mode that made today unrecoverable. | `region-sync.processor.ts` | — |
| **S4** | Tests: the abort fires on consecutive failures and NOT on scattered ones; a success resets the counter; a cancelled row short-circuits the processor. | co-located | — |

## 4. Decisions

**Consecutive, not cumulative.** A long sync legitimately has scattered
failures — a dead URL, one malformed record. Aborting on cumulative count would
stop healthy runs. Five consecutive failures is a different thing: it says the
run itself is broken, not an item.

**Throw rather than return.** The phase is already inside the processor's
try/catch, which marks the `pipeline_jobs` row failed with the message. An
abort must land there, not be swallowed into a "completed with 24 errors"
summary that reads like success.

**`cancelled` is a new status string, not an enum change.** `status` is a plain
`String` in the schema, so this needs no migration and no coordinated deploy.

**Cancellation is checked at the job boundary, not mid-item.** Stopping a
24-minute LLM call in flight needs cooperative cancellation threaded through
every sync service, and that is a larger change. Checking at the boundary
already fixes what actually hurt: the job restarting forever. Mid-run
cancellation is filed separately rather than half-built here.

## 5. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| The abort threshold fires on a healthy run that hits a rough patch | medium × possible | Consecutive-only, and a single success resets the counter; threshold is env-tunable without a deploy |
| An operator cancels a job that is mid-write | low × possible | The boundary check runs between jobs, never mid-transaction |
| A cancelled job is re-enqueued later and silently skipped | low × possible | The processor logs at `warn` when it exits for cancellation, naming the row |
| `cancelled` rows are read as failures by existing dashboards | low × likely | Distinct status string; the sweeper only touches `running` |

## 6. Corrected during review

**A skip now CLEARS the counter.** The plan said `skipped` should be neutral —
neither tripping the abort nor clearing it. Tracing the call sites showed that
is wrong in the one place it matters most: the bills sync walks 5,019 rows and
skips most of them as unchanged, so five errors separated by hundreds of skips
would accumulate into an abort and stop a healthy 48-hour run. A skip means the
item was handled and needed no work — the pipeline functioning. It clears.
`itemUnknown` counts the same way, for the same reason.

**The escape path was traced and is better than the plan assumed.** `syncAll`
wraps EACH data type in its own try/catch, so an abort in civics is caught
there, recorded in that data type's `errors[]`, and the remaining data types
still run. No worker crash and no row stranded in `running`. The one call to
`item()` from inside a `catch` (`propositions-sync.service.ts`, the analysis
pass) uses a tracker with a single item, so it can never reach the threshold.

## 7. Not in scope

- **Mid-run cooperative cancellation** — needs an abort signal threaded through
  every sync service. Filed separately.
- **The civics extraction failure itself** — the 7B produces valid civics JSON
  in 80s when driven directly, so the production failure is not reproduced yet
  and is not this issue.
- **The stale `bull:` Redis prefix** — 2026-09-11 debris from an older image;
  no code path writes it. Cleanup, not a code change.
