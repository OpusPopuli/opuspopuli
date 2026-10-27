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

#### Network and CPU lanes — design (2026-10-25)

*Renamed 2026-10-26 (owner: lanes are named for the resource they consume): the
"fetch lane" is the **network lane**, its knob `NETWORK_LANE_CONCURRENCY`
(`networkLaneConcurrency()` in `@opuspopuli/common`, shared with civics), and
the S7 "LLM lane" queue is the **GPU lane**. See `civics-phase-b.md` §3b.*

**Owner decision (2026-10-25):** propositions gets all three lanes, not the
GPU lane alone — the consistency principle applied to S6 as it was to S3.
Further decisions: build the CPU lane for N-way parallelism but **leave the
container limits as they are** (raising them is a later, measured change to
the node compose); the mupdf licence question filed separately (#1410).

**Revised 2026-10-25 — the goal is multi-host scaling as a flip of a switch.**
Parallelism through a **built-in `worker_threads` pool** inside the
`pdf-parse` consumer, not BullMQ worker-thread processors: a BullMQ sandboxed
processor runs the whole job in the thread, so each slot would carry its own
Prisma engine and connection pool and its own OCR stack; the pool runs only
the CPU work (bytes in, text out). Multi-host comes from the QUEUE in either
design — another process anywhere consumes `pdf-parse` — so the pool loses
nothing there, and it is reusable where a queue is not (the synchronous
petition scan, xenova embeddings). The pool sits behind a `parsePdf(bytes)`
interface so it can become child processes if native crashes ever appear —
the one thing a sandbox's child-process mode would buy. And the switch is made
explicit: **`WORKER_QUEUES`** says which consumers a worker process starts,
proved by a **two-worker UAT** in which a second container parses every PDF.

**What is true today (read 2026-10-25):**

- `region-worker` is capped at **1 CPU on UAT, 2 in prod** (6 GB each). The
  14 cores on the Mac buy nothing until those limits move.
- Everything in the PDF cascade but OCR runs **on the worker's one JS
  thread**: pdf-parse (pdfjs's in-thread fake worker), mupdf's open,
  render and PNG encode (synchronous WASM), and the OCR preprocessing's
  deskew (pure JS, 61+ passes per page). OCR itself runs in a tesseract.js
  worker thread — **one**, shared, so concurrent OCR calls serialise.
  `createScheduler` exists and is unused.
- The detail crawl (`detail-crawler.service.ts`) is a serial loop with a
  fixed 500 ms pause, on top of the shared per-host Redis token bucket (S1)
  that already bounds request starts per host across any number of callers.
  California's limit is 1 req/s, burst 3, per host. The extraction plan is
  resolved on the first successful item and reused. **The crawler is shared
  with representatives** (Assembly, Senate, 29 counties).

**Network lane.** Resolve the extraction plan on the first item alone, then
fetch the rest **concurrently**, bounded by a per-run pool
(`NETWORK_LANE_CONCURRENCY`, default 4) — the token bucket, not a pause,
keeps each host at its configured rate. Drop the fixed 500 ms pause (and the
secondary-detail one), which only stacked on the limiter. Each item still
gets its own content (items are enriched in place); warnings and the
per-field failure map now fill in completion order, so their order — and
which item's failure a field's entry names — can differ run to run.
Expected: an unchanged propositions run ~92 s → ~50 s (two hosts overlap;
each stays at 1 req/s). Representatives benefits the same way.

*Measured 2026-10-25 — the expectation was wrong.* An unchanged run still
takes 90 s in discover, because 94 of its 97 requests go to ONE host
(`oag.ca.gov`), and 97 requests at 1 req/s is the run. The lane is working —
`pipeline_stage_duration_seconds{stage="fetch"}` summed 344 busy seconds over
those 90 s, ~3.8 fetches in flight against `NETWORK_LANE_CONCURRENCY=4` —
but each in-flight fetch spends its time waiting for a token. Propositions'
unchanged run is bound by the per-host rate, which is a politeness setting
and the owner's call, not by our concurrency. Where the lane does pay: a
source spread over many hosts (representatives' 29 counties), and responses
slower than the token interval.

**CPU lane (S6).**

- **Queue `pdf-parse`**, one job per archived PDF that has no recorded parse
  under this process's parser key; payload `{ sourceVersionId, parserKey }`,
  job id `<sourceVersionId>__parse__<sha256(key)[0:16]>` — so two requests
  for one artifact under one key share a job. The
  extraction provider gains an optional **`PDF_PARSE_LANE` port**, called in
  `parseArchivedPdf` after the reuse check misses; unbound — or no
  `sourceVersionId` (not archived, or over 25 MB) — it parses in process, as
  now.
- **The consumer** (`PdfParseProcessor`, region-worker) loads the bytes and
  records the parse through `SourceVersionService`, and hands only the CPU
  work to a **pool of worker threads**, each with its own mupdf and its own
  tesseract worker, so mupdf, pdf-parse and deskew stop sharing the event
  loop that renews every lock. Bytes are transferred, not copied. Pool size =
  `BULLMQ_QUEUE_PDF_PARSE_CONCURRENCY`, **default 1**; each thread has a
  memory cap (`PDF_PARSE_THREAD_MAX_MB`) and a parse that exceeds its timeout
  has its thread terminated. Tesseract only — `OCR_PROVIDER=vision` is an LLM
  call, not CPU work, and keeps parsing in process.
- **The parser key now covers the preprocessing pipeline** (found while
  building this): `OcrService.getProviderInfo()` reported whether
  preprocessing was on, not WHICH — two hosts on different
  `OCR_PREPROCESSING_PRESET`s, which OCR differently, produced the same key and
  could reuse each other's parses. It now includes the preset and the enabled
  steps. One-time cost: every recorded parse re-parses once after deploy.
- **The consumer computes its own parser key** and records under it. A host
  whose OCR configuration differs from the requester's therefore never
  records a parse under the wrong key: the key mismatch is reported and the
  requester parses for itself.
- **A bounded wait.** The requester waits for its parse job up to
  `PDF_PARSE_LANE_TIMEOUT_MS` (10 min) and then parses in process, so a lane
  with no consumer anywhere (every host's `WORKER_QUEUES` excluding it) costs
  time, not a stuck sync.
- **The text does not travel through Redis.** The consumer loads the bytes
  by id, the thread parses, and the consumer records a complete parse with
  `attachParsedText` (K-P1's store); the job's return value is one word —
  `parsed`, `reused`, `incomplete`, `key_mismatch` or `missing`. On `parsed`
  or `reused` the caller reads the text back with `getParsedText`. *Changed
  in implementation:* an incomplete parse (OCR unavailable) is not returned
  through the job — the caller parses in process, as it would with no lane.
  That costs a second parse in the one case that is already degraded, and
  keeps a megabyte-scale fallback text out of Redis.
- **Waiting:** the network lane's concurrency is what fills the CPU lane — N
  detail items in flight each await their own parse job.
- **The rasteriser stays behind `PdfExtractor`**, so #1410's outcome can swap
  mupdf without touching the lane.

**The role switch — `WORKER_QUEUES`.** A comma list read by the worker
factory: `*` (the default — every consumer, as today), queue names,
`prefix*`, and `!name` to exclude. A CPU host is the region-worker image with
`WORKER_QUEUES=pdf-parse` and the pool sized to its cores; the requesting host
runs `WORKER_QUEUES=*,!pdf-parse`. Distinct from `BULLMQ_QUEUE_<NAME>_ENABLED`,
which switches a QUEUE on or off everywhere (producers then run that work in
process); `WORKER_QUEUES` decides only which process CONSUMES it. Committed as
a UAT overlay (`docker-compose-uat.multihost.yml`) and a multi-host runbook.

**Acceptance:** an unchanged run makes no parse job (K-P1 reuse) and fetches
concurrently within the per-host rate; a changed-PDF run with
`BULLMQ_QUEUE_PDF_PARSE_CONCURRENCY=2` (prod's CPU limit) roughly halves the
OCR wall time against one, with identical parsed text (same `parsed_text_hash`
as an in-process parse of the same bytes); the event loop stays responsive
during OCR (lock renewal never misses); memory per parse thread measured and
recorded before any default above 1; representatives' sync still matches its
gold eval (`representatives-gold-eval.md`); **two-worker UAT**: with the
multihost overlay, every PDF a propositions sync parses is parsed by the
second container (its logs), with the same `parsed_text_hash` as an
in-process parse.

#### Implemented (2026-10-25)

| Piece | Where |
|---|---|
| Thread pool (respawn on exit, terminate on timeout, heap cap) | `src/common/cpu-lane/thread-pool.ts` |
| Thread script; `PDF_PARSE_THREAD_FILE` keeps it in `nest build --tsc`'s output (nothing imports a thread script for its code) | `src/common/cpu-lane/pdf-parse.thread.ts`, `pdf-parse-thread-file.ts` |
| Requester (`PDF_PARSE_LANE`), never throws | `region/src/infrastructure/queued-pdf-parse-lane.ts`, bound inside `ExtractionModule`'s scope |
| Long-lived shared waiter for per-item jobs requested deep in other work | `src/common/child-jobs/child-job-waiter.ts` |
| Consumer, pool sized by `queueConcurrency('pdf-parse')` and created on the first job | `region-worker/src/pdf-parse.processor.ts` |
| OCR built from env without Nest, so thread and module key identically (and the `OCR_PREPROCESSING_ENABLED=false` comparison bug fixed: it compared a boolean to a string, so preprocessing could never be turned off) | `ocr-provider/src/ocr-from-config.ts` |
| `WORKER_QUEUES` | `queue-provider/src/worker.factory.ts` |
| Network lane | `scraping-pipeline/src/crawling/detail-crawler.service.ts`, `common/src/utils/concurrency.ts` |

Smoke-tested from `dist/` before UAT: two parses of one PDF on a two-thread
pool ran concurrently (337 ms) while a 10 ms main-thread timer kept firing
(31 of ~33 ticks).

**UAT, 2026-10-25** (image with every change on this branch):

| Run | Layout | Discover | Parses | Notes |
|---|---|---|---|---|
| A — unchanged | one worker | 90 s | 95 reused, 0 jobs | Phase 3 reads **72 skipped (`analysis_current`)** where it read 0; embedding 72 `unchanged`; ~3.8 fetches in flight (rate-bound, see the network lane) |
| B — every PDF re-parses (the preset fix changed the key) | two workers (`docker-compose-uat.multihost.yml`), CPU host at concurrency 2 | **270 s** (509 s for the last full in-process parse, pre-K-P1) | **94 on the CPU host, 0 in process**; `pdf_parse_total{source="lane"}` 94 = the CPU host's `bullmq_job_attempts_total{queue="pdf-parse",outcome="success"}` 94 | **94/94 `parsed_text_hash` identical** to the in-process parses saved before the run — 160 page OCRs among them; event-loop p99 max **15 ms** on the CPU host while its two threads held 2.0 CPU; CPU host RSS 1.9 GiB at two threads |

The one artifact not re-parsed was not fetched by that run; it re-parses when
it next is.

**Review (2026-10-25, three lenses on the working tree — correctness/TS,
security/data, performance/tests/consistency; no blockers; self-review, needs
a countersign).** Fixed in this branch:

- *The lane's wait counted queue time*, so with the crawl at 4 and the lane at
  1 a backlog timed out and parsed the same PDF twice. Now, when the wait runs
  out, a job still waiting is removed before the caller parses in process,
  and a job already running is waited on once more for the thread's own
  timeout (`pdfParseThreadTimeoutMs`, shared with the consumer).
- *`pdf-parse` retried doomed parses* (default 3 attempts, ~16 min). A failed
  parse is deterministic: `DEFAULT_QUEUE_ATTEMPTS['pdf-parse'] = 1`.
- *A thread script that cannot load respawned forever.* Threads now post
  `{ ready: true }`; three deaths before ready in a row stop the pool and
  fail every task with the reason. A death after ready (a hostile PDF) is
  replaced as before.
- *The heap cap was oversold*: it bounds the JS heap only, not mupdf's WASM,
  sharp or tesseract. The comment says so, and the pool is sized from
  measured RSS.
- *The waiter cached a failed open* (one Redis blip disabled the lane until
  restart) and *left callers hanging on close* — both fixed.
- *Queue depth:* oldest-waiting is the older of the two lists' heads, aged
  from a retried job's last start; the queue list is rescanned every 10th
  sample rather than SCANning the keyspace every 30 s; series for a vanished
  queue are removed. `QueueBacklogStalled` alerts on a job waiting over
  10 min — the one signal for a queue nobody consumes.
- *Smaller:* one narrow read for the consumer (`getForParse` — bytes and
  recorded parse, not the derived text); a key mismatch warned once per key;
  `envInt` and `queueEnvKey`/`queueEnvInt` replace five hand-rolled env
  parsers; `createWorker`'s consumption check extracted; thread errors
  truncated to 200 characters; port 3008 on loopback; thread-pool overlap
  asserted directly rather than by wall clock; an integration test on
  `postgres_test` proves the stale/current complement, NULL columns included
  (it fails with the digest axis's IS NULL arm removed).

**Re-review of those fixes (same day, final tree; no blockers).** Fixed:
a consumer claiming the job between the lane's look and its remove (it now
looks again and waits); `QueueBacklogStalled` fired on healthy busy lanes, so
it now also requires nothing ACTIVE on the queue — the no-consumer case
alone; a broken pool now retries after a 5-minute cooldown instead of staying
dark until restart (a spawn can fail transiently); a timed-out job's late
outcome could settle the next caller of that id, so outcomes for an id are
dropped before it is re-added; `close()` no longer throws when its batch
never opened. Noted: `queueEnvInt` is stricter than the `parseInt` it
replaced — `"300000ms"` or `"1e3"` now fall back to the default, and
`ATTEMPTS=0` means the default — and every value in the repo's compose and
example files is a plain integer, so nothing changes in practice.

**Declined, with the reason:** *don't fall back in process after the lane's
parse fails* (the security lens: a hostile PDF that killed its thread is then
parsed on the requester's event loop). Not falling back leaves the measure
with no text, and an empty `fullText` written over a good one is a worse
outcome than one slow parse; it is also exactly pre-S6 behaviour. The
residual risk is bounded by the archive's 25 MB cap and the requester's own
retry and lock handling.

#### Multi-host runbook

The lane is a configuration change, because a job carries ids — never bytes or
text — and every host reads the same database and Redis.

1. **Same image, same OCR.** The CPU host runs the region-worker image of the
   SAME release, with the same `OCR_LANGUAGES`, `OCR_PREPROCESSING_ENABLED`
   and `OCR_PREPROCESSING_PRESET` as the requester. A difference changes the
   parser key, and every job then reports `key_mismatch` (a warning naming
   both keys) and the requester parses for itself — slower, never wrong.
2. **Roles.** CPU host: `WORKER_QUEUES=pdf-parse`,
   `BULLMQ_QUEUE_PDF_PARSE_CONCURRENCY=<cores it may use>`, its own
   `WORKER_HOST`. Requesting host: `WORKER_QUEUES=*,!pdf-parse`. Leave
   `BULLMQ_QUEUE_PDF_PARSE_ENABLED` unset on both — `false` there switches the
   lane off everywhere.
3. **Reachability.** The CPU host needs `REDIS_URL` and `DATABASE_URL` for the
   node, over the tailnet; nothing else (no prompt-service, no Ollama).
4. **Cron.** Set `REGION_SYNC_CRON_ENABLED=false` and
   `REGION_SYNC_RUN_ON_STARTUP=false` on the CPU host: it consumes no
   `region-sync` jobs, and only one host should register the schedulers.
5. **Prove it.** On the dashboard's CPU-lane row, *pdf-parse jobs by host*
   shows only the CPU host; *PDF text by source* shows `lane`, not
   `in_process`. In the logs, the CPU host prints `pdf-parse` successes and
   the requester prints no `parsing in process` lines.
6. **Back out.** Remove `WORKER_QUEUES` from the requesting host (or set it to
   `*`): it consumes `pdf-parse` again, as before.

Local rehearsal: `docker-compose-uat.multihost.yml` (committed) adds
`region-worker-cpu` on port 3008. The git-ignored `.local` overlay's secrets do
not reach a service defined in a later file, so locally add a
`docker-compose-uat.multihost.local.yml` whose `region-worker-cpu` `extends`
the local file's `region-worker`, and layer it last.

#### Observability (2026-10-25, owner: "review our grafana dashboard and revise accordingly")

The dashboard audit found the work unobservable: `WorkerMetrics` had no
implementation, queues had no depth, a reused parse left no trace, embeddings
emitted nothing, current analyses were never counted, and no custom series
named its host. Added:

| Metric | Source |
|---|---|
| `bullmq_job_attempts_total{queue,trigger,outcome}`, `bullmq_job_duration_seconds{queue,trigger}` | every `createWorker`, through `setDefaultWorkerMetrics` bound once by `MetricsModule` — no caller has to remember it |
| `bullmq_queue_jobs{queue,state}`, `bullmq_queue_oldest_waiting_seconds{queue}` | `QueueDepthMetricsService` (region-worker), every 30 s; queues discovered from Redis (`<prefix>:<queue>:meta`), so a new queue needs no registration |
| `pdf_parse_total{source,complete}` | `ExtractionProvider.parseArchivedPdf` |
| `pipeline_items_total{reason="analysis_current"}` | K-P2's current measures, counted in bulk (`SyncPhaseTracker.skippedInBulk`) — a fully-skipped phase 3 read "0 skipped" |
| `pipeline_items_total{stage="embed"}` | the propositions embedding pass |
| `reason="no_content"` | civics pages with no civic content |
| `worker_host` default label | `WORKER_HOST`, on every series a worker publishes |

`ingestion-pipeline.json` (v2): the *Model loads per hour* query never matched
(it subtracted a bucket series, which carries `le`, from a count) and now sums
each side by model first; the stage heatmap takes a `stage` variable; item
panels take `data_type`; new rows **Skips**, **Child-job queues**, **GPU
lanes** (wait p95, tokens by lane), **CPU lane** (worker CPU against its limit,
parse jobs by host), **Hosts** and **Fetch**. Every query was run against
local Prometheus. The second worker gets its own scrape job, labelled
`optional`, which `ServiceDown` now ignores.

**Deploy order:** the node repo carries its own copy of this dashboard and of
the Prometheus config, ported by hand. Port them after the backend release
that emits these series, or the new panels read "No data".

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
