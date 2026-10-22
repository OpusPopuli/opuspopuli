# F2 — stop the bills prune deleting bills it should keep

Track 0 of `ingestion-resource-lanes.md` (§0, §5.1 F2). That section is the
record of the finding; this is the design for the fix. Ships as a **patch
release**, independent of v2.0.0.

## What is wrong

`pruneStaleBills` (`region-sync.service.ts`) hard-deletes every bill in the
region whose `externalId` is not in `syncedExternalIds`. Deletion cascades to
`BillVote`, `BillCoAuthor` and `BillCommitteeAssignment`, and nulls
`LegislativeAction.billId`.

1. **A failed bill is deleted.** `processOneBillUrl` adds an id only when
   `result !== 'failed'`. A 503 or an LLM reply with no JSON on an existing
   bill removes it, and its voting record with it.
2. **The prune is not scoped by session.** When the California source moves
   to `session_year=20272028` (the 2027–28 session convenes early December
   2026), the first full sync deletes every 2025–26 bill — chaptered laws
   included.
3. **Nothing bounds it.** One bad discovery pass (a source down, a markup
   change returning zero links on one of two sources) deletes whatever that
   source owned.

There are no tests on the prune at all.

### Measured on prod, 2026-10-22

- `opuspopuli-region-worker` (up since 2026-09-16): **0** `[BillSync]` lines
  and **0** `removed (not seen in this sync)` lines. No bills sync has run in
  five weeks, so mode 1 has deleted nothing on this deployment yet.
- `bills`: **5,019 rows, all `session_year = 2025-2026`.**
- Prod runs `REGION_SYNC_CRON_ENABLED=false`, so a bills sync happens only
  when triggered. The exposure is the next manual or release resync, and
  every sync after the session flip.

So this is prevention, not recovery — but it has a calendar deadline.

## Design

### 1. Prune against *discovered* ids

A bill that failed was still seen. Every id parsed from a status URL in phase
1 goes into a `discoveredExternalIds` set, whatever its outcome. The prune
reads that set; `syncedExternalIds` is no longer its input.

Built in `processOneBillUrl` from the same `safeBillIdFromUrl` call, before
any fetch, so no outcome branch can forget to add it.

### 2. Scope the prune to the sessions this sync covered

After phase 2, query the distinct `sessionYear` of stored bills whose
`externalId` is in the discovered set. Prune only inside those sessions.

Read from the DB rather than parsed from the id, for two reasons:

- the id format (`20252026` + `0` + `AB1`) is California's; the
  `session_year` column is the region-neutral fact;
- on the first sync after the flip, the discovered ids are 2027–28 bills that
  phase 2 has **just created**, so the lookup returns `{2027-2028}` and the
  2025–26 corpus is outside the scope by construction.

Discovered but never stored (every new bill failed) contributes no session,
so an all-failed sync prunes nothing.

### 3. Deletion guard

Refuse the prune, log at `error`, and leave every row in place, when it would
delete more than **max(2% of the in-scope bills, 10 bills)**.

- The fraction catches a broken discovery pass on a large corpus: 2% of 5,019
  is 100.
- The floor keeps a small region usable: 2% of 60 bills is one, which would
  refuse every legitimate prune.

Refused, not truncated — deleting "the first 100" of a bad set is still
deleting the wrong bills. The phase records the refusal with
`reason=deletion-guard` so it is visible on the dashboard, not only in logs.

### 4. `pipeline_rows_deleted_total`

Counter, label `data_type` (§3 contract), incremented by the number of rows
actually deleted. Added to `PipelineMetric`, registered in `metrics.module.ts`
and the Prometheus observer. A refused prune increments nothing; the alert in
§3 ("bulk deletion") reads this counter.

## Out of scope

- Soft delete for bills. A real design change (every reader would need a
  `deletedAt` filter), and the three fixes above remove the failure modes
  without it.
- The K5 freeze, which makes frozen bills count as discovered. It builds on
  this; it does not belong in a patch.

## Tests

Unit, against the prune with a mocked `db` (the shape the other sync specs
use), plus one integration test on `postgres_test` because the scoping is a
query:

| Test | Reintroduce to verify |
|---|---|
| A failed existing bill survives a full sync | add only non-failed ids again |
| A 2025–26 bill survives a sync that discovered only 2027–28 bills | drop the session filter |
| A prune over the guard is refused and deletes nothing | remove the guard |
| A prune under the guard deletes exactly the undiscovered in-scope bills | — (the positive case) |
| `pipeline_rows_deleted_total` counts deleted rows; a refusal counts zero | emit before the guard |

## Risks

| Risk | Mitigation |
|---|---|
| Bills that really left the source survive longer (a failed bill is now kept) | Correct by design — a failed fetch is not evidence the bill is gone. The next successful sync re-tests it |
| The guard refuses a legitimate large cleanup | Logged at `error` with the count; the operator re-runs with the cause understood. Rare, and the opposite error is unrecoverable |
| Session lookup is a second query over up to ~5k ids | One `findMany … distinct sessionYear` on an indexed unique column, once per sync |

## Owner decision

The guard threshold — §11 of the parent plan suggests ~2%; this adds the
10-bill floor. **Decided 2026-10-22: max(2% of in-scope bills, 10 bills).**

## Status — implemented 2026-10-22, branch `fix/bill-prune-scope`

All four parts as designed. Every regression test was verified by putting
its defect back:

| Defect reintroduced | Caught by |
|---|---|
| Session filter removed | 3 unit tests, 2 integration tests |
| Guard removed | the refusal unit test |
| Only non-failed ids recorded as discovered | the failed-bill unit test |
| Counter registered but not injected | the OpenMetrics scrape test |

**One test lied on its first version.** The session-flip test seeded 120
old bills, so with the session filter removed the guard refused the prune
and the test still passed. Both versions now seed the old session under the
guard's floor of 10, so only the session filter can save those rows.

**Not exercised on UAT, deliberately.** `maxBills` skips the prune, so a
capped sync cannot reach it, and a full bills sync is ~48h. The real-Postgres
integration test covers the queries; UAT confirmed the rebuilt
`region-worker` boots healthy and exposes `pipeline_rows_deleted`.

Not in this change: the §3 "bulk deletion" alert that reads the new counter.
It belongs with the alert rules, and the guard prevents what it would report.

