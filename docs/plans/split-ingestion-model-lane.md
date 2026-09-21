# Plan of record — split the ingestion inference lane

| | |
|---|---|
| **Driver** | Roadmap §6.4, R7. Prerequisite for step 5 (the model switch) |
| **Date** | 2026-09-20 |
| **Author** | Rodney Gagnon (with Claude Opus 5) |
| **Branch** | `feat/split-ingestion-model-lane` |
| **Data classification** | None. Configuration and DI wiring only; no data is read, written or emitted. |

## 1. Why

Inference is two jobs with different requirements, and there was exactly **one**
variable — `LLM_MODEL` — shared by the structural-analysis worker, the
generators and the RAG path.

| Job | Model | Measured |
|---|---|---|
| **Analysis** — proposition analysis, minutes summaries, bios, RAG | `olmo-3.1:32b-instruct` | 57% claim anchoring vs the 7B's 28%; 96% operative-law citation vs 88%; correct abstention where the 7B fabricated a fiscal impact. **~550 s/measure, 21.4 GB** |
| **Ingestion** — structural analysis, civics extraction, detail crawling, PDF extraction | `olmo-3:7b-instruct` | 10/10 valid JSON, zero fabricated figures, 100% essential recall. **~52 s/measure, ~4.5 GB** |

Pinning both to one model spends the large model's wall clock where it buys
nothing — and ingestion runs over far more documents than analysis does, so
that is exactly where a 10× difference compounds.

## 2. Classification, checked rather than assumed

Both tokens are named for their lane: `LLM_ANALYSIS_PROVIDER` and
`LLM_INGESTION_PROVIDER`. The old `LLM_PROVIDER` is gone rather than kept as
the analysis alias, and that is the point — **the default had become the
expensive lane.** A service added later reaches for the obvious-looking token
and silently opts into a 550 s model; with no obvious default, a lane has to
be chosen, and a constructor now says which one it is on.

The **environment variable** deliberately does not follow. `LLM_MODEL` stays,
because it genuinely means "the model, unless a lane overrides it" — it is the
fallback for both lanes — and renaming it would break every existing
deployment for symmetry that buys nothing.

**Ingestion** (moved to `LLM_INGESTION_PROVIDER`):

- `structural-analyzer.service.ts` — `getStructuralAnalysisPrompt`
- `pipeline.service.ts` — passes the provider to detail crawling and PDF extraction
- `civics-sync.service.ts` — `getCivicsExtractionPrompt`

**Analysis** (unchanged on `LLM_PROVIDER`): `llm-generator.base` (all seven
generators), `region-sync` (verified: `getBillStatusSummaryPrompt`, synthesis),
`knowledge.service`, `briefing-summary`, `llm-rerank`, `documents/analysis`,
`documents/personalized-impact`.

`llm-rerank` was the one worth checking: it is batch/cron-driven with cached
results rather than a synchronous user path, so the accuracy lane is
defensible. **Its capacity under a 550 s model is an open question** — noted
rather than silently decided.

## 3. Inert until configured

`LLM_INGESTION_MODEL` / `LLM_INGESTION_URL` fall back through `LLM_OLLAMA_*`
to `LLM_*`. An unconfigured deployment gets byte-for-byte the provider it had
before, so carrying the split costs nothing and rolling it out is safe.

**The URL is split as well as the model**, deliberately. The two models are
meant to end up on different machines (7B on the Mini, 32B on the Studio);
they start on one host, and moving them apart should be a config change rather
than another code change. `OCR_VISION_MODEL`/`OCR_VISION_URL` set the same
precedent for the same reason (#1050).

## 4. Findings from review, all fixed here

- **Two near-identical factories** — a CPD-gate clone, and the way such a pair
  drifts is that one lane quietly stops honouring a timeout the other does,
  which nothing catches because both still construct. Extracted to `buildLane`.
- **Nothing said which model a lane resolved to.** It is now logged at boot for
  both lanes. Inferring it from four environment variables and a fallback chain
  is how a service ends up running a model nobody chose.
- **Setting `LLM_INGESTION_URL` without `LLM_INGESTION_MODEL`** sends the
  *analysis* model to the ingestion host — a 32B at 21.4 GB aimed at a machine
  chosen for a 7B, surfacing as a pull error or an OOM rather than as the
  misconfiguration it is. Now warned at boot.
- **The first DI test proved nothing.** Resolving the tokens straight off the
  testing module passes with the export REMOVED, because Nest's `get()` reaches
  unexported providers — verified by reintroduction. It now injects through a
  separate consumer module, which is what crosses the export boundary #1278
  got wrong.
- **The warning test could not see the log.** `jest.spyOn(Logger.prototype)`
  in the backend cannot intercept a logger inside `@opuspopuli/llm-provider`:
  the package resolves its **own** `@nestjs/common` in the pnpm workspace, so
  the patched prototype is a different object and the spy silently observes
  nothing. It asserts on stream output instead — which is what an operator
  actually sees.

## 5. Verification

- **Proved in a real container**, not only in tests: with
  `LLM_INGESTION_MODEL=olmo-3:7b-instruct`, region logs
  `analysis lane: qwen3.5:9b` and `ingestion lane: olmo-3:7b-instruct` on the
  same host, set purely by environment.
- region, region-worker, structural-analysis-worker, knowledge and documents
  all rebuilt and booted **healthy with zero DI errors**.
- 1,005 unit tests / 55 suites, `tsc` clean cold, sonar lint clean,
  `build:region` clean, all three packages build, compose validates.
- Every guard verified by reintroducing the defect.

## 6. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| A service is on the wrong lane | **high** × possible | Every consumer enumerated and classified against the prompt it actually calls; lane logged at boot so it is visible rather than inferred |
| Token provided but not exported — the #1278 shape | **high** × possible | DI test injects through a separate consumer module; verified by reintroduction |
| Ingestion host set without its model | medium × likely | Warned at boot, with the specific failure named |
| Both models resident on one host degrades throughput | **high** × certain at first | This is the condition that produced 550 s/measure (degrading from 2m17s to 11m46s *within* a run). Documented in config, `.env.example` and here; `OLLAMA_MAX_LOADED_MODELS` and keep-alive matter more than these pins while they share a machine |
| `llm-rerank` too slow on the analysis lane | medium × possible | Batch/cron with cached results, so not a user-facing path. Flagged as an open capacity question rather than decided |
| Ingestion quality unmeasured on the 7B | **high** × certain | **The real gap.** Every ingestion number comes from the *analysis* prompt; `getStructuralAnalysisPrompt` and `getCivicsExtractionPrompt` have no eval leg. The split makes the choice expressible — it does not make it evidenced |

## 7. Effort

~half a session.
