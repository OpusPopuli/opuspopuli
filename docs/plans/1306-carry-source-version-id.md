# Plan of record — #1306: carry the `SourceVersion` id onto the rows that derive from it

| | |
|---|---|
| **Issue** | [opuspopuli#1306](https://github.com/OpusPopuli/opuspopuli/issues/1306) — sub-issue of [#1207](https://github.com/OpusPopuli/opuspopuli/issues/1207) (M1 Provenance foundation) |
| **Date** | 2026-09-21 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/carry-source-version-id-1306` |
| **Data classification** | Public civic records that contain personal data — same class as #1276's store, with one new copy. See §5. |
| **Depends on** | #1276 (store, merged), #1280 (row provenance, merged), #1296 (the consuming resolver, merged) |
| **Reads first** | `docs/plans/1276-source-version-store.md`, `docs/plans/1280-link-rows-to-producing-run.md`, `docs/plans/1212-claim-anchoring-quote-then-locate.md` |

## 1. The issue's scope is necessary but not sufficient

The issue reads as plumbing: `archive()` returns an id instead of `void`, the id
rides the pipeline onto the subject row, `recordClaims` copies it onto `Evidence`.
All four steps are needed and all four are in this plan.

But doing only those four steps **makes every claim on the platform report
`source-changed`** — a false statement, and the most damaging of the resolver's
five outcomes, because it accuses the source of having been altered.

### Why

`ClaimSourceResolverService` re-derives the cited passage from the archived bytes:

```ts
const derived = decodeUtf8(bytes);                       // archived artifact
const derivedHash = createHash('sha256').update(derived, 'utf8').digest('hex');
const span = resolveEvidenceSpan(derived, derivedHash, {
  sourceTextHash: evidence.sourceTextHash, ...            // what the claim cited
});
```

That is correct only if the archived bytes, decoded, **are** the text the span
indexes into. They never are:

| Family | Archived bytes | What the span indexes into | Equal? |
|---|---|---|---|
| minutes | the **PDF** (`minutes-ingest.handler.ts:369`) | `rawText` — pdf-parse output, then truncated at 256 kB | no |
| proposition | the **HTML** detail page (`detail-crawler.service.ts:364`) | `fullText` — CSS-selector extraction under an LLM-derived plan | no |
| representative | not archived at all | `bio` | n/a |

`evidence.sourceTextHash` is documented in the schema as *"SHA-256 of the **derived**
text"*. The resolver compares it against the hash of the **fetched** bytes. Those are
two different artifacts, and the hash check fails by construction — for all 746
claims that carry a span today, and for every one generated after the model refresh.

### The gap this exposes

`fullText` cannot be re-derived from archived HTML at read time: the extraction plan
is LLM-derived per page and is not reproducible. So the derived text has to be
**stored** at the moment it is produced, or the resolver's contract is unsatisfiable
rather than merely unimplemented.

This is the substance of #1306, and it is why the plan is larger than the issue.

## 2. Design

**One row per fetch, carrying both representations.** `SourceVersion` gains
`derivedText` + `derivedTextHash` alongside the bytes it already holds.

Rejected alternative: archiving the derived text as a *second* content-addressed
`SourceVersion` linked by a self-reference. It works, but it gives one fetch two rows
that each claim to be "the source", and `sourceUrl` then means different things on
each. One fetch, one identity, two representations of it is the smaller lie.

**The derived text is captured at the upsert, not at the fetch.** The value written
is the exact string being stored in `full_text` / `raw_text` — taken from the same
variable, in the same statement. Capturing it at the fetch instead would be a
different string the moment anything between the two transforms it (minutes already
truncates), and the failure would be silent: a hash that never matches, reported as
`source-changed`.

**`sourceVersionId` is stamped per item, not per run.** `stampProvenance` applies one
provenance object to every item in the result, which is right for `executionId` and
wrong here: each item's `fullText` comes from *its own* detail-page fetch. It must
travel out of `fetchDetailContent` per item, beside the text it produced.

## 3. Subtasks

| # | Work | Package / service | Migration |
|---|---|---|---|
| **S1** | `SourceVersionService.record` returns the row id — it already probes for it on the duplicate path and discards it. `ISourceArchive.archive()` returns `{ sourceVersionId }` rather than `void`; `archiveFetch` returns it; `fetchUrl`/`fetchWithRetry` carry it on `CachedFetchResult`; `fetchPdfText` returns `{ text, sourceVersionId }` where it returns a bare string today. | `extraction-provider`, region infrastructure | — |
| **S2** | `fetchDetailContent` returns the id with the text; `enrichItems`/`enrichSummaries` stamp it on **each item**. `RowProvenance` gains `sourceVersionId`. | `scraping-pipeline`, `common` | — |
| **S3** | `SourceVersion.derivedText` (Text, nullable) + `derivedTextHash` (VarChar(64), nullable, indexed). `propositions` and `minutes` gain `source_version_id` + FK `ON DELETE SET NULL` + index. **Not `representatives`** — §4 puts bios out of scope, and an earlier draft of this row contradicted that. | `relationaldb-provider` | additive; `migrate` + `down.sql` |
| **S4** | Sync services write `sourceVersionId` at the upsert as an **explicit null** when absent (#1280's rule), and fill the archive's `derivedText`/`derivedTextHash` from the string being stored. Fill is write-once: a non-null value that differs is logged, never overwritten — the table is append-only. | region sync services | — |
| **S5** | `ClaimRecordInput` gains `sourceVersionId`; `recordClaims` writes it on each `Evidence` row **and includes it in the claim signature**. Without the signature change, a regeneration producing identical claims is a no-op and the link never lands on the 1,497 existing claims. | region | — |
| **S6** | Resolver reads `derivedText` **instead of** `decodeUtf8(content)` — not as a preference with a fallback, because the fallback is the bug: decoding a PDF and slicing it at offsets measured against its extracted text is exactly what produces a false `source-changed`. Keeps the byte-integrity check against `contentHash`, adds one against `derivedTextHash`, and returns a new `no-derived-text` reason. | region | — |
| **S7** | Integration tests on a real database: a claim resolving end-to-end from real synced data (the AC verbatim); the untracked-run explicit-null rule; rows predating the link still returning `no-archived-source`; and a reintroduction check that S6's new reason is not reachable by a genuine source change. | `apps/backend` | — |

## 4. Decisions

**Representative bios are out of scope for the link.** Their detail pages are not
archived, and #1296 already established that bios cite structured fields rather than
text spans — all 751 are unevidenced by construction. Linking them would require
archiving a fetch that produces no span, for no gain. They keep returning
`no-archived-source`, which stays true.

**No backfill.** Same reasoning as #1280: existing rows keep a null. A back-dated
guess about which bytes a claim rested on would be indistinguishable from evidence.

**`derivedText` is capped at `MAX_ARCHIVED_BYTES`.** Same argument as the bytes: a
partial derivation under a hash claiming to be whole would verify.

## 5. Data classification

The derived text is the same civic text already in `full_text` / `raw_text`, which
under #1263 can contain proponent contact details. No new data class — but it creates
a **second, permanent** copy in an append-only table, where the first was mutable.
Nothing renders it today; the read path added in S6 returns a ≤1024-char span, never
the document. Any future surface must redact before display, as #1276 already records
for the bytes.

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Linking without S6 reports `source-changed` platform-wide — an accusation, not a gap | **high × certain** *(this is §1)* | S3/S4/S6 ship in the same change as S1/S2/S5; S7 asserts a real claim resolves, not that the columns are populated |
| Signature omission leaves 1,497 existing claims permanently unlinked | high × likely | S5 puts `sourceVersionId` in the signature; test asserts a re-run with identical claims still rewrites |
| `derivedText` duplicates civic text into a permanent store | medium × certain | §5; size bounded by `MAX_ARCHIVED_BYTES` and by 54 propositions / 56 minutes today |
| Write-once fill races two concurrent syncs | low × possible | Fill only where null; a differing non-null value logs at warn and is not overwritten |
| A re-sync disturbs the byte-identical `full_text` invariant #1305's transfer depends on | medium × likely | The issue's own sequencing note: land this, then sync, then transfer — never transfer across a sync |
| `fetchPdfText`'s return-shape change breaks callers silently | medium × possible | It is a type change, not a field addition — `tsc --noEmit` across the workspace is the gate |

## 7. Effort

Roughly 1.5–2 focused sessions. S1–S2 are mechanical threading across three packages;
S3–S4 are the substance; S6–S7 are where the correctness lives.

## 8. What changed during implementation

- **S3 no longer touches `representatives`.** The subtask table and §4 contradicted
  each other; §4 was right. Bios cite structured fields, not spans.
- **The resolver does not fall back to decoding the bytes.** Written as a preference
  in §3; implemented as a replacement. A fallback would silently restore the exact
  defect for any row whose derivation is missing.
- **`getSharedHttpPool`-style silent memoisation has an analogue here** and is
  handled: `attachDerivedText` uses a conditional `updateMany` on the null predicate
  rather than read-then-write, so two concurrent syncs cannot both believe they won.
- **The existing #1296 suite had to be rewritten, not extended.** Its fixture
  archived the derived text *as* the bytes, so `decodeUtf8(content)` returned exactly
  the string the spans indexed into and every test passed on a shape that does not
  occur in production. Reintroducing the old resolver now fails three of its tests.

## 9. Sequencing

Lands **before** the model refresh and the corpus regeneration (roadmap §6.4): the
regeneration is the sync that would populate this, and running it first means running
it twice.
