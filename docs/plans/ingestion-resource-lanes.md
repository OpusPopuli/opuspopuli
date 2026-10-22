# Plan of record — resource lanes for ingestion and analysis

| | |
|---|---|
| **Status** | Agreed in shape; not started. Delivery: Track 0 patch now (§0), then one major release, v2.0.0 (§10) |
| **Date** | 2026-10-21 (revised the same day after a full review against the code) |
| **Author** | Rodney Gagnon (with Claude Opus 5.5) |
| **Driver** | Infra architecture D12 (ingestion throughput is the primary goal); D12.1 per-stage spans |
| **Related** | `opus-populi-infra-architecture.md` (D2, D7, D8, D12, D13), `split-ingestion-model-lane.md`, `model-selection-and-deployment-split.md`, `sync-runaway-and-cancellation.md`, `docs/architecture/async-workers.md`, #1276 (source version store), #1280 (row → producing run), #1281 (pin model digest — open), #1305 (local regeneration transfer — closed, available), #1344 (metric cardinality — open) |
| **Data classification** | No new data flow. Job orchestration, rate limiting and skip predicates over public civic records. The lazy-summary mutation (§5) records a bill id and the caller's session, nothing else. Petition-scan OCR (third-party PII) is touched only in S6, and only to move where it executes — not what it stores or logs |

## 0. Start here — execution order

| Track | What | Ships as | Why this position |
|---|---|---|---|
| **0** | **F2: bills are being deleted** (§5.1) — scope the prune, stop pruning failed bills, add a deletion guard | **Patch release now**, independent of v2.0.0 | Live data loss on every full bills sync, plus a mass deletion at the December session flip. Do not wait for the bundle |
| **A** | Foundation: measurement + dashboard (§2), shared helpers, rate limiter, lane queues, per-type jobs (§10.1) | Merged to `main`, inert | Every later change is measured on it; nothing in B may fork it |
| **B** | Per data type, in order: bills, civics, propositions, representatives, meetings, campaign finance (§10.2) | Merged to `main`, inert | Each type walks skip fixes → attribution → lanes, then is re-measured |
| **C** | Lane model cutover (§10.3), regeneration, release (§10.4) | `v2.0.0` | A model belongs to a lane, not a data type, so it switches once per lane, after every type on that lane has an eval leg |

Owner decisions that block work are collected in §11.

**Tracking.** This document is the record of every finding and item in it
(F*, M*, K*, S*). ~~Struck-through text is delivered and merged~~; where only
part of an item shipped, only that part is struck, so what remains is
readable at a glance. Findings captured here do not get separate GitHub issues.
Per the SDLC rule, items with a design
choice in them (F2, M1, S2, S3, S7, the §5 lazy path) get their own short
plan under `docs/plans/` before code; mechanical items (K2, K4, S1, S8)
implement straight from this document.

## 1. Why

Every ingestion path is a serial `for … await` loop, and every BullMQ worker
runs at concurrency 1 (`worker.factory.ts:33-37`; no compose file overrides
it). Within one item, network, CPU, GPU and DB work strictly alternate, so
each resource is idle while another is busy:

- **The GPU idles for the whole scrape.** Propositions, representatives and
  bills fetch everything first, then run every analysis call afterwards.
- **The network idles for every generation.** Civics and bill extraction
  alternate fetch → LLM per item.
- **One data type blocks all the others.** `syncAll` loops plugins and data
  types serially (`region-sync.service.ts:633, 681`) on one worker. A
  multi-day bills run holds the only `region-sync` slot.
- **CPU work runs on the event loop that holds the BullMQ lock.** mupdf
  rasterisation is synchronous (`pdf-extractor.ts:143-165`), deskew is a
  pure-JS pixel loop (`deskew.ts:20-80`). A long page stalls lock renewal —
  the stalled-job/redelivery failure mode in `async-workers.md` (#730).
- **A large share of the GPU work repeats work whose input has not
  changed** (§4). The weekly bills status scan alone re-extracts every bill
  with the LLM (K5).

There is no event mechanism in the codebase (no FlowProducer, QueueEvents,
EventEmitter, pub/sub or LISTEN/NOTIFY). The only chaining between stages is
a direct enqueue: manifest miss → structural analysis → follow-up sync.
`minutes-summary` (one job per row, `jobId` = row id) is the one stage already
pulled out of the sync, and it is the template for what follows.

### What this plan does *not* claim

**With one GPU, the throughput ceiling is total GPU-busy time.** Overlapping
stages only recovers the time the GPU is currently idle. For a changed bill —
~3 fetches at 1 req/s against an LLM call of up to 8,000 tokens — overlap may
be worth single-digit percent. The gains this plan is confident about, in
order of size:

1. **Not doing work whose input has not changed** (§4, §5) — largest, cheapest.
2. **Fairness** — bills stop blocking civics, reps and propositions.
3. **Isolation** — a failed stage retries alone instead of re-running a sync.
4. **Model affinity** — grouping ingestion-model and analysis-model jobs
   instead of interleaving them on one host (measured: 2m17s → 11m46s
   degradation within a run when both stay resident,
   `split-ingestion-model-lane.md` §6).

How much overlap itself buys is unknown, which is why §2 comes first.

## 2. Gate 0 — measure before restructuring

Nothing in §6 starts until this exists. It is D12.1, unbuilt.

**Already in place, so not in scope:** every worker imports
`src/common/tracing` first (`workers/*/src/main.ts:1`), and the prom-client
defaults already export `nodejs_eventloop_lag_p99_seconds`, which Node Health
plots. This gate adds the pipeline-specific layer on top.

| # | Work | Where |
|---|---|---|
| ~~**M1**~~ | ~~**One `withStage()` helper** that, around any existing call, emits an OTel span, observes `pipeline_stage_duration_seconds` (with the span's trace id as exemplar), and counts the item outcome. One helper, so spans and metrics cannot drift apart. `stage` ∈ {`fetch`, `pdf_parse`, `ocr`, `html_parse`, `embed`, `llm`, `db_write`}, plus `data_type`, `lane`, `model`, `host`. No behaviour change~~ | `packages/common` (helper); call sites landed in `resilient-fetch.ts`, `extraction.provider.ts`, `ocr.service.ts` and `lane-metrics.ts` — the last covers every consumer of a lane provider, which `llm-generator.base.ts` would not have. Item counts come from `sync-phase-logger.ts`, so no sync loop was touched |
| ~~**M2**~~ | ~~**LLM phase timings.** Read `load_duration`, `prompt_eval_duration` and `eval_duration` from Ollama's response — `ollama.provider.ts:74-90` reads only the token counts today — and emit them as `llm_request_duration_seconds{phase}`~~ | `packages/llm-provider` |
| ~~**M3**~~ | ~~BullMQ trace-context propagation (D7), so a sync and every job it enqueues land in one trace~~ — see the M3 note below | `packages/queue-provider` |
| ~~**M4**~~ | ~~**Baseline, all six data types**, before any other change lands: per-stage busy time, LLM calls per run, GPU idle fraction, max event-loop lag, and eval-harness quality scores where a leg exists~~ — **closed at four of seven rows**, see the M4 note below | runbook under `docs/runbooks/` |

### M1/M2 as shipped — what is wired, and what is not

Recorded here rather than as issues, per this project's convention that the
plan is the record. Everything below was found by review of the M1/M2 branch
and is **deliberately** out of that change, with the reason stated.

**Wired.** `withStage()` in `packages/common/src/utils/with-stage.ts`, emitting
a span plus `pipeline_stage_duration_seconds` with the span's `trace_id` as an
exemplar. Stage call sites: `llm` (in `lane-metrics.ts`, so every consumer of a
lane provider is covered by construction rather than per generator), `fetch`
(inside `fetchTextWithRetry`, covering both callers — `region-sync` keeps a
private copy of `fetchUrlText` alongside `HttpFetcherService`), `pdf_parse`
(`extraction.provider.ts`) and `ocr` (`ocr.service.ts`). Item outcomes come
from `SyncPhaseTracker`, which already owned per-item accounting, so all seven
data types report without touching their loops.

**Not wired, and why:**

| Gap | Why it is not in M1 |
|---|---|
| `html_parse` and `embed` stages | No single chokepoint. `htmlToReadableText` is a pure function with many callers, and threading an observer through each is churn for the cheapest stages on the list. Row 8 cares about `pdf_parse` and `ocr`, which are wired |
| `data_type` on `pdf_parse`, `ocr`, `llm` | All three are reached through shared code that cannot know its caller's data type, and a guessed label is wrong in a way no query can detect. Only the bills fetch path sets it, so **`sum by (data_type)` returns one dominant empty bucket** — row 2 must not be built on that label until the callers that do know thread it down |
| `host` | Declared in the label set for §7 and set by nothing. `os.hostname()` is the wrong source: in a container it is the container id, so it would mint a new series set on every recreate. §7 must supply a stable node identity first. Row building should skip the label until then |
| `pipeline_rows_deleted_total` | Row 1 names it; the prune paths are F2's territory, not M1's |
| `county_thresholds` emits nothing | `CountyThresholdSyncService` uses no `SyncPhaseTracker` at all, so it has no phase list and no per-item accounting to publish. Pre-existing, outside the mechanical threading, and it needs a phase list designed rather than inferred |
| Rows 3, 5, 6, 7, 9, 10 of §3 | Built: rows 1, 2, 4 and 8 (`ingestion-pipeline.json`). The rest need metrics or grants that do not exist — BullMQ queue metrics (row 3), skip counters (5), the lazy path (6), per-host fetch labels (7), and `grafana_ro` SELECT grants for the Postgres-backed attribution and drill-down rows (9, 10). Absent rather than empty, on purpose |

**The dashboard, as built.** `ingestion-pipeline.json` (uid
`op-ingestion-pipeline`), 19 panels across the four rows that have data:
Overview, Stage timing, Inference, CPU lane. `sync-pipeline.json` keeps its
log panels and loses its multiplied log-count "ingest rate" — an estimate, not
a measurement — so there are no longer two different answers to "how fast is
the sync"; the two dashboards link to each other.

Every expression was validated against the running Prometheus (16 of 16 parse)
and the file was loaded by a throwaway Grafana of the same version to confirm
it provisions, before being believed. Three panels carry `"exemplar": true`,
and the dots render — the full chain works in dev.

Two panels are named for what they actually measure rather than what the plan
asked for, because the honest version is narrower: "Data types reporting
activity" is not "active syncs" (nothing publishes sync liveness, so it infers
activity from throughput, and a sync stalled before its first item does not
appear), and "Model loads per hour" counts load-phase observations slower than
500ms, because Ollama reports a near-zero `load_duration` on every response and
counting observations would count requests. `circuit_breaker_state` has zero
series — declared, never set — so row 4 has no breaker panel rather than a
permanently empty one.

**M3 as shipped.** `packages/queue-provider/src/job-tracing.ts`. The active
trace context is injected into job data at `enqueue` and `enqueueBulk`, and
`createWorker` runs every handler as a CHILD of the span that enqueued it — so
one trace now covers the resolver, the queue hop and every `withStage()` span
the sync opens underneath. A producer span (`<queue> publish`) makes the hop
itself visible; without it the job attaches straight to the resolver and the
queue is invisible, which is the thing D7 exists to show.

**`upsertScheduler` deliberately injects nothing.** BullMQ stores a
scheduler's `data` once and replays it on every firing, so a `traceparent`
there would make every nightly sync for the life of the scheduler a child of
one upsert — a single trace growing without bound, parented to a span that
ended months ago. A cron firing is its own trace root. This is the subtlest
part of M3 and it has its own test; the mutation that injects there was the
one that initially survived.

Verified through real Redis rather than mocks: a job enqueued inside a request
span came back out of BullMQ with its carrier intact and its payload
untouched, and the request, the job and a nested stage span all shared one
trace id. Mocked bullmq cannot show that the carrier survives JSON in Redis,
which is the only thing that has to be true across two processes.

Still open for M3's value to be realised end to end: **R6 (NTP on every host)**
from §10, without which cross-host spans order wrongly, and Tempo retention
long enough to hold a ~48h bills run in one trace.

**Measured on the first live civics sync (2026-10-22), and two things
changed because of it.**

*The stage and phase metrics reconcile.* The `llm` stage's wall clock and the
sum of Ollama's own load/prefill/decode agreed to **0.09s** on the same call
(114.71 vs 114.62) — two independent instruments measuring the same work,
which is the check that makes either of them trustworthy. The gap is HTTP plus
queue wait, ~0 at concurrency 1, and it is the number §6's lanes have to move.

*Rate windows must exceed the longest single call.* Every one of these
histograms is observed when the work COMPLETES, so an in-flight call
contributes nothing. A civics extraction on a 76,344-character prompt ran
**nine minutes** while `rate(...[5m])` reported zero inference and the GPU was
saturated. The dashboard now uses 1h for the GPU stats and 15m for the stage
panels. The deeper point is that this family of metrics cannot answer "is it
busy right now" at all — that needs S7's `llm_inflight_requests` gauge. It
answers "what fraction of the window went to inference", which is what Gate 0
actually asks.

A related Prometheus property, worth knowing before reading a short run: the
FIRST observation of a counter is invisible to `rate()`, because the series'
first sample already contains it and there is no earlier value to subtract.

*Long jobs make an incomplete trace.* A span is exported when it ends, so
during a run the `<queue> process` span does not exist yet and its children
appear parentless. Observed here: 82 spans across `region` and `region-worker`
in one trace, 20 of them waiting on the same unexported parent. It resolves on
completion — but a ~48h bills sync would hold that parent open for 48h, which
is worth checking against Tempo's block handling before relying on it.

**First Gate 0 baseline — civics, california, 2026-10-22.** One job, 2032s
(33m52s). 24 pages: 9 updated, 13 skipped, 2 failed. The metrics reconcile
EXACTLY with the phase-complete log line on all four outcomes, which is the
property that justifies counting in `SyncPhaseTracker` rather than at call
sites.

| | |
|---|---|
| `llm` stage | 1911.4s — **94.1%** of the job |
| `fetch` stage | 9.9s — 0.5% |
| unaccounted | ~5.5% (DB writes, parsing, overhead) |
| GPU busy | **47.2%** (idle 52.8%) |
| LLM calls | 21 — 164,061 tokens in, 28,084 out |
| prefill / decode | 423.4s / 491.9s — **1.16×**, near parity |

**The headline is the contradiction between rows one and four.** The job spends
94% of its wall clock inside the `llm` stage while the GPU works 47% of it.
The 952s gap is not queue wait — it is two calls that ran 797s and ~326s and
then died, returning no phase timings because the Ollama runner was killed.
Host was at 48 GiB with 25% free and swap 91% full; the model holds 24 GiB
because `num_ctx=131072` is allocated up front regardless of prompt size. So
roughly half of this sync was spent on work that could never finish.

That reframes Gate 0's exit metric: "GPU idle 52.8%" here does NOT mean the
pipeline is poorly parallelised, which is what §6's lanes address. It means
memory pressure destroyed half the run. **Fix the memory envelope before
reading an idle fraction as evidence for anything**, or the lanes work will be
measured against a corrupted baseline.

A second, unrelated gotcha found the same day: Tempo had a **zero-byte block**
from 2026-10-18 (`meta.json` 0 bytes) which made its 5-minutely blocklist poll
fail with `unexpected end of JSON input`. The effect is silent and nasty —
queries return only the blocks it can still enumerate, so a 34-minute trace
came back missing its first half and Tempo labelled it "root span not yet
received". Quarantining that one block and restarting returned the full 201-span
trace. Check for empty `meta.json` before believing a truncated trace.

**The memory envelope, measured 2026-10-22 — and the obvious fix is wrong.**
Two of the civics run's 21 LLM calls died with `unexpected EOF` (the Ollama
runner killed), burning ~1,120s of a 2,032s job. The reflex is to lower
`num_ctx`. Measured on the live host, it buys nothing:

| `num_ctx` | resident |
|---|---|
| 32,768 | 24.0 GiB |
| 65,536 | 24.0 GiB |
| 131,072 | 24.2 GiB |

The KV cache is near-free here because `nemotron-3.5-lightning` is a hybrid
`nemotron_h_moe` — most layers are state-space, not attention — on top of
`OLLAMA_KV_CACHE_TYPE=q8_0` and flash attention already being set. So cutting
the window would free ~0.2 GiB and cost extraction fidelity, which the
`ollama.provider.ts` table shows is *doubly* expensive: overflow discards half
the KV cache, so a too-small window reads `num_ctx / 2` tokens and does it
SILENTLY.

Containers are not the lever either: all 27 together hold **2.7 GiB**, and
Docker's VM only 4.4 GiB resident. The envelope is simply the model —
**24.55 GiB of a 48 GiB host** — beside Docker (4.4), Firefox (2.4) and VS
Code (1.0), which is why swap sat at 87-91% full.

Two silent multipliers were closed in `~/Library/LaunchAgents/sh.brew.ollama.plist`
(host config, outside this repo): `OLLAMA_MAX_LOADED_MODELS=1`, because a
petition OCR would otherwise load `qwen2.5vl:7b` beside nemotron for 29.3 GiB
resident, and `OLLAMA_NUM_PARALLEL=1`, because unset lets Ollama choose slots
by free memory. Both are preventive; neither was the proximate cause.

What actually remains, in order of effect: run baselines with the desktop
quiet (~3.5 GiB), give the ingestion lane a smaller model (§6's whole premise
— nothing smaller than 23.7 GB is installed today, so that needs a pull and an
eval leg), or more RAM. **Until then, treat any GPU-idle figure as suspect:**
this run's 52.8% was mostly two doomed calls, not poor parallelism.

**The fetch-path fix, measured before and after (2026-10-22).** Same sync,
same 121 items, seven seconds apart in duration:

| | pre-fix | post-fix |
|---|---|---|
| `llm` | 419.5s (53.4%) | 434.8s (54.8%) |
| `fetch` | **0s** | **268.3s (33.8%)** |
| accounted for | **53.4%** | **88.7%** |

Nearly half the run had been invisible. It was not overhead or DB time — it
was the scraping pipeline's own fetches through
`ExtractionProvider.fetchWithRetry`, most of them the ~80 Assembly biography
pages that fail (#1383) plus their retry backoff. The pre-fix row looked
*healthier*: a 20.9s gap and no fetch cost at all.

Two things this changes for M4. The remaining rows must be measured on images
built after this fix, and **a low accounted-time percentage is itself a
finding** — it means a resource is being used that nothing is instrumented to
see, not that the run was idle.

~~Still untracked: `generateActivitySummaries()` runs after `bio_generation`
completes and before the job ends, one LLM call per representative, and no
`SyncPhaseTracker` phase covers it.~~ On this run that was most of the 83 LLM
calls against 2 bios, so the phase-complete lines understated the job by
minutes. **Fixed:** the gap was four steps wide, not one — committee
summaries, the committee linker and committee descriptions ran there too. All
four now sit in a sixth rep phase, `summaries` (5 of 6, before `prune_stale`).
It carries duration only (`total` 0): none of the generators returns per-item
outcomes, and counting steps as items would publish them into
`pipeline_items_total` as representatives. The LLM calls inside were already
timed per call by the lane providers; what was missing was the phase line.

**The exemplar chain needs FOUR switches, not three.** Backend serves
OpenMetrics (prom-client renders exemplars in no other format, and refuses to
construct an `enableExemplars` histogram otherwise); Prometheus runs
`--enable-feature=exemplar-storage`; the Grafana datasource declares
`exemplarTraceIdDestinations` naming the `trace_id` label; and **the panel's
own target must carry `"exemplar": true`** or Grafana never calls
`/api/v1/query_exemplars`. Every one of the four fails silently — the panel
still draws, with nothing behind the dots.

**Production has none of the last three.** `opuspopuli-node-us-ca`'s
`docker-compose-prod.yml` runs `prom/prometheus:v2.51.0` with no `command:` at
all, so no exemplar storage, and its datasource provisioning contains no
`exemplar` reference anywhere. The OpenMetrics content-type switch ships to
prod regardless (it is safe — verified against a real scrape), so prod takes
the format change and discards every exemplar until that repo is ported. Node
sync is a manual port.

**M4 closed at four of seven rows (2026-10-22).** Civics, propositions and
representatives (county and state) are measured; meetings, campaign finance
and bills are not. The four rows already answer what Gate 0 was for — they
show the GPU saturated on reps, idle behind `pdf_parse` on propositions, and
a fetch cost nobody could see before the fix — and the remaining three cost
far more than they add here: bills alone is ~48h and weekend-only, and
campaign finance runs no LLM at all, so it says nothing about GPU lanes.

This **defers** those rows; it does not drop them. Phase B step 4 compares
against a baseline, so for meetings, campaign finance and bills the baseline
becomes **step 0 of that type's Phase B**: measure on the image before any of
its changes land, using `docs/runbooks/gate-0-baseline.md` unchanged. Bills is
first in §10.2, so the 48h run moves to the start of Phase B rather than
disappearing. Only the state-reps row was measured after the fetch-path fix;
the other three understate `fetch` and should be read that way.

**Exit criterion:** a table of busy time per stage per data type, LLM calls
per run, and the GPU idle fraction during a sync. If GPU idle is under ~15%
for a data type, §6 lanes for that type are deprioritised — the skip fixes
and fairness still stand.

Quality is part of the baseline because S7 (batched/parallel decode) and the
§10.3 cutover can move output. A throughput gain that costs accuracy must
not read as success.

## 3. The Ingestion Pipeline dashboard

**What exists today.** The node provisions dashboards from files
(`opuspopuli-node/grafana/dashboards/`, with `allowUiUpdates: false`): Node
Health, API Performance, Users and **Sync Pipeline**. The node has four
datasources: Loki, Prometheus, Tempo and the read-only Postgres
`opuspopuli-postgres` (role `grafana_ro`).

Sync Pipeline is **built entirely from log lines**. Its "ingest rate" is a
count of `Flushed batch` lines multiplied by 10,000, which is an estimate,
not a measurement; the other panels are Loki log streams.

**Prometheus has no pipeline metrics at all.** The backend exports HTTP,
GraphQL, DB pool, circuit-breaker, document, OCR, claim and source-store
metrics. It exports nothing for sync stages, queues, LLM calls or skips.
The Redis exporter is commented out (`observability/prometheus.yml:87`).
Ollama runs natively on the host and is not scraped.

**The change: a new dashboard, `ingestion-pipeline.json`** (uid
`op-ingestion-pipeline`, folder Opus Populi), plus a trim of Sync Pipeline:

- Sync Pipeline keeps its log panels and becomes the "what did this run
  say" view.
- Its multiplied log-count panel is removed, so there are not two different
  "ingest rate" numbers.
- Each dashboard links to the other.

**Variables:** `region`, `data_type`, `lane`, `model`, `host`, and
`pipeline_job` (read from `pipeline_jobs` via the Postgres datasource, for
drill-down). `host` is there from the start for §7.

| Row | Panels | Source |
|---|---|---|
| **1 · Overview** | Active syncs by data type — shipped NARROWER as "Data types reporting activity", which infers activity from throughput because nothing publishes sync liveness. ~~Items per second by outcome (created / updated / skipped / failed)~~. ~~**GPU busy % and GPU idle % during an active sync** — the Gate 0 exit metric, shown as a stat~~ (window must exceed the longest call — see the M1/M2 note). ~~Aborted phases (`SyncAbortedError`)~~. Rows deleted per sync | Prometheus |
| **2 · Stage timing** | ~~Busy time per stage, stacked~~, per data type — the "where does a sync's time go" panel (`data_type` is set only on the bills fetch path, so the per-type split is NOT yet usable). ~~p50/p95 per stage~~. ~~Duration heatmap~~. ~~Exemplars link each bucket to its Tempo trace~~ | `pipeline_stage_duration_seconds` |
| **3 · Lanes** | Per lane: waiting / active / delayed / failed. Oldest waiting job age. Enqueue → start wait p95. Active versus the `setGlobalConcurrency` limit. Interactive versus batch priority throughput | BullMQ `exportPrometheusMetrics` |
| **4 · Inference** | ~~Decode tokens/sec per model~~. ~~**Prefill time versus decode time**~~ (D12.6 expects prefill to be the cost; over a full civics run of 21 calls they are near parity — decode 491.9s vs prefill 423.4s, 1.16×. A single early call read 6.7× and was NOT representative). ~~Model loads per hour — the measure of whether S7's model affinity is working~~. In-flight requests versus `OLLAMA_NUM_PARALLEL`, **split queued versus interactive** (S7). Timeouts and circuit-breaker state per lane — `circuit_breaker_state` has zero series, so no panel rather than an empty one | `llm_*` metrics |
| **5 · Skips** | Skip ratio by reason per data type (`hash_unchanged`, `status_unchanged`, `frozen`, `prompt_unchanged`). **LLM calls avoided** per run. Frozen-bill count. This row is what proves K1–K6 work | Prometheus; Postgres for counts |
| **6 · Lazy analysis** | Summary requests, dedupe hits, pending, completed. **Request → ready latency p50/p95**, the first reader's wait. Daily cap used and `UNAVAILABLE` count. Hot/cold bill counts and summary coverage by class | Prometheus; Postgres for coverage |
| **7 · Fetch** | Requests/sec per target host. Per-host throttle wait. 429 / 503 / timeout rates. Retries | Prometheus |
| **8 · CPU lane** | ~~PDF parse and OCR duration~~, pages/sec, pool utilisation, ~~`nodejs_eventloop_lag_p99_seconds` per worker~~ | Prometheus |
| **9 · Attribution** | Share of rows written in the window that carry prompt hash, prompt version **and** model digest, by data type and model. Rows by producing model — makes the v2.0.0 regeneration visible as it progresses | Postgres (read-only) |
| **10 · Drill-down** | Logs for the selected `pipeline_job`. Trace search for that job's trace id | Loki, Tempo |

**Metrics to add** (M1, M2, S1, S7 and §5 emit them):

| Metric | Type | Labels |
|---|---|---|
| `pipeline_stage_duration_seconds` | histogram, with exemplars | `stage`, `data_type`, `lane`, `model`, `host` |
| `pipeline_items_total` | counter | `data_type`, `outcome`, `reason`, and one of `phase` (sync tracker) or `stage` (`withStage`) — exactly one writer per item |
| `pipeline_rows_deleted_total` | counter | `data_type` |
| `pipeline_phase_aborted_total` | counter | `data_type`, `phase` |
| `llm_request_duration_seconds` | histogram | `lane`, `model`, `phase` = `load` / `prefill` / `decode` |
| `llm_tokens_total` | counter | `lane`, `model`, `direction` = `in` / `out` |
| `llm_inflight_requests` | gauge | `lane`, `model`, `endpoint`, `path` = `queued` / `interactive` |
| `lane_wait_seconds` | histogram | `lane`, `priority` |
| `fetch_requests_total` | counter | `target_host`, `status_class` |
| `fetch_throttle_wait_seconds` | histogram | `target_host` |
| `lazy_analysis_requests_total` | counter | `data_type`, `result` = `enqueued` / `deduped` / `capped` |
| `lazy_analysis_ready_seconds` | histogram | `data_type` |

Queue depth comes from BullMQ's own `Queue.exportPrometheusMetrics()`
(present in the installed 5.76.10, `queue-getters`), served from each
producer's `/metrics` — no hand-rolled `lane_jobs` gauge and no Redis
exporter needed.

**GPU busy % comes from the application side**, as summed in-flight
inference time over wall time. That number exists on every host, a remote
one included. A host-level Apple GPU exporter is optional and deferred:
`powermetrics` needs root, and any third-party exporter needs a licence
check against the no-GPL rule first.

**Config the dashboard needs, outside the JSON:**

- **Exemplars** need Prometheus started with `--enable-feature=exemplar-storage`
  and prom-client exemplars enabled. Without both, row 2 loses its trace
  links silently.
- **`grafana_ro` needs `SELECT`** on `bills`, `pipeline_jobs`,
  `civics_blocks` and the summary columns rows 5, 6 and 9 read. Check the
  role's grants before building those panels.

**Cardinality rules (#1344, still open):**

- No per-item labels — never a bill id, URL or user id.
- `target_host` is the small, fixed set of government hosts a region config
  names, not arbitrary hosts.
- `pipeline_job` is a dashboard variable feeding Loki and Tempo, **never a
  Prometheus label**.
- Record active series before and after, as #1344 asks.

**Alerts** (`observability/prometheus-alerts.yml`, alongside the existing
`opuspopuli-document-pipeline` group):

- **Bulk deletion.** `pipeline_rows_deleted_total` jumping by more than a
  threshold in one sync. That is the signature of F2, and it catches that
  whole class of bug — the F2 guard (§5.1) prevents it, this alert reports
  it.
- **Lane backlog.** Oldest waiting job older than its lane's budget.
- **Lazy cap reached.** Readers are getting `UNAVAILABLE`.
- **Repeated aborts.** A data type aborted on consecutive runs.
- **GPU idle during an active sync.** Fires only after Gate 0 has set what
  normal looks like.

**Where the files live.**

- The dashboard is authored in **`opuspopuli-node`** (`grafana/dashboards/`),
  because that is where production reads it. It is then ported to the
  monorepo's `observability/grafana/provisioning/dashboards/`, so dev and UAT
  show the same view.
- The two repos share no git history, so this is a manual port — note it in
  the PR for each.
- The dashboard and alerts deploy **after** the backend that emits the
  metrics. A dashboard pointing at series that don't exist yet looks the
  same as a pipeline that is doing nothing.

## 4. Skip fixes — stop re-running unchanged work

Independent of the lane work; each is shippable on its own, after the M4
baseline so its effect can be measured.

**Shared rule.** A skip key covers **every input that can change the
output**:

- the source content hash;
- the prompt hash;
- the model digest (#1281, still open);
- **the region config hash** where config feeds the prompt. Measured during
  the civics work: region config moves the output *more* than the prompt
  does, so a skip that ignores config serves stale output after a config
  change.

One shared helper builds the key (§10.1), so no skip invents its own.

| # | Today | Fix | Schema |
|---|---|---|---|
| **K1** | Civics re-sends every crawled page to the LLM on every run (`civics-sync.service.ts:305`) — no content check. `civics_blocks` already has `prompt_hash` and `@@unique([regionId, sourceUrl])` | Skip when readable-text hash, prompt hash, model digest and the data source's config hash all match the stored row | **Additive:** `source_text_hash`, `config_hash` on `civics_blocks` |
| **K2** | Entity activity summaries regenerate every rep and committee with actions in the 90-day window, every run. `activitySummaryGeneratedAt` is selected (`entity-activity-summary-generator.service.ts:117`) and never compared | Skip when no `legislativeAction` for the entity is newer than `activitySummaryGeneratedAt` and `activitySummaryPromptHash` / `activitySummaryLlmDigest` match | None — the columns exist |
| **K3** | Bill `votes_only` fetches and LLM-extracts every discovered votes page every run (`runVotesPhase`, `region-sync.service.ts:1724`) | Hash the fetched page; skip the LLM when the hash matches the last extraction. **Persist the raw extraction output**, so rep matching (`linkBillVotes`) can re-run without the model when a new representative appears | **Additive:** votes-page hash and raw output, on the bill or a side table |
| **K4** | Campaign finance re-parses and re-upserts the whole bulk file even when it is byte-identical. sha256 is computed while streaming and `etag`/`last-modified` are archived (`bulk-download.handler.ts:253-254`); neither is compared | Skip parse and upsert when the sha256 matches the last *successfully completed* import. Compare on completion, so a failed import is never skipped. **The post-sync linkers still run** — new propositions or committees can need linking against unchanged finance data | Possibly none — check whether the archived import record already carries the hash |
| **K5** | Every sync fetches every existing bill's status page at 1 req/s (`tryStatusOnlyRecheck`, `:2262`). California sets `statusScanCadence: "0 2 * * 0"`; that job passes `forceStatusRecheck: true` (`region-sync.scheduler.ts:121-133`), which sends **every bill, chaptered and dead included, through the 8,000-token LLM extraction every week** | Freeze cold bills (§5): no status fetch, no forced weekly re-extraction. Re-check them on a slow cadence with the cheap no-LLM parse only. Frozen bills count as *discovered* for the prune (F2). **Depends on F2 and F4** | None |
| **K6** | Bill summaries go to every bill with `aiSummary IS NULL` (`:1597`) — no lifecycle filter, and never regenerated after a prompt change | Batch hot bills only. Re-run hot bills whose `aiSummaryPromptHash` differs from the live hash, **excluding the `{skip: true}` sentinel** so it cannot loop. Cold bills go to §5 | None |

**Verification, for each:** run a sync twice against an unchanged source and
assert zero LLM calls on the second run. Change one key input (source,
prompt, config) and assert exactly the affected items re-run. Then
reintroduce the defect (remove the predicate) and confirm the test fails.

## 5. Bills: hot bills eagerly, cold bills on first read

The product's point is what a person can act on. A bill that died, or was
signed into law long ago, is not that, so it should not get the same
recurring analysis as one still moving. Today it does.

**Sizing (local dev DB, 2025–2026 session, last synced 2026-07-17 —
illustrative, re-count on prod):** 5,019 bills. 2,698 active, 1,319 passed,
1,002 dead. 2,098 are inactive with a last action more than 180 days old.
Both personalised consumers already filter to `isActive = true`
(`personalized-feed.service.ts:167`, `personalized-rep-activity.service.ts:301`),
so a cold bill's summary is read **only** on its own detail page
(`region-query.service.ts:1816`).

**Definitions** (from fields that already exist — `isActive`, `isDead`,
`lastActionDate`, via `bill-lifecycle.ts`):

- **Hot:** `isActive`, **or** inactive with a last action within
  `coldAfterDays`.
- **Cold:** everything else.

`coldAfterDays` is a new region-config field, so it goes through
`opuspopuli-regions` (schema change, publish, pin, image rebuild) like any
other config. The window exists because "recently signed" is not "old": a
law signed in October that takes effect on 1 January changes people's
lives *now*.

**What each class gets:**

| Stage | Hot | Cold |
|---|---|---|
| Discovery + cheap status parse (no LLM) | every sync | slow cadence only (K5) |
| LLM extraction (author, co-authors, committees, fiscal) | eager, on change | **once**, then frozen |
| Votes | eager, on change (K3) | **once**, then frozen |
| Plain-language summary + status refinement | eager batch (K6) | **on first read** |
| Weekly forced re-extraction | yes | **no** (K5) |

Extraction and votes stay eager, deliberately. A frozen bill costs nothing
after its first ingest, and its author and vote rows are what a
representative's page shows — "laws my representative wrote" and "how they
voted on what passed" are accountability data, even when the bill is over.

**The summary pass is not only a summary.** `writeStatusSummary`
(`region-sync.service.ts:1910-1966`) is a merged call that also writes
`status`, `lastAction`, `lastActionDate` and `currentStageId` — the
lifecycle inputs. So the hot/cold rule must be computable from what
extraction writes, and any later write of those fields must recompute the
lifecycle (F4).

### 5.1 Findings — fix before the lazy path

- **F1 — the weekly forced re-extraction** (K5). Likely a large share of the
  bills sync's wall-clock time; the M4 baseline confirms or refutes it.

- **F2 — bills are being deleted. Track 0: ship as a patch now.**
  `pruneStaleBills` (`region-sync.service.ts:1506-1543`) hard-deletes every
  bill in the region that is not in `syncedExternalIds`. Two failure modes:
  1. **Every full sync, today.** A bill is added to `syncedExternalIds`
     only when its processing did not fail (`:1344`,
     `if (result !== 'failed' && billId)`). A 503 or an LLM response with no
     JSON on an existing bill therefore deletes it.
  2. **At the session flip.** The prune is not scoped by session. When the
     California source moves to `session_year=20272028` (the 2027–28
     session convenes in early December 2026), the first full sync deletes
     every 2025–26 bill — chaptered laws included.

  Deletion cascades: `BillVote`, `BillCoAuthor` and
  `BillCommitteeAssignment` go with the bill (`onDelete: Cascade`), so a
  representative's voting record on that bill disappears, and
  `LegislativeAction.billId` is set null. A re-sync recreates the bill under
  a new id with its votes re-extracted — at 8,000 tokens each.

  **Fix:**
  - Prune against **discovered** ids, not *successfully processed* ids. A
    failed bill was still seen.
  - Scope the prune to the session years present in this sync's
    discovered set.
  - Add a **deletion guard**: refuse the prune, and log at `error`, when it
    would delete more than a small fraction of the region's bills in one
    run.
  - Emit `pipeline_rows_deleted_total` (§3).

  **Before fixing:**
  - Confirm on prod: Loki for `removed (not seen in this sync)` in
    region-worker logs shows how many bills mode 1 has already deleted.
  - **This section is the record for F2; there is no separate issue.** An
    issue search (2026-10-21) for `pruneStaleBills`, `prune_stale`, "prune
    stale bills session" and "bills deleted session" found nothing else
    covering it; #831 mentions `pruneStaleBills` only inside a refactor.

  **Regression tests:**
  - A failed existing bill survives a full sync.
  - A second session's bills survive a sync of the first.
  - A prune above the guard threshold is refused.

  Reintroduce each defect and confirm its test fails.

- **F3 — bill extraction and votes prompts discard their hash.** Both
  destructure only `promptText` (`region-sync.service.ts:2385`, `:2557`), so
  an extracted bill cannot say which prompt produced it — a break of the
  attestation rule in `CLAUDE.md`. K5 makes extraction a one-time event per
  cold bill, so its provenance is the only record there will ever be. Fix
  with K5: **additive** `extraction_prompt_hash` / `_version` / `_llm_model`
  / `_llm_digest` columns, mirroring the `aiSummary*` and
  `activitySummary*` sets.

- **F4 — lifecycle booleans go stale.** `isActive`/`isDead` are computed
  only in the extraction upsert (`:2476-2477`). The summary pass (`:1963`)
  and `stage_backfill` (`:1492`) both write `currentStageId` without
  recomputing them. Today that only mislabels a bill until its next
  extraction. With K5, a frozen bill has no next extraction, and hot/cold
  is decided from these booleans. **Fix:** one `writeBillLifecycleFields()`
  helper that every writer of `status` / `lastAction` / `lastActionDate` /
  `currentStageId` goes through, recomputing both booleans in the same
  update. Then a one-off backfill to repair existing rows.

### 5.2 The lazy path

1. **Trigger.** The bill detail page calls `requestBillSummary(billId)` when
   the bill has no current summary.
   - **Signed-in viewers:** the page calls it automatically.
   - **Anonymous viewers:** they get a "Summarise this bill" button, so a
     person — not a page load — starts generation.

   CSRF does not stop bots: a crawler that renders JavaScript (Googlebot
   does) carries the cookie and can send the header. What stops automatic
   triggering is requiring either a session or a user gesture. It is a
   mutation, never a side effect of the `bill` query or the SSR render.
2. **Enqueue** on the analysis lane at **higher BullMQ priority than batch
   work**, with `jobId = bill:<id>:summary:<promptHash>`. Concurrent first
   readers collapse onto one job. The mutation returns immediately with
   `summaryStatus: PENDING`.
3. **The page never waits on the GPU.**
   - It renders the source facts at once — title, status, last action,
     author, votes, link to the official text.
   - Alongside them, a "preparing a plain-language summary" state polls the
     bill query and stops after a bounded number of attempts.
   - A held request would hit the gateway timeout and still spend the GPU
     time.
   - The state needs en/es i18n strings and an `aria-live="polite"` region
     (WCAG 2.2 AA).
4. **Budget.** A global daily cap on lazily triggered summaries, plus a
   per-session cap. Over a cap, `summaryStatus: UNAVAILABLE`, and the
   source facts are still shown.
5. **The lazy job is the batch job.** It calls the same
   `enrichSingleBill` / `writeStatusSummary` path, so the summary, the
   status refinement, the lifecycle recompute (F4) and the `aiSummary*`
   provenance are identical to batch output. A cold bill summarised under
   an older prompt is regenerated on its next read.
6. **Transitions.** Hot → cold needs nothing. Cold → hot (a veto override, a
   source correction) is picked up by the slow re-check, then by the next
   batch, which filters on hot.

`summaryStatus` and `requestBillSummary` are additive in the region subgraph
and need the gateway federation check.

## 6. The lanes

Each lane is a BullMQ queue whose concurrency matches what bounds it. Stages
hand off by enqueueing the next stage, with the payload pointing at a stored
source version (#1276), not carrying the content itself.

```
                 ┌──────────────┐  source.changed   ┌───────────┐
 scheduler ────► │ FETCH  (net) │ ─────────────────► │ CPU parse │
                 │ per-host     │  (hash differs)    │ pdf/ocr/  │
                 │ token bucket │                    │ html/csv  │
                 └──────────────┘                    └─────┬─────┘
                                                           │
                    ┌──────────────────────────────────────┤
                    ▼                                      ▼
           ┌─────────────────┐                   ┌──────────────────┐
           │ GPU ingestion   │ ── extracted ───► │ GPU analysis     │
           │ lane: struct.,  │                   │ lane: analysis,  │
           │ civics, bills   │                   │ bios, summaries  │
           └────────┬────────┘                   └────────┬─────────┘
                    └──────────────┬──────────────────────┘
                                   ▼
                          ┌──────────────────┐
                          │ DB write/linkers │
                          └──────────────────┘
```

| Lane | Bound by | Concurrency | Contents |
|---|---|---|---|
| **fetch** | Network, per host | High overall, rate-limited **per host** | List/detail pages, PDF and bulk downloads |
| **cpu** | Cores | ≈ cores − 2 (headroom for the event loop) | pdf-parse/mupdf/raster, Tesseract, Cheerio, `htmlToReadableText`, CSV parse, xenova embeddings |
| **gpu-ingestion** | The ingestion model's Ollama endpoint | Its slots minus the interactive reserve (S7) | structural analysis, extraction-plan derivation, self-heal, civics, votes; bill extraction once its eval leg passes (§10.2) |
| **gpu-analysis** | The analysis model's Ollama endpoint | Its slots minus the interactive reserve (S7) | proposition analysis, bios, committee summaries/descriptions, activity summaries, bill summaries, minutes summaries, rerank |
| **db** | Postgres | Low; batched | upserts, campaign-finance batches, linkers |

Lanes are named for their role, not their model. Which model serves each
lane comes from the node's `.env` (`LLM_ANALYSIS_MODEL` /
`LLM_INGESTION_MODEL`, written by `create-op-node`) and is chosen by
`model-selection-and-deployment-split.md`.

**Job identity is the attestation key.** `jobId = <entity>:<stage>:<skipKey>`,
with the skip key from §4's shared rule. One key gives dedupe (BullMQ refuses
a duplicate id), idempotent retries, and the same provenance the output row
must persist.

**Use BullMQ, not a new broker.** Redis is already there and already durable
for jobs. Kafka/NATS would add an operational surface for a single-node
deployment with no consumer that needs a log.

### Subtasks

Phase A order matters: **S7's queue bound lands before S2 raises
concurrency.** Two concurrent syncs on two different models, with nothing
bounding GPU access, is exactly the resident-model thrash measured in
`split-ingestion-model-lane.md` §6.

| # | Work | Depends on | Notes |
|---|---|---|---|
| **S1** | **Per-host rate limiter, in Redis.** Replace the single `extraction:ratelimit` key (`extraction.provider.ts:157`) with `extraction:ratelimit:<host>`, and **retire the in-process `HostThrottle`** (`region-sync.service.ts:382`) onto the same bucket — one per-host policy shared by every process. Keep `rateLimitOverride` | — | Without it, fetch concurrency cannot help: every host serialises on one bucket. Redis-backed because an in-process throttle multiplies the rate a government site sees by the number of processes (§7 H2) |
| **S7** | **GPU lanes bounded per endpoint, with model affinity.** One queue per Ollama endpoint, named from the lane's resolved URL. Bound with BullMQ `setGlobalConcurrency` (5.76.10), not per-worker `concurrency`, so the bound holds however many processes consume it. **Reserve slots for interactive inference** — RAG, petition analysis and personalised impact call Ollama directly over HTTP and bypass every queue, so lane concurrency = `OLLAMA_NUM_PARALLEL` − interactive reserve. Drain one model before switching while both share the Studio. Set `OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_LOADED_MODELS` and keep-alive explicitly in node config | M4 | The queue bound is Phase A; raising parallelism above 1 is quality-gated on the eval harness. Replaces the seven `*_CONCURRENCY` knobs |
| **S2** | **One sync job per data type.** The scheduler already registers one cron per (region, dataType); make the startup/manual "all types" path enqueue one job per type. Run `region-sync` at concurrency ≥ 2 so bills never holds the only slot. Record `worker_host` on `markRunning` (additive column) and scope `sweepStaleRunning` to this host's rows. `cancelRegionSync` cancels the children of a fanned-out request | S7 | §7 H1 |
| **S3** | **Pull bill and civics extraction out of their fetch loops.** The fetch loop stores the source version and enqueues the GPU lane with the skip key; fetching continues while the GPU works | S1, S7, K1, K3 | Copy the `minutes-summary` shape. The consecutive-failure abort (`sync-phase-logger.ts`) moves into the lane worker, keyed per parent job, so a broken run still stops |
| **S4** | **Post-scrape generators onto the analysis lane.** Proposition analysis, bios, committee summaries/descriptions, activity summaries and bill summaries are enqueued per row as rows are upserted, instead of after the whole scrape | S2, S7, K2, K6 | |
| **S5** | **Extraction-plan derivation and self-heal off the crawl loop.** The detail crawl stalls between fetch #1 and #2 on the plan LLM call (`detail-crawler.service.ts:219, 600`); self-heal runs inline even in async mode (`pipeline.service.ts:552, 600, 887`). Enqueue both | S3 | Mirror the cache-miss contract (`pendingManifestAnalysis`) rather than inventing a new one |
| **S6** | **CPU lane.** `PdfExtractor`, OCR (Tesseract worker pool, `OMP_THREAD_LIMIT=1` per D12.5), deskew and xenova embedding become a **queue-fed** lane: input is a source-version id, output is stored text. The consumer may run inside the existing worker process for now, using threads internally | M4 shows CPU on the loop | The queue is the boundary, not the thread pool (§7 H3). Petition scan moves OCR off the event loop **without** going async — the user-facing contract stays synchronous |
| **S8** | Campaign-finance parse/write overlap: parse batch *n+1* while batch *n* writes, with a buffer of 1–2 batches | K4 | Stays inside one job, so the local temp file (`bulk-download.handler.ts:167`) is fine (§7 H4) |

**Linkers become a terminal stage.** Once a data type fans out, its linkers
run when that type's lane jobs for the parent sync have drained, not inline
mid-sync. Otherwise they link against rows that have not landed yet.

## 7. Multi-host: build the seam now, the topology later

Infra D13 says *nothing may depend on being co-located*. Every lane is
designed to that rule, but this plan does **not** deploy across machines.
For each concern, the cheap part that keeps the door open is in scope now;
the part that only pays off with a second host is deferred to §9.

| # | Concern | In this plan (now) | Deferred to §9 | Why deferring is safe on one host |
|---|---|---|---|---|
| **H1** | `sweepStaleRunning` (`pipeline-job.service.ts:127`) fails *every* `RUNNING` row older than 10 min, whoever owns it | Record `worker_host`; sweep only this host's rows (S2) | Heartbeat column; sweep on expired heartbeat instead of age | One host restarting kills all its own jobs anyway |
| **H2** | `HostThrottle` is per process, so N processes = N× the rate a site sees | **Fully done now** (S1) | — | Not deferred: S2 already adds a second concurrent sync |
| **H3** | A thread pool cannot move to another machine | CPU work goes through a queue (S6) | Own `cpu-worker` deployable for the mini (D12.5) | Where the queue's consumer runs is config |
| **H4** | Bulk downloads land in a local `tmpdir()` | **Rule:** anything crossing a lane boundary references a source-version id or storage key, never a local path | Fetch uploads to the bulk-archive tier (#1277) before enqueueing the parse | S8 keeps fetch and parse in one job |
| **H5** | Per-worker concurrency multiplies with consumers; Prod and UAT share one GPU through separate Redis | Per-endpoint queues bounded by `setGlobalConcurrency`, with an interactive reserve (S7) | Cross-environment arbitration; per-host model-affinity dispatchers once the models are on different machines | One environment per Redis, one consumer per queue today |
| **H6** | A partitioned worker's lock expires and a second worker runs the same job concurrently. A unique `jobId` stops a duplicate enqueue, not a duplicate execution | **Fully done now**: every lane write is an idempotent upsert keyed on the skip key that never overwrites a newer result | — | Not deferred: stalled-job redelivery already happens on one host (#730) |

H2 and H6 are correctness fixes on one host that happen to be what
multi-host needs. **Lane timeouts and circuit breakers are per lane and
env-configured** (D8), so a remote endpoint's latency is config, not code.

## 8. Decisions

**Skip fixes before lanes.** They attack GPU busy time — the actual
ceiling. Lanes only attack GPU idle time.

**A model belongs to a lane, not a data type.** Lane models are per-process
environment shared by every data type on that lane, so "switch bills to the
new model" is not expressible — moving a *stage* between lanes is. Phase B
moves stages; Phase C switches each lane's model once (§10.3).

**Payloads carry a source-version id, not content.** Redis stays small, a
retried job reads exactly the bytes the first attempt saw, and the row links
to its source version (#1306) and run (#1280).

**Enqueue-next-stage, not FlowProducer, to start.** The manifest chain
already works this way, and parent/child flows add failure semantics the
per-type sync does not need. Revisit only if S2's cancellation fan-out needs
it.

**One concurrency per lane, not per stage.** Seven independent
`*_CONCURRENCY` knobs can sum past what Ollama accepts, and calls then queue
server-side, invisibly. A lane bound makes queue depth visible on the
dashboard.

**Prune by discovery, never by success** (F2). Whether a bill was processed
successfully says nothing about whether it still exists at the source.

## 9. Multi-host gaps — deferred to the scale refactor

**Trigger:** the infra plan's "decide whether to buy the mini" gate, or any
decision to run a lane consumer on a second machine — whichever comes first.
Until then these are known gaps, not defects. Re-verify each when the
trigger fires; the code will have moved.

| # | Work | Builds on |
|---|---|---|
| **R1** | Heartbeat-based stale-job detection across every lane's status table | H1 |
| **R2** | `cpu-worker` as its own deployable (nest-cli entry, Dockerfile, compose, `/health`, Prometheus scrape) | H3 |
| **R3** | Fetch uploads bulk files to the bulk-archive tier; the CPU lane reads from storage | H4, #1277 |
| **R4** | Per-host GPU dispatchers; decide whether Prod outranks UAT at the GPU and how that is enforced across two Redis instances | H5, infra D2 |
| **R5** | Per-host secret provisioning — today's `op-compose` Keychain injection is Studio-specific | infra D9 |
| **R6** | NTP on every host, so cross-host spans order correctly | M3 |
| **R7** | Lock durations and timeouts re-measured over the real link (Thunderbolt Bridge for Prod, Tailscale for UAT) | §7 |

## 10. Delivery

Implementation walks **each data type through every stage of this plan**,
rather than shipping each item across all types as it lands. Track 0 ships
first, alone. Everything else ships as **one major release, v2.0.0**: lanes
and performance, the model cutover, attribution and lazy analysis together.

This fits trunk-based work without a long-lived branch. **Merging does not
ship** — `release.yml` triggers on a `v*` tag — so every PR merges to `main`
as it is ready, behind defaults that are inert until configured (the
`split-ingestion-model-lane.md` §3 precedent), and the release is tagged
once. The bundle is the release, not a branch.

### 10.1 Phase A — foundation

In this order:

1. **Gate 0** (M1–M4) and the **dashboard** (§3) — the baseline is taken
   before anything else changes.
2. **Shared helpers**, consumed by every Phase B PR and never forked:
   - ~~`withStage()` (M1)~~
   - the skip-key builder (§4 shared rule)
   - the idempotent, monotonic lane upsert (H6)
   - `writeBillLifecycleFields()` (F4)
3. **S1** per-host rate limiter.
4. **S7** queue part: per-endpoint queues, global bound, interactive
   reserve, priority. Parallelism stays at 1.
5. **S2** per-type jobs, `worker_host`.
6. **#1281** model digest pinned in `LlmGeneratorBase` — still open, and
   every skip key and attribution column needs it.

### 10.2 Phase B — per data type, in this order

Each data type goes through the same steps:

1. Apply its skip fixes.
2. Close its attribution gaps.
3. Move its stages onto lanes.
4. Re-measure against the M4 baseline: speed, LLM calls, and quality where
   a leg exists. **No quality regression is accepted for a throughput gain.**
5. Exercise it on the local UAT stack before the PR (the UAT-before-commit
   rule).

| Order | Data type | Plan items | Eval note |
|---|---|---|---|
| 1 | **Bills** | F4, K3, K5, K6, F3, §5.2 lazy path, S3 | Bill extraction runs on the **analysis** lane today. Moving it to the ingestion lane needs a bills-extraction eval leg first — model plan §5 says no ingestion workload has one. Until it passes, extraction stays on the analysis lane |
| 2 | **Civics** | K1, S3 | `getCivicsExtractionPrompt` has no eval leg either; build it here. The held-out gold page stays untuned |
| 3 | **Propositions** | S4 (analysis); embedding per the embeddings provider choice (#1156) | Re-read the yes/no asymmetry finding (model plan §4.2) in prompt-service before regenerating |
| 4 | **Representatives** | K2, S4 (bios, committee summaries/descriptions), S5 | `representatives-gold-eval.md` is the gate |
| 5 | **Meetings / minutes** | S6 (PDF/OCR to the CPU lane) | `minutes-summary` is already lane-shaped — mostly a move. OCR choice per `1234-petition-scan-ocr-eval.md` |
| 6 | **Campaign finance** | K4, S8 | No LLM. Verify against the raw archive, not `items_extracted` |

Bills goes first because it has the most findings and the longest run.

### 10.3 Phase C1 — lane model cutover

Once every data type on a lane has passed its eval leg on the candidate
model, switch that lane's model — **once per lane**, on the UAT stack first,
per `model-selection-and-deployment-split.md`. Then raise S7 parallelism
above 1 and re-run the eval harness at the new parallelism. #1233
(`MIN_VERIFIED_SIMILARITY` uncalibrated per model) must be re-measured for
any change that touches petition verification.

### 10.4 Phase C2 — the release

A runbook in `docs/runbooks/`, prepared with `/op-release`:

- **A verified backup first.** Prod backups have stopped silently before.
  This release regenerates analyses at scale, so take a backup and
  restore-test it before tagging.
- **Regeneration is explicit.** Analysis staleness has prompt and
  source-text axes but **no model axis**, so a model cutover does not
  invalidate existing analyses. Plan the regeneration per data type, scoped
  (shared tables like `claims` need scoped clears). Use the #1305 transfer
  path to regenerate on the Studio and ship the results, rather than
  regenerating live on the node.
- **Order of deploys:**
  1. prompt-service, with any new templates seeded. Do not restart it after
     seeding — a boot re-seed overwrites newer prompts.
  2. The `@opuspopuli/regions` version carrying `coldAfterDays` and any
     cadence changes, pinned in the image.
  3. The backend `v2.0.0` tag, deployed with **both** compose files.
     Migrations are baked into the image and additive only.
  4. `frontend-v*`. `summaryStatus` must exist before the UI asks for it.
  5. The `opuspopuli-node` dashboard, alert changes and Prometheus
     exemplar flag (§3), once the metrics are being emitted.
- **Federation check** at the gateway for every additive subgraph field.
- **Column retirements** (if any) go in a later release, never in v2.0.0.

### 10.5 Risks of bundling

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| A big release is hard to roll back | **high** × possible | Every change is merged and inert on `main` before the tag; lane and model choices are env-switchable, so rollback is config plus the previous image tags; the backup covers data |
| Regeneration at scale saturates the Studio | medium × likely | Regenerate offline and transfer (#1305); otherwise per data type, off-hours, under the lane bounds |
| Per-data-type work drifts from the shared helpers | medium × possible | Phase A lands first; Phase B PRs consume the helpers and may not fork them |
| Scope grows because "it is a major release anyway" | medium × likely | Only items named in this plan are in v2.0.0. Anything else is a separate issue |

## 11. Owner decisions

| Decision | Blocks | Suggestion |
|---|---|---|
| `coldAfterDays` default | K5, K6, §5.2 | 180 days |
| Do **dead** bills go cold immediately, rather than after the window? | K5 | Yes — a bill that died in committee has no "it just changed" reason to stay hot |
| The F2 deletion-guard threshold | F2 | Refuse a prune above ~2% of the region's bills in one run |
| Lazy-summary caps (global daily, per session) | §5.2 | Start low; the dashboard's row 6 shows whether readers hit them |
| Whether anonymous viewers get the summarise button at all, or only signed-in viewers | §5.2 | Button for anonymous — civic information should not require an account |

## 12. Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| Bills deleted by the prune before Track 0 ships | **high** × certain | Ship Track 0 first; check prod logs for how many bills mode 1 has already deleted |
| A skip key misses an input and serves stale output | **high** × possible | §4 shared rule (content, prompt, model digest, config) built in one helper; change-one-input test per skip |
| Frozen bills mislabelled because lifecycle never recomputes | **high** × certain without F4 | F4 before K5; a backfill repairs existing rows |
| Linkers run before the rows they link have landed | **high** × likely once fanned out | Linkers are a terminal stage per data type per parent sync (§6) |
| Queued lanes starve interactive inference (RAG, petition scan) | **high** × likely without the reserve | Interactive reserve in S7; dashboard row 4 splits queued versus interactive |
| Cancellation stops the parent but not enqueued children | medium × likely | `cancelRegionSync` removes waiting children by parent id; each lane worker checks the parent row at job start (`sync-runaway-and-cancellation.md` boundary rule) |
| Provenance lost across the job boundary | **high** × possible | `pipelineJobId` and source-version id in every payload; output rows persist them (#1280, #1306) |
| A redelivered job runs concurrently with the original and writes twice | **high** × possible | Idempotent, monotonic upserts per lane (H6) |
| Higher Ollama parallelism or a model cutover changes output | medium × possible | Gated on eval-harness parity, including the held-out civics page (§10.3) |
| JS-rendering crawlers trigger lazy summaries | medium × possible | Session or user gesture required; per-job dedupe; caps (§5.2) |
| A cold bill's status changes and nobody notices | medium × rare | Slow cheap re-check (K5) |
| A reader waits minutes for a summary and leaves | low × likely | Source facts render immediately; the summary is additive |
| More moving parts on a host that does not survive an unattended reboot | medium × certain | Jobs persist in Redis; the startup sweep extends to every lane's status rows. FileVault-before-login stays an accepted risk |
| A seam built "for later" is silently co-location-dependent | medium × possible | Run every lane consumer as a separate process in UAT with only configured endpoints (D13), before §9 |
| Overlap gain turns out negligible | medium × possible | Gate 0 decides per data type; §4, §5 and S2 stand regardless |

## 13. Not in scope

- **Moving workers to the Mac mini.** D13 makes that a host/config change;
  §7 keeps every lane location-independent. The remaining work is §9.
- **Making petition scans asynchronous.** S6 moves *where* OCR runs, not the
  synchronous GraphQL contract.
- **Mid-item cooperative cancellation** of an in-flight LLM call — filed
  under `sync-runaway-and-cancellation.md` §7.
- **Choosing models.** Lane → model mapping follows
  `model-selection-and-deployment-split.md`.

## 14. Effort

| Item | Estimate |
|---|---|
| Track 0 (F2 + tests + patch release) | ~½–1 session |
| Gate 0 (M1–M4) | ~1–2 sessions |
| §3 dashboard, alerts, Prometheus config, port to both repos | ~1–2 sessions |
| Phase A helpers, S1, S7 queue part, S2, #1281 | ~2–3 sessions |
| Bills: F4, K3, K5, K6, F3 | ~1–2 sessions |
| Bills: §5.2 lazy path (mutation, resolver, frontend state, a11y, i18n) | ~1–2 sessions |
| S3–S5 | ~2–3 sessions |
| K1, K2, K4 | ~½ session each |
| S6, S8 | ~1 session each |
| Eval legs: bills extraction, civics extraction | ~1 session each |
| Phase C: cutover, regeneration, runbook, release | ~2 sessions |
| §9 (deferred) | ~2–3 sessions when triggered |

Every number here is a guess until Gate 0 runs.
