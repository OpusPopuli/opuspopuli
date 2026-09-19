# Plan of record — #1277: bulk-archive tier, retention schedule + per-filing record hashes

| | |
|---|---|
| **Issue** | [opuspopuli#1277](https://github.com/OpusPopuli/opuspopuli/issues/1277) — sub-issue of [#1207](https://github.com/OpusPopuli/opuspopuli/issues/1207) (M1 Provenance foundation), scope item 1, tier 2 of 2 |
| **Date** | 2026-09-19 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/bulk-archive-tier-1277` |
| **Data classification** | Public civic records — campaign-finance filings are already public. No new personal-data flow. |
| **Depends on** | #1276 (cited-source tier, merged), #1280 (row → producing run, merged) |
| **Reads first** | `docs/plans/1276-source-version-store.md`, `docs/plans/1280-link-rows-to-producing-run.md` |

## 1. Three findings that shape the work

### 1.1 There is no archive to prune

`bulk-download.handler.ts` streams the download to `tmpdir()` and `unlink`s it in
a `finally` (line ~291). Nothing is retained, ever. The acceptance criterion
"the bulk-archive tier enforces its retention schedule (latest + monthly), and
older snapshots are pruned" presumes a store that does not exist. As in #1280,
most of the work is building the thing before governing it.

### 1.2 `IStorageProvider` cannot accept a server-side upload

Its surface is `getSignedUrl` / `listFiles` / `deleteFile` / `exists` /
`getMetadata` — presigned-URL-shaped, designed for browser uploads of scan
photos. There is no `put` or `putStream`. Archiving a ~1 GB export through it
requires either extending the interface or having the server PUT a gigabyte to
its own presigned URL.

**Decision: extend the interface** with a streaming upload. It is the only
option that keeps both the provider pattern and the backup story (§3), and the
method is genuinely missing from the abstraction rather than being bent to fit.

### 1.3 #1280 already did most of the linking

Finance rows carry `pipelineExecutionId`. So `execution → snapshot` plus a
per-record hash satisfies "a finance row's provenance resolves without the
original ZIP" **without adding a snapshot column to the 18M-row table**:

```
contribution.pipelineExecutionId → PipelineExecution → BulkSnapshot
contribution.sourceRecordHash    = sha256(raw CSV/TSV line)
```

## 2. Why the two tiers differ

Cited pages (#1276) are small and immutable forever. The CAL-ACCESS export is
~1 GB per snapshot, and naive weekly immutability would be ~50 GB/yr — the only
material growth driver in the store. The resolution, from the issue: **claims
cite filings, not the rolling export**, so row-level provenance survives
without warehousing every snapshot.

Snapshot **metadata rows are kept forever even after their bytes are pruned.**
That is what keeps provenance resolvable once a snapshot ages out: pruning
deletes the payload, never the record that it existed.

## 3. Storage decision

Object storage via an extended `IStorageProvider`, **not** Postgres — the
opposite of #1276's call for the cited tier, deliberately:

- 12–13 GB/yr at latest+monthly would sit inside the database backup and
  directly lengthen restore time. #1276 chose `bytea` *because* that tier is
  small; the same reasoning rejects it here.
- This tier is not immutable-forever, so `deleteFile` being available is a
  feature rather than the hazard it was in #1276.

Accepted cost, and it must be stated plainly: object storage has **no off-node
copy** (`docs/runbooks/restore-drill.md` §8). A host loss takes the snapshots.
The metadata and the per-record hashes survive in the database, so provenance
degrades to "we know which snapshot, we cannot re-read it" rather than
disappearing.

## 4. Subtasks

| # | Work | Package / service | Migration |
|---|---|---|---|
| **S1** | `BulkSnapshot` model — content hash, source URL, fetchedAt, byteSize, storage key, retention fields, FK from `PipelineExecution` | `relationaldb-provider` | additive |
| **S2** | Retain the download rather than discarding it: content-address the file and upload it; extend `IStorageProvider` with a streaming put | `common`, `storage-provider`, `scraping-pipeline` | — |
| **S3** | Per-record hash over the **raw line before parsing** at `processLine`; `sourceRecordHash` on the finance row families | `scraping-pipeline`, `relationaldb-provider` | additive |
| **S4** | Retention sweep: keep latest + one per calendar month, prune older payloads, keep every metadata row | region worker | — |
| **S5** | Integration tests against a real database, including provenance resolving for a **pruned** snapshot | `apps/backend` | — |

## 5. Decisions

**Hash the raw line, not the parsed record.** Same principle as #1276: the hash
must witness what the source said, not our interpretation. It is also what
would let #991 (EXPN ~40% shortfall) and #992 (amended filings double-count) be
audited after the fact — the issue names this as the point of per-record
hashing.

**No backfill.** Existing finance rows keep a null `sourceRecordHash`. A null
says "ingested before hashing existed"; a computed-after-the-fact value would
claim the row was verified against a source when it was not.

**Verify against the real archive, not `items_extracted`** — that counts
survivors, not rows read (carried from the issue, and from
`project_finance_data_correctness`).

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Extending `IStorageProvider` breaks an existing implementation | high × possible | Additive optional method; both implementations updated; existing callers untouched |
| Retention sweep deletes the newest snapshot through an off-by-one | **critical** × possible | Sweep selects what to KEEP and deletes the complement; integration test asserts latest + monthly survive; never delete a metadata row |
| A 1 GB upload on the sync path slows or fails the finance run | medium × likely | Upload is best-effort alongside ingest, as archiving is in #1276 — a failed archive must not fail the sync |
| Adding a column to `contributions` (18M rows) | medium × rare | Nullable, no default — catalogue-only in PG11+; measured at 7 s for the #1280 index on the same table |
| Snapshots have no off-node copy | medium × likely | Stated in §3 and in the runbook; provenance degrades rather than disappears |
| Re-ingest triggered accidentally (bills sync is ~48 h, #1037) | high × rare | Nothing in this issue triggers a re-ingest; the sweep only deletes payloads |
| `db push` re-drops raw-SQL indexes (#1168) | high × rare | `prisma migrate` only, with `down.sql` |

## 7. Effort

2–3 focused sessions. S2 is the largest piece because it changes a shared
provider interface; S4 is the most dangerous and gets the most test attention.
