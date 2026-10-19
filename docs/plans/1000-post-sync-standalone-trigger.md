# #1000 — a standalone trigger for the post-sync steps

**Issue:** [#1000](https://github.com/OpusPopuli/opuspopuli/issues/1000), open since
2026-08-13. **Related:** #992, #997, #1376.

## Problem

`AmendmentSupersessionService.supersedeAll()` and
`FilingReconciliationService.reconcileAll()` are reachable only from
`CampaignFinanceSyncService.runPostSyncLinkers()`, which is `private` and runs
only at the tail of a full `syncCampaignFinance()`. The sole entry point is the
`syncRegionData` mutation.

That sync was ~4h when #1000 was filed. It is **~15h now** — the 2026-10-13 run
took 14h59m over 42,158,073 items — because #991 tripled the expenditure corpus.
So the cost of reaching two minutes of set-based SQL has quadrupled.

Both steps are set-based and idempotent, and #1000 measured them:

| step | work | shape |
|---|---|---|
| supersession | 2,014,849 rows in 81 batches | `$executeRaw`, batched at 25,000 |
| reconciliation | 173,804 filings | one statement + a summary query |

### Why it matters now

**A deployed fix has still never run.** #997 corrected the supersession batch
loop. The 2026-08-13 corrective run was hand-written SQL and bypassed it
entirely, so that code path gets its first real exercise on some future sync —
the worst moment to find a problem.

**Derived verdicts go stale silently, and this has already published a wrong
number.** `filing_reconciliations` is written only by the post-sync chain. After
supersession corrected 2M rows underneath it, the table still served
`OVER_ITEMIZED: 7,140` when the true figure was **515** — a 14x overstatement of
a fault condition, with nothing indicating staleness.

**It is live again.** #1376 added `VERSION_MISMATCH` and changed how `amend_id`
is compared. The local corpus still holds the pre-#1376 verdicts and will until
someone spends 15h. This is the same staleness, one release later.

## Decisions

### 1. Scope is supersession and reconciliation only — not all six steps

`runPostSyncLinkers()` chains six steps. This change exposes two. The other four
(IE, cover-page, proposition-finance, candidate-committee) stay sync-only:
#1000 does not ask for them, three of the four are loop-based over committees
and propositions rather than set-based over the corpus, and the staleness harm
measured above belongs to `filing_reconciliations`. Widening the surface to
six steps would also widen what an admin can trigger, for no demonstrated need.

Revisit if a linker-logic change needs the same loop.

### 2. `supersedeAmendments` re-runs reconciliation; it is not optional

Supersession is the one step that can invalidate **every** stored verdict — that
is precisely the 7,140-vs-515 harm. #1000's acceptance requires that running
supersession alone leaves `filing_reconciliations` consistent, "either by
re-running reconciliation, or by marking it stale".

Chosen: **re-run it, always, in the same call.** Reconciliation is one statement
over 173,804 filings, so the cost of chaining is negligible against the cost of
leaving a known-stale fault count in a table that reads as authoritative. A
`thenReconcile: false` flag was considered and rejected: a parameter whose only
function is to produce a state we have already measured as harmful is a footgun,
not a feature. Marking-stale was rejected for the same reason — nothing reads a
staleness flag that the next reader has to remember to check.

So: `supersedeAmendments` → supersede, then reconcile, returning both results.
`reconcileFilings` → reconcile only.

### 3. It must fail loudly when it cannot act

Both services take `@Optional() private readonly db?: DbService` and return
zeros when it is absent — `{ ...EMPTY }` for reconciliation, two zeroed table
results for supersession.

For a sync that is correct: an unbound step is skipped and the sync keeps its
upserted data. For an **admin maintenance call it is a false all-clear** —
`reconciled: 0` because the DB is not bound is indistinguishable from
`reconciled: 0` because there was nothing to do.

This is the third instance of one pattern in this codebase: #991's `@Optional()`
funding dependency returning zeros (fixed with a `measured` flag), the
`payeeName: ""` fixture that matched a present key, and now this. So:

- each service gains a public `get available(): boolean` returning `!!this.db`
- the maintenance path throws `ServiceUnavailableException` when it is false,
  rather than returning a zeroed result
- the guard is **mutation-verified**: flipping it back to a zero return must
  fail a test

The services' behaviour inside a sync does not change.

### 4. Synchronous mutations, with the limitation recorded

Mirrors `backfillClaims` / `backfillPropositionSummaries`: admin-guarded,
`@Extensions({ complexity })`, straight through `RegionService`. Not a worker
job.

Justified by the measured timings — minutes, not hours. The known limitation,
stated rather than discovered later: if a run exceeds the gateway timeout the
caller gets a 524, as happened for boundary loads in #1122. That is tolerable
*here* specifically because both operations are idempotent, so a timed-out call
can be retried with no corrective work. If the corpus grows until these take
long enough to time out routinely, the upgrade is to enqueue onto the existing
`region-sync` queue like `syncRegionData` does.

### 5. Precondition: an already-linked corpus

`reconcileAll()` references `committee_id` seven times. Reconciliation runs
**last** in the sync chain for a reason recorded in `runPostSyncLinkers()`:
supersession must have dropped stale amendments and the cover-page linker must
have stamped `committeeId`, or it "reconciles rows that are about to vanish and
attributes its verdict to nobody".

These mutations are a corrective tool for a corpus that has already been synced
and linked. They are not a substitute for a sync, and running `reconcileFilings`
against a freshly-ingested unlinked corpus would under-attribute. Documented on
the mutations themselves, where the caller is.

## Subtasks

### 1. Expose availability on both services

`available` getter on `AmendmentSupersessionService` and
`FilingReconciliationService`. No change to `supersedeAll()` / `reconcileAll()`.

### 2. `RegionService` passthroughs

Inject both services into `RegionService` (currently a three-dependency
constructor; both are already providers in `region.module.ts` at lines 292–293).
Add:

- `reconcileFilings(): Promise<ReconciliationSummary>`
- `supersedeAmendments(): Promise<{ supersession: SupersessionResult; reconciliation: ReconciliationSummary }>`

Each throws `ServiceUnavailableException` when the relevant service reports
unavailable.

### 3. GraphQL models

New `models/post-sync-steps.model.ts`, mirroring `claim-backfill.model.ts`:
`SupersessionTableResultModel`, `SupersessionResultModel`,
`ReconciliationSummaryModel`, `SupersedeAmendmentsResultModel`. Models are
coverage-excluded by convention.

### 4. Two admin mutations

`reconcileFilings` and `supersedeAmendments` on `RegionQueryResolver`, guarded
like `backfillClaims`. **Federated subgraph schema change** — the API Gateway
must be validated for federation compatibility, and the frontend's
`schema.introspection.json` fixture refreshed.

### 5. Tests

- Unit: both passthroughs, both guards, the supersede→reconcile chain order.
  The chain and the guards are **mutation-verified** — removing the chained
  reconciliation, or restoring the zero return, must fail.
- Integration (real DB, per repo rule): `supersedeAmendments` against seeded
  multi-amendment rows, asserting rows are removed **and** that
  `filing_reconciliations` reflects the post-supersession state. This satisfies
  #1000's requirement that #997's batch loop be exercised by a real invocation
  rather than only by unit tests.

### 6. Postman collection

Both mutations added to `postman/OpusPopuli.postman_collection.json` under
`Pipeline Jobs (Region Worker)`, mirroring the #1268 precedent
(`Backfill Proposition Summaries (Admin)`). This is how the operator actually
triggers them, so a mutation that exists only in the schema is not finished.
Each request's description carries the preconditions and the re-run semantics,
because that is where someone reads them at the moment they are about to fire
it.

## Acceptance

Mapped to #1000's own criteria:

| #1000 criterion | how this satisfies it |
|---|---|
| Each service invocable independently of a sync | two admin mutations |
| Supersession alone leaves `filing_reconciliations` consistent | decision 2 — reconciliation always chained |
| #997's batch-loop fix exercised by a real invocation | subtask 5 integration test |
| Admin-guarded, consistent with existing region admin mutations | mirrors `backfillClaims` |

Plus, for this change specifically:

- An unavailable service produces an **error**, never a zeroed success
  (mutation-verified)
- `reconcileFilings` on the local corpus returns #1376's `versionMismatch`
  count, which the stored table currently cannot report

## What implementation settled that the plan did not anticipate

**1. A `Promise`-typed method that throws synchronously bypasses `.catch()`.**
`reconcileFilings` was written non-`async` returning `Promise<ReconciliationSummary>`,
so its guard threw *before* a promise existed. `expect(...).rejects` never
received one, which is how the test found it. Any caller using `.catch()` rather
than `try/await` would have been bypassed entirely. Now `async`, with the reason
recorded at the method — a guard that only fires for some calling styles is not
a guard.

**2. Both availability checks must precede the deletion, not bracket it.**
`supersedeAmendments` originally checked supersession, deleted the superseded
rows, and only then hit reconciliation's guard inside the chained call. An
unavailable reconciliation would therefore have produced precisely the state
this change exists to prevent: rows gone, verdicts still describing them. Both
are now checked up front. Both resolve the same `DbService` so the case is
unreachable today, which is exactly why it would have survived review — found
by reading the diff, not by a failing test, and now pinned by one.

**3. #1000's "exercised by a real invocation" criterion is only half met here.**
`amendment-supersession.integration.spec.ts` already covers the multi-batch
path against a real database, so #997's loop *is* tested. What #1000 asked for
is a real *corpus* invocation, and only running the mutation provides that.
Recorded as outstanding rather than claimed.

**4. The frontend schema snapshot cannot be refreshed from here.**
`apps/frontend/__tests__/graphql/__fixtures__/schema.introspection.json` is
generated by introspecting a **running gateway**, and CI's e2e job re-introspects
with `--check` and fails on drift. Two new mutations make it stale. Hand-editing
a generated artifact to match a gateway's exact output would be false
confidence, so it is left for a refresh against a live stack:

```
cd apps/frontend && node scripts/refresh-schema-snapshot.mjs http://localhost:3000/api
```

Until that runs, CI's e2e job is expected to fail on this branch. Stated here
so it reads as a known step rather than a surprise.

## Risks

| risk | likelihood | mitigation |
|---|---|---|
| A run exceeds the gateway timeout | low now, grows with the corpus | Both idempotent, so retry is free. Upgrade path to the `region-sync` queue named in decision 4 |
| An admin triggers supersession's deletes unexpectedly | low | Admin-only, and the operation only removes rows a higher `amend_id` already supersedes. Not a general delete |
| Reconciliation run against an unlinked corpus under-attributes | low | Decision 5, documented on the mutation. Not enforced in code — a precondition we cannot cheaply assert |
| Scope creep to all six steps | — | Decision 1 |

## Out of scope

- The four linkers (decision 1)
- Any change to what the steps compute. #1376 already changed reconciliation's
  verdicts; this only makes them reachable
- Backfilling production. Prod is still on v1.28.0 and has not been resynced
