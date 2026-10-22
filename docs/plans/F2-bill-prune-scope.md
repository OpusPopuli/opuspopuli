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

Revised after independent review (see Status): the first version scoped by
"any session a discovered id belongs to", which one stray id could defeat.

### 1. Prune against *discovered* ids

A bill that failed was still seen. Phase 1 (`discoverAllBillUrls`) records
every bill id parsed from a status **or votes** URL into
`BillDiscovery.externalIds`, before phase 2 processes anything — so no
outcome branch can leave one out, and a bill reached only through its votes
page counts as seen. `syncedExternalIds` is gone.

### 2. Skip the prune when discovery was incomplete

`discoverBillUrls` returns `[]` both for a failed seed fetch and for markup
that stopped matching. A source that yields nothing still owns its stored
bills, and if it owns fewer than the guard's limit they would be deleted
quietly. So the prune does not run when:

- any source returned no URLs at all (`source-returned-nothing`), or
- any status URL had no parseable `bill_id` (`unidentified-status-urls`) —
  extraction stores that bill under a page-derived id the discovered set can
  never contain, so it would be pruned on the next run.

Every skip writes one `skipped` item with its reason, so a region stuck in
either state reaches the dashboard and the `SyncPruneDisabled` alert, not only
a log line.

### 3. Scope the prune to the sessions this sync *covered*

Two grouped counts: discovered stored bills per `sessionYear`, and all stored
bills in those sessions. A session is in scope only when the discovered ids
account for **≥50%** of its stored bills **and at least 10 of them**. The
minimum stops two stray links into a four-bill special session counting as
"half covered" and deleting the other two; a session that small is never
pruned, and keeping a delisted bill is the recoverable error.

Coverage, not mere presence, because one stray id must not pull a whole
session into scope:

- a 2027–28 list page linking one carried-over 2025–26 bill;
- an LLM-mislabelled `sessionYear` on one new row (the column comes from
  extraction, `raw.sessionYear ?? sessionYear`);
- a spoofed page injecting one old `bill_id`.

With presence-only scoping, a large old session then made every later sync
refuse (safe, but stuck), and a small one — under the guard's floor — was
simply deleted: F2's own failure, smaller. After the flip the old session is
barely covered, so it is out of scope by construction. A session left out is
named in a `warn` line with its seen/stored counts.

Read from the DB rather than parsed from the id because the id format
(`20252026` + `0` + `AB1`) is California's; `session_year` is region-neutral.

### 4. Deletion guard

Refuse the prune, and leave every row in place, when it would delete more
than **max(2% of the in-scope bills, 10 bills)**.

- The fraction catches a broken discovery pass on a large corpus: 2% of 5,019
  is 100.
- The floor keeps a small region usable: 2% of 60 bills is one, which would
  refuse every legitimate prune.

Refused, not truncated — deleting "the first 100" of a bad set is still
deleting the wrong bills. A refusal writes **one** `error` line naming the
first 20 kept bills and **one** `skipped` item with `reason=deletion-guard`.
One line and item per kept bill would bury the error under thousands of lines
on exactly the run it matters, and skew the bills skip-rate panel.

### 5. `pipeline_rows_deleted_total` and the alerts

Counter, label `data_type` (§3 contract), incremented by `deleteMany`'s
returned count — what was deleted, not what was found. Emitted through
`SyncPhaseTracker.rowsDeleted`, so it shares the tracker's guarded `publish`
rather than a second try/catch.

The guard is per run, so it cannot see a source that drops 1.9% a day — under
the cap every run, a session gone in a month. Two rules in
`observability/prometheus-alerts.yml` (group `opuspopuli-sync-prune`):

- `SyncBulkDeletion` — more than 100 rows pruned in 7 days, per data type;
- `SyncPruneRefused` — any `deletion-guard` refusal in the last day;
- `SyncPruneDisabled` — any skip for incomplete discovery or no covered
  session in the last day.

**Every series these read is created at zero at boot**
(`RegionSyncService.primePruneSeries`). prom-client exports a labelled counter
only after its first increment, and `increase()` cannot see a series born
above zero. Prod syncs bills rarely and by hand, so the first refusal or
deletion after a restart is usually the only one — and without priming, none
of the three would fire for it. Found by the third review; reproduced and then
shown fixed with `promtool test rules` (unprimed: no alert; primed: all three
fire).

## Out of scope

- Soft delete for bills. A real design change (every reader would need a
  `deletedAt` filter), and the fixes above remove the failure modes without
  it.
- A rolling-window cap enforced in code. It needs prune history the sync does
  not keep; the 7-day alert detects the same drift without new state.
- Wrapping the reads and the delete in one transaction. The `region-sync`
  worker runs one job at a time unless `BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY`
  raises it (default 1, `worker.factory.ts`); the residual race is a slightly
  stale limit, and the counter now reports the true delete count. Revisit if
  that concurrency is ever raised — and S2 (per-type jobs) will.
- The K5 freeze, which makes frozen bills count as discovered. It builds on
  this; it does not belong in a patch.

## Tests

| Test | Defect it catches |
|---|---|
| Deletes exactly the undiscovered bills of a covered session | — (the positive case) |
| Counts the deleted rows, from the prune itself | the emission removed |
| Never touches another region's bills in the same session (unit + integration) | `regionId` dropped from the stale query |
| Keeps the previous session after a flip, with one stray old id (unit + integration) | coverage rule removed; session filter removed |
| Refuses over the guard: nothing deleted, one ERROR, one `deletion-guard` item, no deletion counted | guard removed; per-bill refusal items |
| Deletes at exactly the limit, refuses one past it | `>` changed to `>=` |
| Prunes nothing when discovery was incomplete | the skip reason ignored |
| Discovery counts votes-URL ids; flags an empty source and an id-less status URL | votes ids dropped; either flag removed |
| Counter registered and injected (OpenMetrics scrape) | registration or injection missing |
| A zero increment exports the series at 0 (OpenMetrics scrape) | — (pins the prom-client behaviour priming relies on) |
| Every alerted prune series is created at zero on construction | the priming call removed |
| A four-bill session reached by two strays is kept | the 10-sighting minimum removed |
| A covered session prunes while a half-seen one is left alone, with a warn | the uncovered-session warn removed |
| A skip writes one `skipped` item with its reason | the skip item removed |
| `syncBills` hands the prune every discovered id when every bill failed | discovery not passed through |
| `safeBillIdFromUrl` warns only on a malformed URL | — |
| `rowsDeleted` counts, ignores zero, survives a throwing observer | the zero guard inverted |
| Alerts fire on 7-day drift and on a refusal (`promtool test rules`, not committed) | — |

## Risks

| Risk | Mitigation |
|---|---|
| Bills that really left the source survive longer (a failed bill is now kept) | Correct by design — a failed fetch is not evidence the bill is gone. The next successful sync re-tests it |
| The guard or the coverage rule blocks a legitimate prune | Visible as a skip reason or a refusal alert; the operator acts with the cause understood. The opposite error is unrecoverable |
| A region with a permanently empty source never prunes | `SyncPruneDisabled` fires on every bills sync with `reason=source-returned-nothing`; fix or remove the source |
| A region past ~30k bills | The `in`/`notIn` lists bind one parameter per id, so the prune would throw (not delete). California is ~5k; not new in this change |

## Owner decision

The guard threshold — §11 of the parent plan suggests ~2%; this adds the
10-bill floor. **Decided 2026-10-22: max(2% of in-scope bills, 10 bills).**

## Status — implemented 2026-10-22, branch `fix/bill-prune-scope`

**Review.** Three rounds. Rounds 1 and 2 were two independent reviewers
(correctness/performance/tests and security/data/consistency) on the first
commit; they found no blockers. Their suggestions were fixed in
this change rather than filed: coverage-based scoping (§3), the incomplete-
discovery skip and votes-URL ids (§1–2), one-line refusals (§4), emission
through the tracker with the true delete count, the alerts (§5), a misplaced
doc comment, and the six missing tests above. What was not done is in Out of
scope, each with its reason.

Round 3, a fresh reviewer on the revision, found **one blocker — in the
alerts this change had just added**: neither could see the first event after
a restart (§5). Fixed by priming, along with its suggestions: the 10-sighting
minimum (§3), skip items and `SyncPruneDisabled` (§2, §5), and the tests it
listed as missing.

**Every test was verified by putting its defect back** — seventeen mutations
across the three rounds, each failing at least one test. Three mutation scripts
broke compilation instead and proved nothing; all three were redone.

**One test lied on its first version.** The session-flip test seeded 120
old bills, so with the session filter removed the guard refused the prune
and the test still passed. It now seeds the old session under the guard's
floor of 10, so only the scope rules can save those rows.

**Not exercised on UAT, deliberately.** `maxBills` skips the prune, so a
capped sync cannot reach it, and a full bills sync is ~48h. The real-Postgres
integration test covers the queries; UAT confirmed the rebuilt
`region-worker` boots healthy and exposes `pipeline_rows_deleted`.

**Prod carries the alert only once the node repo is ported** — node sync is
a manual port, like the exemplar settings in §2 of the parent plan.
