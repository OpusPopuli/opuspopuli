# Model selection and the two-machine split — measured evidence

|                         |                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| **Status**              | **Proposal with measurements. Nothing is deployed** — `LLM_MODEL: qwen3.5:9b` is still set on all five services in `docker-compose-uat.yml` |
| **Date**                | 2026-09-20                                                                                        |
| **Author**              | Rodney Gagnon                                                                                     |
| **Roadmap**             | R7 / M7 — model selection, gated on the R3 harness. R3's exits were met 2026-09-16                |
| **Measured by**         | `packages/eval-harness` (#1142), 2026-09-16 and 2026-09-17                                        |
| **Data classification** | None. Public civic records; fixtures redacted as a post-condition (`src/redaction.ts`)            |
| **Related**             | #1212 (quote-then-locate, shipped in #1274), #1233 (`MIN_VERIFIED_SIMILARITY` uncalibrated per model), #1272, #1273, #1281 (pin model digest), #1305 (regenerate locally, transfer to prod), #1308 (README debt) |

---

## 1. The proposal

| Job | Workload | Model | Machine |
| --- | -------- | ----- | ------- |
| **1 — ingest** | scraping, structural analysis, civics extraction | `olmo-3:7b-instruct` | Mac Mini |
| **2 — analyse** | proposition analysis, synthesis, RAG, chat | `olmo-3.1:32b-instruct` | Mac Studio |

`qwen3.5:9b` is excluded on **provenance grounds** — not on measured quality. It is retained below
only as the reference ceiling every earlier number was taken against.

## 2. The measurements

All runs: Q4_K_M, matched quantisation, identical fixtures (10 measures unless noted), recorded
model digests, prompt hash pinned per run. `assertComparable` refuses cross-quantisation
comparisons, so these are like-for-like.

| model | contract | json | grounding | fabricated | abstention | anchoring | cites operative | cites transmittal | median | mean tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `olmo-3:7b-instruct` | offsets | 10/10 | 1.00 | 0 | 1.00 | 1/42 (2.4%) | 24% | 38% | 26s | 715 |
| `qwen3.5:9b` | offsets | 10/10 | 1.00 | 0 | 1.00 | 5/56 (8.9%) | 44% | 27% | 71s | 1351 |
| `olmo-3:7b-think` +think | offsets | 4/5 | 1.00 | 0 | 0.83 | 1/13 (7.7%) | 15% | 54% | 609s | 8264 |
| `olmo-3:7b-instruct` | **quote-then-locate** | 10/10 | 1.00 | 0 | **0.82** | 10/36 (27.8%) | 88% | 6% | 52s | 727 |
| `olmo-3.1:32b-instruct` | **quote-then-locate** | 10/10 | 1.00 | 0 | **1.00** | **44/77 (57.1%)** | **96%** | **2%** | 550s | 1474 |

Essential-provision recall (omission leg, embeddings-scored against gold provisions):

| model | overall | **essential** |
| --- | --- | --- |
| `olmo-3:7b-instruct` | 24/24 | **17/17 (100%)** |
| `olmo-3.1:32b-instruct` | 24/24 | **17/17 (100%)** |
| `qwen3.5:9b` | 23/24 | 16/17 (94%) — dropped `25-0015`, *"the penalty is triggered by any qualifying vote cast after January 1 2025"* |

Symmetry (partisan treatment, deterministic track, canonical template):

| reading | `qwen3.5:9b` | `olmo-3.1:32b-instruct` |
| --- | --- | --- |
| Mean yes/no length ratio | 0.781 | 0.683 |
| `yesOutcome` longer than `noOutcome` | **8/10** | **8/10** |
| Measures flagged | 1/10 | 7/10 |
| Hedge markers across 20 texts | 1 | 9 |
| Control pair (near-duplicate filings) | clean | clean |

Throughput (decode, measured under one protocol):

| runtime | model | decode tok/s |
| --- | --- | --- |
| Ollama | `olmo-3:7b-instruct` | 42.44 |
| Ollama | `qwen3.5:9b` | 19.93 |
| MLX | `Qwen3.5-9B-4bit` | 42.96 |
| MLX | `Olmo-3-7B-Instruct-4bit` | 48.44 |

## 3. What the numbers support

**The 32B for analysis is well supported.** It anchors **2× better** than the 7B (57.1% vs 27.8%),
cites operative law 96% of the time against 88%, places more than twice as many claims per measure
(7.7 vs 3.6), fabricates nothing, and recalls every essential provision.

**One result argues specifically against the 7B for analysis.** Its abstention fell to **0.82**
under the quoted contract, where it was 1.00 under offsets — it began populating `fiscalImpact` on
measures whose source cannot support one. That is inventing a field, on the axis a citizen-facing
analysis can least afford. The 32B held at 1.00.

**The 7B for ingest is supported by inference, not by measurement — see §5.**

**Dropping qwen costs nothing measurable.** The 32B beats it on every axis here.

## 4. The two findings that matter more than the model choice

### 4.1 The anchoring win was the contract, not the model

Claim anchoring went **2% → 57%** on the 32B and **2% → 27.8%** on the 7B. Both came from changing
*what the model is asked for* — a verbatim `sourceQuote` that code locates — not from more
parameters (#1212, shipped in #1274). Under the old contract the 32B would have scored in the same
single digits as everything else.

Two consequences worth carrying forward:

- Do not read the 7B's old 2% as "too small for this job". It was measured under a contract that
  defeated every model tested, including 32B-class ones.
- The same reasoning applies to the next model: ask what the contract costs before assuming the
  model is the problem.

It also closed a disclosure path. Citations landing in the AG transmittal letter — where
`propositions.full_text` carries proponent postal addresses, emails and phone numbers unredacted in
production (#1263) — fell from **27–54% under offsets to 2–6% under quote-then-locate**. Since a
quoted citation copies text verbatim, that reduction is what keeps the contract from publishing
contact details.

### 4.2 The yes/no asymmetry is probably the prompt, not the model

`yesOutcome` ran longer than `noOutcome` on **the same 8 of 10 measures for both `qwen3.5:9b` and
`olmo-3.1:32b-instruct`** — unrelated model families, identical fixtures.

Each run alone is directional and not conclusive (p ≈ 0.109). The two are **not** twenty
independent trials; they are the same ten measures scored twice. What agreement across two
unrelated models on fixed inputs suggests is that the asymmetry lives in **the prompt or the source
material**.

Plausible and testable mechanism: *"what happens if this passes"* is inherently more describable
than *"what happens if it fails"*, which is usually the status quo.

**Next step is to read the template's `yesOutcome`/`noOutcome` instructions in `prompt-service` —
not to try another model.** A reader could fairly call a consistently longer "yes" case a thumb on
the scale, which makes this a transparency concern rather than a tuning detail.

## 5. The gap — job 1 is unmeasured

Every number above comes from the **analysis** prompt (`document-analysis-proposition-analysis`).
The job-1 workloads have **no eval leg at all**:

| Job-1 prompt | Consumer |
| --- | --- |
| `getStructuralAnalysisPrompt` | `packages/scraping-pipeline/src/analysis/structural-analyzer.service.ts` |
| `getCivicsExtractionPrompt` | `apps/backend/src/apps/region/src/domains/civics-sync.service.ts` |

The case for the 7B on ingest is that extraction rewards exactly what it is strong at — format
adherence (10/10 JSON), no fabrication (0 figures), completeness (100% essential recall) — and does
not depend on citation anchoring, its weakness. **That is a well-grounded inference from an
adjacent workload, not a measurement of the real one.** Building the leg needs fixtures (scraped
pages plus gold manifests), not new scorers: `json-validity` and `grounding` transfer directly.

## 6. Deployment — configuration, not code

Both model and endpoint are per-process environment, resolved in
`packages/config-provider/src/configs/llm.config.ts`:

```ts
url:   process.env.LLM_URL,        model: process.env.LLM_MODEL
ollama: { url: LLM_OLLAMA_URL || LLM_URL, model: LLM_OLLAMA_MODEL || LLM_MODEL }
```

`docker-compose-uat.yml` already sets `LLM_MODEL` in **five separate service blocks** — `knowledge`,
`region`, `region-worker`, `structural-analysis-worker`, `llm-rerank-worker` — all currently
`qwen3.5:9b`. Splitting models and machines is per-service environment, with **no provider or code
change**.

Suggested mapping:

| Service | Job | Model | Endpoint |
| --- | --- | --- | --- |
| `structural-analysis-worker`, `region-worker` | 1 | `olmo-3:7b-instruct` | Mini |
| `knowledge`, `region`, `llm-rerank-worker` | 2 | `olmo-3.1:32b-instruct` | Studio |

Memory measured on a 48GB box: **32B resident at 21.4GB**, 7B at ~4.5GB. A 16GB Mini cannot hold
the 32B; it holds the 7B comfortably. The split is feasible on the hardware as described.

`OCR_VISION_MODEL` is already pinned separately from `LLM_MODEL`, with a comment anticipating this
move — *"inference is moving to a US-provenance model with no vision capability"*. Keep it separate.

## 7. Before this ships — blockers and interactions

- **#1273 — three services cannot honour LLM timeouts over five minutes.** `knowledge`, `documents`
  and `structural-analysis-worker` run on undici's 300s default while the other three set
  1,350,000ms. `generate()` posts `stream: false`, so no headers arrive until generation completes.
  **The 32B's median is 550s.** Two of the three services proposed for job 2 and job 1 above would
  fail on essentially every analysis. This is a hard prerequisite, not a nice-to-have.
- **#1233 — `MIN_VERIFIED_SIMILARITY` is uncalibrated for every selectable model.** Petition
  verification is fail-closed until re-measured, and a model change is exactly the event that
  requires it.
- **#1281 — pin the model digest** in `LlmGeneratorBase`. A split where two models produce rows into
  one database makes per-row model attribution structural rather than optional.
- **#1305 — regenerate locally, transfer to production.** Directly relevant: if analyses are
  generated on the Studio and shipped, the production node may not need the 32B resident at all.
- **Interactive chat is unmeasured at 550s/measure.** Fine for batch analysis; not obviously fine
  for chat. Measure before promising it.

## 8. Caveats on every number here

- **One run each, one quantisation, ten measures. Nothing is pooled.** A neighbouring metric
  (anchoring under the quoted contract) showed **13-point run-to-run swings** — 14%, 24%, 17% across
  identical configurations. Treat single-run differences under ~10 points as noise.
- **`olmo-3.1:32b-think` was never tested** — it is not installed. R3's candidate set named it.
- **The 8-bit comparison R3 asked for was never run**; every number here is Q4_K_M.
- **R3's LLM-judge symmetry track was never built** — the plan specified a blind A/B with side-swap
  and position randomisation alongside the deterministic track. Only the deterministic track exists.
- **Result files are gitignored.** The numbers in this document and in
  `packages/eval-harness/README.md` are the durable record; the JSON is not.
- Reproduce with, e.g.:
  ```bash
  PROMPT_SERVICE_URL=http://localhost:3210 PROMPT_SERVICE_API_KEY=... \
    pnpm --filter @opuspopuli/eval-harness eval:generation -- \
      --model olmo-3.1:32b-instruct --no-think \
      --contract quote-then-locate --document-type proposition-analysis-quoted
  ```
