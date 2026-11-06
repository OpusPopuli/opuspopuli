# Phase B — campaign finance

Campaign finance is sixth in Phase B (`ingestion-resource-lanes.md` §10.2,
owner order: civics, propositions, representatives, meetings, **campaign
finance**, bills). Its plan items are **K4**, skipping a bulk import whose
input is unchanged, and **S8**, overlapping parse with write. By the
consistency principle it also gets every stage the other types got: skip keys
on every axis, attribution, and every lane that applies. It runs no LLM, so
there is no eval leg. Correctness is checked against the raw archive, never
against `items_extracted` (`project_finance_data_correctness`, and the
reconciliation method in `991-admit-incomplete-expenditures-and-disclose.md`).

Dev only (owner, 2026-10-26): verified on the local UAT stack, with no tags
and no Studio deploys.

Related: #1277 (bulk-archive tier and per-record hashes, closed), #991
(expenditures, merged as #1364 but still open), #992 (amendment
supersession), #630 (the federal plugin OOMs on FEC `api` sources).

## What is true today (read 2026-11-01)

**The sources.** California has seven `bulk_download` sources, all on
`https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip` (1.61 GB), one per
TSV: `RCPT_CD`, `EXPN_CD`, `SMRY_CD`, `S496_CD`, `CVR2_CAMPAIGN_DISCLOSURE_CD`
and `CVR_CAMPAIGN_DISCLOSURE_CD` twice (IE cover pages, committees). All have
`syncCadence: "0 2 * * *"`, which is daily. The federal plugin has two FEC
`api` sources and two FEC `bulk_download` sources (`indiv26.zip`, `cm26.zip`).
The ~60 county sources have no `sourceType` and do not sync.

**The run** (`campaign-finance-sync.service.ts`). The plugin fetches every
source in turn through `BulkDownloadHandler.execute`, which streams batches to
`onBatch`. Each batch is sorted by table, enriched, given committee stubs,
and upserted. Then the post-sync linkers run (supersession, the IE and
cover-page linkers, propositions, candidates). The order is load-bearing and
covered by the spec.

**The last two full runs (UAT):**

| run | wall | created | updated | per source |
|---|---|---|---|---|
| 2026-10-13 → 10-14 (#991 resync) | 16 h 33 m | 12,333,327 | 24,627,760 | RCPT 7 h 18 m, EXPN 6 h 13 m, SMRY 1 h 16 m, rest 10 m, linkers ~1 h 36 m |
| 2026-10-16 | 9 h 22 m | 3,942,295 | **32,685,958** | RCPT 5 h 33 m, EXPN 2 h 51 m, SMRY 34 m, rest 7 m, linkers ~17 m |

The 10-16 run is what a routine daily sync costs: **32.7 M rows rewritten**,
nearly all of them unchanged. The UAT cron is off (`REGION_SYNC_CRON_ENABLED=false`),
so this cost has never been paid daily anywhere yet. Production would pay it
every day, as a 9-hour job on a 24-hour cadence.

### Finding F1 — every row is a separate upsert, and every row is rewritten

`upsertRecordsByFields` reads the batch's existing `externalId`s, then sends
one Prisma `upsert` per row inside `batchTransaction`. An unchanged row is
written in full, which updates its indexes and leaves a dead tuple behind.
The tables are large (`contributions` 19.1 M rows / 13 GB, `expenditures`
14.1 M / 10 GB, `filing_summaries` 4.2 M / 1.6 GB), and the Docker VM's data
disk has 49 GB free (79% used).

### Finding F2 — K4 as written would never fire

K4 (lanes plan §4) skips the import when the downloaded file's sha256 matches
the last completed import. **The export is regenerated every day:**
- `bulk_snapshots` holds 3 fetches and 3 distinct hashes;
- `last-modified` moved 10-15 09:48 → 10-16 08:59 → 11-01 09:07 GMT;
- every TSV inside today's zip carries a 2026-11-01 timestamp (00:05–01:57).

A whole-file hash therefore never matches on a daily cadence. The skip has to
be per row (D1). How many rows really change in a day is measured in step 0
by diffing the line hashes of two consecutive exports.

### Finding F3 — the per-record hash from #1277 has never been stored

The handler stamps `sourceRecordHash` (sha256 of the raw line) on every
record, and `upsertBatch` lists it in every table's fields. But every finance
schema in `domain-mapper.service.ts` is a plain `z.object`, which **strips
unknown keys**, so the hash is gone by the time the row is written.
Measured on a 0.5% sample: `source_record_hash` is NULL on 90,854 of 90,854
contributions and 65,728 of 65,728 expenditures.

The tests missed it at both ends:
- the handler spec uses a mock mapper that passes records through;
- the integration spec (`bulk-archive-tier.integration.spec.ts`) writes the
  hash into the row itself.

No test runs a line through the real mapper. Searched 2026-11-01
(`sourceRecordHash`, `source_record_hash`): #1277 is closed and no issue
records this. A row-level skip (D1) depends on it, and so does #1277's own
purpose, locating a row in its snapshot.

### Finding F4 — seven downloads per sync, and one sync can mix two exports

Each source downloads the zip again: 7 × 1.61 GB per sync, about 50 s each.
The export is republished around 09:00 UTC, so a sync running across that
moment ingests two exports. The 10-16 run did: RCPT and EXPN came from the
10-15 export, and SMRY, S496 and both CVR files from the 10-16 one. For
filings made in between, the summary and cover page are present but the line
items are not. That makes the totals check in #992's reconciliation read low
for those filings, with nothing to say why.

### Finding F5 — five of seven runs cannot be traced to their snapshot

`bulk_snapshots` dedupes by content hash, so only the execution that first
downloads an export is recorded against it (`bulk_snapshots.execution_id`).
On 10-16, RCPT and SMRY link to a snapshot; EXPN, S496 and the three CVR runs
do not. On top of that, only `contributions` has `pipeline_execution_id`.
`expenditures`, `filing_summaries`, `independent_expenditures`, `cvr_filings`
and `cvr2_filings` carry no link to the run that wrote them. #1277's join,
row → execution → snapshot, therefore works only for contributions, and only
for runs that were first to fetch their export.

### Finding F6 — a stranded federal execution

The FEC `indiv26.zip` execution of 2026-08-10 is still `running`. It
completed twice in July (3,615,356 items). #630 already covers the federal
`api` sources accumulating everything in memory, and the UAT compose file
raised the region container to 6 GB to work around it.

### What already works

- Streaming: the CAL-ACCESS path never holds the file in memory.
- Resume: `ExecutionSession.appliedBatches` skips batches already applied on
  a retry.
- Amendment ordering (`keepNewestAmendment`, #992) and supersession.
- The network lane: one host, honoured `rateLimit` (#1401).
- No GPU and no CPU-lane work: the parse is a plain TSV split.

## Owner decisions

| | Decision | Suggestion |
|---|---|---|
| **D1** | K4's shape. A whole-file skip never fires (F2) | **Per row.** Skip a row whose stored `source_record_hash` equals the incoming line's hash, under an unchanged import key (D2). The existing `findMany` per batch selects the hash too, so this costs no extra query |
| **D2** | What the import key covers, so that a mapping change rewrites everything once | **The source's config hash plus a mapper version.** The config hash covers `columnMappings`, `filters`, composite keys, `filePattern` and `category`. The mapper version is a constant beside the finance schemas, pinned by a spec that hashes those schemas' source and fails until the constant is bumped. That is enforced, not left to memory. A change rewrites every row once, about a 9-hour run, and then skipping resumes |
| **D3** | Where the import key is kept | **One row per source in a new table**, `bulk_imports`: the source key, the import key, and `completed_at` for the last import that completed. Skipping is allowed only when the last completed import has the same key, so a failed or partial import never licenses a skip. That beats a column on 37 M rows |
| **D4** | One download per sync, shared by all seven sources (F4) | **Yes.** It gives one export per sync, so the tables are consistent with each other, and one download instead of seven. The file stays in this job's temp directory (§7 H4 holds, since nothing crosses a lane) |
| **D5** | Attribution (F5) | **`pipeline_executions.bulk_snapshot_id`** on every bulk execution, deduped or not, plus `pipeline_execution_id` on the five finance tables that lack it. Both additive and nullable; written from the next sync on, no backfill |
| **D6** | S8 (overlapping parse and write) | **Decide after K4, from a measurement.** If rows stop being rewritten, the write side may no longer be the bottleneck, and S8 would buy nothing. Step 4 measures where a post-K4 sync spends its time |
| **D7** | Federal: #630 and F6 | **Out of scope here.** FEC bulk sources run the same handler and inherit D1–D5 with no extra work. #630 is its own change, against its own issue. F6's stranded row is swept like any orphan |

**Owner, 2026-11-02: D1–D7 as suggested.**

## Steps

### 0. Baseline

- **A full California finance sync on the current image**, using
  `docs/runbooks/gate-0-baseline.md` unchanged: alone on the host, under
  `caffeinate`. Record wall time per source, rows created and updated, the
  linkers' time, DB disk before and after, and dead tuples.
- **The daily delta.** Download the export on two consecutive days and count
  the RCPT and EXPN lines whose hash is in one export but not the other. That
  figure sizes D1, the share of writes a row-level skip removes. One export is
  already held for 2026-11-01. The download stays in the session scratchpad,
  never the repo: it is personal information (see Data classification).

### 1. Store the record hash (F3)

Each finance schema keeps `sourceRecordHash`. Add a test that runs a raw line
through the **real** mapper and the real upsert into `postgres_test`, and
asserts the stored hash. Mutation-check it by stripping the field again. The
first sync after this writes a hash on every row. That is a full rewrite, the
same cost as every sync today.

### 2. One download per sync (D4)

Sources with the same URL share one download and one snapshot within a sync.
Every one of their executions records that snapshot (D5).

### 3. K4, per row (D1–D3)

- Migration via `/op-migration`, additive:
  - `bulk_imports`;
  - `pipeline_executions.bulk_snapshot_id`;
  - `pipeline_execution_id` on the five tables.
- The import key is built with the shared skip-key helper (`buildSkipKey`),
  so this skip does not invent its own.
- `upsertRecordsByFields` drops rows whose stored hash matches, when the
  import key matches the last completed import. A skipped row is counted as
  `skipped`, not `updated`.
- **The linkers still run** (lanes plan K4): new propositions or committees
  can need linking against unchanged finance data.
- Amendment safety: an unchanged line carries an unchanged `amendId`, so
  skipping it cannot change what supersession sees.
- **Verification:**
  - two syncs on the same export: the second writes only the keys that
    repeat inside a batch (see the defect below). The 0 rows first written
    here was wrong: supersession deletes rows the export still carries, so
    they were new to every sync until F7 was fixed (now built, below);
  - a config or mapper-version change: everything is rewritten once;
  - a failed import: the next run does not skip;
  - remove the predicate: a test fails.

### 4. Measure, then S8 (D6)

Re-run step 0's sync on the K4 image, with the next day's export. Record
where the time goes (download, parse, the per-batch read, writes, linkers).
S8 is built only if the writes still dominate.

**Decided on run 5: not built.** The writes no longer dominate (see "UAT run 5").

### 5. UAT and gate

There is no eval leg, so the gate is the raw archive:

- **Row counts:** distinct keys per table in the export, checked against the
  stored rows. Read before supersession, the method that validated #991.
- **Totals:** the per-filing direction check from
  `project_finance_data_correctness` (ours higher than official is a defect)
  is unchanged from the step 0 baseline.
- **Skip:** a second sync on the same export writes nothing beyond the
  repeated keys (F7 built). A next-day sync writes no more than that plus the
  measured delta.
- **Attribution:** every row written by the gate syncs reaches its snapshot
  through its execution, for all seven sources.
- **Linkers:** counts unchanged against baseline.
- Wall time and rows written recorded against step 0.

## Risks

| Risk | Mitigation |
|---|---|
| A mapping change ships without a mapper-version bump, and rows keep stale values | The pinning spec (D2) fails CI until the version is bumped |
| A partial import licenses a skip | Skipping requires the last *completed* import's key (D3). An import that dies partway never completes |
| Disk: the baseline and step 1 each rewrite ~37 M rows on a disk with 49 GB free | Measure free space and dead tuples before and after the baseline. Autovacuum already absorbed the 10-16 run. If headroom drops below 25 GB, stop and ask before going on |
| A daily export with a large delta (a bulk amendment season) | The skip degrades to today's behaviour, never worse. Step 0 measures one ordinary day |
| One shared download (D4) makes the first failure fail all seven sources | That is the same export either way. Today a failed download fails only its source, but the sources it leaves would ingest a different export (F4) |

## Data classification

**CCPA personal information, already held.** CAL-ACCESS contributions name
individual donors, with employer, occupation, city and ZIP. They are public by
statute (Political Reform Act disclosure), and that does not make them less
personal. This plan adds no new data flow:

- **`source_record_hash`** is a sha256 of a raw export line, which contains
  those fields. It is stored beside the very row it was derived from, and is
  never logged or sent anywhere.
- **The step 0 delta** reads two exports, but only counts hashes. The
  downloads stay in the session scratchpad and are deleted afterwards.
- **Logs:** no raw line, donor field or row value is logged. Batch logs keep
  printing counts only, and new logs follow the same rule.
- **Fixtures:** any fixture uses invented donors, never a line copied from
  the export.

## As built: steps 1–3 (2026-11-02, UAT pending)

Code complete on `feat/finance-phase-b`. UAT is still to run, after the step 0
baseline finishes.

- **Step 1 (F3).** Each of the six finance schemas declares
  `sourceRecordHash` (sha256, 64 characters). Tests:
  - a mapper test over all six categories;
  - an integration test on `postgres_test` that sends a line through the
    real handler, mapper and sync and asserts the stored hash. It fails with
    the production symptom (`source_record_hash: null`) when the field is
    stripped again.
- **Step 2 (D4).** `createBulkDownloadScope` (common) holds one download per
  URL for a sync, so later sources reuse it, and it holds a failure too. The
  plugin opens one scope around its source loop and closes it in `finally`.
  `PipelineExecuteOptions.bulkDownloads` carries it to the handler.
- **Step 3 (D1–D3, D5).**
  - **Import key.** `bulkImportKey(source)` is a `stableHash` of
    `BULK_MAPPING_VERSION`, `dataType`, `category` and `bulk`. It is not built
    with `buildSkipKey`, whose inputs are a prompt hash and a model digest,
    neither of which a bulk import has.
  - **The version is pinned twice:**
    - `bulk-import-key.spec.ts` hashes the handler and the mapper source;
    - `campaign-finance-write-shape.spec.ts` hashes `FINANCE_WRITE_FIELDS`,
      the per-table write fields, now a named constant.

    Either failing says "bump the version".
  - **Where the skip is decided** (changed from the plan's wording, not from
    D3). The sync service cannot tell which source a batch came from, since
    all seven feed one `onBatch`. So the handler reads the ledger
    (`IBulkImportLedger`, `bulk_imports`) per source and passes
    `{ skipUnchanged }` with every batch. The sync skips a row only when
    `skipUnchanged` is set and the stored and incoming line hashes are equal.
    A stored row with no hash, which is every row today, is written.
  - **Completion.** An import is recorded as complete only after its stream
    finishes. A source's later failure does not undo that, but it also cannot
    license a skip it was not given.
  - **Linkers** still run on every sync.
  - **D5.** `IBulkArchive.archive` returns the snapshot id, new or existing.
    Every run that read the download records it (`linkSnapshot` →
    `pipeline_executions.bulk_snapshot_id`), and the five tables gain
    `pipeline_execution_id` in `FINANCE_WRITE_FIELDS`.
  - **Migration** `20261102120000_finance_phase_b_import_ledger`, with
    `rollback.sql`. It applies cleanly on `postgres_test`.
- **Checks so far:**
  - **Tests:** common 280, scraping-pipeline 727, region-provider 155, backend
    3690, and the finance-ingest integration spec, 5 tests. tsc, lint and the
    backend `lint:sonar` are clean. The one complexity-19 function in the
    plugin, `fetchRepresentatives`, is unchanged from `main`.
  - **Mutation-checked:**
    - the six schema fields, through both the unit and integration tests;
    - the scope's sharing, its release, the plugin's close, and the scope's
      pass-through;
    - the key comparison, recording completion on failure, the snapshot link,
      and the key's `bulk` input;
    - the sync's skip, its null-hash guard, and the context pass-through;
    - both pins;
    - the skip and link end to end on `postgres_test`.

## Step 0 results (job 190, 2026-11-02)

The pre-change UAT image, alone on the host, under `caffeinate`. The cron is
off.

| Stage | Wall time | Rows |
| --- | --- | --- |
| RCPT (contributions) | 4 h 35 m | 20,548,134 processed |
| EXPN (expenditures) | 2 h 27 m | 16,110,528 |
| SMRY (filing summaries) | 37 m | 4,255,847 |
| S496 (independent expenditures) | 44 s | 80,085 |
| CVR (cover pages) | 5 m | 725,709 |
| CVR2 (committee positions) | 2 s | 2,791 of 182,209 parsed |
| CVR (committee roster) | 1.6 m | 725,708 |
| Seven downloads, two failed uploads | ~6 m | 1.53 GB each |
| Supersession | 16 m | 3,946,929 deleted |
| Other linkers | 3 m | |
| **Total** | **8 h 12 m** | 4,185,196 created, 32,712,731 updated, 0 skipped |

- **Disk.** The DB volume went from 49.4 GB free to 48.1 GB free. Contributions
  grew from 13 GB to 14 GB and carries 3.69 M dead tuples after the run.
  Expenditures has 86 k.
- **F4 happened again.** RCPT and EXPN read the 11-01 export (`8315ba65…`).
  SMRY onwards read the 11-02 export (`dc5e9ca7…`, published 09:52 UTC
  mid-sync).
- **No hash is stored.** A 0.1% sample of contributions (19,114 rows) holds
  0 hashes, as F3 says.
- **The uploads fail on local Supabase.** Each new snapshot exceeds the
  storage per-file limit. `PrismaBulkArchive` records the row anyway, with no
  storage key, so D5's link still resolves. Every snapshot since 10-13 has
  `storage_key` null locally. This setting predates Phase B and is out of
  scope.

### The daily delta (11-01 → 11-02 export)

Line sets compared per TSV (sorted, `comm`). Only the counts were kept, and
the 11-01 download was deleted afterwards.

| File | 11-01 lines | New in 11-02 | Gone from 11-01 |
| --- | --- | --- | --- |
| RCPT | 20,550,448 | 5,685 (0.03%) | 0 |
| EXPN | 16,161,802 | 1,602 (0.01%) | 0 |
| SMRY | 15,578,023 | 5,429 | 0 |
| S496 | 80,062 | 73 | 0 |
| CVR | 725,600 | 110 | 0 |
| CVR2 | 182,179 | 30 | 0 |

- **The export only grew between these two days.** No line changed or
  disappeared. An amendment arrives as new lines with a higher `amend_id`.
- **D1 is sized:** a row-level skip leaves under 0.1% of the line writes,
  before F7.

### Finding F7: supersession churn is most of the creates

During the run, about 8% of each RCPT batch was **created**, not updated. The
supersession counts explain it:

- Supersession (#992) deleted 2,835,883 contributions and 1,111,046
  expenditures, **3,946,929 rows, 94% of the 4,185,196 created**.
- The export keeps every amendment's lines. Supersession deletes the rows below
  a filing's `max(amend_id)`. Each sync then re-inserts those older lines and
  supersession deletes them again.
- **K4 cannot skip them, because the row no longer exists.** On an unchanged
  export, K4 still writes ~3.9 M inserts plus ~3.9 M deletes per sync. That is
  also where contributions' dead tuples come from.
- Fixing it means dropping superseded lines before the write, against the
  stored `max(amend_id)` per filing. That is a design change outside D1–D7, so
  it is measured in step 4 and put to the owner, not built here.

## UAT run 1: the hash backfill (2026-11-02)

The new image against the 11-02 export (`dc5e9ca7…`). Every row is written
once more, this time with its hash.

- **Result:** succeeded in **10 h 4 m**; 3,948,560 created, 32,932,840
  updated, 0 unchanged.
- **One download (D4).** All seven sources read one fetch of the export.
- **Ledger (D3).** All seven sources wrote a `bulk_imports` row, each under
  its own key.
- **Attribution (D5).** All seven executions carry `bulk_snapshot_id =
  f0a84a68` (the 11-02 snapshot).
- **Hash and execution coverage (0.5% sample).** Every CAL-ACCESS row in
  contributions, expenditures, filing_summaries, independent_expenditures and
  cvr_filings has both. Contributions has 19 k hashless rows in the sample;
  all are `source_system = 'fec'`, last written July–August (the federal
  plugin, D7, out of scope).
- **Linkers.** All of them ran. Supersession removed 2,836,697 contributions
  and 1,111,175 expenditures, as in step 0 (F7).
- **Slower than step 0, and it is expenditures.** EXPN took 4 h 16 m
  against 2 h 27 m. Its per-batch average was 7.5–10.7 s against 4.7–6.0 s,
  growing through the file in both runs. RCPT was unchanged (4 h 31 m against
  4 h 35 m). The likeliest cause is that this run writes two new columns onto
  every row for the first time: the hash, and `pipeline_execution_id` with its
  new index. Contributions already had the column and index. This is a
  one-off cost of the backfill, and run 2 tests it.
- **Disk:** 40.6 GB free, from 44.8 GB before the run.

## UAT run 2: same export, K4 live (2026-11-02)

- **Result:** succeeded in **2 h 2 m**, against 8 h 12 m in step 0 and
  10 h 4 m in run 1. Counts: 3,947,872 created, 472,438 updated, 32,458,376
  skipped.

| Source | Created | Updated | Unchanged |
| --- | --- | --- | --- |
| RCPT | 2,836,697 | 199,976 | 14,499,034 |
| EXPN | 1,111,175 | 91,932 | 13,075,440 |
| SMRY | 0 | 0 | 4,255,847 |
| S496 | 0 | 62,359 | 17,726 |
| CVR (cover pages) | 0 | 115,512 | 610,197 |
| CVR2 | 0 | 2,659 | 132 |

- **Every create is F7.** Run 2 created exactly as many rows as supersession
  then deleted (2,836,697 + 1,111,175).
- **RCPT and EXPN updates are F7 too.** Partway through, every contribution
  run 2 had written was a superseded row (133,278 of 133,278, `amend_id` below
  its filing's max). Filing 578423, for example:
  - amendment 2 restated its lines under new `TRAN_ID`s (`CR…` for `INC…`),
    so they key to different rows;
  - the amendment-0 line recreates the old row, the amendment-1 line updates
    it about 10 k lines later, and supersession deletes it.
- **The S496, CVR and CVR2 updates are not F7. They exposed a defect.**

### Defect: K4 kept the wrong line when a key repeats inside a batch

These three tables are not amendable. They keep one row per key with
last-line-wins, and several lines map to one key:

- CVR keys on `FILING_ID`, one line per amendment.
- S496 and CVR2 key on `TRAN_ID`.

In the 11-02 export:

- CVR: 62,315 of 651,452 keys have several lines; 26,413 have two inside one
  10 k-line batch.
- S496: 7,467 of 23,076 keys; 5,407 inside one batch.

`withoutUnchanged` compared each line with the stored row on its own. In a
batch holding lines A then B for one key, the stored row held B, from the
previous sync. So A was written and B was skipped as unchanged, and the row
ended on A.

- **Measured after run 2:** 21,061 of 651,451 cover pages held an earlier
  line's hash, not their key's last line. Each holds a superseded amendment's
  cover page, and the cover-page linker attributes money through these rows.
- **Fix:** a key that appears on more than one line in the batch is never
  skipped. Every one of its lines is written in order, as without K4, at a
  cost of about 30 k extra writes per sync. Amendable tables were never
  exposed, because `keepNewestAmendment` leaves one row per key before the
  skip.
- **Tests:**
  - a unit test (two lines, one key; both written, in order);
  - an integration test on `postgres_test` (a cover page imported twice ends
    on its last line and hash).
  - Both fail with the guard removed.
- **Why the integration tests missed it:** every fixture line had a distinct
  key.
- **Repair:** the next sync on the fixed image rewrites every multi-line key,
  which restores those rows. Run 3 verified it (below).
- **Lines for one key in different batches need no guard.** Each batch reads
  the stored rows after the previous batch committed, so the later line is
  compared with the line this sync just wrote. A second integration test
  (one line per batch) pins that.

### Finding F8: S496 and CVR2 key on a bare TRAN_ID (pre-existing)

Found while measuring the defect. In the regions config, `CAL-ACCESS
Independent Expenditures` and `CAL-ACCESS Committee Positions` map `TRAN_ID →
externalId` alone. `TRAN_ID` is unique only within a filing.

- **S496:** 80,135 lines give 23,076 keys. 5,314 `TRAN_ID`s appear under more
  than one `FILING_ID`, so 45,044 filing-transactions overwrite another
  filing's row.
- **CVR2:** 1,867 `TRAN_ID`s span several filings, though only 2,791 lines are
  ingested at all.
- **This predates Phase B and K4 does not change it.** It is the per-filing
  collision of #716 (closed), which moved RCPT/EXPN to the
  `FILING_ID+LINE_ITEM+TRAN_ID` composite key. That fix assumed `TRAN_ID` alone
  was unique for these two sources.
- **The fix belongs in opuspopuli-regions** (a `compositeKey`) and needs a
  mapping-version bump, so it is out of scope here.
- **Issue search (2026-11-02), no match:**
  - opuspopuli: "S496 TRAN_ID externalId", "independent expenditure externalId
    collision", "CVR2 TRAN_ID", "TRAN_ID unique filing" (found only #716 and
    #980);
  - opuspopuli-regions: "TRAN_ID".

## UAT run 3: same export, the fixed image (2026-11-02)

- **Result:** succeeded in **1 h 24 m** (job 193). Counts: 3,947,872 created,
  495,633 updated, 32,435,181 skipped.
- **Creates are F7 again**, the same 3,947,872 as run 2.
- **Updates rose by 23,195** against run 2: the repeated keys now written.
- **Faster than run 2** (1 h 24 m against 2 h 2 m) on the same export and
  more writes. Not explained yet; step 4 records where the time goes.

Every stored row checked against its key's last line in the 11-02 export:

| Table | Rows | Last line | Earlier line |
| --- | --- | --- | --- |
| cvr_filings | 651,451 | 651,451 | 0 |
| independent_expenditures | 23,075 | 23,066 | 9 |
| cvr2_filings | 225 | 225 | 0 |

- **The 21,061 cover pages are repaired.**
- **The 9 independent expenditures are correct.** In each, the key's last line
  has an empty `AMOUNT`. The parser omits empty cells, so `amount` is
  undefined and the schema rejects the row. The stored row holds the only
  line the mapper accepts.
- **CVR2 is counted over the lines the mapper keeps.** It drops lines with
  neither a ballot name nor a number (#936). Counted over raw lines, 72 rows
  look wrong for the same reason.
- **Amendable tables:** one RCPT key repeats at the same `AMEND_ID` with
  different lines, and no EXPN key does. Within a batch `keepNewestAmendment`
  collapses it to the last line before the skip; across batches nothing is
  needed (above).

## Step 5 gate on the 11-02 export (after run 3)

The skip can only change which line a row holds or leave a row unwritten; it
never deletes. So the check is per key: the line a full write leaves is the
key's newest-amendment line, last in file order. Drop keys below their
filing's max `AMEND_ID` (supersession), then compare that line's hash with the
stored row's. Keys and hashes only; no line content was printed.

| Source | Same line | Different line | Expected, not stored | Stored, not expected |
| --- | --- | --- | --- | --- |
| RCPT | 14,499,029 | 2 | 1,396 | 3 |
| EXPN | 13,075,438 | 1 | 21,915 | 1 |
| SMRY | 4,255,847 | 0 | 0 | 0 |

- **The residuals are mapper rejects, not K4.** The expected set does not
  apply the mapper's schemas. Run 3 rejected 2,314 contribution lines and
  51,274 expenditure lines (empty or non-numeric amounts, bad dates; the
  #991 EXPN rejects). A rejected last line leaves the earlier line, and a
  rejected max-amendment line moves the supersession cut.
- **No current row was written under the skip.** Every stored CAL-ACCESS
  contribution and expenditure names job 191 (run 1) as its writer. Run 1 had
  no ledger entry, so it wrote every line. Runs 2 and 3 skipped them, and
  supersession deleted the same counts in all three runs. The state is
  therefore the full write's state.
- **Cover pages, IEs, CVR2:** see run 3 (all hold their key's last kept line).
- **Attribution:** all seven run-3 executions link to snapshot `f0a84a68`, as
  runs 1 and 2 do (same export). Every stored CAL-ACCESS row on the six tables
  names an execution that links to it: job 191 for rows unchanged since run 1,
  job 193 for the 62,315 cover pages and 7,448 IEs run 3 rewrote.
- **Linkers and reconciliation are unchanged across runs 1–3:**
  - 176,392 filings reconciled; 459 over-itemized contribution filings (also
    459 in step 0, so pre-existing) and 4,453 over-itemized expenditure
    filings;
  - 75,285 filings carrying $3,499,834,151.30 unitemized;
  - supersession 2,836,697 + 1,111,175;
  - CVR2 linked 2 of 225; 235 inferred positions; candidate linker
    unchanged.
- **Against step 0:** reconciliation differs slightly (75,288 filings, 234
  not judged against 213). Step 0 read RCPT and EXPN from the 11-01 export
  (F4), so this is not like for like.
- **Still to run:** the next-day sync (step 4), against the measured delta.

## Review of diff a67c48af (2026-11-03) and what changed

`/op-review` ran three independent lenses on the uncommitted diff, version
a67c48af. It is a **self-review**: the author and the reviewer are the same
session, so it needs a second person's countersign. None of the lenses raised
a blocker. One suggestion broke D3's invariant, so it was treated as one.

- **Treated as a blocker: an unfinished run could still license a skip.** The
  ledger entry was only ever written, never cleared, so two paths broke "a
  failed or partial import never licenses a skip":
  - a run under a new key rewrites part of the file and dies; after a
    rollback to the old key, the old entry vouches for rows the new mapping
    wrote;
  - a job resumed after a deploy that bumped the version records the new key
    over batches written under the old one.

  Fixed:
  - the handler `forget`s the entry before the first batch whenever the key
    does not match;
  - a resumed import (any batch already applied) never records completion,
    so the next sync writes every row once.

  Tests:
  - handler unit tests: forget-before-write, keep-on-match, resumed run not
    recorded, a failed ledger write does not fail the run;
  - adapter tests;
  - on `postgres_test`: the rollback path writes every row.
  - Each fails with its guard removed.
- **The pins were too narrow and too wide.**
  - The handler pin covered the whole file, so any ledger or download edit
    forced a 32.7 M-row rewrite. It missed `handler-utils.ts` (which stamps
    `sourceSystem`), the finance routing, and the write rules
    (`clearableFields`, `amendable`, the undefined-to-null rule).
  - The line parser moved to `bulk-line-parser.ts`, a mechanical move with
    behaviour unchanged (all 739 package tests pass). The pin now covers that
    file, `handler-utils.ts` and the mapper.
  - The write fields, rules and `writeValues` moved to
    `campaign-finance-write-shape.ts`. Its pin hashes that file and
    `finance-routing.ts`.
  - bm1 was re-pinned in place. It has never left dev, and none of these
    moves changes what a line becomes.
  - The download code is deliberately unpinned: a change that alters a line's
    text alters its hash, so the row is rewritten anyway.
- **The temp export now outlives a source (security lens).** With D4 one file
  is held for the whole sync, still world-readable, and never swept after a
  kill. Now:
  - it is created `0600`;
  - exports older than 48 h are swept before each download.
  - Tests cover the mode, the sweep, and deletion after a failed download.
- **The batch context is typed end to end.** A shared `BatchCallback<T>` runs
  from the plugin through the pipeline, so a wrapper that drops it no longer
  compiles.
- **Smaller fixes:**
  - snapshot-link failure tests;
  - the scope's unchecked cast is documented (it is per call because the
    scope is created where the download type is unknown);
  - the key-change test moved to the import-key spec, with a test that the
    version is part of the key;
  - the migration's lock comment was wrong. Prisma runs the file as one
    transaction, so NOT VALID + VALIDATE holds the lock through the scan:
    run it with the sync stopped. The edit changes the applied migration's
    checksum, which `migrate dev` reports as modified; `migrate deploy` does
    not check it.
- **Left for step 4:** reading `source_record_hash` in the per-batch
  `findMany` forces heap reads. If step 4 shows that read dominating, a
  covering index `(external_id) INCLUDE (source_record_hash)` restores the
  index-only scan.
- **Not acted on:** `archiveSnapshot` and the plugin log `error.message` on
  storage and HTTP failures. That code is unchanged, and the lens judged it
  needed no action.
- **The data scan has not covered this change.** `scripts/data-scan.ts` reads
  `origin/main...HEAD`, which these uncommitted edits are not in. Run it after
  committing.

## Step 4 run (job 194, 2026-11-03): the CDN served the old export

The run was meant to read the 11-03 export. It read 11-02's again.

- **What happened.** The script saw `Last-Modified: Tue, 03 Nov 2026
  09:52:36 GMT` at 10:06:09 UTC and downloaded the new zip (`28d808c0…`).
  The worker's request, 30 s later, received 1,533.6 MB with 11-02's content.
  The archive logged "Bulk export unchanged, already archived", and all seven
  executions link to snapshot `f0a84a68` (11-02). The CDN was serving both
  versions for a while after the refresh.
- **This shows the archive doing its job.** The content hash, not the
  `Last-Modified` header, decides which export a run read, so the attribution
  is right even when the CDN is not.
- **Determinism.** The counts are identical to run 3: 3,947,872 created,
  495,633 updated, 32,435,181 skipped. Linkers and reconciliation are also
  identical (176,392 filings; 459 / 4,453 over-itemized; 75,285 filings,
  $3,499,834,151.30 unitemized).
- **Where the time goes (1 h 25 m):**

  | Stage | Time | Lines | Written |
  | --- | --- | --- | --- |
  | Download | 32 s | | |
  | RCPT | 46 m 8 s | 20.55 M | 3.04 M |
  | EXPN | 19 m 46 s | 16.11 M | 1.20 M |
  | SMRY, S496, CVR, CVR2, Committees | about 3 m | 5.79 M | 0.18 M |
  | Supersession | 14 m 30 s | | 3.95 M deleted |
  | Other linkers and reconciliation | about 1 m | | |

  F7's rows are nearly every write and every delete. The S8 decision (D6) is
  therefore taken after F7, on run 5.
- **The real 11-02 → 11-03 delta,** from the two zips (keys and counts only):

  | File | 11-02 lines | 11-03 lines | New or changed | Gone or changed |
  | --- | --- | --- | --- | --- |
  | RCPT | 20,556,133 | 20,558,592 | 2,459 | 0 |
  | EXPN | 16,163,404 | 16,171,279 | 7,875 | 0 |
  | SMRY | 15,583,452 | 15,609,535 | 26,083 | 0 |
  | S496 | 80,135 | 80,498 | 363 | 0 |
  | CVR | 725,710 | 726,137 | 427 | 0 |
  | CVR2 | 182,209 | 182,258 | 49 | 0 |

  Again the export only grew.
- **Seen in passing:** every bulk execution records `total_time_ms = 0`, in
  run 3 as in run 4. The times above come from the executions' start times
  and the log.

## F7 built (owner, 2026-11-03: "this PR")

Superseded lines are dropped before they are written. They are no longer
written and then deleted.

- **Rule.** On an amendable table, a line whose `amendId` is below the highest
  for its filing is dropped. The highest is taken over the stored rows (one
  grouped read per batch on the `(filing_id, amend_id)` index) and over every
  line in the batch.
- **Why this deletes nothing supersession would keep.**
  - Both maxima only rise during a sync. A batch line is either written or
    kept out by a stored row at the same or a newer amendment.
  - Nothing is deleted until supersession, which never deletes a filing's
    highest version.
  - So every dropped row is one supersession would delete. A row with no
    `filingId` or `amendId` is never dropped, as supersession never deletes
    one.
- **Only when supersession is bound.** Without it the older versions are what
  the table keeps, so nothing is dropped.
- **Counting.** Dropped lines count as `skipped`, and as `superseded` in the
  batch note and the sync result.
- **Tests:**
  - unit: dropped against the stored max, dropped against a newer line in the
    batch, the latest amendment's lines kept, no filing or amendment kept, the
    grouped read's shape, unbound supersession writes everything,
    non-amendable tables untouched;
  - `postgres_test`: a sync of an amended filing ends with only the latest
    row and recreates nothing on the second sync; a superseded line in a
    later batch than its amendment is dropped against the stored max.
  - Removing the rule fails two unit tests and both integration tests.
    Removing the in-batch max fails one unit test.

## F8 built (owner, 2026-11-03: "yes, and let's fix it")

[opuspopuli-regions#97](https://github.com/OpusPopuli/opuspopuli-regions/issues/97),
fix in [regions#98](https://github.com/OpusPopuli/opuspopuli-regions/pull/98).

Measured on the 11-02 export before choosing the key (keys and counts only):

| | S496 | CVR2 |
| --- | --- | --- |
| Lines | 80,135 | 182,209 |
| Distinct `TRAN_ID` (the old key) | 23,076 | 9,410 |
| Distinct `FILING_ID+AMEND_ID+TRAN_ID` | 80,135 | 182,209 |
| Distinct `FILING_ID+LINE_ITEM+TRAN_ID` | 69,734 | 150,485 |
| Filings with more than one amendment | 5,173 | 18,762 |
| Lines in each filing's latest amendment | 66,438 | 147,067 |

- **Independent expenditures were understated by about 77%.** The dev DB held
  23,075 S496 rows, $279.2 M. The latest amendment of every filing holds
  $1,227.8 M.
- **The key alone is not enough.** Amendments restate S496 and CVR2 lines as
  RCPT's do, so under the composite key 6,876 S496 rows ($151.4 M) and 13,436
  CVR2 rows belong to a superseded amendment. Within each filing's latest
  amendment the composite key is unique for both.
- **Fix, matching RCPT and EXPN:**
  - regions: `compositeKey: [FILING_ID, LINE_ITEM, TRAN_ID]` and `AMEND_ID →
    amendId` on both sources;
  - here: `amendId` in the mapper schemas, the types and the write shape;
    both tables `amendable`; supersession covers both (also in its GraphQL
    result);
  - migration `20261103120000_finance_ie_cvr2_amendable` (owner-approved
    SQL): adds `amend_id` and the `(filing_id, amend_id)` index to both
    tables, and deletes the CAL-ACCESS rows still on the bare key. Left in
    place, they would sit beside their rebuilt rows with `amend_id` NULL,
    which supersession never removes. **Both tables have no CAL-ACCESS rows
    from deploy until the next sync. Run one right after deploying.**
- **No mapping-version bump.** The two sources' config changes, so their
  import key changes and they are written in full. The other five sources'
  write shape is unchanged. bm1 was re-pinned in place (it has not left dev).
- **Tests:**
  - the mapper keeps a numeric `amendId` for both (fails with it removed from
    the schema);
  - supersession on `postgres_test` removes the superseded IE and CVR2 rows;
  - the unbound service reports zeros for all four tables.

## UAT run 5 (job 195, 2026-11-04): the 11-03 export, F7 and F8 live

The image carries F7, F8 and `@opuspopuli/regions` 1.0.106 (regions#98). The
F8 migration was applied to the dev DB first: it deleted the 23,075 IE and
225 CVR2 rows on the bare key, as approved. The CDN's `Last-Modified` was the
11-03 export before the run, and every execution links to snapshot
`2c849990` (`28d808c0…`), the hash of the 11-03 zip kept for the delta. So
this run read the export it was meant to.

- **Result:** succeeded in **22 m 14 s**, against 1 h 25 m for run 4 and
  8 h 12 m for step 0. Counts: 75,202 created, 144,075 updated, 36,752,530
  skipped.

| Stage | Run 4 | Run 5 | Written in run 5 | Dropped by F7 |
| --- | --- | --- | --- | --- |
| Download and archive | 32 s | 1 m 26 s | | |
| RCPT | 46 m 8 s | 7 m 3 s | 2,458 | 3,094,963 |
| EXPN | 19 m 46 s | 8 m 51 s | 7,874 | 1,237,086 |
| SMRY | | 50 s | 839 | |
| S496 (table rebuilt, F8) | | 25 s | 68,731 | 3,117 |
| CVR (cover pages) | | 51 s | 137,051 | |
| CVR2 (table rebuilt, F8) | | 2 s | 2,324 | 45 |
| Supersession, linkers, reconciliation | 15 m 30 s | 1 m 53 s | | |

The download stage includes the failed upload of the 1.5 GB zip to local
Supabase (see step 0).

- **F7 works.** RCPT wrote 2,458 rows against 2,459 new lines in the delta,
  and EXPN wrote 7,874 against 7,875. The difference is a mapper reject in
  each.
- **What supersession still deletes is new data.** 248 contributions and
  4,006 expenditures went, across 8 and 14 filings: older rows that the
  11-03 export's new amendments superseded. The rebuilt tables lost 601 IE
  and 21 CVR2 rows, older amendment lines written in an earlier batch than
  their filing's newer amendment. F7 only sees the stored rows and the
  current batch.
- **Cover pages cost about 137 k writes a sync, not the 30 k estimated.** A
  key with several lines is rewritten once per line on every sync, whether
  its lines share a batch (the K4 guard) or not: a later batch's line
  differs from the row the previous line left. In the 11-03 export 62,375
  keys hold 136,699 lines, against 136,690 updates. It costs 51 s a sync and the rows end correct. Cutting it would
  need an amendment-aware collapse for `cvr_filings`, which has no
  `amend_id` column. Not worth it now.

### D6: S8 is not built

The writes no longer dominate. RCPT and EXPN together wrote about 10 k rows.
From the log's per-batch timings:

| Source | Batches | Database time, median per batch | Database time, total | Parse and map, total |
| --- | --- | --- | --- | --- |
| RCPT | 2,056 | 23 ms | 101 s | 322 s |
| EXPN | 1,618 | 32 ms | 318 s | 213 s |

The database time per batch is the read of the stored rows' hashes plus F7's
grouped read. On EXPN it is mostly a tail: 10% of its batches took 0.5–1.6 s
while writing nothing, which points to the hash read on cold heap pages. A
covering index on `(source_system, external_id) INCLUDE
(source_record_hash)` would make that read index-only. It is not built here.
Overlapping parse with write (S8) would save at most the shorter of the two
sides, about 4 minutes of a 22-minute run. A covering index would cost a
migration on two tables of 13–18 M rows. Neither is needed for the daily
cadence.

### Gate on the 11-03 export

The same method as after run 3: each key's last line among its filing's
newest amendment, compared by hash with the stored row. For S496 and CVR2 the
expected set now applies the mapper's drops: S496 lines with no `EXP_DATE`,
and CVR2 lines with neither `BAL_NAME` nor `BAL_NUM` (#936). Keys and hashes
only.

| Source | Same line | Different line | Expected, not stored | Stored, not expected |
| --- | --- | --- | --- | --- |
| RCPT | 14,499,305 | 2 | 1,396 | 3 |
| EXPN | 13,075,681 | 1 | 21,915 | 1 |
| SMRY | 4,256,686 | 0 | 0 | 0 |
| S496 | 66,435 | 1 | 1 | 0 |
| CVR2 | 2,171 | 0 | 0 | 0 |

- **RCPT, EXPN, SMRY:** the same residuals as run 3, all mapper rejects.
  SMRY grew by the 839 new F460 lines.
- **S496's two keys are mapper rejects too.** Each has an amendment-1 line
  with a blank `AMOUNT`, which the schema rejects. In one, the filing's other
  lines are at amendment 1, so the amendment-0 line is dropped and the key is
  absent. In the other, the key is the filing's only line, so the amendment-0
  line stays. That is the same class as RCPT and EXPN: supersession and F7
  see only the lines the mapper keeps.
- **Independent expenditures now match the export:** 66,436 rows, $1,228.2 M,
  against $279.2 M before F8. The IE linker attributed 66,435 of them; the
  one left has no Form 496 cover page.
- **Attribution:** all seven executions link to `2c849990`. Every CAL-ACCESS
  row on the six tables reaches a snapshot. The rows run 5 wrote are exactly
  the counts above (2,458; 7,874; 839; 66,436; 2,171; 62,736 cover pages).
- **Linkers and reconciliation.** These move with the new export and the
  rebuilt tables, not with K4:
  - 176,403 filings reconciled (176,392 on 11-02);
  - 459 and 4,453 over-itemized filings, unchanged;
  - 75,287 filings carry $3,499,835,410.08 unitemized;
  - CVR2 linked 39 of 2,171 (2 of 225 before F8);
  - 594 IEs linked to measures; 283 inferred positions (235).
- **DB size:** 31 GB before and after.

### Still open

- The review of everything changed since diff a67c48af (F7, F8, run 5), then
  the commit and the PR.
- **Deploy coupling:** the F8 migration empties the CAL-ACCESS rows of two
  tables. Run a finance sync right after deploying it.

## Review of diff c1d0efbb (2026-11-04) and what changed

`/op-review` ran three independent lenses on the uncommitted diff, version
c1d0efbb (everything since a67c48af: its review fixes, F7, F8, the regions
bump, the schema snapshot, run 5). It is a **self-review**: the author and the
reviewer are the same session, so it needs a second person's countersign.
None of the lenses raised a blocker.

Fixed:

- **F8 had no behavioural test, only the file-hash pin.** Removing `amendId`
  from the IE or CVR2 write fields, or `amendable` from either rule, failed
  nothing but the pin, whose message says to re-pin. An integration test now
  syncs an S496-shaped and a CVR2-shaped source on `postgres_test`, one line
  per batch, newest amendment first. Amendment 0 can only be dropped against
  the stored `amend_id`, so the test checks the stored `amendId` and that one
  row is left. Both mutations fail both cases.
- **The rollback left the composite-key rows in place.** The previous code
  supersedes neither table and the previous config writes bare `TRAN_ID`
  rows, so after a rollback every line would count twice. `rollback.sql` now
  deletes them, the mirror of the up migration. Dry-run on `postgres_test` in
  a rolled-back transaction.
- **A delegate without `groupBy` turned F7 off silently.** It is now required
  on the delegate type, so a missing one fails loudly.
- **Counts:** one `NO_COUNTS` and an `addCounts` helper replace three zero
  literals and three sets of five `+=`. The final-flush note now prints the
  unchanged and superseded split, as each batch note does, and the
  `processed` comment says what it counts (rows left after the newest-
  amendment collapse).
- **Test helpers:** `providerFrom` and `supersedingSync` replace the copied
  provider and constructor blocks in the ingest spec.
- **bm1 re-pinned in place, not bumped to bm2.** The lens's case is a DB that
  ran regions 1.0.106 before the mapper kept `amendId`. Those rows would keep
  `amend_id` NULL and be skipped for ever. No such DB exists: production has
  no ledger yet, and every one of dev's 66,436 IE and 2,171 CVR2 rows carries
  an `amend_id`. The pin specs now state the exception (a version that has
  never left dev, where every table whose shape changed also changed its
  config or had its rows deleted), not just "never edit an old entry".

Recorded, not changed:

- **A rejected line in the newest amendment lets the older version survive.**
  F7 and supersession both take a filing's highest amendment over the lines
  the mapper kept, table by table. Run 5 shows one S496 key like this. CVR2 is
  more exposed, because the mapper keeps about 1% of its lines: an amendment
  that blanks `BAL_NAME` and `BAL_NUM` leaves the superseded declaration. It
  predates F7, which behaves exactly as supersession does. A fix would take
  the highest amendment from the raw lines, before the mapper.
- **Supersession groups by `filing_id`, not by `source_system`.** No FEC
  source maps `amendId` and rows with a NULL `amend_id` are excluded, so FEC
  rows cannot be affected today. Adding `source_system` would mean changing
  the grouping on four tables, contributions among them (18 M rows), and F7's
  read too, without the `(filing_id, amend_id)` index covering it. Revisit
  if an FEC source maps `AMEND_ID`.
- **Supersession still scans the four tables in full each sync.** With F7 it
  usually finds little to delete. Run 5 spent 1 m 53 s on supersession,
  linkers and reconciliation together. Scoping it to the filings a sync
  touched is the next lever, if it is ever needed.
- **A redundant index.** On IE and CVR2, `@@index([filingId])` is now covered
  by the composite index, as it already is on contributions and
  expenditures. Dropping the single-column indexes is a follow-up for all
  four.
- **Not taken:**
  - the claim that `BulkDownloadHandler.execute()` exceeds the complexity
    gate: measured with `sonarjs/cognitive-complexity`, it is 11;
  - `FINANCE_WRITE_RULES` written with `satisfies`: cosmetic, and it would
    trip the pin.
- **Pre-existing, outside the diff:** in changed files, `fetchRepresentatives`
  (`declarative-region-plugin.ts`, 19) and `deriveSummariesFromDigest`
  (`pipeline.service.ts`, 18) are over 15, the same on main. This diff
  touches neither.
- **Deploy:** the plain `CREATE INDEX` statements in both migrations block
  writes on their tables (`expenditures` has 13 M rows), so deploy with the
  sync stopped. That goes in the PR.

Tests after the fixes:
- backend unit: 3,701;
- finance integration specs on `postgres_test`: 29;
- scraping-pipeline: 741;
- tsc and lint: clean.

A second fix review covered the c1d0efbb→0076c050 fixes, one lens. It found no
blocker and two nitpicks, both fixed:
- `upsertBatch` could return the shared `NO_COUNTS` object; it now starts
  from a copy, and the constant is frozen;
- the F8 test picks its model by its `table` field.

### UAT run 6 (job 196, 2026-11-04): the final code, same export

The rebuilt image on the final code, the 11-03 export again. **Succeeded in
20 m 51 s: 0 created, 136,699 updated, 36,829,185 skipped.** The updates are
exactly the 136,699 lines on CVR's 62,375 multi-line keys, as predicted.
Supersession removed nothing, and every table's count equals run 5's. On a
second sync of one export, the only writes are the repeated keys. That is
the skip gate.
