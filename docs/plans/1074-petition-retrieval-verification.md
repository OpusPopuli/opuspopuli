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

#### 1. Measure OCR coverage on the cropped image
**Ships no code.** Output is a comment on #1074.

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

**Redistribution:** the SoS sample is a government document; the Voter-ID
petition is Reform California campaign material — the measure text is public
record, the layout is theirs. Settle redistribution before either lands in this
AGPL-3.0 repo as a fixture.

### Phase A — verify and label

#### 2. Corpus embedding column + backfill
**Package:** `packages/relationaldb-provider`

Migration (additive): `propositions.embedding vector(1536)` nullable, plus an
`ivfflat` index. At 52 rows an exact scan is fine today; the index goes in
because there is no ANN index precedent anywhere in the repo to inherit later,
and adding it under load is worse than adding it now.

Backfill script embeds `full_text` for all 52 rows (100% have it). Idempotent
and re-runnable — write only where `embedding IS NULL` or the source hash
changed.

**Tests:** migration applies cleanly to `postgres_test`; backfill is idempotent
across two consecutive runs.

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

#### 5. Verdict provenance
**Service:** `documents`

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
