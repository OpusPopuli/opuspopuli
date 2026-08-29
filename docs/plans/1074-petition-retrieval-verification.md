# Plan: Petition retrieval verification

| | |
|---|---|
| **Issue** | [#1074](https://github.com/OpusPopuli/opuspopuli/issues/1074) — Verify scanned petitions against the filed record, and analyze the filed text |
| **Date** | 2026-08-28 |
| **Author** | Rodney Gagnon |
| **Branch** | `feat/petition-retrieval-verification-1074` |
| **Data classification** | **`ca-personal-information`** (CCPA/CPRA). Active families `us-state-privacy` + `soc2` per `.claude/compliance-profile.yaml`. `hipaa` inert. Two new derived-data flows — see *Data classification detail*. |
| **Migrations** | One, additive: `propositions.embedding vector(1536)` nullable + index. No drops, no renames. |
| **Federation** | Analysis DTO gains optional fields only — additive. Gateway validation still required. |
| **Dependencies** | None new. `@opuspopuli/embeddings-provider` and `@opuspopuli/vectordb-provider` already exist. No AGPL-3.0 conflict. |

## One line

Identify which filed measure a scanned petition is, by retrieval rather than
substring matching, and say plainly whether the user is looking at an analysis
grounded in the filed record or a reading of the photograph alone.

## Why this is not a refusal gate

The issue as originally written required refusal when nothing matched: *"no
analysis is produced — no summary, no characterization, no hedged guess."* That
is dropped, and the criteria were rewritten on 2026-08-28 to match.

The issue contradicted itself. The criteria demanded refusal while the
hard-parts section observed that the asymmetry argument *"is sound for fakes and
does not transfer to unfiled measures"* and asked for a third outcome. A hard
gate is a dead end for every local, county and municipal petition — measures
that have no Secretary of State filing and never will. The moment this product
exists for is someone standing at a signing table, and "check the SoS site" is
the right answer for a fake and a poor one for a real county measure.

**What that costs, recorded so nobody rediscovers it as a surprise.** Retrieval
cannot separate "a real local measure we do not hold" from "a fabricated sheet".
Both are simply absent from the corpus. Refusal was the anti-fake property, and
it is gone. What replaces it is **disclosure, not detection** — we do not claim
to identify fakes, we state clearly when we could not verify. The label carries
that entire weight, which is why the label is the deliverable and not a UI
nicety, and why the negative-control test weakens from *"no analysis produced"*
to *"never `verified`"*.

## Corpus reality (measured 2026-08-28, against production)

Checked before planning, because several of the issue's assumptions did not hold.

| | |
|---|---|
| propositions in corpus | **52**, and **all 52 have `full_text`** |
| circulating-style AG numbers (`25-0007`) | **45** |
| already-amended versions (`A1`) | **30** |
| base + amended coexisting for one measure | **0** |
| filed text length | min 1,754 · **median 14,360** · max 115,077 chars |
| our 8 real scans | min 461 · **avg 1,213** · max 2,464 chars |

1. **The corpus already covers circulating petitions**, not only qualified
   propositions. `25-0007A1` — the Voter-ID petition examined from the PDFs — is
   in it with 4,636 chars. Retrieval has something real to match against; the
   missing piece is the embedding pipeline, not the data.
2. **The amendment-ambiguity case does not currently exist.** Zero
   base/amended collisions: one row per measure, already the amended version
   where amended. The issue calls this *"the case that sets the threshold"* —
   confirm it is still true before building machinery for it.
3. **A photo yields roughly 8% of a median measure's text** (1,213 vs 14,360).

Point 3 corrects an earlier comment of mine on #1074, which argued from
`25-0007A1` that a single photo captures the whole measure and therefore *"the
original framing overstates the gap"*. That petition is unusually short; the
median filing is three times longer. The gap is real for typical measures, and
Phase B is worth more than I said. Caveat: those 8 scans are one person's test
shots and only one is post-crop, so this **motivates** subtask 1 rather than
replacing it.

## How #1075 changed this issue's inputs

#1074 was written 2026-08-27. The on-device crop shipped 2026-08-28 and keeps
only the **top 55%** of the detected page.

- **Helps retrieval.** The top of the sheet is the AG circulating title and
  summary — the identifying header worth matching on.
- **Hurts the fallback.** There is less operative text in the photo than when
  this issue was written.

Any OCR-coverage measurement must therefore run against the **cropped** image.
Measuring the full frame measures an input we no longer ship.

#1075 also settles the embedding question the issue flagged: stored
`extractedText` is cropped on-device and scrubbed server-side, so embedding it
creates no new signer-PII derivative at rest.

## Decisions taken

1. **Fall back, do not refuse.** Below threshold, analysis runs from
   `extractedText` exactly as today, labelled.
2. **Four verdict states**, extending #1057's closed enum rather than replacing
   it: `verified` · `unverified` · `not_a_petition` · `unreadable`.
3. **No second structural gate.** #1057's `not_a_petition` classification is
   left exactly as it is. We do not add a "does this look officially formatted"
   check before offering `unverified`. It would be an imperfect fabrication
   detector bolted onto a feature that has already given up on detection, and
   two overlapping gates are harder to reason about than one.
4. **The `unverified` copy is fixed** (below). It was written to fail safe in
   both directions rather than to read well in one.
5. **Scans embed to `Document.embedding`, never through `IVectorDBProvider`.**
   The pgvector provider persists `content` alongside each vector; routing scan
   text through it would create a second at-rest copy of user text.

### The `unverified` copy

> We couldn't match this to a filed state measure. It may be a local or county
> petition, or it may not be on file — we're reading the page in front of you,
> not an official record.

Longer than a UI string wants to be, deliberately. It has to be true when the
sheet is a real county measure *and* when it is fabricated, and it must not
imply we checked and found it legitimate. Spanish must preserve that balance,
not just translate the words.

## Subtasks

### Phase A prerequisite

#### 1. Measure OCR coverage on the cropped image — **DONE 2026-08-29**
**Shipped no code.** Findings recorded on #1074.

Photograph the two known petitions — the SoS sample and 25-0007A1 — under
realistic conditions (angle, glare, clipboard, indoor light, partial page). Run
the shipped capture path and diff the extraction against the known text.

Produces the numbers everything downstream depends on:

- What fraction of measure text survives OCR **after the crop**?
- Does the identifying header (AG number, circulating title) survive reliably
  enough to retrieve on?
- How does recovery degrade with measure length?

**This is a gate, not a formality.** If the header does not survive, subtask 4's
design changes from whole-text similarity to header-anchored matching, and
building 4 first would be building the wrong thing. Testing against a PDF text
layer measures nothing — the artifact must be a photograph of a printed sheet.

##### Results

Nine photographs of the printed Voter-ID petition (25-0007A1), varied
deliberately — table, clipboard, square-on, steep angle, good light, dim — each
run through `analyzeFrame` → `deskewImageData` → the #1075 crop → Tesseract.
Ground truth is page 2 of the filing, 11,721 chars. Detection was never the
problem: 9/9 detected at confidence 1.0, coverage 0.88–0.96.

**The crop is validated as a privacy control.** Signature-block markers appeared
in 4/9 full frames and **0/9 crops**. Not what the measurement was for, and the
most reassuring thing in it.

**Recovery is bimodal, and OCR confidence predicts it.** Confidence 80–81 gave
100% title overlap and the AG number; confidence 72 gave 18%; the six below 70
gave 0–9%. It is not that the header is hard to read — when the photograph is
good the header comes through completely, and when it is not, nothing does.
There is no middle case and no case where body text survived but the header did
not. Best crop recovered 5,420 chars, 46% of the page.

**This vindicates subtask 2's `title + summary` decision** rather than
overturning it. Every crop that recovered anything usable recovered the title
in full. No re-embed needed.

**Exact-identifier matching is dead.** `25-0007A1` came through as `(25000781)`
— hyphen dropped, `A1` read as `81` — on the best photograph in the set. Fuzzy
matching over the title is required, which is what subtask 2 built.

**Caveat on evidence weight.** Nine photographs of one petition by one person.
Enough to settle the gate and to kill exact-identifier matching; not enough to
fix a production threshold with confidence. The constants below are named and
telemetered so they can be tuned on real traffic.

**Redistribution:** the SoS sample is a government document; the Voter-ID
petition is Reform California campaign material — the measure text is public
record, the layout is theirs. Settle redistribution before either lands in this
AGPL-3.0 repo as a fixture.

### Phase A — verify and label

#### 2. Corpus embedding column + backfill — **DONE**
**Package:** `packages/relationaldb-provider`, service in `region`

Two corrections were made while implementing, both from measuring first:

**HNSW, not IVFFlat.** IVFFlat trains centroids from the data present when the
index is built. Built against the empty column this migration leaves behind, it
is degenerate and must be dropped and rebuilt after the backfill — a cleanup
step someone will forget. HNSW builds incrementally and is correct from empty.
Production runs pgvector 0.8.2, so it is available. `vector_cosine_ops`.

**Embed `title + summary`, not `fullText`.** Measured: 13 of the 52 filed
measures exceed a typical 8k-token embedding window, so a single embedding call
would silently truncate a quarter of the corpus. And a 14,000-character filing
averaged into one vector is not comparable to the ~1,213 characters a photograph
actually yields. Title plus summary is present for all 52, runs 47–609 chars
(median 385), and is the same artefact the scan captures — the AG circulating
title and summary sit at the top of the sheet, which is what #1075's crop keeps.
If subtask 1 shows the header does not survive photography this changes, and
`embeddingSourceHash` makes it cheap: changing the source function changes every
hash, so the next run re-embeds the corpus with no manual cleanup.

`embedding_source_hash` landed in the same migration rather than a second one
for subtask 3 — sync runs often and `fullText` rarely changes, so without it
every sync re-embeds all 52 rows to produce identical vectors.

**Delivered:** migration `20260828000000_proposition_embeddings`,
`PropositionEmbeddingService`, `backfill-proposition-embeddings.ts`, 11 unit
tests, 5 integration tests.

**One bug the integration test caught that nothing else could.** `propositions.id`
is Prisma's `String @id @default(uuid())` with no `@db.Uuid`, so the column is
TEXT. The raw-SQL write cast the parameter to `::uuid`, producing `text = uuid`,
which Postgres refuses (42883). It compiled cleanly and the mocked unit tests
passed — only a real pgvector column surfaced it.

#### 3. Keep the corpus fresh
**Service:** `region`

Re-embed when `full_text` changes on sync. Store a content hash so unchanged
text is not re-embedded on every sync — the embedding call is the expensive part
and syncs are frequent.

**Tests:** integration — changed text re-embeds; unchanged text does not.

#### 4. Retrieve before analyzing
**Service:** `documents`. New `RetrievalService`.

Embed `extractedText` into `Document.embedding`, cosine-match against the
proposition corpus, return the top candidate with a **real** score. Runs
**before** the analysis prompt. At this subtask it changes no behaviour — it
only produces a score — so it can land and be observed before anything depends
on it.

**Tests:** unit on scoring and ordering; integration against a real database
with seeded propositions (never mock the DB layer).

#### 5. Verdict provenance — and an OCR-quality gate folded in
**Service:** `documents`

**Folded in from subtask 1's findings:** the existing `unreadable` gate measures
quantity, not quality. It is `extractedText.length < 80`. One photograph in the
measurement produced 3,142 characters of pure OCR noise — 39× the threshold — so
it passes the gate and reaches the LLM as though it were readable text. All nine
crops pass; only two are matchable. `documents.ocrConfidence` is already
captured on every scan and stored, and is used for nothing.

Two named constants, two different decisions:

- `MIN_ANALYZABLE_OCR_CONFIDENCE` — below this the scan is genuinely unreadable
  and gets the existing `unreadable` verdict rather than an LLM analysis of
  noise. Measured basis: confidence 31–47 produced 0–9% title overlap.
- `MIN_RETRIEVAL_OCR_CONFIDENCE` — below this, retrieval is not attempted at
  all, because matching noise against the corpus yields arbitrary near-matches
  and a similarity threshold alone cannot tell a weak genuine match from a
  confident match on garbage. Measured basis: ≥80 gave 100% title overlap, <70
  gave 0–9%.

Set conservatively and telemetered. Nine photographs of one petition is not
enough evidence to be aggressive with a gate that refuses real scans.

Above threshold → `verified`, with the matched proposition and its real score.
Below → `unverified`, and analysis proceeds from `extractedText` exactly as it
does today.

Replaces the hardcoded `confidence: 0.8` at `linking.service.ts:67` with the
computed score. That constant is the reason this issue exists: nothing
downstream depended on the match being right, which is precisely why a constant
could sit there unnoticed.

Analysis DTO gains optional `verificationState` / `matchedPropositionId` /
`matchScore` — **additive, federation-safe**, but the gateway must still
validate composition.

**Tests:** a negative-control fixture — a well-formed initiative that was never
filed — returns `unverified` and never `verified`, with the test stating in a
comment why this is weaker than the original criterion. `not_a_petition` and
`unreadable` unchanged.

#### 6. Frontend states and copy
**App:** `apps/frontend`, both locales

Render the four states. The `unverified` copy is fixed above; Spanish must
preserve the balance rather than translate literally.

**Tests:** unit per state; a11y; `--project=mobile-safari` before commit — this
surface is phone-first.

#### 7. Threshold and telemetry

The threshold becomes a named, documented constant with its tuning basis
recorded in this file. Telemetry captures the score distribution so the constant
can be revisited on evidence.

**Log ids and scores only. Never candidate text, never scan text.**

### Phase B — analyze the filed text
*Separate PR. Gated on subtask 1's numbers.*

#### 8. Retrieval-grounded analysis
When `verified`, feed the matched filing's `full_text` to the analysis prompt
instead of `extractedText`.

The new template lives in the **private `prompt-service` repo** and is consumed
via `@opuspopuli/prompt-client`. No prompt text lands in this repo, even
temporarily.

Justified by the 8% coverage figure, but separable: Phase A ships the
verification and the honesty on its own, and if subtask 1 shows OCR recovers
most of a typical measure, Phase B's value drops sharply and it should be
re-argued rather than assumed.

## Data classification detail

**Scan embedding.** Derived from `extractedText`, which post-#1075 is cropped
on-device and scrubbed server-side, so it should carry no signer names or
addresses. Written to the existing `Document.embedding` column — **not** through
`IVectorDBProvider`, which persists `content` alongside each vector and would
create a second at-rest copy of user text. Embed the stored text, never any
pre-scrub value.

**Corpus embedding.** Public filed text. No personal information. The provider's
content storage is unproblematic here.

**Retrieval logging.** Ids and scores only.

**Inference stays self-hosted.** No scan text reaches a third party. That
posture must not change to make retrieval easier.

## Risk register

| Risk | Rating | Mitigation |
|---|---|---|
| Confident analysis of the **wrong** filing — both wrong and authoritative | **critical × possible** | Threshold from a measured distribution, not judgement; `unverified` is the safe landing place rather than silence; negative-control fixture |
| `unverified` copy reads as reassurance when the sheet is fabricated | **high × likely** | Copy fixed in this plan and written to fail safe in both directions; Spanish reviewed for balance, not literal translation |
| Scan text copied into the vector store's `content` column | **high × possible** | Decision 5: `Document.embedding` directly, never `IVectorDBProvider`, for scans |
| OCR header does not survive the crop, so retrieval cannot anchor | **high × possible** | Subtask 1 is a gate; subtask 4's design changes if the header is lost |
| Building amendment disambiguation for a problem the data does not have | medium × likely | Corpus shows **0** base/amended collisions; confirm in subtask 1 before any machinery |
| Migration against a live `propositions` table | medium × rare | Additive nullable column only; no drops or renames; `postgres_test` first |
| Re-embedding the whole corpus on every sync | medium × likely | Content hash in subtask 3 |
| New dependency introduces GPL | low × rare | No new dependencies — both providers already exist |
| Regulated data reaching logs during tuning | medium × possible | Ids and scores only, asserted in review |

## Effort

| | |
|---|---|
| Subtask 1 | half a day — physical photography, not desk work |
| Subtasks 2–5 | ~2 days |
| Subtask 6 | half a day, mostly copy |
| Subtask 7 | half a day plus tuning time |
| **Phase A** | **3–4 days** |
| Phase B | 1–2 days, spanning two repos |

## Out of scope

- Restoring or changing the petition map (#1073 unlinked it; the route stays).
- Re-analyzing historical scans. Existing analyses stay as they are unless
  `forceReanalyze` is used.
- Any change to `not_a_petition` / `unreadable` from #1057 — decision 3.
