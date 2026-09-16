# `@opuspopuli/eval-harness`

The measurement instrument for AI-architecture changes. Roadmap **R3**, milestone **M4** (`docs/plans/ai-architecture-roadmap.md`).

## Why this exists

Several confident claims about retrieval in this project turned out to be wrong when measured:

- that a 768-dim multilingual model must beat a 384-dim MiniLM — **it does not, on English**
- that Metal-backed inference would be faster — **~73× slower per query**
- that nomic v1.5 was a reasonable fallback — **0/14 on this corpus**

Each was plausible. Each was stated with confidence. Each was overturned by ten minutes of measurement. The harness exists so that retrieval changes can say what they did to a number, instead of what they ought to have done.

## Quick start

**Build the providers first.** The harness executes each provider's `dist/`, not its source, and `pnpm install` does not build:

```bash
pnpm -r --filter './packages/*' build
```

Every eval entrypoint refuses to run against a stale build rather than reporting a number from it — see [The stale-build trap](#the-stale-build-trap).

```bash
# The in-process Xenova default (NOT MiniLM any more — see baselines)
pnpm --filter @opuspopuli/eval-harness eval:baseline

# A candidate
pnpm --filter @opuspopuli/eval-harness eval:retrieval -- \
  --provider ollama --model nomic-embed-text-v2-moe:latest --prefix
```

Results land in `results/` as JSON (gitignored), keyed by provider+model, so runs stay comparable instead of scrolling past in a terminal.

## What it measures

| Metric              | Meaning                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `top1` / `top1Rate` | Gold document ranked first                                                                                                                                                                                                      |
| `MRR`               | Mean reciprocal rank — credits near-misses                                                                                                                                                                                      |
| `meanMargin`        | Top score minus the best **non-gold** score. **The one to watch.** A correct answer winning by 0.036 is nearly a coin flip; the same answer winning by 0.223 is a retrieval. Hit rate alone hides that difference.              |
| `corpusSeparation`  | Query-independent. How far apart the model spreads the corpus. Predicts failure before any query runs: nomic v1.5 scored **0.942 mean** here and returned 0/14. A `max` of 1.000 means two documents are identical — see #1219. |
| `byLang`            | EN and ES reported separately. Spanish parity is a platform non-negotiable, and an aggregate number hides it.                                                                                                                   |

Margin is computed against the best _non-gold_ document deliberately: several filings are genuine duplicates, so ranking two of them 1st and 2nd is correct behaviour and must not be scored as a narrow win.

## Baselines — 56 items, post-#1261, 2026-09-15

**69 propositions** (the corpus grew by 4), 56 gold items (35 EN + 21 ES), after #1261 landed
real Legislative Digest summaries. Verified with the pipeline's own `detectSummaryEcho`:
**7.2% echo (5/69)**, against R2's <10% exit. Median summary is now **992 characters**, up from
~211 — which was the title and nothing else.

| Model | Overall | EN | ES | Corpus sep. |
| --- | --- | --- | --- | --- |
| `Xenova/all-MiniLM-L6-v2` (384) | 41/56 · MRR .806 | 32/35 · .182 | **9/21** · .034 | 0.334 |
| `Xenova/bge-base-en-v1.5` (768) | 48/56 · MRR .900 | 32/35 · .099 | 16/21 · .042 | 0.670 |
| `nomic-embed-text-v2-moe` prefixed (768) | **52/56 · MRR .953 · margin .171** | **34/35 · .167** | **18/21** · **.178** | 0.397 |

### What the corpus fix bought, measured

nomic, before and after the same 56 items:

| | pre-#1261 (65 docs) | post-#1261 (69 docs) |
| --- | --- | --- |
| Overall | 51/56 · MRR .939 · margin .145 | **52/56 · MRR .953 · margin .171** |
| EN | 32/35 · margin .133 | **34/35 · margin .167** |
| ES | 19/21 · margin .166 | 18/21 · margin .178 |
| Byte-identical docs | yes (`max` sep 1.000) | **none** (`max` .999) |

**English is the clear win**: 91.4% → 97.1%, with margin up a quarter. The corpus now carries
real text for English queries to match against instead of a repeated title.

**`ret-en-008` finally hits.** This item missed under *every* model in every prior run, and the
README recorded it as a corpus defect rather than a model failure — three filings shared a
title and two were byte-identical. There are now **zero byte-identical documents** in the
corpus. The defect was real, it was data, and fixing the data fixed the item.

### The prediction, scored

Six items were flagged `contentOnly` before the fix, with two predicted to miss until real
summaries landed:

- **`ret-en-031`** (the residency test for income tax) — **now hits.** Predicted correctly.
- **`ret-en-020`** (insurance lowballing) — **still misses**, but the reason has changed:
  `25-0020A2` now carries a 1,006-character summary, so the corpus *can* support the query.
  It is no longer a corpus-ceiling miss; it is a genuine retrieval miss, which is a more
  useful thing to know.

### Spanish regressed, and the cause is precise

ES went 19/21 → 18/21, with two new misses — and both are measures that **still have no
summary**:

| item | target | summary length | outcome |
| --- | --- | --- | --- |
| `ret-es-017` | `SB 417` | 52 chars | now misses |
| `ret-es-018` | `26-0005` | **0 chars** | now misses |

`26-0005` previously carried `"California Food Tax Fairness Act"` as its summary, so the title
appeared twice in the embedding source. That duplication was an *echo* — correctly identified
as a defect — but it was also signal, and removing it left the document as title-only. The
English query against the same measure (`ret-en-033`) still hits; the Spanish one no longer
does. Cross-lingual retrieval has the least signal to spare, so it fails first.

This is the shape of the remaining gap rather than a fault in the fix: **17 of 69 rows now
have an empty summary** — 14 Sonoma local measures plus `26-0005` and `26-0006`. The AG
initiatives, which is what #1261 targeted, went from title-echo to ~992 characters of real
Legislative Digest and improved sharply. The local measures have yet to be filled in.

Worth noting for whoever picks that up: an empty summary is not an echo, so it does not appear
in the 7.2%. The echo metric and "does this row carry a usable summary" are different
questions, and only the first is currently reported.

### The stale-build trap

On 2026-09-14 this clone carried a `dist/` from **Sep 7**, predating the task-prefix support added to `OllamaEmbeddingProvider` for #1156. The harness accepted `--prefix`, wrote `"prefixed": true` into its results JSON, and embedded entirely unprefixed text. Prefixed and unprefixed runs came back **bit-identical** (cosine 1.000000) while the raw Ollama API showed the prefix moves an embedding a long way (cosine 0.763).

Nothing in the source was wrong. Nothing logged an error. The result file asserted a configuration the running code could not honour — which is the same defect this harness was built to catch, one level down: `retrieval-eval.ts` stopped reimplementing the provider so it would measure production, and then measured a four-day-old build of it.

`src/build-freshness.ts` now refuses to run any eval when a guarded package's source is newer than its build, and names the rebuild command. `EVAL_SKIP_BUILD_CHECK=1` bypasses it and says so loudly; do not set it for a run whose numbers you intend to quote.

## Generation leg (#1142)

```bash
PROMPT_SERVICE_URL=http://localhost:3210 PROMPT_SERVICE_API_KEY=<key> \
  pnpm --filter @opuspopuli/eval-harness eval:generation -- \
    --model qwen3.5:9b [--think] [--limit 3] [--contract quote-then-locate]
```

Runs the real `document-analysis-proposition-analysis` template through the real
`OllamaLLMProvider`, at production's settings — `maxTokens` 6000 (not 2000; see #1085),
`temperature` 0.2, and `think` **set explicitly per model**.

### Prerequisites that will look like bugs

**`PROMPT_SERVICE_URL` is required, and the eval refuses to run without it.** This is
deliberate, and stronger than the client's own behaviour. `getDocumentAnalysisPrompt`
asks for `document-analysis-proposition-analysis` with `document-analysis-generic` as
its fallback, and `getTemplateFromDb` substitutes that fallback **silently** when the
requested template is missing. The local `prompt_templates` table in `opuspopuli-db`
carries `document-analysis-proposition` (948 chars) but not
`document-analysis-proposition-analysis` (6,818 chars) — so an unguarded run scores
675 characters of generic instruction while recording a `promptHash` that makes the
result look attributed.

`src/prompt-attribution.ts` closes both doors: it requires the URL, and it fetches the
named template straight from prompt-service to check its hash against the one the
client returned. A mismatch means a fallback happened, and the run stops.

**A stale build is refused too** — see [The stale-build trap](#the-stale-build-trap).

### What it measures

| Metric | Meaning |
| --- | --- |
| **JSON validity** | Through production's own `extractJsonObjectSlice`. `empty-response` is a **separate verdict** from `no-json`: with reasoning left on, a capable model spends its whole budget thinking and returns nothing, which reads as a format failure and is one flag. |
| **Numeric grounding** | Every `$`, percentage and magnitude emitted must appear in the source, matched on **value** so "$1.2 million" is grounded by "$1,200,000". |
| **Abstention correctness** | An empty `fiscalImpact` on AG-filed text is the **right** answer. Fabricating and missing are reported separately, never netted. |
| **Claim-span anchoring** | Scored on **raw** offsets, never `normalizePayload`-clamped ones, and with a partitioning detector for the sequential-span tell. |

**Field completeness is never scored.** In #1142's first run a 3.4B model topped the
scoreboard at 16/18 fields *because it fabricated the fiscal impact*, while qwen scored
lower for correctly returning an empty `fiscalImpact`. All six models returned empty
`fiscalImpact` on all five measures — a property of the source data, which a
completeness metric misreads as a model failure.

### Baseline — qwen3.5:9b, 2026-09-14

10 measures, `document-analysis-proposition-analysis` v1 (`850bdd19629b`, 6,818 chars),
`think: false`, `maxTokens` 6000, offsets contract. M4 Pro, Q4_K_M.

| | |
| --- | --- |
| JSON valid | **10/10** |
| Claims anchored | **6/54 (11%)** |
| Fabricated figures | **0** |
| Fabricated fields | **0** |
| Abstention correctness | **100%** — empty `fiscalImpact` on all ten, which is correct |
| Median cited span | 185 chars |
| Wall clock | 855s total, 85s/measure, 6.8–23.3 tok/s |

This reproduces what #1142 reported from an uncommitted script, and sharpens one part of it.

**The anchoring failure is not out-of-range offsets.** Across 54 claims the verdicts are
**47 unsupported, 6 anchored, 1 out-of-range**. Ninety-eight percent of qwen's citations
point *inside* the document, at paragraph-sized spans (median 100–334 chars), and simply
do not contain the claim they are attached to.

That matters for #1212 and #1209. "Fabricated offsets" covers two different behaviours:

- **Out of range** — granite's `1240..5400` in a 2,799-char document. A bounds check
  catches it, and `normalizePayload`'s clamp currently hides it.
- **In range, unrelated** — qwen's dominant mode. A bounds check passes it. Clamping does
  nothing to it. Only comparing the span against the claim catches it at all.

A verify-or-snap gate built around range validation would therefore pass ~98% of qwen's
wrong citations. Sequential partitioning — each claim's span starting exactly where the
previous ended — was detected on 3 of 10 measures.

**Throughput varies enough to matter.** 6.83 tok/s on one measure against 23.28 on
another of similar size, same settings, same machine. Single-run numbers are directional
only; comparisons need repeats.

### Run-to-run variance — two identical runs, 2026-09-14

R1 on the plan's risk register says single-run rankings are noise. Two full runs at identical
settings (`qwen3.5:9b`, Q4_K_M, `think: false`, 6000 tokens, offsets contract):

| | run 1 | run 2 |
| --- | --- | --- |
| JSON valid | 10/10 | 10/10 |
| Claims anchored | 6/54 · **11%** | 7/60 · **12%** |
| Fabricated figures | 0 | 0 |
| Fabricated fields | 0 | 0 |
| Partitioning detected | 3/10 | 3/10 |
| Median cited span | 185 chars | 200 chars |

**The aggregate is stable; the per-measure figures are not.** Same measure, same settings,
one run apart:

| measure | run 1 | run 2 |
| --- | --- | --- |
| `25-0019A1` | 0/4 · 0% | 3/11 · 27% |
| `ACA 22` | 2/5 · 40% | 0/7 · 0% |
| `25-0041A1` | 1/11 · 9% | 0/6 · 0% |
| `25-0003` | 0/4 · 0% | 1/4 · 25% |

The model also emits a different *number* of claims each time — 54 against 60 in total, and
4 against 11 on `25-0019A1` alone — so the denominator moves as well as the numerator. Which
measures trip the partitioning detector changes too (`25-0017` in run 1, `25-0007A1` in run 2).

So: **quote the aggregate, never a per-measure cell, from a single run.** A per-measure number
here swings from 0% to 27% on nothing but resampling. Comparisons between models need repeats;
the plan's N=3 minimum is the floor, not a formality.

### Symmetry — first numbers, 2026-09-14

`qwen3.5:9b` Q4_K_M, 5 pairs (1 control), 10 measures. **R3's second exit criterion is met:
symmetry metrics produce numbers.** What those numbers say is more modest than that sounds.

**The control pair is clean.** Two near-identical filings came back at length ratio 0.95 and
provisions 5 vs 5 — so the metric does not fire on near-identical input, and the readings
below are worth something. This is reported first on purpose: if the control ever flags,
nothing after it can be trusted.

| reading | result |
| --- | --- |
| Within-measure yes/no, mean length ratio | 0.781 |
| `yesOutcome` longer than `noOutcome` | **8/10** (two-sided p ≈ 0.109) |
| Mirrored pairs flagged | 1/4 |
| Hedging | **no signal** — 1 marker in 20 texts |

**"Yes" runs longer than "no" on 8 of 10 measures.** Directional, not conclusive: at n=10
that is p ≈ 0.11, so it could be chance. It is exactly the shape that more measures would
settle, and exactly the shape a unanimity rule would have thrown away — see below.

**One pair surfaced twice the provisions on one side**: `property-tax-relieve-vs-repeal`
returned 13 provisions for the exemption-extending measure against 6 for the repeal, a ratio
of 0.46, against a control that returns 1.00. How many provisions a measure *has* is a
property of the measure; how many the analyst *surfaces* is treatment.

#### Three defects the first run exposed — in the reporting, not the model

Worth recording, because each would have produced a confident wrong reading:

1. **A unanimity rule dismissed a real pattern.** "yes longer on 8/10" printed as *"split
   across measures; no consistent lean"*, because the verdict only fired at 10/10. Replaced
   with an exact two-sided binomial and wording that separates *directional* from
   *significant*.
2. **Zero hedging read as symmetry.** Hedge Δ was 0.00 nearly everywhere — not because the
   two sides hedge equally, but because there is **1 hedging marker in 20 texts**. The
   yes/no fields are short declaratives ("A yes vote means…"). A delta of 0.00 over absent
   data is not evidence of anything, and the report now says so instead of implying balance.
3. **Provision asymmetry was measured and never flagged.** 13 vs 6 sat in the output
   unremarked because only length and hedging carried thresholds.

#### Re-scoring without re-running

Runs retain their payloads, so a metric change costs seconds rather than another 20 minutes
of GPU:

```bash
pnpm --filter @opuspopuli/eval-harness eval:symmetry -- \
  --rescore results/symmetry-qwen3-5-9b-Q4-K-M.json
```

All three fixes above were validated that way, against the run that exposed them. Live and
re-scored output share one renderer, so a fix cannot change one and not the other.

### Calibration — can #1209 gate on claim confidence?

**No.** Measured over 70 claims from the symmetry run (`qwen3.5:9b`, Q4_K_M):

| level | n | share | anchoring rate |
| --- | --- | --- | --- |
| `high` | 69 | **98.6%** | **4.3%** |
| `medium` | 1 | 1.4% | 0% |

The model marks essentially everything `"high"`, and a `"high"` claim's citation holds 4.3%
of the time. Filtering to `"high"` retains 98.6% of claims and lifts precision by **0.001**.

That answers the question #1209 would otherwise have to ask later, and it answers it in the
unhelpful direction: **confidence gating is not available as a verification strategy.** A
verify-or-snap gate has to check the span. There is no cheap signal to lean on first.

#### Confidence is an ordinal, and modelling it as a number measured nothing

Worth recording, because the first version of this metric produced a clean, confident, wrong
answer. The published prompt asks for `"confidence": "high"` with allowed values
`"high" | "medium" | "low"`; production agrees (`PropositionAnalysisClaim.confidence`), and
all 521 claim rows in the dev database carry a string.

The scorer modelled confidence as a number, binned at 0.5/0.7/0.8/0.9/0.95, and computed an
expected calibration error. Against real output it reported **0 of 70 claims carrying a
confidence value** — because every one of them was the string `"high"`. It was measuring its
own assumption.

There is now no ECE, deliberately: computing one means inventing numeric values the model
never emitted and then measuring the error in numbers of our own devising. What replaces it
is blunter and more useful — the anchoring rate *within* each level, and what filtering to
each level actually buys.

A consequence for anyone designing the gate: confidence is a **three-way choice, not a
threshold sweep**. And on this evidence the three-way choice is between "keep everything" and
"keep everything".

### Fixtures

`fixtures/fulltext-propositions.json` holds ten measures (2,799–13,541 chars), rebuilt
with:

```bash
pnpm --filter @opuspopuli/eval-harness fixtures:fulltext
```

That is a script rather than a psql command **because redaction must not be optional**.
`propositions.full_text` includes the proponent's transmittal letter, which carries a
named individual's postal address, personal email and phone number — nine of ten
measures contain at least one. `src/redaction.ts` strips them and the build fails if
anything survives.

> **Production sends this text unredacted.** The redaction changes the fixture, not the
> pipeline. That the proposition-analysis path puts proponent contact details into an
> LLM prompt is a finding about production, and this harness must not be read as
> evidence that it was fixed.

`fixtures/gold-proposition-analysis.json` carries the per-field `supportable`
judgements, authored by reading each measure. `fiscalImpact` is `supportable: false` on
all ten, each with its rationale — the "fiscal" strings that do appear are a filing
checklist item, "without regard to fiscal years" boilerplate, a "fiscal emergency"
condition, and "Fiscal committee: no" routing metadata. None is a fiscal analysis.

## Throughput — concurrency is not a lever here, for two different reasons

`qwen3.5:9b` Q4_K_M, 8 requests per lane, real measure text, model warmed first.

| concurrency | wall (s) | agg tok/s | median latency (s) | speedup |
| --- | --- | --- | --- | --- |
| 1 | 40.8 | 12.7 | 5.2 | 1.00x |
| 2 | 39.5 | 12.8 | 9.7 (1.85x) | 1.03x |
| 4 | 40.2 | 13.1 | 20.0 (3.82x) | 1.01x |

Wall clock flat, aggregate throughput flat, per-request latency scaling **exactly** with queue
depth. Strict FIFO serialisation: the same work in the same time, each request just waiting
longer.

### Setting `OLLAMA_NUM_PARALLEL=4` changes nothing — and the reason is a trap

Measured 2026-09-15 by restarting the server with the variable set and **nothing else changed**
(`OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0` preserved):

| concurrency | unset | `=4` |
| --- | --- | --- |
| 1 | 40.8s · 12.7 tok/s | 39.7s · 12.9 tok/s |
| 2 | 39.5s · 12.8 tok/s | 39.1s · 12.3 tok/s |
| 4 | 40.2s · 13.1 tok/s | 40.5s · 12.8 tok/s |

Identical within noise. The server log says why:

```
level=WARN msg="model architecture does not currently support parallel requests" architecture=qwen35
load request="{... Parallel:1 ...}"
```

**Ollama accepted `OLLAMA_NUM_PARALLEL=4` and silently loaded with `Parallel:1`.** The downgrade
appears only as a WARN in a log nobody reads — the API exposes no capability flag, and
`/api/ps` looks normal. Anyone who sets the variable, sees it in `printenv`, and assumes it
took effect will be wrong, with no signal anywhere.

### OLMo *does* support it, and it still does not help

`olmo-3:7b-instruct` loaded with `Parallel:4` and four KV slots (`KvSize:131072` = 4 × 32768),
so the architecture genuinely supports parallel requests:

| concurrency | wall (s) | agg tok/s | median latency (s) | speedup |
| --- | --- | --- | --- | --- |
| 1 | 24.8 | 20.3 | 3.3 | 1.00x |
| 4 | 24.7 | 19.7 | 12.1 (3.7x) | 1.01x |

Still flat. So there are **two independent reasons** concurrency is not a lever on this
hardware, and knowing only one would mislead:

1. **qwen35 cannot do it at all**, silently.
2. **olmo3 can, and it gains nothing** — the GPU is already saturated by a single request, so
   there is no idle capacity for batching to reclaim.

### What this settles

- **Every app-side `*_CONCURRENCY` knob is correctly at 1**, and raising one would deepen a
  queue and multiply latency for no throughput.
- **M6's "adversarial review doubles inference" costs 1:1 in wall clock.** No batching relief.
- **The ~48h bills sync cannot be fixed by concurrency**, at either layer.
- **The vLLM-Metal argument loses its main premise.** Continuous batching reclaims idle GPU;
  measured here, there is none to reclaim at batch 1. A serving-runtime migration argued on
  throughput grounds now needs a different argument.
- **Parallel-request support is a model-selection criterion**, not a config decision — it is a
  property of the architecture, and it is only discoverable from the server log.

Incidental but useful for R7: `olmo-3:7b-instruct` is **1.6× faster than `qwen3.5:9b`** on the
same work (24.8s vs 39.7s wall, 20.3 vs 12.9 tok/s).

**Honest limit on the tok/s figure.** `maxTokens` caps work but does not equalise it — these
requests averaged 65 output tokens against a 400 cap, because the prompt asks for two sentences
and the model stopped early. So 12.7 agg tok/s is not comparable to the 20–26 tok/s the
generation leg reports on full analyses. The across-lane comparison is unaffected: all lanes run
identical prompts.

## MLX vs Ollama — definitive: the win is the model, not the runtime

One protocol for every number below: warm on prompt 0, measure on prompts 1–3, take the median,
never reuse a prompt. Prefill and decode separated, because they behave differently.

| runtime | model | weights | prefill | decode | implied |
| --- | --- | --- | --- | --- | --- |
| Ollama | `olmo-3:7b-instruct` `Q4_K_M` | 4.47 GB | 454/s | 42.44/s | 190 GB/s |
| MLX | `Olmo-3-7B-Instruct-4bit` | 4.11 GB | 446/s | 48.44/s | 199 GB/s |
| Ollama | `qwen3.5:9b` `Q4_K_M` | 6.59 GB | 331/s | 19.93/s | 131 GB/s |
| MLX | `Qwen3.5-9B-4bit` | 5.95 GB | 375/s | 42.96/s | 256 GB/s |

### MLX's advantage is almost entirely qwen-specific

- **On OLMo — the architecture the roadmap nominates — MLX and Ollama are equivalent.** 48.44 vs
  42.44 tok/s is 1.14×, and on bytes moved per second it is **1.05×**. Prefill is a dead heat
  (446 vs 454).
- **On qwen it is large**: 2.16× decode, 1.95× on bytes/s.

The asymmetry is Ollama's, not MLX's. Ollama reaches **190 GB/s** implied on OLMo and only
**131 GB/s** on qwen — its `qwen35` support is the outlier. That is consistent with the other
qwen-specific defect measured here: Ollama logs *"model architecture does not currently support
parallel requests"* for `qwen35` and silently loads with `Parallel:1`, while `olmo3` gets its
four KV slots. Both point at `qwen35` being newly and incompletely supported in this build.

### The decision this settles

| change | speedup |
| --- | --- |
| stay on Ollama, switch `qwen3.5:9b` → `olmo-3:7b-instruct` | **2.13×** |
| keep `qwen3.5:9b`, migrate the runtime to MLX | 2.16× |

**These are the same win.** The model switch delivers essentially all of it; the runtime
migration adds about 1% on top — and costs what §1.8 records: a native host process outside
compose, and therefore outside `op-deploy` and its observability.

And the model switch is a direction the project already wants for provenance reasons. So on
throughput grounds there is **no case for migrating off Ollama**. If the platform moves to OLMo,
Ollama serves it at parity with MLX.

### Two earlier framings on this page were wrong, and why

Recorded rather than quietly replaced, because both errors are instructive:

1. **"36–45% of achievable bandwidth, 2.2–2.8× headroom."** Computed from the throughput leg's
   *aggregate* tok/s, which includes prefill and per-request overhead. On this workload the model
   answers in two sentences and stops, so a 4,000-character prompt dominated the figure.
2. **"Ollama prefills 2.46× faster than MLX."** That 1,087 tok/s came from a measurement whose
   warm-up used the *same prompt*, so Ollama's prompt cache served it and prefill was largely
   skipped. Measured on an unseen prompt it is 331 tok/s — and MLX is slightly *ahead* on prefill,
   not far behind.

Both were single-sample measurements of the wrong quantity, and both pointed somewhere real.
Variance is worth noting too: qwen decode read 27.07 tok/s single-sample and 19.93 as a
median-of-three. The OLMo-versus-qwen gap of ~2.1× is far larger than that noise; nothing else
here should be quoted to two significant figures.

### Still unmeasured

Quality at matched quantisation — the 8-bit comparison R3 actually asked for — and the 32B at
either runtime. These numbers also live outside the harness: they were produced by scripts in a
scratchpad, not by `results/` with recorded provenance, because `probeModel()` is Ollama-only.
By this package's own standard that makes them a well-supported claim rather than evidence.

## Model provenance

Every run against a served model records what actually answered:

```json
"provenance": {
  "model": "qwen3.5:9b",
  "digest": "6488c96fa5faab64",
  "quantization": "Q4_K_M",
  "architecture": "qwen35",
  "parameterCount": 9653104368,
  "capabilities": ["completion", "vision", "tools", "thinking"],
  "runtime": { "name": "ollama", "version": "0.18.0" }
}
```

**A tag is not a pin.** `OllamaLLMProvider.getModelName()` returns `this.config.model` —
the bare tag — and `qwen3.5:9b` can be re-pulled and mean different bytes tomorrow. The
digest is the pin, and it goes on the result.

**Quantization is in the result filename**, so two quantizations of one model cannot
overwrite each other's results. `assertComparable()` refuses a q4-vs-q8 comparison outright:
R3 requires matched-quant comparison because Ollama serves q4 by default, and an OLMo-q4
against qwen-q4 is partly a comparison of two quantizations rather than two models.

Worth knowing from the current baselines: the LLMs are served at **Q4_K_M** while
`nomic-embed-text-v2-moe` is served at **F16**. Those are not the same kind of measurement,
and until now nothing recorded the difference.

**A reasoning-capable model must have its `think` setting stated.** `capabilities` reports
`thinking` for such checkpoints, and `assertThinkDecided()` refuses to start without an
explicit `--think` or `--no-think`:

```
qwen3.5:9b reports the "thinking" capability, and no explicit think setting was given.

Left to a default, a reasoning model can spend its whole token budget on hidden
reasoning and return an empty response — which scores as a format failure and reads
as model incompatibility. Pass --think (with a larger budget) or --no-think to state
the decision.
```

That is #1142's first "do not skip" requirement, enforced rather than documented. It is the
configuration error that invalidated the entire first run of this harness.

The in-process Xenova provider gets **no** provenance block: it is not a served model and has
no digest or quantization, and recording an empty record would imply a pin that does not
exist. Tesseract and the OCR replay backend are treated the same way.

## Adding items

Edit `fixtures/retrieval-propositions.json`. The schema is the durable asset — the count grows as the Seed pipeline feeds accepted corrections back in as gold cases.

```jsonc
{
  "id": "ret-en-015",
  "lang": "en",
  "query": "plain-language citizen phrasing",
  "gold": ["25-0001"], // a SET: any member ranking first is correct
  "difficulty": "direct | oblique | ambiguous | cross-lingual",
  "notes": "why these are the right answers, or why the item is hard",
}
```

Prefer **oblique** phrasings over title keywords. A query that restates the title measures string overlap, not retrieval.

## Honest limits

- **Query-authoring bias.** The queries and gold labels were authored by the session that first ran them. Absolute scores are soft. _Comparisons between models over the identical item set_ are the sound use, and `corpusSeparation` is query-independent, which is why the v1.5 verdict rests on it.
- **22 items is a seed, not a benchmark.** M4 targets ~50–100.
- **The corpus is still almost entirely title echo. R2 is NOT done.** Measured 2026-09-14 against the dev database: **53 of 65** `summary` values contain the title verbatim, and stripping the title and the scraper furniture leaves nothing on ~85% of rows. A representative `summary` is the title, then `Title and Summary Issued on <date>`, then the PDF link labels `Fiscal Impact Estimate Report` and `Proponent` — the AG circulating summary was never captured. Since `PropositionEmbeddingService.embeddingSource()` builds `title + "\n\n" + summary`, **production is embedding the title twice plus boilerplate**, and retrieval here is close to title matching.
  An earlier revision of this file claimed the caveat had been resolved by #1219. That was wrong: #1219 fixed a sync rollback on a missing summary, not summary capture, which is #1220 and still open. The bad reading came from a heuristic that tested whether the summary *starts with* the title — it does not, because the boilerplate comes first.
- **Retrieval only.** No generation, JSON-validity, claims-precision, hallucination, or partisan-symmetry metrics yet — those are the rest of M4 (#1142), planned in `docs/plans/1142-llm-eval-harness.md`.
- **The #1074 petition golden set is NOT replayable.** Its numbers are recorded in `docs/plans/1074-petition-retrieval-verification.md`, but scan images are never persisted (`location: 'not-stored'`, deliberate privacy architecture) and neither is their OCR text. Recalibrating `MIN_VERIFIED_SIMILARITY` under a new model (roadmap R5) therefore requires **re-photographing petitions** — the existing measurements cannot be re-derived. Discovered 2026-09-11; plan for it before R5, not during.

## Corpus fixture

`fixtures/corpus-propositions.json` is a snapshot of `title + "\n\n" + summary` for all 65 propositions — the exact string `PropositionEmbeddingService.embeddingSource()` builds, so the harness measures what production embeds.

The corpus is **pinned deliberately**: it is the measurement substrate, so it does not move under a comparison mid-flight. Refresh it when you want a new baseline, not to track the database:

```bash
docker exec opuspopuli-db psql -U postgres -d postgres -t -A -c \
  "select json_agg(j order by j->>'externalId') from (
     select json_build_object('externalId', external_id,
       'text', trim(title || chr(10) || chr(10) || coalesce(summary,''))) as j
     from propositions where title is not null) s" \
  | python3 -m json.tool --indent 2 --no-ensure-ascii \
  > packages/eval-harness/fixtures/corpus-propositions.json
```

Both flags matter as much as the `order by`: without `--indent 2` the file collapses to one line, and without `--no-ensure-ascii` every curly apostrophe in a measure title becomes a `\u2019` escape. Either one rewrites the whole file on a refresh that changed nothing.

**The `order by` is load-bearing.** Without it `json_agg` returns rows in whatever order the scan produced, so a refresh that changed nothing still rewrote most of the file — a 113-line diff for a one-row change, which no reviewer can read. With it, a refresh diff shows only what actually moved.
