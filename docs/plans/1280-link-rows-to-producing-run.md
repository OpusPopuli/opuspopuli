# Plan of record — #1280: link civic rows to the pipeline run that produced them

| | |
|---|---|
| **Issue** | [opuspopuli#1280](https://github.com/OpusPopuli/opuspopuli/issues/1280) — sub-issue of [#1207](https://github.com/OpusPopuli/opuspopuli/issues/1207) (M1 Provenance foundation), scope item 3 |
| **Date** | 2026-09-18 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/link-rows-to-producing-run-1280` |
| **Data classification** | Public civic records plus run identifiers. No new personal-data flow. |
| **Depends on** | #1276 (merged) — the source store whose `executionId` this also populates |
| **Reads first** | `docs/plans/1276-source-version-store.md`, `docs/plans/ai-architecture-gap-analysis.md` |

## 1. The issue's premise does not hold

The issue opens: *"`PipelineExecution` and `StructuralManifest` already record which run
and which manifest produced what — but no `Proposition`, `Bill`, `Contribution` or
`Minutes` row points back to either."*

The first half is not true. Measured against the development database on 2026-09-18:

| Data type | `pipeline_executions` | `structural_manifests` | rows to link |
|---|---|---|---|
| propositions | **0** | 24 | 69 |
| meetings / minutes | **0** | 10 | 56 |
| bills | **0** | **0** | 5,019 |
| campaign finance | 30 — **none since 2026-08-13** | 2 | 18,055,411 |

**Only campaign finance has ever recorded an execution.** For three of the four row
families there is no run row to point at, so the acceptance criterion "given a
`PipelineExecution`, the rows it produced can be listed" cannot be met by adding
columns. The bulk of this issue is therefore *making run recording happen at all*,
and only then linking rows to it.

### Why nothing is recorded

Two independent mechanisms, both silent:

1. **`ExecutionTrackerService.beginSession` is only called from the api-ingest and
   bulk-download handlers.** The `html_scrape` path — propositions, meetings,
   representatives — never opens a session.
2. **`beginSession` returns a no-op session when `pipelineJobId` is absent**
   (`execution-tracker.service.ts:89`). A cron-triggered sync with no job row records
   nothing, reports success, and looks identical to a healthy run.

The second explains why even campaign finance stopped in August: not a regression in
the tracker, but runs arriving without a job id.

## 2. Why it matters

When a scrape goes wrong — a selector breaks, a manifest changes shape, an extraction
silently yields nothing — there is no way to identify the affected rows and no way to
scope a re-run to them. The blast radius of a bad run is "unknown", which operationally
means "everything".

This has already bitten twice: #1219 (proposition summaries that were title-echo and
scraper furniture) and #1220 (10 documents, 0 embedded) were both found by inspection,
because no query could ask "which rows did that run touch".

## 3. Subtasks

| # | Work | Package / service | Migration |
|---|---|---|---|
| **S1** | Open execution sessions on the `html_scrape` / `pdf_archive` paths. Expose `executionId` on `ExecutionSession`. Decide and implement what happens when `pipelineJobId` is absent — today it silently records nothing. | `scraping-pipeline` | — |
| **S2** | Carry `executionId` and `manifestId` out on `ExtractionResult` (it already carries `manifestVersion`), and stamp provenance **per item**. Per-item rather than per-source because `fetchByDataType` merges items from several sources into one array, and per-source attribution would be lost in the merge. | `scraping-pipeline`, `region-provider` | — |
| **S3** | Nullable provenance columns + FKs (`ON DELETE SET NULL`) + an index on the execution reference, for propositions, bills, minutes and finance rows. | `relationaldb-provider` | additive; `prisma migrate` + `down.sql` |
| **S4** | Persist provenance at the upsert sites. | region sync services | — |
| **S5** | Feed `executionId` into the #1276 archive context, closing the gap that issue deliberately left open. | region, `scraping-pipeline` | — |
| **S6** | Integration tests against a real database, including the AC verbatim: given an execution, list the rows it produced. | `apps/backend` | — |

## 4. Decisions

**No backfill.** Existing rows keep a null reference. A null says "we do not know";
a back-dated guess would look like evidence and would be indistinguishable from a real
link. Required by the issue, and recorded here so the nulls are not later mistaken for
a bug.

**`ON DELETE SET NULL`, not `CASCADE`.** Pruning pipeline bookkeeping must never delete
civic rows. Same reasoning as #1276's source store.

**Bills have no manifests at all**, so their provenance will be execution-only. Confirm
where bills are actually sourced from before wiring them.

## 5. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Adding a column to `contributions` (18M rows) locks the table | high × possible | A nullable column with no default is metadata-only in modern Postgres — **verify on `postgres_test`, do not assume**. Adding the FK is a separate matter and does scan; measure before shipping |
| Opening execution sessions on paths that never had them changes run behaviour | medium × possible | Sessions are additive bookkeeping; failure to record must not fail the run, exactly as archiving does not (#1276) |
| Provenance stamped per item bloats domain objects crossing package boundaries | low × likely | Optional fields only; nothing downstream is required to read them |
| A no-op session silently records nothing (the existing bug) recurs elsewhere | medium × likely | Make the no-op path observable — log at warn rather than returning silently |
| `db push` re-drops raw-SQL indexes (#1168) | high × rare | `prisma migrate` only, with `down.sql` |
| Row-to-run link looks complete but is null in practice (the #1276 lesson) | high × possible | Integration test asserts a row written through the real sync path carries a non-null execution reference |

## 6. Effort

**2–3 focused sessions.** S1 is the bulk of it and is "make run recording work at all",
not plumbing. Splitting S1 into its own issue was considered and rejected: it would
leave #1280 unable to satisfy its own acceptance criteria.
