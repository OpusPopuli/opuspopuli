# Plan of record — #1293: generators dual-write claims into the relational model

| | |
|---|---|
| **Issue** | [opuspopuli#1293](https://github.com/OpusPopuli/opuspopuli/issues/1293) — sub-issue of [#1208](https://github.com/OpusPopuli/opuspopuli/issues/1208) (M2 — Evidence Graph) |
| **Date** | 2026-09-20 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/claim-dual-write-1293` |
| **Data classification** | Public civic records. Claim text is model output about published documents; `minutes.rawText` and proposition `fullText` can contain proponent contact details (#1263). Dual-write copies claim text and quoted spans into new tables — no new egress, no new surface, same classification as the JSONB it mirrors. |
| **Depends on** | #1291 (Claim/Evidence tables, `resolveEvidenceSpan`), #1292 (`verifyEvidence`), #1280 (`pipelineExecutionId`), #1279 (`analysisSourceTextHash`) |
| **Reads first** | `docs/plans/1291-claim-evidence-core.md`, `docs/plans/1292-verify-or-snap-gate.md`, `docs/plans/1212-claim-anchoring-quote-then-locate.md` |

## 1. Correcting the issue's cross-service note

The issue warns that "the three generators write through different services" and
that this must not introduce a cross-service join. Measured — **all three write
from `region`**:

| Column | Writer |
|---|---|
| `propositions.analysis_claims` | `proposition-analysis.service.ts` |
| `minutes.summary_claims` | `minutes-summary.service.ts` |
| `representatives.bio_claims` | `bio-generator.service.ts` |

All in `apps/backend/src/apps/region/src/domains/`, all extending
`LlmGeneratorBase`. The federation constraint is real for the epic — it governs
how *other* services reach claims — but there is no cross-service shortcut
available to take here.

## 2. There is no write chokepoint, so the seam is a choice

`LlmGeneratorBase.withProvenance()` shapes data; it does not persist. Each
generator runs its own `db.X.update({ data: { …claims, …provenance } })`. So
dual-write is an explicit call each generator makes, which is exactly the
"wired but inert" shape that has already shipped three times in this milestone:
`StorageModule` never imported by region, `SOURCE_ARCHIVE` registered in the
wrong DI scope, metric providers never exported. Each passed its unit tests
while doing nothing.

Mitigation is not a cleverer abstraction — it is a test per generator asserting
the recorder is **called**, and an integration test that reads the rows back.

## 3. What the corpus will actually look like

The three shapes differ in how checkable they are, and the honest answer is not
uniform:

| Generator | Citation carried | Expected states |
|---|---|---|
| **minutes** | `citation.quote` — a **verbatim quote** from `rawText` | genuinely checkable; real `verified` rows |
| **propositions** | `sourceStart`/`sourceEnd`, plus `sourceQuote` only under #1212's contract | mostly `unverified` — production still requests the offsets template (§6.3) |
| **representatives** | `sourceField` dot-path or `sourceHint` prose — never text offsets | `unsourced` (`origin: 'training'`) or `unverified` (`origin: 'source'`) |

Minutes is the correction to my own earlier assumption that dual-write would
produce a uniform wall of `unverified`. It will not: minutes claims quote their
source, so they are the one family the gate can actually verify today. That
also makes them the first real read of whether `MIN_SUPPORT = 0.3` is set
sensibly against live data rather than harness fixtures.

Representative bios will never verify, and that is not a defect to fix here:
bio claims cite *structured fields*, not text. There is no source text to
locate a quote in. `unsourced` vs `unverified` keeps the difference legible,
which is what #1208 asks for.

## 4. Two gaps this issue exposes in merged work

### 4.1 A quote with no stored span currently lands `snapped`

`verifyQuoted` computes `moved = spanStart !== located.start || spanEnd !== located.end`.
Minutes evidence has **no span at all** (`null`), so `null !== 34` is true and
every supported minutes claim would be recorded as `snapped` — "the citation
was moved" — when nothing was moved. The claim never pointed anywhere to be
corrected from.

That would systematically understate verification for the one family that can
be verified, and `snapped` is a state we will show citizens. Fixed here rather
than left: when there was no stored span, a located and supported quote is
`verified`, with the located offsets recorded as the derived span. That is
precisely #1212's quote-then-locate contract — offsets are *derived* from the
quote, never asserted.

### 4.2 Minutes has no source-text hash

`Proposition` has `fullTextHash` (Postgres-generated) and
`analysisSourceTextHash` (#1279). `Minutes` has `rawText` and **neither**. So a
minutes summary cannot currently be told stale.

Not solved here — that is #1279's shape applied to a second table, and it wants
its own issue. What dual-write does is hash `rawText` at write time into
`evidence.sourceTextHash`, which is correct (the summary was generated from
that text) and is what makes future staleness detectable at all. Filed as a
follow-up.

## 5. `Claim.confidence` is the wrong type

The column is `Float?`. All three generators report an **ordinal** —
`'high' | 'medium' | 'low'`. Writing 0.9/0.6/0.3 fabricates precision the model
never expressed, in a column whose own comment says it is "recorded, never used
as a substitute for verification."

Changed to `String? @db.VarChar(10)`. This is a type change on an existing
table, which the additive-only rule exists to prevent — it is safe here for
reasons that must hold, and are checked, not assumed:

- the table was created in #1291 and **#1293 is its first writer**;
- verified empty: absent from dev `postgres` (migration not applied), 3 rows in
  `postgres_test` from the #1292 integration test;
- nothing reads `Claim.confidence` anywhere in the repo.

If any of that stops being true before merge, the fallback is a new
`confidence_label` column and leaving the float unused.

## 6. Subtasks

| # | Work |
|---|---|
| **S1** | `claim-normalisers.ts` — three pure functions mapping each JSONB shape to a common claim + citation shape. Shared, because #1294's backfill needs exactly this mapping and reimplementing it is how the harness and gate drifted before (#1212, #1292) |
| **S2** | `ClaimRecorderService` — normalise, run each citation through `verifyEvidence`, write `Claim` + `Evidence` + `ClaimEvidence` in one transaction |
| **S3** | Wire the three generators, each inside a try/catch so a recorder failure cannot lose the analysis (AC 4) |
| **S4** | Migration: `Claim.confidence` → varchar |
| **S5** | Tests — per-generator "the recorder was called", states come from the gate, a recorder failure still persists the blob, and an integration test reading rows back per subject family |

## 7. Out of scope

- **No read-path cutover.** The JSONB blob stays authoritative and unconditional; nothing reads the new tables yet. That is #1296.
- **No backfill** of existing rows (#1294).
- **No minutes source-text hash** (§4.2) — follow-up issue.
- **No quoted-template promotion** (§6.3 of the roadmap) — owner's decision, and the thing that would move propositions off `unverified`.

## 8. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Dual-write wired but never called — the milestone's recurring failure | **high** × likely | Per-generator test asserting invocation; integration test reading rows back. Unit tests that construct the service directly are blind to this |
| A recorder failure loses the analysis | **high** × possible | Blob write first, recorder in try/catch after, failure logged and swallowed. Explicit test that a throwing recorder still persists the blob |
| Normaliser and #1294's backfill drift, producing two claim corpora that disagree | **high** × likely | One implementation, shared now, before the second consumer exists |
| Minutes claims recorded as `snapped` en masse, understating verification | medium × certain if unfixed | §4.1 — fixed in the gate as part of this issue, with a test |
| `confidence` type change hits a non-empty table | medium × rare | Emptiness verified in both databases and re-checked before merge; documented fallback in §5 |
| Dual-write doubles write volume on the generator hot path | low × possible | One transaction per subject, not per claim; generators already run at LLM speed, which dominates by orders of magnitude |
| Claim text duplicated into a second table increases #1263 contact-detail exposure | low × possible | Same data, same service, same classification; no new egress and no new API surface until #1296 |

## 9. Effort

~1 focused session. The normalisers and recorder are mechanical; the judgement
is in §4.1 and §5.
