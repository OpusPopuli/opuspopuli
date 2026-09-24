# Model selection, measured — 2026-09-23

Every number here came from the real prompts the services send, at the options
they send them with, against real California civic documents. Where a figure
contradicts an earlier claim in this repo, the contradiction is stated rather
than quietly replaced.

## Result

**`nemotron-3.5-lightning:30b-a3b` (GGUF) on both lanes, with
`num_ctx: 131072` set explicitly.** A 30B MoE with ~3B active.

GGUF rather than the MLX build because quality measured equivalent and the
operational properties are better — portable beyond Apple Silicon, and 8x
faster to load. See "MLX vs GGUF" below for what separates them.

The MLX build is **no longer configured as a lane model**. MLX stays in this
document as the measurement it was, and as the reference point that shows what
an unset window costs — not as a deployable option. (Unrelated to the olmOCR
MLX sidecar in the OCR eval, which remains the only working route for that
model; see `packages/eval-harness/src/ocr-eval.ts`.)

**What is and is not committed.** `LLM_ANALYSIS_CONTEXT_TOKENS` /
`LLM_INGESTION_CONTEXT_TOKENS` are declared in `apps/backend/.env.example` and
plumbed through every LLM-consuming service in `docker-compose-uat.yml`, both
defaulting to empty — so this decision is reviewable in the repo, but **no
tracked file selects the model or the window**. Both are set per deployment:
on the author's workstation by a local overlay that is deliberately never
committed. Read every claim here as measured-on-one-48GB-MacBook until a node
records its own.

## The finding that decided it

Ollama enforces `num_ctx` by **silently truncating the prompt**. No error, no
flag — a fluent, well-formed answer about the fragment it read.

Against AB 1830, a real 451 KB California bill (~112,878 estimated tokens):

| model / build | prompt tokens read | coverage | wall | valid JSON |
|---|---|---|---|---|
| lightning **MLX** | **107,298** | **95%** | 260s | yes |
| lightning GGUF, default `num_ctx` | 16,386 | 15% | 5s | yes |
| lightning GGUF, `num_ctx: 32768` | 16,386 | 15% | 5s | yes |
| lightning GGUF, `num_ctx: 131072` | **107,298** | **95%** | 314s | yes |
| qwen3.5:9b | 16,386 | 15% | 10s | yes |
| olmo-3:7b-instruct | 16,386 | 15% | 52s | yes |

`16386` is `16384 + 2` — a 16K window plus two. **Every fast run in that table
is a model that did not read the bill**, and every one of them returned valid
JSON describing roughly the first 15% of it.

Two consequences:

- MLX is the only build that reads long documents **by default**. GGUF gets
  there with `num_ctx: 131072`, but **32768 changed nothing** — the setting is
  not simply "whatever you ask for", and being wrong about it is silent.
- This corrects an earlier claim of mine that `num_ctx` is a no-op. It is a
  no-op at 6.6K-token civics prompts (measured, three seeds, both arms
  identical) and decisive at 112K. Both were true of their own case; the
  generalisation was not.

Detection shipped in #1322 — `prompt_eval_count` was already on every response
and simply never compared against what we sent.

## Analysis lane — 10 propositions, live v3 prompt, fixed seeds

| model | parsed | claims | located | rate | citable/doc | mean wall |
|---|---|---|---|---|---|---|
| qwen3.5:9b | 10/10 | 62 | 43 | **69%** | **4.3** | 321s |
| **lightning MLX** | 10/10 | 61 | 33 | 54% | 3.3 | **34s** |
| olmo-3.1:32b-instruct | 9/10 | 79 | 20 | 25% | 2.2 | 783s |

Qwen is the more accurate model per claim. Lightning produces **7× more citable
output per minute**, which is what decides a 5,019-row corpus.

This also contradicts the selection recorded in `llm.config.ts`, which chose
the 32B on 57% claim anchoring against the 7B's 28%. That comparison was not
wrong — it simply never included the model already running in production.
Its "~550 s/measure" was also contention-inflated: idle, the 32B is 183s.

## Ingestion lane — real civics-extraction prompt

| model | wall | output tokens | valid JSON | keys |
|---|---|---|---|---|
| **lightning MLX** | 56s | 4,415 | yes | 4/4 |
| olmo-3:7b-instruct | 66s | 2,399 | yes | 4/4 |

## Bills — 5 real bills, 11 KB to 451 KB

| model | valid | read completely |
|---|---|---|
| **lightning MLX** | 5/5 | **5/5** |
| qwen3.5:9b | 5/5 | 4/5 |
| olmo-3:7b-instruct | 3/5 | 3/5 |

Qwen's "5/5 valid" was really 4/5 complete plus one confident summary of 15% of
a document — which is why validity alone is not a sufficient metric.

## Spanish — `briefing-summary`, the only prompt that asks for Spanish

| model | Spanish | counts correct | civic lever terms |
|---|---|---|---|
| **lightning MLX** | yes | yes | 4 |
| qwen3.5:9b | yes | yes | 2 |
| olmo-3:7b-instruct | yes | **no — dropped a count** | 4 |

OLMo produced *"El póster de tu denuncia"* — "the poster of your complaint" —
an invented phrase unrelated to a civic briefing, and silently omitted the
proposition count. #1156 made Spanish parity decisive for the embeddings model;
the same bar applies here.

## MLX vs GGUF — same weights, both lanes measured

Asked directly: are they the same once GGUF's context window is set?

| | MLX | GGUF @ `num_ctx: 131072` |
|---|---|---|
| analysis — citations located | 33 of 61 (54%) | **33** of 64 (52%) |
| analysis — citable per document | 3.3 | **3.3** |
| analysis — mean wall | 34s | 35s |
| civics — valid JSON, keys present | yes, 4/4 | yes, 4/4 |
| civics — output tokens | 4,415 | 2,266 |
| civics — wall (warm) | 56s | **36s** |
| 451 KB bill — coverage | 95% **by default** | 95% **only at 131072** |
| cold load | 131.3s | **15.7s** |

**Quality is equivalent**: the same 33 located citations, the same citable
output per document. The 2-point rate difference is GGUF emitting 3 more
claims, not locating fewer.

One difference that is real but unquantified: GGUF produces roughly **half the
civics output** (2,266 vs 4,415 tokens) while still returning all four keys.
Terser, not broken — content depth was not compared, so "same keys" is not
"same richness".

**The decision is therefore operational, not qualitative.** GGUF is portable
and boots 8x faster; its cost is depending on a setting that fails silently
when wrong. `num_ctx: 32768` reads exactly as much as no setting at all —
16,386 tokens — so a plausible value is not a safe one. That footgun is
acceptable *because #1322 now detects the condition*: we rely on a setting plus
a detector, rather than on a setting alone. Without that detection, MLX would
be the right default.

## Load time, which is not free

| build | cold load |
|---|---|
| lightning MLX | **131.3s** |
| lightning GGUF | 15.7s |

MLX's load is its real weakness, paid on every service restart. It is
acceptable because a deployment runs **one model for both lanes**, so lanes
never swap and the cost is paid at boot rather than per call. It would not be
acceptable in a deployment that switched models per request.

## What is NOT measured

- **`nemotron-3-super`** — 86 GB, and the Studio holds a 63 GB Docker VM in
  128 GB of RAM. It cannot be resident alongside production, so it was never
  benchmarked. Revisit on a 256 GB machine.
- **Anything but this MacBook.** Every figure is from one 48 GB machine.
- **GGUF content depth on civics.** It returns all four keys in half the
  tokens; whether the shorter output is as complete was not scored.
- **Either build on anything but Apple Silicon.** GGUF is portable in
  principle; no non-Mac run was made.
- ~~**The civics production failure** — a 32,000-token runaway producing 155 KB
  with no JSON, twice, which a hand-rebuilt prompt does not reproduce. Still
  unexplained.~~ **EXPLAINED 2026-09-24, and it was not a runaway.** Captured in
  full by arming #1321's `CIVICS_CAPTURE_DIR` — which no deployment set, which
  is why it had never fired. On `assembly.ca.gov/resources/glossary` the model
  returned 141,786 chars of **well-formed JSON containing 211 complete glossary
  terms**, then stopped mid-string with `finishReason: 'length'`. Every element
  of the original description was the output ceiling doing its job: "32,000
  tokens" *was* `maxTokens`, and "no JSON" meant the JSON had no closing brace
  so the extractor's slice found none. The cause is nemotron extracting the
  glossary ~7× more completely than qwen (211+ terms against 30), which
  overflows a budget 30 terms never approached. Fixed by raising the budget and
  by making the log name the ceiling instead of reporting malformed output.

  Two lessons worth more than the fix. The structured field `hitTokenCeiling`
  was already being logged beside that warning — the *message* is what a human
  reads, and it said the wrong thing for two days. And a diagnostic that is
  off by default is not a diagnostic.

- **Civics extraction was non-deterministic.** Two identical syncs on
  2026-09-24 disagreed about 2 of 24 pages — `how-qualify-initiative` returned
  nothing on one run and 10,871 bytes on the next, and
  `information-help-you-follow-process` did the reverse. `temperature: 0.1`
  with no seed. Any per-page comparison made before 2026-09-24 measured this
  variance along with whatever it meant to measure. Now seeded.

- **Three pages fail reliably** and are the real targets for prompt work:
  `teachers-and-students` (17 KB in the qwen baseline), `attorney-general-information`
  (13 KB) and `qualified-ballot-measures` (12 KB) all extract to nothing. Not
  measured here: whether that is the prompt, the model, or the HTML-to-text step.

## Reproducing

```bash
pnpm --filter @opuspopuli/eval-harness eval:context -- \
  --models nemotron-3.5-lightning:30b-a3b \
  --num-ctx 131072
```

**What that command does and does not reproduce.** It sends proposition full
text, largest first, and reports coverage per run — so it reproduces the
*method* and the truncation signal. It does **not** reproduce the AB 1830 rows
in the table above: `Bill` holds only a `full_text_url`, not the text, so bill
bodies are not in the database for the harness to read. Those figures were
measured by hand before the harness existed, and are recorded here as the
finding rather than as the tool's output. Reaching them from the harness means
resolving `full_text_url` first, which is filed separately.

For the same reason there is no "valid JSON" column in the harness output. The
prompt it sends is the document alone — prompt text lives in `prompt-service`
and is never inlined in this repo — so nothing asks the model for JSON. The
"valid JSON" observations in the tables above come from the runs that used the
real service prompts.

Two lanes, one variable: `LLM_ANALYSIS_CONTEXT_TOKENS=131072` arms both, since
ingestion falls back through the analysis value.
