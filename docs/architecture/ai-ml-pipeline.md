# AI/ML Pipeline Architecture

## What this document is

The **intended end state** of the Opus Populi AI pipeline, with an honest
status marker on every layer. It replaces an earlier version that described
only the generic RAG slice; the pipeline it describes now is the civic
evidence pipeline the platform is converging on.

Status legend (as of 2026-09): ✅ shipped · 🟡 partial · ⬜ planned.
A layer marked ⬜ is a design commitment, not a description of running code.

## Governing constraint

The model is never the source of truth. Trust comes from the system around
the model — evidence, provenance, deterministic validation, adversarial
review, versioned history, open methodology — so that **any model is
replaceable** and no answer asks for the model's authority.

> The AI says: *here is what I found.*
> The evidence layer says: *here is where it came from.*
> The verification layer says: *here is why this claim is supportable — or
> why it isn't.*
> The citizen decides.

Two operating rules fall out of this:

1. **Deterministic code does what deterministic code can do.** Arithmetic,
   citation existence, offset anchoring, hash integrity, numeric consistency,
   schema validity are software problems — never delegated to an LLM.
2. **Every consequential factual claim requires evidence before
   publication.** Missing evidence means reject, downgrade, or label —
   never silently publish.

## The pipeline

```
        SOURCE INGESTION  ✅                 (scraping pipeline, scans, uploads)
                │
        NORMALIZATION / OCR  ✅              (Tesseract, extraction, scrubbing)
                │
        IMMUTABLE SOURCE STORE  ⬜           (content-addressed SourceVersion:
                │                            SHA-256 of fetched bytes, append-only)
                ▼
        EVIDENCE GRAPH  🟡                   (Claim / Evidence / ClaimRelation,
                │                            spans pinned to source versions)
                ▼
   ┌── HYBRID RETRIEVAL ──┐
   │  lexical ⬜   vector ✅│                (Postgres FTS + pgvector, merged)
   └───────────┬──────────┘
        RERANKING  ⬜                        (cross-encoder over merged candidates)
                │
        CIVIC REASONING (LLM)  ✅            (Ollama; structured output ⬜)
                │
   ┌────────────┴────────────┐
   ▼                         ▼
 DETERMINISTIC          ADVERSARIAL
 VERIFICATION  🟡       REVIEW  ⬜           (second pass attacks Level 2+ output)
   └────────────┬────────────┘
                ▼
        PUBLICATION / RENDERING  ✅          (application renders; model never
                │                            writes to the public surface)
                ▼
        CITIZEN  +  SOURCE CITATIONS

  spine: PROVENANCE (prompt hash/version, model, source refs, timestamps) 🟡
  alongside: EVALUATION HARNESS + CIVIC BENCHMARK ⬜   ·   HITL FEEDBACK ⬜
```

## Risk tiers

Not every civic question deserves the same machinery. Verification and review
scale with consequence:

| Level | Example | Treatment |
|---|---|---|
| 0 — trivial | election date | automated |
| 1 — factual | sponsor identity | automated + citation |
| 2 — consequential | taxpayer cost | multiple sources + deterministic validation |
| 3 — interpretive | who benefits? | multiple sources + adversarial review |
| 4 — contested / value-laden | "is this good for working families?" | **no single verdict**: what the measure does, proponents' arguments, opponents' arguments, evidence, uncertainty |

## Layers

### Source ingestion — ✅ shipped

`@opuspopuli/scraping-pipeline` (five source types: bulk download, API, PDF,
PDF archive, HTML scrape) with throttling, retry/backoff, circuit breakers,
ingestion watermarks, and self-healing structural manifests. Citizen-side:
camera scans and uploads into the documents service. This layer is kept
as-is; new layers attach to it.

### Normalization / OCR — ✅ shipped

Tesseract (`@opuspopuli/ocr-provider`) with preprocessing/deskew; aggregate
confidence gates analysis and retrieval. Signature scrubbing on petition
scans is a deliberate lossy privacy step. Scan images are **never stored** —
privacy is architectural and outranks completeness for user-submitted
material.

### Immutable source store — ⬜ planned

Every *fetched civic artifact* (HTML, PDF) gets a content-addressed
`SourceVersion`: SHA-256 of the raw bytes, fetch timestamp, HTTP validators,
source URL, and the manifest/execution that fetched it. Append-only —
re-fetch creates a new version, never overwrites. This is the foundation
that lets a claim cite *the exact text version it was derived from* and lets
the system answer "what did we know about this measure on date X."

The store is **two-tier**: sources that claims cite are immutable forever
(content-addressing deduplicates unchanged re-fetches, so cost tracks change,
not fetch frequency); bulk archives (e.g. the ~1GB campaign-finance export)
are kept on a retention schedule, with per-record hashes extracted at ingest
so row-level provenance survives without warehousing every snapshot. Text is
compressed at rest; store size and growth are exported as metrics per tier.

Today, extracted text lives on the entity rows and is updated in place; the
existing `Minutes` revision model (`revisionSeq`/`isActive`, superseded rows
retained) and `StructuralManifest` versioning are the shipped precedents this
layer generalizes.

### Evidence graph — 🟡 partial

End state: relational `Claim` and `Evidence` entities (plus claim↔claim
relations: supports, contradicts, qualifies, supersedes), each `Evidence`
pinned to a `SourceVersion` + character span, with temporal validity. Owned
by the **region service**; other services reference claims through GraphQL
Federation keys. Queryable properties matter more than storage: *"show every
published assertion that lacks primary evidence"* must be a query, not an
audit project.

Shipped today, feeding the design: claim-with-offset structures on
propositions (`analysis_claims` — char spans into `full_text`), minutes
(`summary_claims`), and representative bios (`bio_claims` with
source-vs-training attribution); `LegislativeAction` rows carry
deterministically derived spans re-sliced from stored text at read time.
These are per-entity JSON structures — addressable, joinable claims are the
gap.

### Hybrid retrieval — 🟡 partial (vector ✅, lexical ⬜)

- **Semantic** (✅): pgvector, cosine similarity, HNSW indexing
  (`@opuspopuli/vectordb-provider`, `@opuspopuli/embeddings-provider`).
  Embedding width is fixed by `EMBEDDING_DIMENSIONS` in
  `@opuspopuli/common` and asserted at startup — **switching embedding
  models of a different width is a migration, not an env change** (the one
  place the provider pattern does not hold).
- **Lexical** (⬜): Postgres full-text search — exact identifiers, names, and
  statutory phrases that embeddings blur. No new infrastructure required.
- **Fusion** (⬜): merged candidate set from both legs feeds the reranker.

### Reranking — ⬜ planned

A cross-encoder reranker scores the merged candidate set before generation.
Adopted only on evaluation evidence, not by default; candidate selection is
open, and candidates are held to the same openness/provenance standard that
decided the embeddings model.

Naming note: the existing `llm-rerank-worker` is *not* this layer — it
generates per-item relevance explanations for the personalized feed and does
not reorder retrieval results. The retrieval reranker gets a distinct name.

### Civic reasoning (LLM) — ✅ shipped, structured output ⬜

All inference is self-hosted Ollama behind `ILLMProvider`
(`@opuspopuli/llm-provider`). Swap models via `LLM_MODEL`; no external AI
API is on any request path.

| | Current | End state |
|---|---|---|
| Output contract | free text, hand-parsed JSON | **schema-enforced JSON** (Ollama `format` + per-generator schema validation); parse failures are typed, recorded states — never silent degradation |
| Model identity | tag (`qwen3.5:9b`) | tag **+ digest** pinned and recorded on every output |
| Rendering | application renders ✅ | unchanged — the model never writes to the public surface |

Generated factual claims must reference evidence (see publication invariant);
behavior is defined for missing, conflicting, uncertain, and stale evidence —
reject, downgrade, or label.

### Deterministic verification — 🟡 partial

Software-verifiable properties, verified by software:

| Validator | Status | Notes |
|---|---|---|
| Financial reconciliation | ✅ | detail tables reconciled against publisher-reported totals; six verdicts; over-itemization is a first-class fault |
| Section-offset anchoring | ✅ | LLM-proposed section offsets snapped to real string matches ("LLMs cannot count characters precisely") |
| Deterministic passage spans | ✅ | legislative actions carry regex-derived offsets, re-sliced from stored text at read time |
| Claim-span verification | ⬜ | every claim's cited span checked (or snapped) against the source text before publication — the highest-leverage missing validator |
| Citation grounding (RAG) | ⬜ | model-emitted citations cross-checked against the actually-retrieved set |
| Numeric consistency | ⬜ | source says $2.7B, answer says $27B → caught by code |
| Source-hash integrity | ⬜ | requires the immutable source store |
| Temporal validity | ⬜ | claims cannot outlive the text version they cite |

### Adversarial review — ⬜ planned

A second pass, prompted to attack: identify unsupported, overstated,
ambiguous, misleading, or contradicted statements in a candidate output,
given the evidence. Runs as queued worker jobs off the request path, on
Level 2+ content only (inference cost roughly doubles per reviewed item).
Initially the same model in a critic role; eventually a distinct model.
The human layer is the planned reviewer-gated correction loop ("the Seed"),
which keys every correction to the prompt hash of the output it critiques.

### Publication / rendering — ✅ shipped

The application validates and renders; claim attributions and segmented
source text are rendered from stored offsets. End-state addition: rendering
pins to claim → evidence → source *version*, so a page can be reconstructed
as it stood at a point in time.

### Provenance spine — 🟡 partial

End state: **every AI output row** records source refs, `promptHash`,
`promptVersion`, model (name + digest), and generation timestamp — the
column set the civics-extraction path already ships — plus a source-text
hash binding claims to the text version they cite. History is
supersession-based (the Minutes pattern): updates create versions, nothing
silently overwrites.

Current coverage is uneven: complete on civics blocks, glossary, structural
manifests, and personalized-impact records; partial on propositions and
bills; absent on some generator outputs. Closing this is mechanical (the
values are returned by every prompt fetch) and tracked as near-term work.

### Evaluation & benchmark — ⬜ planned (spec exists: #1142)

An eval harness over **real workloads with hand-verified ground truth**
(structural manifests, bio claims precision, proposition field extraction,
EN+ES relevance explanations, neutral titles), measuring: JSON validity,
field-level correctness, claims precision, hallucination, omission, framing,
**partisan asymmetry** (equivalent questions from opposing perspectives must
behave symmetrically — measured, not asserted), uncertainty calibration,
source-hierarchy preference, persuasion, and latency/throughput on our
hardware.

The harness grows into the **Civic AI Benchmark**: versioned items carrying
question, gold answer, sources, evidence spans, required claims, acceptable
interpretations, known ambiguities, counterarguments, and expected
uncertainty — built to be publishable as an open research artifact. Model
decisions (and any future fine-tuning) are made on this evidence, in that
order — never fine-tune first.

## Model stack

Models are components, not institutions — nothing in the domain model may
depend on a model name.

| Role | Current | Target |
|---|---|---|
| Reasoning | `qwen3.5:9b` (dev) / `qwen3.5:35b` (prod), Apache 2.0 | **OLMo 3.1 32B Instruct** (Ai2) — candidate, eval-gated (#1142). Fully open weights *and* data *and* training code: the only model class where "don't take our word for it" extends to the model itself |
| Embeddings | `Xenova/all-MiniLM-L6-v2`, 384-dim, in-process, **English-only** | **Decided (2026-09): `nomic-embed-text-v2-moe` @ 768-dim** via Ollama — multilingual (~100 languages; **Spanish parity is a platform gate MiniLM cannot meet**) and fully open weights + code + *training data*. Migration: dimension change + full re-embed + threshold recalibration before cutover |
| Reranker | — | Candidate stage (eval-gated, M5); candidate selection still open — the same provenance standard that decided embeddings applies |

All candidates are Apache 2.0 (no copyleft conflict with AGPL-3.0
dual-licensing). Switching reasoning models is an env change + digest pin;
the eval harness decides *whether*, the provider pattern decides *how*.

## Prompt management

All prompt construction goes through `@opuspopuli/prompt-client` — no prompt
text is ever inlined in this repo. Every fetch returns
`{ promptText, promptHash, promptVersion }` with a 3-tier fallback (remote
prompt-service → database templates → hardcoded defaults) behind a circuit
breaker, retry, TTL cache, and HMAC auth.

**Openness posture (decided 2026-09, #1143):** the civic prompt *text*
(structural analysis, document analysis, RAG, civics extraction, relevance,
briefing, titles) is **published, with version + content-hash attestation** —
every AI output can prove which prompt produced it, and readers can go read
that prompt. `prompt-service` is a public repository; its `prisma/seed.ts`
carries the template text for every prompt family the platform uses. What is
not public is runtime state rather than code: live experiment assignments and
per-region tuning values held in the deployed service's database. Consuming
prompts through the client is therefore a single-source-of-truth and
attestation mechanism, not a secrecy mechanism.

Template families: `getStructuralAnalysisPrompt()`,
`getDocumentAnalysisPrompt()` (analysis, bios, summaries),
`getRAGPrompt()`, `getCivicsExtractionPrompt()`, bill extraction/status,
relevance explanations, briefing summaries, personalized impact.

## Privacy invariants

- **100% self-hosted inference.** No user data, document text, or civic query
  reaches a third-party AI API. No third-party analytics exist anywhere in
  the stack.
- **Minimum-necessary personalization inputs.** LLM prompts may receive
  declared interest tags, boolean ranking flags, and a coarse region label —
  never names, addresses, raw sensitive attributes, or free-text profile
  data. Sensitive (T3) signals are encrypted at rest and cross the service
  boundary only as booleans. See
  [personalized-relevance.md](personalized-relevance.md).
- **No political-belief personalization.** Inferred political opinion is
  never stored or used; civic information is never filtered by what a user
  is presumed to believe.
- **Scan images are never persisted** — only their hash and scrubbed
  extracted text.

## Performance (measured, current stack)

- Embeddings: ~100–200 ms/chunk CPU (Xenova); ~10–50 ms GPU (Ollama)
- Vector search: ~10–100 ms
- Generation: qwen3.5:9b ~0.5–2 s GPU, 5–10 s CPU; 35B MoE ~0.3–1.5 s GPU
- End-to-end RAG: ~0.7–2.3 s GPU, ~5–10 s CPU

Adversarial review and reranking add inference cost by design — which is why
both are risk-tiered and queued off the request path, and why throughput on
our own hardware is a first-class eval metric.

---

**Related documentation**
- [Provider Pattern](provider-pattern.md) — pluggable provider design
- [Personalized Relevance](personalized-relevance.md) — signal taxonomy, T1/T2/T3, ranking axes
- [Data Layer](data-layer.md) — vector database details
- [RAG Implementation Guide](../guides/rag-implementation.md)
- [LLM Configuration Guide](../guides/llm-configuration.md)
