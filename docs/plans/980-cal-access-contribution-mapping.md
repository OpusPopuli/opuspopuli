# Plan: RCPT contributions cover-page join (#980)

| | |
|---|---|
| **Issue** | [#980](https://github.com/OpusPopuli/opuspopuli/issues/980) |
| **Blocked by** | [#984](https://github.com/OpusPopuli/opuspopuli/issues/984) — cover-page source silently skipped |
| **Precedent** | [#955](https://github.com/OpusPopuli/opuspopuli/issues/955) — the same join, already solved for S496 |
| **Related** | [#979](https://github.com/OpusPopuli/opuspopuli/issues/979), [#962](https://github.com/OpusPopuli/opuspopuli/issues/962), [#982](https://github.com/OpusPopuli/opuspopuli/issues/982), [#983](https://github.com/OpusPopuli/opuspopuli/issues/983), [#954](https://github.com/OpusPopuli/opuspopuli/issues/954) |
| **Date** | 2026-08-08 (rewritten after raw-file verification) |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** Individual donor name, employer, occupation, city, state, ZIP+4. Public record under CA law. Volume increases ~6x if this lands. |
| **Branch** | `fix/980-cal-access-contribution-mapping` (+ `opuspopuli-regions`, + migration) |
| **Effort** | 4–6 focused sessions |
| **Status** | Subtasks 0, 1, 3 complete. Next: 2 and 5, then 4. |

## Problem

`RCPT_CD.TSV` maps `CMTE_ID → committeeId`. `CMTE_ID` is the **contributing** committee. `RCPT_CD`
contains no recipient column, so the recipient is only reachable by joining `FILING_ID` to the
`CVR_CAMPAIGN_DISCLOSURE_CD` cover page.

Because `ContributionSchema` requires `committeeId: z.string().min(1)`, every row with a blank
`CMTE_ID` — every individual donor — is dropped by the mapper. What survives is committee-to-committee
transfers, attributed backwards: `totalRaised` sums money each committee **paid out**.

This is [#955](https://github.com/OpusPopuli/opuspopuli/issues/955)'s defect in the contributions
table. That issue's title was almost verbatim the same problem for S496.

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

Two gaps: `contributions` has no `filing_id` column and `RCPT` never extracts `FILING_ID`; and
`cvr_filings` covers only F496 IE cover pages (31,418 rows) — contributions need F460 too, which is
blocked by #984.

## Subtasks

### 0. Unblock — #984 ✅ done

Resolved by #985 (`b5cde99` on develop): resume-session identity is now unique per source, so the
broadened cover-page source no longer risks colliding with a sibling over the same file.

### 2. Composite `externalId`

- **Where:** `packages/scraping-pipeline/src/handlers/bulk-download.handler.ts`, `BulkDownloadConfig`;
  `opuspopuli-regions/schema/region-plugin.schema.json`
- Add optional `compositeKey: string[]` joining source columns with a stable separator.
- **Tests:** key construction, collision behavior, back-compat when absent.

### 3. `filing_id` on contributions and expenditures ✅ done (2026-08-09)

- **Migration:** `packages/relationaldb-provider/prisma/migrations/20260809000000_contribution_expenditure_cover_page_join/`
  — not `supabase/migrations/`, which holds only `99_vault_functions.sql`; schema migrations are
  Prisma-managed here, as #955's was.
- Additive + widening: nullable `filing_id` VARCHAR(50) + index on both tables. No drops, no renames.
  Both `ALTER`s are catalog-only in Postgres, so neither rewrites the ~204k-row table.

**Scope correction.** The plan said "nullable `filing_id` + index" only, but dropping the
`CMTE_ID → committeeId` mapping (subtask 5) makes a `NOT NULL committee_id` unsatisfiable — so
`ALTER COLUMN committee_id DROP NOT NULL` had to ride along on both tables, exactly as #955 did for
`independent_expenditures`. Consequences handled here:

- **The FK footgun.** Prisma defaults an *optional* relation to `onDelete: SetNull`. Left implicit,
  relaxing NOT NULL would have silently converted both FKs, so deleting a committee would orphan its
  finance rows to `committee_id = NULL` — indistinguishable from "unresolved, please stamp". The
  schema pins `onDelete: Restrict`; verified in the DB as `confdeltype = 'r'` and covered by two
  integration tests.
- **GraphQL stays non-null.** `getContributions`/`getExpenditures` (and the by-id fetches, now
  `findFirst`) filter `committeeId: { not: null }`, so unattributed staging rows never surface —
  the same treatment #955 gave S496 rows. No federation schema change, so the nullability question
  in subtask 4 stays open rather than being pre-decided.
- `PropositionFinanceLinkerService.buildFilingToCommitteeIndex` now skips null-committee rows. It
  keeps the *first* hit per filing, so an unattributed row would otherwise shadow a resolved one.

**Tests:** `apps/backend/__tests__/integration/region/contribution-cover-page-columns.integration.spec.ts`
— 10 cases against real `postgres_test` (column shape, nullability, indexes, pre-link inserts, FK
RESTRICT on both tables), plus unit coverage for the new query filters and the linker skip.
Full backend suite green (2301 tests); `tsc --noEmit` adds no new errors over baseline.

> Note for whoever runs this locally: `pnpm test:integration` gates on all five HTTP services being
> up, though `bootstrapTestDatabase()` (which applies the migration) runs first, before that gate.

**Rollback** (no down-file convention here — Prisma-managed, and #955 shipped none):

```sql
DROP INDEX IF EXISTS "expenditures_filing_id_idx";
DROP INDEX IF EXISTS "contributions_filing_id_idx";
ALTER TABLE "expenditures"  DROP COLUMN IF EXISTS "filing_id";
ALTER TABLE "contributions" DROP COLUMN IF EXISTS "filing_id";

-- NOT reversible unattended: SET NOT NULL scans the table and FAILS if the linker
-- left any row unresolved. Resolve or remove those first, e.g.
--   DELETE FROM "expenditures"  WHERE "committee_id" IS NULL;
--   DELETE FROM "contributions" WHERE "committee_id" IS NULL;
ALTER TABLE "expenditures"  ALTER COLUMN "committee_id" SET NOT NULL;
ALTER TABLE "contributions" ALTER COLUMN "committee_id" SET NOT NULL;
```

### 4. Cover-page-join resolution

- **Where:** `apps/backend/src/apps/region/src/domains/` — new linker or extension of `CampaignFinanceSyncService`
- Resolve `contributions.filing_id → cvr_filings.filer_id → committees.external_id`.
- Follow `IndependentExpenditureLinkerService` (#955) — same shape, already reviewed.
- **Tests:** unit tests for resolution + reconcile; integration test for the full join.

### 4b. Write path for `filing_id` — **hard prerequisite for 5** (found in review, 2026-08-09)

Subtask 3 added the column; nothing can populate it yet. Three edits are needed, and #955 did all
three for `independent_expenditures` — copy that shape:

1. `packages/scraping-pipeline/src/mapping/domain-mapper.service.ts:898,935` — `ContributionSchema`
   / `ExpenditureSchema` need `filingId` added and `committeeId` relaxed to `.optional()`.
   `z.object()` **strips unknown keys**, so without this the mapper deletes `filingId` before the
   sync ever sees it, no matter what the region config maps.
2. `packages/common/src/providers/region/types.ts` — same shape change on the `Contribution` /
   `Expenditure` interfaces.
3. `apps/backend/src/apps/region/src/domains/campaign-finance-sync.service.ts:441,460` — add
   `'filingId'` to both `fields` projections. `upsertRecordsByFields` picks *only* the listed
   fields, so the column stays NULL otherwise.

**Sequencing trap:** relaxing `committeeId` in the zod schema *before* the region config drops the
`CMTE_ID → committeeId` mapping would admit ~1M currently-dropped rows carrying the **wrong**
committee. Relax it and change the config in the same deploy. Conversely, if the config changes
first without the schema relax, every RCPT/EXPN row fails `safeParse` and is dropped with only a
`logger.debug` — a sync that reports success having ingested zero contributions.

**Also:** the new cover-page linker must run *before* `propositionFinanceLinker.linkAll()` in
`campaign-finance-sync.service.ts:181-199`, the way the IE linker already is.

### 5. Column mappings

- **Where:** `opuspopuli-regions` (merges to `main`, publishes `@opuspopuli/regions`)
- `RCPT_CD` / `EXPN_CD`: add `FILING_ID → filingId`; `externalId` ← composite key; drop or repurpose
  the `CMTE_ID → committeeId` mapping.
- Broaden cover-page ingestion to F460 (depends on #984).
- Version bump, publish, consume in the monorepo.

### 6. Re-ingest

- **Where:** region-worker
- Existing rows carry a wrong `committee_id` and an unstable `externalId`, so upsert **will not
  converge** — scoped delete of `source_system='cal_access'` contributions and expenditures first.
- DB snapshot beforehand. Scope by `source_system`. Never target the dev `postgres` DB (#796).
- **Acceptance gate:** `/op-data-scan`.

### 7. Verify aggregation semantics

- **Where:** `representative-funding.service.ts`
- Confirm `totalRaised` means raised, and `totalSpent <= totalRaised` for a sample.
- Cross-check 5–10 representatives against official CAL-ACCESS filings before production.

### 8. Revisit labeling

- **Where:** `RepresentativeFundingPanel.tsx`, `locales/{en,es}/civics.json`
- The interim "Identified donors" wording may revert to "Donors" once counts are real. Re-run
  `pnpm test:a11y`.

**Ordering:** #984 first. Then 2, 3, 5 in parallel; 4 after 3; 6 after all; 7–8 after 6.

**Deploy ordering (added 2026-08-09).** The migration is inert on its own — nothing writes a NULL
committee until subtask 5 ships. But between 5 landing and the linker (4) running, freshly-ingested
rows sit unattributed and are excluded from GraphQL, so `totalRaised` reads *low* rather than wrong.
That's the intended failure mode, and it argues for 4 shipping before 5, not merely before 6.

## Found in review of subtask 3 (2026-08-09) — not yet filed

**`committee_measure_positions` is never purged, and it is downstream of the bad attribution.**
`PropositionFinanceLinkerService` only ever `upsert`s (`:380`); nothing deletes. Two consequences:

- `buildFilingToCommitteeIndex` maps `filingId → contribution.committeeId`, which per this issue's
  own premise is the **counterparty**, and writes it as a position with `isPrimaryFormation = true`.
  `PropositionFundingService.computeSide` then sums those committees' money into public
  `totalRaised` / `totalSpent`. So proposition support/oppose totals are wrong today by the same
  mechanism as representative totals — this issue's scope is wider than the `contributions` table.
- Once subtask 4 stamps correct committees, the correct positions are **added alongside** the stale
  wrong ones and both get summed. Subtask 6 therefore needs to purge and re-link
  `committee_measure_positions`, not just delete and re-ingest the finance rows.

**`extractFilingId` breaks silently when subtask 2 lands.** It recovers FILING_ID by splitting
`externalId` on the first `:`/`-` (`:462`). Once `compositeKey` changes that layout, it returns
garbage, every CVR2 row hits the `skipped` branch, and proposition funding quietly reads $0 — no
exception, and the specs hardcode `12345:1` so nothing fails. Subtask 4 should re-point the linker
at the new `filing_id` column, which also removes the unpaginated full-table load and the
nondeterministic "first hit per filing wins" (those `findMany`s have no `orderBy`, so a filing with
several contributors resolves to a different committee run to run).

**Re-sync alone will not clear the existing bad `committee_id`s.** `upsertRecordsByFields`'s `pick`
(`campaign-finance-sync.service.ts:556`) emits `committeeId: undefined` for absent fields, and
Prisma treats `undefined` in `update` as *leave unchanged*. This is the mechanism behind subtask 6's
"upsert will not converge" note — the scoped delete is mandatory, not merely tidier.

**PII masking gap (confirms an open question above).** `PARTIAL_MASK_FIELDS` in
`apps/backend/src/common/utils/pii-masker.ts:23` is only `email`/`phone`/`phonenumber` — no donor
fields. Harmless today (the audit interceptor logs args, never results), but any future
`logger.debug({ contribution })` writes unmasked donor PII to Loki.

**Bulk-scrape exposure at 6x volume.** `contributions`, `contribution(id)` and `expenditures` are
`@Public()` (pre-existing, unchanged here), and `PaginationArgs` caps `take` at 100 but leaves
`skip` unbounded. Today that's a ~20-minute anonymous scrape of 204k donor records; after subtask 6
it is ~1.2M. Public record under CA law, but name + employer + occupation + ZIP+4 in bulk is a
different risk profile than record-by-record lookup. Worth an explicit decision before 6 lands.

## Adjacent defects — split out

- [#982](https://github.com/OpusPopuli/opuspopuli/issues/982) — committee rows whose `name` is a bare
  numeric filer ID
- [#983](https://github.com/OpusPopuli/opuspopuli/issues/983) — refunds netting against totals with no
  sign handling (no ingestion dependency; can land any time)

## Data classification

**PII, no PHI.** Individual contributor rows carry name, employer, occupation, city, state, ZIP+4 —
published public record under CA law, so ingestion is lawful, but volume changes the risk profile.
Today ~29,809 individual rows survive; the fix brings the stored total from 203,945 toward the
1.21M extracted.

Required before subtask 6 lands:

- **ZIP+4 minimization.** Name + employer + ZIP+4 approaches individually identifying. Decide whether
  ZIP+4 is needed or ZIP5 suffices.
- **No model exposure.** Confirm contributor rows never reach prompts, embeddings, or the RAG index.
- **Log masking.** Verify donor fields are in the audit-log masked set.
- **Retention.** No equivalent of the 90-day audit-log expiry exists here. Needs an explicit decision.

## Risk register

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| ~~Blocked by #984~~ | — | — | Resolved — #985 merged to develop as `b5cde99` |
| Broadening `cvr_filings` regresses the #955 IE linker | low | possible | Checked: the linker starts from S496 line items (`committeeId: null, filingId != null`) and looks each up by `FILING_ID`, which is unique per filing — so extra non-F496 rows sit unused rather than mis-matching. Still add a test with non-F496 rows present, and re-verify `independentExpenditures` counts after re-ingest |
| `cvr_filings` grows 31,418 → ~662,076 | low | certain | `IndependentExpenditureLinkerService` does an **unfiltered** `cvrFiling.findMany()` (line 78), so the whole table lands in memory. region-worker is capped at 6G, so ~662k rows is comfortable — but scoping that query to the pending filing IDs is cheap hardening and stops the cost scaling with table size |
| Re-ingest requires deleting existing cal_access rows | high | likely | Scope by `source_system`; verify counts before/after; snapshot first; never target dev `postgres` (#796) |
| Public dollar figures change substantially | high | likely | Expected and correct, but re-verify a sample against official filings before production — same exposure as #979 / #962 |
| Row count grows 203,945 → ~1.2M | medium | likely | Verify index coverage on `contributions(committee_id, filing_id)`; donor scan already capped at 1000 |
| PII volume increase (~6x) | medium | likely | See data classification; `/op-data-scan` gate on subtask 6 |
| Migration on a large existing table | medium | possible | Additive nullable column + concurrent index; no backfill in the migration itself |
| Region config in a separate repo | low | likely | Publish `@opuspopuli/regions` before the monorepo consumes it |
| AGPL-3.0 dependency constraint | low | rare | No new dependencies anticipated |

## Decisions

**Launch gate — this blocks launch** (decided 2026-08-08). Every representative page currently sums
money paid *out* as money *raised*, over ~17% of the available rows. Same false-attribution class as
#979, which was treated as launch-blocking.

**Cover pages — broaden the existing source** (decided 2026-08-08). Drop
`filters: {FORM_TYPE: 'F496'}` from `dataSources[10]` so `cvr_filings` covers all campaign-disclosure
cover pages, rather than adding a second F460-filtered source or a sibling table. One source, one
table, one ingest pass.

Consequence to verify: `cvr_filings` grows from 31,418 toward the 662,076 rows extracted, and
`IndependentExpenditureLinkerService` (#955) must keep working against the larger set. It joins on
`FILING_ID`, which is unaffected by admitting more form types — but the IE linker's behavior on
non-F496 filings needs an explicit test before this ships, because #955 built it against an
F496-only table and may assume every row is an IE cover page.

## Open questions

1. ~~Should this block launch?~~ Resolved above — yes.
2. ~~Does `EXPN_CD` need the same cover-page join?~~ **Yes — verified.** `EXPN_CD` also has no
   `FILER_ID`, carries the same `FILING_ID`/`AMEND_ID`/`LINE_ITEM`/`TRAN_ID` key columns, and its
   `CMTE_ID` (col 26) sits in the payee block — so it identifies the *payee's* committee, not the
   spender. `totalSpent` is inverted the same way `totalRaised` is.
3. ~~Should `cvr_filings` broaden to all form types, or gain a sibling table?~~ Resolved above —
   broaden the existing source.
