# Phase B — propositions

Second type in Phase B (`ingestion-resource-lanes.md` §10.2; owner order
2026-10-23: civics, **propositions**, representatives, meetings, campaign
finance, bills). Same five steps as civics (`civics-phase-b.md`): skip fixes,
attribution gaps, lanes, re-measure with no quality regression accepted, UAT
before the PR. Owner decision (2026-10-23): every type gets the same staged
pipeline whatever it gains; metrics order the work, never exempt a type.

## What is true today (read 2026-10-24)

Paths: `PSS` = `apps/backend/src/apps/region/src/domains/propositions-sync.service.ts`,
`PAS` = `…/proposition-analysis.service.ts`.

- **The run is CPU-bound, and the CPU work is repeated.** Gate 0 (2026-10-22):
  553 s, `pdf_parse` 73%, GPU busy 13.4%, 3 LLM calls. Every detail PDF is
  re-downloaded and **re-parsed every run** — `ExtractionProvider.fetchPdfText`
  archives the bytes in `source_versions` (which dedupes on the hash) and then
  runs `PdfExtractor` regardless (`extraction.provider.ts:320,392`).
  `PdfExtractor` (pdf-parse → mupdf text → mupdf raster + OCR) runs on the
  event loop, no thread pool. That row predates the fetch-metric fix, so its
  `fetch` share is understated.
- **Phases** (`sync-phase-logger.ts:77-81`): `discover` (the whole scraping
  pipeline — fetch, PDF parse, ingestion-lane LLM: structural analysis on a
  manifest miss, self-heal, extraction-plan derivation for non-PDF detail
  pages), `extract_and_upsert`, `analysis`.
- **Analysis is one corpus-wide pass after the scrape**, on no queue:
  `generateMissing()` (PSS:342) over every region's rows, deliberately
  (PAS:223-242), in sequential batches of `PROPOSITION_ANALYSIS_CONCURRENCY`
  (default 1). Analysis-lane provider (`LLM_ANALYSIS_PROVIDER`); like every
  worker LLM call it already goes through S7's lane.
- **Analysis staleness has no model and no config axis.** `generateMissing`
  re-runs a row when never analysed, when its prompt hash differs from the
  live one, or when `analysis_source_text_hash` ≠ `full_text_hash`
  (PAS:266-305). A model pull does not invalidate an analysis (memory, and
  confirmed here); nor does a change to the normalisers or the generation
  settings (`maxTokens` 6000, `temperature` 0.2) that shape what is stored.
- **A stale-check bug.** Single-row `generate()` uses `isCurrent()`
  (PAS:380-405), which also requires `updatedAt <= analysisGeneratedAt` —
  and every sync upsert bumps `updatedAt` (PSS:189-267), as does
  `writeVector` (`proposition-embedding.service.ts:252`). So that path treats
  every row as stale after any sync. `generateMissing`'s comment says rows
  touched since analysis are "caught by the isCurrent() filter below"; no
  such filter is applied (`const pending = candidates;`, PAS:322).
- **Decoding is sampled** (`temperature: 0.2`, no `topK`, no seed): unlike
  civics, an analysis is not a function of its input, so "equivalence" in
  acceptance is structural, not byte-identical.
- **Embeddings** (`proposition-embedding.service.ts`): over `title + summary`
  (the schema comment saying fullText is wrong), skipped when
  `embedding_source_hash` matches; corpus-wide, serial, inline; records the
  model name, no digest; not on any lane.
- **Attribution.** Analysis rows carry prompt hash/version, model, digest,
  source-text hash — no config hash, and no extractor version. Claims carry
  `source_version_id` and `source_text_hash`; `pipeline_execution_id` is not
  set for propositions. Row extraction (title, summary, fullText) carries
  `pipeline_execution_id`, manifest and `source_version_id`, not the
  ingestion prompt/model.
- **The skip-key helper has one caller** — civics.
- **Eval legs exist:** `eval:generation` (the analysis prompt: JSON
  validity, numeric grounding, abstention, anchoring; 10-item gold) and
  `eval:symmetry` (yes/no). The model plan's §4.2 yes/no asymmetry finding
  ("read the template's yesOutcome/noOutcome instructions — not another
  model") was acted on: prompt-service#114, fixed by #115; the live template
  is v4 (#121).
- **Local corpus (2026-10-24):** 72 propositions (57 California, 15 Sonoma),
  all analysed, one prompt hash, one digest (nemotron), none stale on text.

## Steps

### 0. Re-take the baseline

One propositions sync on the current image, measured with
`docs/runbooks/gate-0-baseline.md` (host idle, `caffeinate`), split by LLM
lane so the "3 calls" are identified. And the quality reference on the same
day and runner configuration (`ollama.log` `-b`/`-ub`/`-c`; see
`civics-phase-b.md` §4): `eval:generation` and `eval:symmetry`.

**Baseline taken 2026-10-24** (UAT, main after #1407, host idle, job 115):

| propositions | |
|---|---|
| run | 512 s — 0 created / 52 updated / 0 failed |
| `pdf_parse` | **399 s (78%)**, of which **OCR 377 s (74%)** |
| `fetch` | 79 s (15%) — the 2026-10-22 row understated it |
| LLM calls | **0** — GPU idle the whole run |

Stages overlap (OCR runs inside `pdf_parse`), hence the >100% total. The
"3 calls" of the 2026-10-22 row were not repeated: every analysis was current.
**The run is re-OCRing scanned PDFs whose bytes have not changed** — K-P1 is
worth ~6.5 of its ~8.5 minutes on an unchanged run; S4 matters only when text
or the prompt changes.

**Symmetry reference** (`eval:symmetry --model nemotron-3.5-lightning:30b-a3b
--no-think`, prompt v4, 398 s; Ollama runner `-c 32768 -b 512 -ub 512`;
`results/symmetry-2026-10-24-pre-phase-b.json`):

| reading | value |
|---|---|
| within-measure yes/no length ratio | **0.795 — yes longer on 9/9** (two-sided p ≈ 0.004) |
| hedging | 2 markers across 18 texts |
| control pair (near-identical filings) | **flagged**: provisions 4 vs 7 — the provision metric fires on near-identical input, so provision readings are untrustworthy |
| mirrored pairs | n = 3, mean length ratio 0.818, 0/3 flagged (one pair skipped) |

**Finding, outside Phase B's scope:** the yes/no asymmetry the model plan
(§4.2) traced to the prompt is **not** fixed by prompt-service#115 / template
v4 — it is stronger than the original reading (8/10, p ≈ 0.109): every
measure's `yesOutcome` runs longer than its `noOutcome`. Phase B must only not
make it worse (it does not touch the prompt or the output); the fix belongs in
prompt-service and is raised with the owner.

### 1. Skip fixes

- **K-P1 — do not re-parse an unchanged PDF.** When `fetchPdfText`'s bytes are
  already archived *and* their parse was recorded under the same **parser
  key**, return that text instead of running `PdfExtractor`. Lives in
  `ExtractionProvider`, so meetings (Phase B #5) gets it too. The parsed text
  cannot be `source_versions.derived_text`: that is write-once and holds what
  the *subject row* stored (minutes truncate it at 256 kB), not what the
  parser produced. *Decision below.*
  - **The parser key** is `PDF_EXTRACTOR_VERSION` (bumped by hand with any
    cascade change) **plus a hash of what this process parses with**: the
    installed pdf-parse and mupdf versions and `OcrService.getProviderInfo()`
    (engine, languages, preprocessing, and the engine's own version —
    tesseract.js reports it). Two processes OCRing differently never serve
    each other's parses, and a dependency or engine bump re-parses
    unprompted. They do, though, **take turns overwriting the one slot**, so
    neither reuses: the region, region-worker and structural-analysis-worker
    (the only processes with a source archive) must share one OCR config —
    they do on UAT (one `x-backend-env`); check the node compose before
    deploy. A parse found under another key is logged at info, the signal
    that this is happening.
  - **Only complete parses are recorded.** Not complete: OCR unavailable, OCR
    threw, or OCR came back short of meaningful text — a blank scan and a
    silently bad read look alike, so a truly blank PDF is re-OCRed each run
    rather than a bad read pinned.
  - **Not reused:** the `pdf` source type (`pipeline.service.ts:1108`) fetches
    without `archive`, and PDFs over the 25 MB archive cap are never archived
    — the latter likely the costliest OCR jobs, which matters for meetings.
    Petition scans (`scan.service.ts`) use the non-archiving
    `extractPdfText`, correctly: petition OCR must not be recorded.
- **K-P2 — the analysis skip key.** `buildSkipKey` over `full_text_hash`,
  the live prompt hash, the analysis model digest and a config hash of
  `PROPOSITION_ANALYZER_VERSION` (the normalisers and post-processing) plus
  the effective `maxTokens` and `temperature`. Region config does not reach
  the analysis prompt (`formatPropData` is id + title + fullText), so it is
  not in this key. Stored on the row (`analysis_config_hash`, additive),
  compared component by component like today's selector, with the model axis
  added. *What to do with the 72 rows that have no config hash — decision
  below.*
- **Fix the stale check:** drop the `updatedAt` condition from `isCurrent()`
  (the key replaces it) and correct the `generateMissing` comment.
- **Embeddings** already skip on their source hash; add the embedding
  model and, where the provider reports one, its digest to that comparison,
  so a provider, model or weights change re-embeds. Every existing vector
  has no digest yet, so on an Ollama node the first run re-embeds all ~72
  once (seconds — short title + summary texts); xenova reports no digest and
  re-embeds nothing.

### 2. Attribution gaps

- `analysis_config_hash` (above).
- `embedding_model_digest` where the provider exposes one (Ollama does;
  xenova records its model id).
- ~~Claims: set `pipeline_execution_id` for proposition claims~~ —
  **dropped (2026-10-24).** That column means "the run that produced this
  claim", and an analysis claim is produced by the analysis generation, which
  is not a scraping `PipelineExecution`; the row's own `pipelineExecutionId`
  is the scrape that produced its *text*, so reusing it would misattribute
  every claim. A bad analysis is scoped by the proposition's
  `analysisPromptHash` / `analysisLlmDigest` / `analysisConfigHash` and
  `analysisGeneratedAt`.

### 3. Lanes

- **S4 — analysis onto its own queue.** After the upsert, every row whose
  analysis key differs becomes one `proposition-analysis` job
  (`laneJobId(<id>, 'analyse', skipKey)`, removed on finish),
  consumed by a region-worker processor that reloads the row and re-checks
  the key; the sync waits for every outcome through `src/common/child-jobs`
  (the civics S3 template), so its lock and counts keep their meaning.
  Corpus-wide scope kept, as `generateMissing` is today. Thrown errors retry;
  a parse failure is recorded (`analysisFailureReason`) and returned.
- **Embeddings** ride the same pattern only if the measurement says they
  cost anything; at 72 rows of title + summary, inline is likely right.
- **PDF parse (S6, the CPU lane)** stays planned for meetings (§10.2 #5),
  where OCR dominates. For propositions, K-P1 removes the repeated parse on
  every unchanged run, which is what the 73% was.

**UAT, steps 1–2 (2026-10-24, migration applied):**

| run | result |
|---|---|
| 1 (job 116) | 488 s — every PDF parsed once and its parse recorded (95 of 112 archived versions; the other 17 are Sonoma's, not fetched by a California sync); **all 72 analyses stamped, 0 re-analysed**; parser key `pdf-extractor-1+f176f6143663` |
| **2 (job 117)** | **92 s (baseline 509 s) — `pdf_parse` 0 s and `ocr` 0 s (were 399 s and 377 s); `fetch` 67 s is now the run** |

Run 2 also proves the reuse is exact: 0 analyses went stale, so every reused
parse yielded the same `full_text` hash a fresh parse had.

Re-taken on the final code (round-2 review added the OCR engine version to
the parser key, so the key changed): run 3 (job 118) 480 s, all 95 re-parsed
under `pdf-extractor-1+7cf950246438`, the "recorded under another key" info
line firing once per PDF as designed; **run 4 (job 119) 92 s, `pdf_parse`
0.0 s**, no such lines, 0 analyses stale.

#### S4 — design (2026-10-25, after #1408 merged)

The civics S3 template (`civics-phase-b.md` §3) and its owner decisions —
**the sync waits for its jobs**, jobs carry **ids, not content** — apply
unchanged; this section records only what is specific to propositions.

- **Queue `proposition-analysis`**, one job per stale measure, payload
  `{ propositionId }`. Job id `laneJobId(<propositionId>, 'analyse',
  skipKey)`, the skip key `buildSkipKey(full_text_hash, prompt hash, model
  digest, analysis config hash)` — the four axes of K-P2, so a run's job
  collapses onto an in-flight job only for identical inputs; an unknown
  digest gets a one-off id. Removed on finish.
- **The sync's analysis phase** selects the stale measures exactly as
  `generateMissing` does (legacy stamp first, then `staleWhere`, the
  `PROPOSITION_ANALYSIS_MAX_PROPS` cap, corpus-wide as today), queues them,
  and counts each measure's outcome as it arrives — one tracker item per
  measure, where today it logs one "analysis pass complete" item whatever
  happened. Then it invalidates the propositions cache if anything was
  written.
- **The worker** (`PropositionAnalysisProcessor`, region-worker,
  `BULLMQ_QUEUE_PROPOSITION_ANALYSIS_CONCURRENCY`, default 1) reloads the row,
  **re-checks it on every axis** (`isCurrent`) and analyses it. Its outcome:
  `created` (first analysis) | `updated` | `unchanged` (current by the time it
  ran) | `failed`.
- **Retries — the proposition-specific part.** Today every error, transport
  included, is caught and recorded as `analysisFailureReason`. The worker
  keeps recording it, then **throws on `llm_error`** (a runner killed, the
  lane unreachable — transient), so the queue retries; a later success
  clears the reason, as now. The deterministic reasons (`truncated`,
  `no_json`, `parse_error`, `no_summary`) are recorded and **returned** as
  `failed`, not retried: `truncated` is the budget, the rest would cost a
  full generation to likely repeat.
- **Unchanged paths:** `generateMissing` (the backfill script) and
  `regenerate(id)` (the operator resolver, an interactive single row) stay
  in-process. Embeddings stay inline — 72 short texts, measured cheap.
- **One queue helper for every type.** `CivicsExtractQueue` becomes a
  generic `ChildJobQueues` (open a batch / is-enabled, by queue name), so the
  second type does not copy the first.

**Acceptance:** an unchanged sync queues nothing; a changed prompt or digest
re-analyses exactly the stale measures through the queue; a worker restart
mid-analysis re-runs only the interrupted measure; a transient failure is
retried within the run and a parse failure is not; outcomes per measure
appear in the phase log; `eval:generation` and `eval:symmetry` match step 0
within sampled-decoding variance, on the same runner configuration.

**UAT, S4 (2026-10-25).** No proposition was stale, so a temporary compose
override set the worker's `PROPOSITION_ANALYSIS_MAX_TOKENS=6001` (the config
axis) and `PROPOSITION_ANALYSIS_MAX_PROPS=5`:

| run | result |
|---|---|
| A — unchanged | 92 s; analysis phase queued **nothing** (0 items) |
| B — override on | 261 s; **5 measures, 5 `proposition-analysis` jobs**, one at a time, 22–47 s each, every outcome logged by name (`[1/5] 25-0004A1: analysed` …); job ids `<id>__analyse__sk1-<key>` |
| D — override removed | 200 s; **exactly the same 5** re-analysed under the normal config; all 72 back on one config hash |

Not run on UAT: a worker restart mid-analysis. The mechanism is the shared
child-jobs helper and BullMQ, exercised on the real stack by civics (run 5:
queued jobs carried on, only the interrupted item re-ran); the one
proposition-specific part — re-checking a measure that became current — is in
the integration spec. On UAT the crashed worker's type lock would block the
restoring run D for an hour (S2's lock TTL).

### 4. Re-measure and gate

- **Throughput:** an unchanged second sync makes no PDF parse and no
  analysis call; a prompt or model change re-analyses exactly the affected
  rows.
- **Quality:** `eval:generation` and `eval:symmetry` on the final image
  match step 0 within run-to-run variance (sampled decoding), on the same
  runner configuration.

### 5. UAT

Two syncs (the second skipping), one forced (`resetWatermark` re-analyses),
and a worker restart mid-analysis, as for civics.

## Owner decisions (2026-10-24)

1. **The 72 analyses with no config hash are backfilled as current**, not
   regenerated. Done at runtime, not in the migration: the hash includes the
   *effective* `maxTokens`, which a deployment can override
   (`PROPOSITION_ANALYSIS_MAX_TOKENS`), so a literal in SQL would be wrong on
   any node that does. The first sync stamps the config hash on rows whose
   prompt hash, model digest and text hash already match the live ones, and
   counts them as unchanged; a row that differs on any of those is
   re-analysed as it would be today. *Refined in review:* the stamp fills
   only the config column, so it does not wait for the prompt hash or digest
   to resolve (a row stale on those is still caught by their own axes);
   waiting would re-analyse every legacy row on a run whose digest lookup
   failed. **An accepted assumption, not a proof:** a row analysed under
   another `PROPOSITION_ANALYSIS_MAX_TOKENS`, or before a normaliser change,
   is stamped as this analyzer's too.
2. **Parsed-PDF text lives on `source_versions`**: additive, nullable
   `parsed_text`, `parsed_text_hash`, `parser_version` — beside the bytes it
   came from, one row per content hash (one extra indexed read per PDF after
   the archive's own probe).

## Risks

| Risk | Mitigation |
|---|---|
| A reused parse serves text from an old parser | `parser_version` in the reuse check; bump it with any `PdfExtractor`/OCR change |
| The model axis regenerates the corpus on every `ollama pull` | That is the intended behaviour; it is visible in the sync's counts, and `resetWatermark`-style forcing is not needed |
| Sampled decoding makes acceptance noisy | Structural checks (fields present, claims grounded) and the eval legs, not output equality |
| Corpus-wide analysis inside a region-scoped sync holds the propositions type lock for both regions' work | Unchanged from today; recorded |

## Data classification

Public civic text. Proposition full text can carry proponent contact details
(public-figure PII, public by policy); none of it enters a job payload (ids
only).
