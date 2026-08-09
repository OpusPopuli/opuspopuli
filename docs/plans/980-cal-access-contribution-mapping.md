# Plan: RCPT contributions cover-page join (#980)

| | |
|---|---|
| **Issue** | [#980](https://github.com/OpusPopuli/opuspopuli/issues/980) |
| **Precedent** | [#955](https://github.com/OpusPopuli/opuspopuli/issues/955) — the same join, already solved for S496 |
| **Related** | [#979](https://github.com/OpusPopuli/opuspopuli/issues/979), [#962](https://github.com/OpusPopuli/opuspopuli/issues/962), [#982](https://github.com/OpusPopuli/opuspopuli/issues/982), [#983](https://github.com/OpusPopuli/opuspopuli/issues/983), [#954](https://github.com/OpusPopuli/opuspopuli/issues/954) |
| **Date** | 2026-08-09 (rewritten around the clean cutover) |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** Individual donor name, employer, occupation, city, state, ZIP+4. Public record under CA law. Volume increases ~6x when this lands. |
| **Branch** | `fix/980-cal-access-contribution-mapping` (+ `opuspopuli-regions`) |
| **Effort** | 3–4 focused sessions + one supervised cutover |
| **Status** | Code complete through C3. Next: C4 — the supervised truncate + rebuild. |

## Problem

`RCPT_CD.TSV` maps `CMTE_ID → committeeId`. `CMTE_ID` is the **contributing** committee. `RCPT_CD`
contains no recipient column, so the recipient is only reachable by joining `FILING_ID` to the
`CVR_CAMPAIGN_DISCLOSURE_CD` cover page.

Because `ContributionSchema` requires `committeeId: z.string().min(1)`, every row with a blank
`CMTE_ID` — every individual donor — is dropped by the mapper. What survives is committee-to-committee
transfers, attributed backwards: `totalRaised` sums money each committee **paid out**.

This is [#955](https://github.com/OpusPopuli/opuspopuli/issues/955)'s defect in the contributions
table. That issue's title was almost verbatim the same problem for S496.

`EXPN_CD` is inverted the same way — its `CMTE_ID` (col 26) sits in the payee block, so `totalSpent`
is the payee's money, not the spender's. And the same bad attribution propagates into
`committee_measure_positions`, so **proposition** funding totals are wrong by this mechanism too
(see C4). The blast radius is the whole campaign-finance dataset, not just the contributions table.

## Subtask 1 — spike ✅ complete (2026-08-08)

Verified against the 2026-08-08 bulk export (1.58 GB zip; `RCPT_CD.TSV` is 3.8 GB uncompressed,
under the handler's 10 GB `MAX_UNCOMPRESSED_SIZE`). Archive paths are `CalAccess/DATA/…`, not
`CAL-ACCESS/DATA/…`.

**`RCPT_CD` has 63 columns and no `FILER_ID`.** The originally-planned "map `FILER_ID` instead of
`CMTE_ID`" fix is impossible. Relevant columns:

| # | Column | Role |
|---|---|---|
| 1 | `FILING_ID` | joins to the cover page → recipient |
| 2 | `AMEND_ID` | composite key component |
| 3 | `LINE_ITEM` | composite key component |
| 6 | `TRAN_ID` | composite key component (not unique alone) |
| 25 | `CMTE_ID` | **contributor's** committee — sits inside the `CTRIB_*` block |

**`CVR_CAMPAIGN_DISCLOSURE_CD` supplies the recipient:** `FILING_ID` (1), `FILER_ID` (5),
`FILER_NAML` (7).

**The data arrives; we lose it.** `pipeline_executions`, us-ca node:

```
RCPT_CD.TSV   2026-08-05   items_extracted: 1,210,475   items_failed: 0
contributions (source_system='cal_access'):                203,945
```

~1M rows dropped after the extraction counter — schema rejects and `TRAN_ID` upsert collapse both
happen downstream of it, which is why nothing surfaced as a failure.

**Defect A confirmed empirically.** Of 151,986 committee-donor rows, 40,003 have a `donor_name`
exactly equal to the name of the committee their `committee_id` points at; the remainder are the
same entities under different spellings (#954). A recipient does not donate to itself 40,003 times.

**Secondary — `TRAN_ID` is not unique** across filings, but the sync upserts on `externalId`. Real
key is `FILING_ID + AMEND_ID + LINE_ITEM + TRAN_ID`. `EXPN_CD` shares the pattern.

## What already exists

- `committees.external_id` **is** `FILER_ID` (via `dataSources[12]`)
- `cvr_filings` already stores `filing_id → filer_id` (via `dataSources[10]`, built for #955)
- `IndependentExpenditureLinkerService` is a working reference implementation of this join

---

## Approach: one clean cutover

**Decided 2026-08-09.** Rather than sequencing schema, mappings, linker and re-ingest as separate
deploys that each leave the data in a partially-correct state, land them together and rebuild the
campaign-finance dataset from scratch.

### Why this is safe here

The campaign-finance FK graph is **closed** — verified against the live schema:

```
committees ← contributions, expenditures,
             independent_expenditures, committee_measure_positions
```

Nothing outside that set references it. (`Minutes.committeeId` and `LegislativeAction.committeeId`
point at *legislative* committees — a different table. `CommitteeRelevanceCache` likewise.) Outbound
FKs from `committees` → `representatives` / `propositions` point *away*, so dropping finance rows
cannot damage civic data. `user_events.objectId` is a free-form string with no FK, and that table is
empty, so there is no view/bookmark history to dangle.

Every row is 100% derived from a public bulk export that can be re-downloaded. **This is the crux:
the additive-only rule exists to protect data that cannot be recreated. That rationale does not
apply to derived, reproducible data — and the data being "protected" today is wrong.**

### Deliberate exception to the additive-only rule

`CLAUDE.md` says *additive only on existing tables in production*. This cutover truncates five
tables in production. That is a **conscious, reasoned exception**, recorded here so the history does
not read as the rule being ignored:

- the data is fully reproducible from CAL-ACCESS,
- the current contents are actively incorrect,
- no user-generated or hand-curated data lives in or references these tables,
- and this is pre-launch.

The schema migration itself (`20260809000000`, already merged) remains additive — no table is
dropped or renamed. Only *rows* are removed.

### What the cutover buys

It deletes most of the old risk register rather than mitigating it:

- **No sequencing trap.** Relaxing the zod `committeeId` before the config change would admit ~1M
  wrong-committee rows; changing the config first would drop every row behind a `logger.debug`.
  Landing them together makes the question moot.
- **No upsert-convergence trap.** `upsertRecordsByFields`'s `pick` emits `committeeId: undefined`
  for absent fields, and Prisma treats `undefined` in `update` as *leave unchanged* — so a re-sync
  over existing rows would never clear the bad values. With an empty table there is nothing to
  converge.
- **No append-vs-purge problem** for `committee_measure_positions`.
- **No back-compat burden** for the composite `externalId`.
- **No degraded window** where correct and incorrect figures coexist.

---

## Completed

### 0. Unblock — #984 ✅ done

Resolved by #985 (`b5cde99` on develop): resume-session identity is now unique per source, so the
broadened cover-page source no longer risks colliding with a sibling over the same file.

### 3. `filing_id` on contributions and expenditures ✅ done (2026-08-09, `91e7f66`)

- **Migration:** `packages/relationaldb-provider/prisma/migrations/20260809000000_contribution_expenditure_cover_page_join/`
  — not `supabase/migrations/`, which holds only `99_vault_functions.sql`; schema migrations are
  Prisma-managed here, as #955's was.
- Additive + widening: nullable `filing_id` VARCHAR(50) + index on both tables, and
  `committee_id DROP NOT NULL` (required — once the config stops mapping `CMTE_ID`, a filed row has
  no committee until the linker stamps it). Both `ALTER`s are catalog-only in Postgres.
- **The FK footgun.** Prisma defaults an *optional* relation to `onDelete: SetNull`. Left implicit,
  relaxing NOT NULL would have silently converted both FKs, so deleting a committee would orphan its
  finance rows to `committee_id = NULL` — indistinguishable from "unresolved, please stamp". The
  schema pins `onDelete: Restrict`; verified in the DB as `confdeltype = 'r'`.
- **GraphQL stays non-null.** `getContributions`/`getExpenditures` (and the by-id fetches, now
  `findFirst`) filter `committeeId: { not: null }`, so unattributed staging rows never surface —
  the same treatment #955 gave S496 rows. No federation schema change.

**Tests:** `apps/backend/__tests__/integration/region/contribution-cover-page-columns.integration.spec.ts`
— 13 cases against real `postgres_test` (column shape, nullability, index definitions, pre-link
inserts, FK RESTRICT, and real-row proof that unattributed rows are excluded from list and by-id
reads). Mutation-checked: removing the filter fails exactly the two list cases.

> Note for whoever runs this locally: `pnpm test:integration` gates on all five HTTP services being
> up, though `bootstrapTestDatabase()` (which applies the migration) runs first, before that gate.

---

## The cutover

All of C1–C3 land together, in one deploy, followed by the supervised C4/C5 rebuild.

### C1. Composite `externalId` ✅ done (2026-08-09)

- `BulkDownloadConfig.compositeKey?: string[]` (`packages/common`), consumed in
  `bulk-download.handler.ts`; mirrored in `opuspopuli-regions/schema/region-plugin.schema.json`.
- Segments join with `":"`. Chosen deliberately: it matches the shape single-column ids already have
  (`<FILING_ID>:<LINE_ITEM>`), so with `FILING_ID` leading the key, existing prefix parsing keeps
  working. C3 still re-points the linker at the `filing_id` column — this only removes the cliff.
- **Two loud failures rather than silent collapse**, which is the whole point of the feature:
  a key column absent from the file's headers **throws** (unlike `buildColumnIndices`, which warns
  and continues — a missing key component shortens the key for *every* row); and a row whose
  segments are all empty is dropped rather than upserted onto every other all-empty row.
- Empty cells are preserved as empty segments so positions never shift (`a::7:b`, not `a:7:b`).
- Takes precedence over any `externalId` in `columnMappings`.
- **Tests:** 7 cases in `packages/scraping-pipeline/__tests__/bulk-download.handler.spec.ts`,
  including the actual bug — two rows sharing a `TRAN_ID` across different filings staying distinct.

### C2. Write path for `filing_id` ✅ done (2026-08-09)

1. `domain-mapper.service.ts` — `ContributionSchema` / `ExpenditureSchema` gained `filingId` and
   relaxed `committeeId` to `.optional()`. `z.object()` **strips unknown keys**, so without this the
   mapper deleted `filingId` before the sync ever saw it, whatever the region config mapped.
2. `packages/common/src/providers/region/types.ts` — same shape on the `Contribution` /
   `Expenditure` interfaces.
3. `campaign-finance-sync.service.ts` — `'filingId'` added to both `fields` projections
   (`upsertRecordsByFields` picks *only* the listed fields).
4. **Fallout the review predicted:** `ensureCommitteeStubs` rewrote `committeeId` externalId→UUID
   unconditionally for contributions/expenditures while guarding IEs, which became a compile error
   the moment the type went optional. Now one shared `resolveCommittee` helper for all three.

**These are inert until C3.** No region config maps `FILING_ID` yet and none has a `compositeKey`,
so behavior is unchanged — the only live effect is that a blank `CMTE_ID` no longer fails
validation, and nothing produces such rows today.

### C3. Cover-page-join linker + region config ✅ done (2026-08-09)

**Monorepo:** new `CoverPageLinkerService` (`cover-page-linker.service.ts`), registered in
`region.module.ts` and run from the sync *before* the proposition linker.

- **Set-based, not row-by-row.** One `UPDATE … FROM cvr_filings JOIN committees` per table. #955's
  shape — one `update()` per pending row through `batchTransaction` — is fine for tens of thousands
  of IEs but would mean ~1.2M promises across ~2,400 transactions here.
- The table name is interpolated (SQL identifiers cannot be bound), so it comes from a `const`
  tuple: the only values that can reach the statement are two compile-time literals.
- The leftover breakdown query runs **only** when the UPDATE left something behind, so the
  steady-state re-sync costs one `count` per table and nothing else.
- `PropositionFinanceLinkerService` now reads `filing_id` directly; `extractFilingId` is deleted.
  Its "first hit per filing wins" rule is *now well-defined* rather than arbitrary — every row of a
  filing shares that filing's filer, so the map has one possible value per key.
- `IndependentExpenditureLinkerService`'s cover-page read is scoped to the pending filing IDs
  (it was unfiltered, sized for an F496-only 31k-row table).

**Region config** (`opuspopuli-regions`, `feat/composite-key-schema-980`, config v1.10.0):
`CMTE_ID → committeeId` dropped from both tables, `FILING_ID → filingId` added, `compositeKey` set,
and the cover-page source's `FORM_TYPE=F496` filter removed.

**Tests:** 6 unit (orchestration) + 9 integration against real `postgres_test` — including the one
that matters, that a contribution is attributed to the **filer** even when a counterparty committee
row exists, plus idempotency, the soft-deleted-committee guard, and both skip reasons.

<details><summary>Original scope notes</summary>

**Linker** (`apps/backend/src/apps/region/src/domains/`):

- Resolve `contributions.filing_id → cvr_filings.filer_id → committees.external_id`.
- Follow `IndependentExpenditureLinkerService` (#955), with two deliberate improvements: scope the
  `cvrFiling.findMany()` to the pending filing IDs rather than loading the table, and prefer a
  set-based `UPDATE … FROM cvr_filings` over 1.2M individual `update()` calls in `batchTransaction`.
- Must run **before** `propositionFinanceLinker.linkAll()` in `campaign-finance-sync.service.ts:181-199`,
  the way the IE linker already is.
- **Re-point `PropositionFinanceLinkerService` at the new `filing_id` column.** Today
  `buildFilingToCommitteeIndex` recovers FILING_ID by splitting `externalId` on the first `:`/`-`
  (`:462`), which C1 breaks — silently: every CVR2 row would hit the `skipped` branch and
  proposition funding would read $0 with no exception, and the specs hardcode `12345:1` so nothing
  fails. Reading `filing_id` directly also removes the unpaginated full-table load and the
  nondeterministic "first hit per filing wins" (those `findMany`s have no `orderBy`).

**Region config** (`opuspopuli-regions`, merges to `main`, publishes `@opuspopuli/regions`):

- `RCPT_CD` / `EXPN_CD`: add `FILING_ID → filingId`; `externalId` ← composite key; drop the
  `CMTE_ID → committeeId` mapping.
- Broaden cover-page ingestion to all form types (see Decisions).
- Version bump, publish, then consume in the monorepo. **Publish before the monorepo consumes it.**
</details>


### C3b. Review hardening ✅ done (2026-08-09)

Applied after a three-lens review of C1–C3:

- **`cvr_filings.filing_id` is now `@unique`** (migration `20260809120000`). The linker joins on it
  and requires one cover page per filing; that held only via three facts across two repos
  (`external_id` unique + mapper defaulting `externalId = filingId` + the region config declining to
  map one). Give the cover-page source a `compositeKey` — the feature C1 just added — and the join
  fans out, attributing donor money to an arbitrary filer. Now a database guarantee.
- **Partial `pending_link` indexes** on both tables. The plain `filing_id` index does not serve
  `WHERE committee_id IS NULL`; the partial one stays tiny and empties as rows resolve.
- **The 1.2M-row UPDATE is batched** (50k/transaction). One statement meant multi-GB WAL, ~1.2M dead
  tuples across seven indexes, and a timeout rolling the whole thing back to restart from zero.
  The batch subquery re-applies the full join, so a short batch can only mean "nothing left" —
  filtering only on `committee_id IS NULL` would let a batch of unresolvable rows end the loop early
  and silently half-link. Loop is bounded, not `while (true)`.
- **`explainRemaining` uses `EXISTS`, not `JOIN`** — a join counts row/cover-page pairs, so any
  fan-out would make `skippedNoCoverPage` negative. Plus a `max(0, …)` guard against concurrent
  inserts landing between the count and the update.
- **Donor PII no longer reaches error logs.** The `compositeKey` throw echoed the first ten cells of
  the header row — and it fires *precisely* when that row isn't a header, i.e. when it holds donor
  data. It propagates to the persisted pipeline `errors[]` and on to Loki. Now reports column count
  only; the pre-existing `buildColumnIndices` warn was fixed the same way.
- **IE linker `in` clause chunked** at 10k. Prisma binds one parameter per element against
  Postgres's 32,767 ceiling, `pending` is unbounded, and the sync swallows the failure as a warning
  — so overflowing would read as "IEs quietly stopped linking".
- **`buildFilingToCommitteeIndex` de-duplicates in SQL** (`DISTINCT ON`). It built a ~662k-entry map
  by hydrating ~1.2M row objects; the `committeeId IS NOT NULL` filter does not help, because after
  the linker succeeds nearly every row passes it.
- `processDataLine` takes a `ParseContext` (SonarCloud S107 caps parameters at 7; it had reached 8).
- **Tests added:** the cover-page linker runs *before* the proposition linker, and still yields to it
  when it throws — the ordering the whole design rests on, previously unasserted; plus the
  one-cover-page-per-filing constraint.

### ⚠️ C4 gate — verify amendment handling before rebuilding

**Unresolved, and it can invert the fix.** CAL-ACCESS retains every amendment of a filing in
`RCPT_CD`/`EXPN_CD` — same `FILING_ID`, incremented `AMEND_ID` — and an amendment restates the whole
schedule. `cvr_filings` is deduped by `FILING_ID` (`domain-mapper.service.ts:395`), but line items
now are not: `AMEND_ID` sits in the composite key, so an amended $500 receipt lands twice and the
linker stamps both with the same filer. `totalRaised` reads $1,000.

The old `TRAN_ID`-only key accidentally deduped this. So C1 fixes cross-filing collisions and may
introduce amendment inflation **on the exact metric this issue exists to correct**. Note the extract
counts (1,210,475 → 203,945) were attributed to blank-`CMTE_ID` rejections plus `TRAN_ID` collisions;
if a meaningful share was actually amendment restatements, the new key inflates.

Check against the bulk file before any rebuild:

```
awk -F'\t' 'NR>1{print $1"\t"$2}' RCPT_CD.TSV | sort -u | cut -f1 | uniq -d | wc -l
```

Non-zero ⇒ either drop `AMEND_ID` from the `compositeKey` (last amendment upserts over earlier ones)
or add a latest-amendment filter. Either way it is a `@opuspopuli/regions` change, so settle it
before publishing the version the rebuild consumes.

### C4. Truncate + rebuild

- **Snapshot prod first** — for rollback *and* because C5 needs the old figures to diff against.
- Truncate, scoped to `source_system='cal_access'` where the column exists:
  `committee_measure_positions`, `contributions`, `expenditures`, `independent_expenditures`,
  `committees` (in FK order). Never target the dev `postgres` DB (#796).
- Re-sync from the region worker.
- **Re-run the candidate-committee linker** afterwards — `committees.representative_id` is derived
  and must be rebuilt (#981's same-surname fix is in that path). Same for the proposition linker.
- **Acceptance gate:** `/op-data-scan`.

### C5. Verify

- Confirm `totalRaised` means raised, and `totalSpent <= totalRaised` for a sample.
- Cross-check 5–10 representatives against official CAL-ACCESS filings before calling it done.
- Diff against the pre-cutover snapshot: which figures moved, by how much, and in the expected
  direction. This is why the snapshot is taken even though the old data is wrong.
- Re-verify `independentExpenditures` counts — C3 broadens `cvr_filings` beyond F496.

### C6. Revisit labeling

- **Where:** `RepresentativeFundingPanel.tsx`, `locales/{en,es}/civics.json`
- The interim "Identified donors" wording may revert to "Donors" once counts are real. Re-run
  `pnpm test:a11y`.

---

## Pre-cutover requirements (PII)

These gate C4, not the code work:

- **ZIP+4 minimization.** Name + employer + ZIP+4 approaches individually identifying. Decide
  whether ZIP+4 is needed or ZIP5 suffices — cheapest to decide *before* reloading 1.2M rows.
- **Log masking.** ❌ Confirmed gap: `PARTIAL_MASK_FIELDS` in
  `apps/backend/src/common/utils/pii-masker.ts:23` is only `email`/`phone`/`phonenumber`. Harmless
  today (the audit interceptor logs args, never results), but any future `logger.debug({ contribution })`
  writes unmasked donor PII to Loki. Add the donor fields.
- **Public bulk exposure.** `contributions`, `contribution(id)` and `expenditures` are `@Public()`,
  and `PaginationArgs` caps `take` at 100 but leaves `skip` unbounded — a ~20-minute anonymous
  scrape today, ~2 hours at 1.2M. Public record under CA law, but name + employer + occupation +
  ZIP+4 *in bulk* is a different risk profile than record-by-record lookup. Needs an explicit
  decision, not an inherited default.
- **No model exposure.** Confirm contributor rows never reach prompts, embeddings, or the RAG index.
- **Retention.** No equivalent of the 90-day audit-log expiry exists here. Needs a decision.

## Risk register

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Outage while the dataset rebuilds | high | certain | Duration is **unmeasured** — the Studio was unreachable at planning time. Measure before scheduling. Representative/proposition pages read $0 meanwhile. Pre-launch, so acceptable, but pick the window deliberately |
| From-empty sync path never exercised | high | possible | Every sync so far ran against populated tables. Rehearse the full rebuild on `postgres_test` or a restored snapshot **before** touching prod. #985's resume-session fix helps if it dies partway |
| Public dollar figures change substantially | high | certain | Expected and correct — that is the point. Verify a sample against official filings (C5) before calling it done. Same exposure as #979 / #962 |
| Snapshot missing or unrestorable | high | rare | Verify the snapshot restores *before* truncating, not after |
| Derived linkages not rebuilt | medium | likely | `committees.representative_id` and the proposition links are derived; C4 explicitly re-runs both linkers |
| Broadened `cvr_filings` regresses the #955 IE linker | low | possible | The linker looks up by `FILING_ID`, unique per filing, so extra non-F496 rows sit unused rather than mis-matching. Still add a test with non-F496 rows present, and re-verify counts in C5 |
| `cvr_filings` grows 31,418 → ~662,076 | low | certain | `IndependentExpenditureLinkerService` does an unfiltered `cvrFiling.findMany()` (line 78). Worker is capped at 6G so ~662k rows fits, but C3 scopes the query anyway |
| PII volume increase (~6x) | medium | certain | See pre-cutover requirements; `/op-data-scan` gate on C4 |
| Region config in a separate repo | low | likely | Publish `@opuspopuli/regions` before the monorepo consumes it |
| AGPL-3.0 dependency constraint | low | rare | No new dependencies anticipated |

## Decisions

**Launch gate — this blocks launch** (2026-08-08). Every representative page currently sums money
paid *out* as money *raised*, over ~17% of the available rows. Same false-attribution class as #979,
which was treated as launch-blocking.

**Clean cutover over incremental migration** (2026-08-09). See "Approach" above — the data is
derived and reproducible, the FK graph is closed, and the incremental path's transition states are
strictly worse than a short rebuild.

**Cover pages — broaden the existing source** (2026-08-08). Drop `filters: {FORM_TYPE: 'F496'}` from
`dataSources[10]` so `cvr_filings` covers all campaign-disclosure cover pages, rather than adding a
second F460-filtered source or a sibling table. One source, one table, one ingest pass.

## Adjacent defects — split out

- [#982](https://github.com/OpusPopuli/opuspopuli/issues/982) — committee rows whose `name` is a bare
  numeric filer ID
- [#983](https://github.com/OpusPopuli/opuspopuli/issues/983) — refunds netting against totals with no
  sign handling (no ingestion dependency; can land any time)

**Not yet filed:** `committee_measure_positions` has no purge path at all —
`PropositionFinanceLinkerService` only ever `upsert`s (`:380`). C4 truncates it, which resolves this
cutover, but the underlying "derived table that can never be rebuilt cleanly" defect remains and
deserves its own issue.

## Open questions

1. ~~Should this block launch?~~ Resolved — yes.
2. ~~Does `EXPN_CD` need the same cover-page join?~~ **Yes — verified.** Same missing `FILER_ID`,
   same key columns, and its `CMTE_ID` (col 26) identifies the *payee*.
3. ~~Should `cvr_filings` broaden to all form types, or gain a sibling table?~~ Resolved — broaden.
4. ~~Incremental or clean cutover?~~ Resolved 2026-08-09 — clean cutover.
5. **How long does a full rebuild take?** Unmeasured. Blocks scheduling C4, nothing else.
