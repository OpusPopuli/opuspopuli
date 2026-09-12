# #1156 — Embeddings hard cutover to nomic v2-moe (roadmap R1)

- **Issue:** OpusPopuli/opuspopuli#1156 (epic #1152) — **scope superseded, see §0**
- **Roadmap:** `docs/plans/ai-architecture-roadmap.md` §R1 (revised 2026-09-11, owner)
- **Date:** 2026-09-11
- **Author:** Rodney Gagnon
- **Branch:** `feat/embeddings-hard-cutover-1156`
- **Data classification:** None new. Vectors derive from published AG filings and
  bill text. `documents.embedding` derives from scanned petition OCR (third-party
  PI) — that column already exists and its handling is unchanged here; no new
  at-rest copy of user text is introduced (the column exists precisely so
  `IVectorDBProvider`'s `content` copy is not made).

## 0. What changed, and what this plan supersedes

#1156 and `docs/plans/SPEC-bills-propositions-search.md` §Semantic leg both
specify a **coexistence** design: parallel 768-dim `search_embedding` columns
behind a second `SEARCH_EMBEDDING_PROVIDER` DI token, with MiniLM-384 left live
on `propositions.embedding` / `documents.embedding` until a later M5.

The owner revised this on 2026-09-11 to a **hard cutover**. The justification is
measured, not stylistic:

| Store                                        | Embedded in prod |
| -------------------------------------------- | ---------------- |
| `propositions.embedding`                     | 64               |
| `documents.embedding`                        | 0 / 10           |
| `default_embeddings_vectors` (knowledge RAG) | 0 rows           |

64 vectors total, re-embedding in ~300ms. Every coexistence mechanism existed to
keep two models running while a corpus migrated. There is no corpus to migrate.

Consequently:

- **#1156 prerequisite 1 (the stated BLOCKER — a second named DI token) is
  deleted.** It blocked coexistence, not the switch.
- **#1156 prerequisite 2 (the dimension-map ternary) stands** and is in scope.
- **#1156 prerequisite 3 (task prefixes) stands** as configurable, default off —
  measured as within noise on this corpus.
- ~~`MIN_VERIFIED_SIMILARITY = 0.50` recalibration is **out of scope**~~ —
  **WRONG, corrected 2026-09-11 by measurement. See §C.1.** The reasoning was
  "a path that has never run cannot regress", which is true of production
  behaviour and false of the constant: 0.50 is a MiniLM-space number, and under
  both replacement models it is wrong — in opposite directions. Slice C binds
  the threshold to its model and fails closed.

## 1. Facts established by reading the code (2026-09-11)

| Fact | Location |
| --- | --- |
| `EMBEDDING_DIMENSIONS = 384`, one shared constant, 5 call sites + 4 test sites | `packages/common/src/embeddings-dimensions.ts` |
| Startup width assertion (fail-loud, keep) | `proposition-embedding.service.ts:29` |
| Write-side width validation | `proposition-embedding.service.ts:184` |
| Read-side width validation | `retrieval.service.ts:155` |
| Ollama provider embeds **one text per call** via legacy `/api/embeddings` | `ollama.provider.ts:~123` |
| Dimension inference is a two-model ternary, returns 768 for anything unknown | `ollama.provider.ts:44` |
| Provider default model already corrected to `nomic-embed-text-v2-moe:latest` | #1231 (merged into this branch) |
| `propositions.embedding` is `vector(384)`, HNSW `vector_cosine_ops` | `20260829000000_embedding_dimensions_384` |
| Width changes are done as DROP + ADD (pgvector cannot ALTER a dimension) | same migration |
| Migrations live in `packages/relationaldb-provider/prisma/migrations`, **not** `supabase/migrations` | — |

### 1.1 A trap neither the roadmap nor #1156 names

`default_embeddings_vectors` is **not** created by a migration. The provider
creates it at service init:

```
CREATE TABLE IF NOT EXISTS "default_embeddings_vectors" ( ... embedding vector(${dimensions}) ... )
```
— `packages/vectordb-provider/src/providers/pgvector.provider.ts:69`

with `dimensions` from `VECTORDB_DIMENSIONS` (default **384**,
`packages/config-provider/src/configs/vectordb.config.ts:9`).

The table already exists at `vector(384)` in every environment. `IF NOT EXISTS`
means raising `VECTORDB_DIMENSIONS` to 768 **silently does nothing to the
existing table** — the knowledge RAG path then fails on first insert with a
pgvector dimension error, at runtime, long after the cutover looks green. The
table holds 0 rows, so the migration drops and recreates it. Without this step
the cutover has a latent failure with no startup signal.

## 2. Slices

Each is an independently releasable PR. Slice A is decision-independent and
starts now.

### A — Provider correctness: batching + explicit dimensions _(no schema, no behavior change at 384)_

1. **Batched `/api/embed`.** `embedDocuments` currently loops `embed()` one text
   per call against the legacy endpoint. Measured cost of that shape: 4671ms to
   embed the 64-doc corpus, vs **739ms batched** — 6× on identical work
   (roadmap §1.2). Mandatory, not optional: every backfill and re-embed pays it,
   and M2 chunking multiplies the call count.
2. **Explicit model → dimension map that throws on unknown** (#1156 prereq 2).
   The ternary returns 768 for `mxbai-embed-large:latest` *with the tag* — wrong,
   silently. Tag-normalized lookup; unknown model is a startup error, not a guess.
3. **Task prefixes behind config, default off** (#1156 prereq 3). `search_document: `
   / `search_query: ` per the model card; `ollama show --template` confirms the
   template is bare `{{ .Prompt }}`, so the application must supply them if used.
   Measured 8/8 both ways, mean margin .160 prefixed vs .168 unprefixed — within
   noise, hence configurable rather than mandatory. `EmbeddingsService` already
   splits `getEmbeddingsForText` from `getEmbeddingsForQuery`; that is the seam.

Tests: batching asserts a single HTTP call for N texts and order-preserving
results; dimension map asserts the tagged-model case and the throw.

### A.1 Measured after slice A (2026-09-11)

Two things surfaced only by running the harness against a real Ollama.

**The recorded R3 baseline is a _prefixed_ run.** Neither the roadmap R3 table
nor #1229's commit message says so. Reproduced here, and the two configurations
differ:

| Run | overall | EN | ES |
| --- | --- | --- | --- |
| `--prefix` (what the baseline recorded) | 21/22 · MRR .977 · margin .1794 | 13/14 · MRR .964 · margin .1542 | 8/8 · MRR 1.000 · margin **.2234** |
| unprefixed (**the production default**) | 21/22 · MRR .970 · margin .1814 | 13/14 · MRR .952 · margin .1554 | 8/8 · MRR 1.000 · margin **.2270** |

The whole difference is one English item (`ret-en-008`) sitting at rank 3
unprefixed and rank 2 prefixed. ES — the axis R1 is justified on — is 8/8 either
way and its margin is marginally *better* unprefixed. This confirms #1156's
"within noise" finding on a second corpus and keeps prefixes defaulted off. It
also means **the R1 exit criterion has to name its configuration**, or the next
comparison silently drifts against a baseline measured differently.

**The endpoints return differently-scaled vectors.** Legacy `/api/embeddings`
returns un-normalized vectors (L2 norm 13.21 on a sample text); batched
`/api/embed` returns them L2-normalized (norm 1.0). Direction is identical —
cosine between the two is 1.000000, and a vector embedded alone vs inside a
batch of 3 also cosines to 1.000000, so batching itself changes nothing.
Harmless for every consumer we have, because all of them rank by cosine
(pgvector `<=>`, and the harness's own `cos`), which is magnitude-invariant.
Worth recording because it would **not** be harmless for a dot-product or L2
ranking, and because a stored corpus will now have a different norm than one
embedded before this change.

### A.2 The harness was measuring a reimplementation

`ollamaBackend` in `packages/eval-harness/src/retrieval-eval.ts` called
`/api/embed` inline with its own task prefixing, while `xenovaBackend` used the
shipped `XenovaEmbeddingProvider`. So #1229's "drives the real embeddings
providers … rather than a reimplementation" held for the MiniLM leg and not for
the nomic leg — the one the R1 decision rests on.

Slice A points it at `OllamaEmbeddingProvider`, which also removes a
double-prefixing trap now that the provider can prefix too, and adds a
declared-vs-actual width assertion at backend construction: the static
dimension map is checked against the model that actually answers. Numbers are
unchanged by the switch (both rows above were reproduced through the provider),
which is the point — it now measures shipped code.

### B — Schema _(widen in place; ships in the same release as C)_

Keep the `embedding` name (decided — §4.1). Per table: drop the HNSW index,
drop + re-add `embedding` at `vector(768)`, recreate HNSW `vector_cosine_ops`
from empty (never IVFFlat — see the `20260828000000` comment), add
`embedding_model`, and `NULL` every `embedding_source_hash` so the next run
re-embeds rather than treating stale rows as current — the trick
`20260829000000_embedding_dimensions_384` already used for this exact reason.

`bills.embedding` is greenfield: add only, no drop.

Plus the §1.1 drop-and-recreate of `default_embeddings_vectors` at 768, which
this slice has to do regardless of naming.

Unlike the other slices this one is **not independently releasable** — a
widened column with a 384 image in front of it is the §4.1 deploy window. B and
C ship together.

### C — Cutover

1. `EMBEDDING_DIMENSIONS` 384 → 768, and the startup assertion becomes
   **three-way**: provider width == constant == the actual `vector(N)` column
   width read from the DB. Today it compares only provider to constant
   (`proposition-embedding.service.ts:29`), which is exactly the check that
   passes in the bad deploy window described in §4.1. The third leg converts a
   per-row write failure into a refuse-to-boot.
2. `VECTORDB_DIMENSIONS` default 384 → 768.
3. Services read/write the new columns; `EMBEDDINGS_PROVIDER=ollama` with
   `nomic-embed-text-v2-moe:latest` in `.env.example` and both compose files.
4. Duplicate-source-hash guard (roadmap §1.4b): the same `embedding_source_hash`
   across different `external_id`s is surfaced, never silently written —
   25-0004A1 and 25-0005A1 are byte-identical today and undetected.
5. Re-embed 64 propositions (seconds).
6. **Re-point the in-process provider at a 768-dim model — do not retire it.**
   The roadmap said "retire Xenova from the embeddings path"; the owner decided
   on 2026-09-11 to keep a zero-setup path (§4.5). Because `EMBEDDING_DIMENSIONS`
   is one global constant and a `vector(N)` column is fixed-width, keeping that
   path means the in-process provider must also produce **768**, or selecting it
   trips the startup assertion and the service refuses to boot. Candidate model
   measured on the R3 harness before this lands — see §4.5.

**Ops precondition:** `ollama pull nomic-embed-text-v2-moe` on the node (957 MB).
Production currently has **no** embedding model — its only one was the stale v1.5,
removed 2026-09-11. The cutover fails closed without this.

### C.1 The threshold was not out of scope — measured 2026-09-11

Regenerating the petition-retrieval fixture under the new model produced this,
on the four-document control corpus:

| | correct match | best **wrong** match | unfiled scan's best |
| --- | --- | --- | --- |
| MiniLM-384 (what 0.50 was calibrated on) | 0.9703 | 0.3876 | **0.3876** → rejected |
| bge-base-768 | 0.9723 | 0.6951 | **0.7577** → **would verify** |

The integration negative control demonstrated it rather than predicting it:

```
Retrieval for document …: best=TEST-NC-0001 similarity=0.7577 verified=true
```

A well-formed initiative **that was never filed** came back `verified`, with a
`DocumentProposition` link written (`confidence: 0.7577, linkSource:
auto_retrieval`) — the platform telling a citizen their petition *is* a
specific measure, wrongly. bge's space is compressed upward (everything lands
0.62–0.97), so 0.50 separates nothing. Under nomic, which is what production
will run, correct matches score 0.4–0.5 (#1156) and the same constant is too
strict instead, verifying almost nothing.

**Decision (owner, 2026-09-11): fail closed, keep the feature dark.** The
threshold now travels with the model it was measured against
(`VERIFICATION_CALIBRATION`), and when the running model is not that one the
service returns the match with `verified: false` and `uncalibrated: true`, logs
a warning, and records a distinct `uncalibrated` metric outcome — deliberately
not counted as `unverified`, because that is a verdict and this is the absence
of one. No link is written.

What this costs: petition verification stays dark. It already was — 0/10 in
production (#1220) — and an `unverified` scan still gets its analysis, just not
a claim about *which* measure it is. Recalibration needs real petitions
re-photographed (scan images are never persisted, by design), so it is its own
piece of work, not a number to invent from four synthetic fixtures. The
rejected alternative was a provisional per-model threshold (~0.90 for bge from
the table above) — rested on 2 synthetic scans where 0.50 rested on 9 real
photographs, and would have left nomic, the model production actually runs,
entirely unmeasured.

### ~~D — Follow-up release: drop the legacy `vector(384)` columns~~ — **deleted**

Reusing the `embedding` name (§4.1) means there is no second column family to
retire. No follow-up drop release, and no window in which a table carries two
vector columns and two HNSW indexes.

### E — Rename the in-process provider _(after the cutover — §4.4)_

`EMBEDDINGS_PROVIDER=transformers`, with `xenova` accepted silently as an alias
so no deployment breaks, and `XenovaEmbeddingProvider` →
`TransformersEmbeddingProvider`. 136 occurrences across 33 files.

Deliberately **after** C, not inside it: it touches the same module and config
lines the cutover rewrites, and a rename folded into a cutover makes the
cutover's diff unreviewable.

While in there, `getDimensionsForModel` in `xenova.provider.ts:52` has the same
defect slice A removed from the Ollama provider — a chain of `includes()` tests
ending in `return 384; // Default`, so an unrecognised model silently
mis-declares its width. Same explicit-map-that-throws treatment.

One thing a rename cannot reach: the model ID `Xenova/all-MiniLM-L6-v2` is a
real Hugging Face repo path and stays as it is.

## 3. Exit criteria (roadmap R1)

- One embedding model in production.
- ES holds **8/8 with margin near 0.223** on the R3 harness (`packages/eval-harness`,
  shipped in #1229) — this is the gate, run before and after.
- Spanish query → English measure demonstrated in prod.
- ~~Old `vector(384)` columns dropped in the following release.~~ Not applicable: widened in place (§4.1).

**Rollback:** re-embed 64 rows with MiniLM (~300ms) while the old columns still
exist. Cheaper than the machinery it replaces.

## 4. Open decisions

### 4.1 Column naming — **DECIDED 2026-09-11: keep `embedding`, widen in place**

An earlier draft of this plan recommended `search_embedding`, following the
naming in #1156 and the SPEC. That was wrong, and the reason it was wrong is
worth recording: it followed the *published convention* rather than what the
column is for. Every consumer that exists today is something other than search.

| Column | Written by | Read by | Purpose |
| --- | --- | --- | --- |
| `propositions.embedding` | region `PropositionEmbeddingService` | documents `retrieval.service.ts:176` | petition scan → measure **verification** (#1074) |
| `documents.embedding` | documents `retrieval.service.ts:170` | nothing yet | the scan's own vector |
| `default_embeddings_vectors` | knowledge `knowledge.service.ts` | `pgvector.provider.ts:214` | **RAG** retrieval |

Search is the one consumer that does not exist yet — the semantic leg is #1157,
unstarted. `search_embedding` would have mislabelled all three live consumers to
match the one that is still hypothetical. `embedding_768` was the other
candidate and puts the width in a name that outlives the migration justifying it.

**The decision is to keep `embedding` and widen it in place**, adding
`embedding_model` alongside the existing `embedding_source_hash`.

#### The one real cost, stated plainly

Widening in place **couples the image to the schema for the deploy window**.
With a new column name, an old image keeps working against the old column and
rollback is free. Here, with an old image (384/xenova) against the new schema:

- Region **boots fine**. The startup assertion compares provider width to
  `EMBEDDING_DIMENSIONS` — both still 384. It never looks at the column.
- `writeVector` then sends a 384-element literal: `ERROR: expected 768
  dimensions, not 384`, caught per row → `failed=64, embedded=0` in the log.
- `retrieval.service` compares a 384 query vector against a 768 column:
  `ERROR: different vector dimensions`, caught, scan degrades to `unverified`.

Blast radius: proposition embeddings stop being written, and petition
verification — already 0/10 dark in production (#1220) — stays dark. Fail-loud,
no corruption, nothing silently wrong.

**Mitigation, in slice C:** make the boot assertion three-way — provider ==
`EMBEDDING_DIMENSIONS` == the actual `vector(N)` column width from the DB. The
existing two-way check is precisely the one that passes in this window. The
third leg turns a per-row failure into a refuse-to-boot, which is how this
codebase fails everywhere else.

#### The costs that turned out not to matter

- **No mixed-state.** Two columns would let both vector spaces coexist for an
  A/B. Worth nothing at 64 rows and a ~300ms re-embed.
- **Additive-only (CLAUDE.md).** Violated in the letter: a populated column is
  dropped. But `20260829000000_embedding_dimensions_384` set this precedent for
  the same reason (pgvector cannot `ALTER` a dimension), the data is
  reconstructible from `title + summary` which we still hold, and the documented
  rollback is a re-embed either way.

#### What it buys

- **Slice D disappears** — no follow-up drop release, and no window where a
  table carries two vector columns and two HNSW indexes.
- The diff collapses to the width constant plus `embedding_model`; every call
  site keeps its name.
- `default_embeddings_vectors` has to be dropped and recreated regardless
  (§1.1 — `IF NOT EXISTS` cannot widen it). Reuse makes all three stores
  consistent instead of making that one an exception.
- No permanently misnamed column.

### 4.2 #1156 and the SPEC still describe the superseded design

Whoever picks up #1157 next reads a BLOCKER that no longer exists and a
coexistence design that was deleted. Needs an edit to the issue scope and a
dated correction to the SPEC's §Semantic leg item 1.

### 4.3 Ordering against #1230 (search telemetry)

The roadmap ledger wants #1230 landed **before** R1, to attribute R1's +73ms
per query. R1 is not blocked on it, but without it the latency change is
unmeasured in production.

### 4.4 "Xenova" as a provider name — **DECIDED 2026-09-11: rename, after the cutover**

The name says who packaged the library, not what the provider does. "Xenova" is
a Hugging Face *user handle* — the person who ported transformers to JS — and
upstream has since renamed the library itself: `@xenova/transformers` v2 became
`@huggingface/transformers` v3. This repo is pinned to `^2.17.2`, so the naming
follows a package name upstream has retired.

What the selector actually distinguishes is **in-process CPU inference** from
`ollama`'s external server. `transformers` says that; `xenova` says a username.

Sequenced as slice E, after the cutover.

### 4.5 The zero-setup path — **DECIDED 2026-09-11: keep it**

R1 as written ends with "retire Xenova from the embeddings path". The owner kept
it instead, and the reason is a product property rather than a preference: after
the cutover the default embeddings path needs a running Ollama server with a
957 MB model pulled. For an AGPL project other people are meant to be able to
run, "clone it and go" is worth preserving.

**The consequence, which R1 did not name.** `EMBEDDING_DIMENSIONS` is a single
global constant and pgvector columns are fixed-width, so there is no
per-deployment width. Keeping the in-process path therefore requires an
in-process model that produces **768** — not 384. `xenova.provider.ts` already
knows two 768-dim families (`all-mpnet-base-v2`, `bge-base`), so this is a model
choice, not an architecture change.

It is a choice with a known cost: ES parity is the entire justification for
nomic, and the obvious 768 candidates are English-only. Measure on the R3
harness before choosing, and **state the result in the docs** — a zero-setup
path that quietly fails Spanish is worse than one documented as English-only.
