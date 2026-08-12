# Plan: amendment supersession + filing summaries (#992)

| | |
|---|---|
| **Issue** | [#992](https://github.com/OpusPopuli/opuspopuli/issues/992) |
| **Follows** | [#980](https://github.com/OpusPopuli/opuspopuli/issues/980) — attribution fixed and verified; totals still inflated on amended filings |
| **Related** | [#991](https://github.com/OpusPopuli/opuspopuli/issues/991) (EXPN shortfall), [#983](https://github.com/OpusPopuli/opuspopuli/issues/983) (refund signs) |
| **Date** | 2026-08-11 |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** No new donor fields. `SMRY_CD` is aggregate-only (amounts per filing), so it adds no PII of its own. |
| **Branch** | `feat/992-amendment-supersession-and-summaries` (+ `opuspopuli-regions`, + migration) |
| **Status** | Subtasks 1–4 complete (4 split into 4a/4b after the finding below). 5 (re-verify on a rebuild) is all that remains. |

## Problem

Two findings from #980's subtask-7 verification against official Form 460 totals.

### A. Amended filings double-count

Amendments **restate a filing with new `TRAN_ID` and `LINE_ITEM` values**, so the composite
`externalId` cannot merge them. Original and restatement both persist.

```
filing 2505994
  AMEND_ID 0:  1 row,  $168,135.00
  AMEND_ID 1:  2 rows, $170,988.25   <- official Form 460 line 1, exactly
  stored:      3 rows, $339,123.25   <- both
```

This refines #980's conclusion. Dropping `AMEND_ID` from the key was **necessary** — it collapsed
3.18M genuinely duplicated `RCPT_CD` rows — but only merges rows that *reuse* identifiers.
Restatements don't. The 15.9% collision rate measured at the time was real dedup of a different
case, which is why it read as confirmation.

### B. Unitemized contributions are invisible

Schedule A itemizes contributions of **$100 or more**. Smaller ones are aggregated onto the Form 460
summary line and appear nowhere in `RCPT_CD`. Our detail is complete; the *displayed total* is not.

```
644009:   ours 35,250.00 (= raw file exactly)   official 36,694.00   (-1,444)
1637859:  ours 41,295.00 (= raw file exactly)   official 43,530.00   (-2,235)
```

A candidate funded by many small donors currently looks less funded than one funded by a few large
ones. On a transparency platform that is a substantive distortion, not a rounding detail.

## Measured baseline

123 Schedule-A-only filings vs official Form 460 line 1:

| | Count | |
|---|---:|---|
| Exact match | 60 (49%) | ✅ |
| Ours lower | 55 (45%) | ✅ unitemized (B) |
| Ours higher | **8 (7%)** | ❌ amendment double-count (A) |

Attribution is unaffected and verified: 3,000/3,000 sampled rows matched the filer in the raw
cover-page file; self-donations fell 40,003 → 1,398.

**This baseline is the acceptance target.** After the work, "ours higher" should be ~0 and the
unitemized delta should be explicit rather than silent.

## Decisions

**Superseded rows are deleted post-sync** (decided 2026-08-11). A step after ingest retains only
`max(amend_id)` per filing, mirroring `CoverPageLinkerService`.

Rejected: flagging and filtering on read. It preserves amendment history in-database, which has real
civic value — "this committee revised its numbers" is itself a fact — but it puts a filter on every
current and future read path, and #980 demonstrated exactly how a missed filter becomes a wrong
public number. History remains recoverable from the source archive when a feature needs it.

Rejected: filtering during ingest. The bulk handler streams a single pass and cannot know
`max(amend_id)` until the file ends; a pre-pass or buffering ~20M rows costs more than a post-sync
delete.

**Ingest all F460 summary lines** (decided 2026-08-11), not just contributions (1–5). Lines 6+ carry
expenditure and cash-position totals, which give #991 the same reconciliation lever — and #991 is
currently a 60% shortfall with no independent check.

**The newest amendment wins the upsert, by comparison rather than by arrival**
(added 2026-08-11, during subtask 1). Storing `amend_id` turned a cosmetic defect into a
destructive one, and the fix belongs here rather than in a follow-up.

Because the composite key omits `AMEND_ID`, a restatement that *reuses* `TRAN_ID`/`LINE_ITEM` merges
onto one row whose stored values are simply whichever version was written last. #980 measured **454
`RCPT_CD` rows where `AMEND_ID` decreases in file order** — for those, the superseded version lands
last and wins, and it was harmless while nothing read `amend_id`.

It is not harmless now. Supersession deletes every row below `max(amend_id)` for a filing, so a
current row left holding a stale `amend_id` is deleted outright and its money leaves the committee's
total. The failure is silent and it under-counts — the same class of defect as #980, pointed the
other way. `upsertRecordsByFields` now orders amendable writes by `amendId`, both within a batch and
against what is already stored, so file order stops mattering.

## Subtasks

### 1. `amend_id` on contributions and expenditures

- Migration (`/op-migration`): nullable `amend_id` + index supporting `(filing_id, amend_id)`
- `schema.prisma`, zod schemas in `domain-mapper.service.ts`, `Contribution`/`Expenditure`
  interfaces in `packages/common`, and the `fields` projections in `campaign-finance-sync.service.ts`
- Region config: map `AMEND_ID`

Same four-place write path as #980's `filing_id`, and the same trap: `z.object()` strips unknown
keys, so the schema change is what makes the mapping effective.

### 2. Supersession step

- New service in `apps/backend/src/apps/region/src/domains/`, run from `runPostSyncLinkers`
- Set-based delete, batched, following `CoverPageLinkerService`: for each `filing_id`, remove rows
  whose `amend_id` is below the maximum for that filing
- Must run **before** the cover-page linker — no point attributing rows about to be deleted
- **Tests:** integration against real `postgres_test`, including the 2505994 shape (original +
  restatement with different `TRAN_ID`s)

### 3. `filing_summaries` table + `SMRY_CD` ingestion

- Migration: `filing_summaries` (`filing_id`, `amend_id`, `form_type`, `line_item`, `amount_a/b/c`)
- Region config: new `dataSources` entry for `SMRY_CD.TSV`, `compositeKey`
  `[FILING_ID, AMEND_ID, FORM_TYPE, LINE_ITEM]`, filtered to `FORM_TYPE=F460`
- Domain mapper: `FilingSummarySchema` + category routing
- Sync: upsert config

Note this table keeps `amend_id` — it is the summary *of* an amendment, and reconciliation needs the
latest one, not a merged view.

### 4a. Schedule discriminator on detail rows

**Added 2026-08-12, measured before writing any reconciliation code.** `RCPT_CD` is not Schedule A —
it is every receipt schedule in one file, and the schedule letter (`FORM_TYPE`) was never mapped. So
`contributions` today is an undifferentiated mix with no way to tell the schedules apart:

| `FORM_TYPE` | Rows | Amount | On Form 460 |
|---|---:|---:|---|
| `A` | 18,205,803 | $28.70B | line 1 — monetary contributions |
| `C` | 313,633 | $1.74B | line 4 — nonmonetary |
| `I` | 197,921 | $1.54B | line 14 — miscellaneous increases to cash |
| `F496P3` | 237,731 | $1.87B | not an F460 at all |
| `F401A` | 146,291 | $0.37B | not an F460 at all |
| `A-1`, `E530`, `F900`, junk | 1,992 | $0.10B | — |

Reconciliation compares against **line 1**, which is Schedule A alone. Summing the table as it stands
compares a mixture against one of its parts. Measured across all 122,033 F460 filings, counting only
the surviving amendment (i.e. modelling the post-supersession state):

| Detail summed as | Match | Ours lower | **Ours higher** |
|---|---:|---:|---:|
| Schedule A only | 49,575 | 72,084 | **374 (0.31%)** |
| Every `RCPT_CD` row | 32,753 | 53,568 | **35,712 (29.3%)** |

**35,339 filings (29.0%) would be falsely flagged as over-counting.** The genuine signal is 374
filings; without the discriminator the noise outnumbers it 95:1 and the check is worthless — it would
be a fault detector that cries fault on nearly a third of all filings.

This is the "reconciliation false positives" risk in the register, larger than it was scoped at.

`EXPN_CD` is the same shape, and matters to [#991](https://github.com/OpusPopuli/opuspopuli/issues/991):
`E` 7,824,338 rows (line 6, payments made) mixed with `D` 4,826,727 (a **memo** schedule restating
Schedule E entries — additive summation double-counts it), `G` 1,342,727, plus `F461P5` / `F465P3` /
`F450P5` belonging to other forms entirely.

- Region config: map `RCPT_CD.FORM_TYPE` and `EXPN_CD.FORM_TYPE` → `scheduleCode`
- Migration: nullable `schedule_code` on `contributions` and `expenditures`, index `(filing_id, schedule_code)`
- `schema.prisma`, zod schemas, `packages/common` interfaces, `fields` projections — the same
  four-place write path as `amend_id`, with the same `z.object()` strip trap

Named `scheduleCode`, not `formType`: the finance router keys `filingSummaries` off `formType` +
`lineItem`, and a detail row carrying `formType` sits one field away from being misrouted.

### 4b. Reconciliation

- Compare itemized detail per filing against the official summary line
- **Flag where detail exceeds official** — that comparison is what found this defect; automated, it
  becomes a standing property rather than a manual exercise
- Expose the unitemized delta (line 1 − itemized) so small-donor money stops being invisible

Surfacing it in the UI is out of scope here; storing and flagging it is not.

Note the Schedule-A row above also stands as evidence for subtask 2 at full scale: the sampled
baseline was 8 of 123 filings (7%) over-counting, and modelling supersession across all 122,033 drops
that to 374 (0.31%). The residual is small enough to investigate case by case rather than in bulk.

### 5. Re-verify

Re-run the subtask-7 method on the rebuilt data. Target: "ours higher" ≈ 0, with the remaining
variance explained by unitemized amounts.

**Ordering:** 1 → 2 (fixes the defect) → 3 → 4a → 4b (proves it, and guards it). 5 last.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Supersession deletes rows it should keep | high | A filing with a single amendment must be untouched. Integration test asserts that explicitly before any bulk run. Second path found and closed during subtask 1: a merged row holding a stale `amend_id` from out-of-order arrival — see the monotonic-write decision above |
| Another rebuild needed to apply `amend_id` | medium | Existing rows have no `amend_id`, so supersession cannot act on them. Either backfill from the source or re-sync. A re-sync is ~4h and already proven |
| `SMRY_CD` is 469 MB | low | Comparable to sources already ingested; filtered to F460 |
| Reconciliation false positives | ~~medium~~ **realised** | Detail *below* official is expected (unitemized) and must not be flagged. Only detail **exceeding** official indicates a fault. Measured 2026-08-12: without a schedule discriminator this fires on 29% of filings against a true rate of 0.31%, which is what subtask 4a exists to fix |
| Region config in a separate repo | low | Publish `@opuspopuli/regions` before the monorepo consumes it |

## Open questions

1. ~~Backfill `amend_id` on existing rows, or re-sync?~~ **Resolved 2026-08-11: re-sync.** Not on
   simplicity — backfill is unsound. Stored rows were merged under last-write-wins, so a row that
   collapsed across amendments holds the *content* of whichever version was written last. A backfill
   can stamp an `amend_id` on that row but cannot restore the right values behind it, and
   supersession would then delete rows on the strength of those stamps. Only re-ingesting under the
   monotonic guard produces rows whose `amend_id` and contents agree. Cost stands at ~4h.
2. Should the unitemized delta appear on representative/proposition pages, or stay internal until a
   design exists? Storing it does not commit us either way.
