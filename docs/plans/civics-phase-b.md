# Phase B — civics

Civics is first in Phase B (`ingestion-resource-lanes.md` §10.2, owner
decision 2026-10-23: civics, propositions, representatives, meetings,
campaign finance, then bills). Its plan items are **K1** (skip unchanged
pages) and **S3** (extraction off the fetch loop, onto the GPU lane), and
each Phase B type walks the same five steps: skip fixes, attribution gaps,
lanes, re-measure against the baseline with no quality regression accepted,
UAT before the PR.

## What is true today (read 2026-10-23)

- **Nothing is skipped.** `CivicsSyncService.sync`
  (`civics-sync.service.ts:253`) crawls each source (`crawlCivicsUrls`, BFS
  bounded by `crawlDepth`/`crawlMaxPages`), then for every page, in series,
  fetches it, converts it to readable text (`:660`), builds the prompt and
  calls the LLM (`:672`) — and only then reads the existing
  `civics_blocks` row (`:794`). An unchanged page costs a full extraction
  every run: the baseline's 21 calls were 164k tokens in, 28k out, 94% of a
  34-minute job.
- **Provenance on the block is good, elsewhere partial.** `civics_blocks`
  stores `promptHash` (the template's hash), `promptVersion`, `llmModel`,
  `llmDigest`. It has no hash of the text the model saw and no record of
  the config that fed the prompt. `glossary_entries` store prompt hash and
  version but not the model or its digest.
- **Config moves output more than the prompt does** (measured in the civics
  iteration). The fields that reach the prompt or the grounding are
  `contentGoal`, `category`, `hints`, and `llmMaxTokens` bounds the output.
- **An eval exists** — `packages/eval-harness/src/civics-eval.ts`, scored by
  `scoring/civics.ts` against `fixtures/gold-civics.json` (three tuning
  pages and the held-out Senate legislative-process page, which stays
  untuned). The parent plan's "no eval leg" is wrong; what is missing is
  using it as a gate. Write-up: `docs/evals/2026-09-27-civics-gold.md`.
- **The shared skip-key helper is unused.** `buildSkipKey` / `stableHash` /
  `laneJobId` (`packages/common/src/utils/skip-key.ts`) were built in Phase A
  for exactly this; civics is their first caller.
- **The baseline is not clean.** Gate 0's civics row (2026-10-22) lost two
  of 21 calls to memory pressure — 1,120 s of a 2,032 s job — so its GPU
  figure is corrupted, as the parent plan says.
- Small: `fetchUrlText` labels its fetch metric `dataType: 'bills'` for every
  caller, civics included.

## Steps

### 0. Re-take the baseline

On the current image, before any civics change: one civics sync, measured
with `docs/runbooks/gate-0-baseline.md` unchanged (memory headroom checked
first). The same run is the "first run" of K1's acceptance: it extracts
every page and writes the hashes K1 compares on the second run.

Also run the eval (`eval:civics --candidate model`, seed 7) on the live
model, so step 4 has a quality reference from the same day and image.

**Done 2026-10-23** (UAT, S2 image with the S7 lane queue on and the 5-min
lane lock, host kept awake with `caffeinate`, Docker restarted first). The
first attempt that day lost two pages to S7's 30 s lane lock during an idle
sleep (#1404); this is the re-take.

| civics, job 100 | |
|---|---|
| run | 1,646 s (counters read 35 s after, for scrape lag) |
| items (c/u/s/f) | 0 / 11 / 13 / 0 — plus 3 discovered sources |
| `llm` stage | 1,630 s — 96.8% |
| GPU busy | **96.6%** |
| LLM calls | 24 — 198k tokens in, 76.6k out |
| stage − inference gap | 2.9 s |

**What it says:** civics is GPU-bound and serial — the GPU is busy 97% of
the run, so lanes and parallelism have little to win here at one slot; the
win is not calling it at all. **13 of the 24 calls went to pages with no
civic content** and 11 to pages that, run to run, did not change.

**Eval reference** (nemotron-3.5-lightning:30b-a3b, seed 7, prompt v6 via
prompt-service, gold `extractedTextForAudit`):

| gold page | recall | precision |
|---|---|---|
| failed-qualify | 0.900 | 0.834 |
| qualified-ballot-measures | 1.000 | 0.834 |
| teachers-and-students | n/a (correctly empty) | n/a |
| **legislative-process (held out)** | **0.432** | 0.867 |

K1 must reproduce these exactly: it changes whether a page is extracted,
never what an extraction produces. (The baseline script also under-counted
skips — it read counters at the run's last second, before Prometheus's next
scrape; it now reads one scrape interval after.)

### 1. K1 — skip unchanged pages

Before the LLM call, compute the skip key from:

- `sourceHash` — sha256 of the readable text the prompt is built from
  (`content`, `:660`), not of the HTML: markup churn that leaves the text
  unchanged should not re-extract;
- `promptHash` — the template hash `getCivicsExtractionPrompt` already
  returns (fetched before the LLM call; no change);
- `modelDigest` — the provider's digest (`outputProvenance`);
- `configHash` — `stableHash({ extractor, contentGoal, category, hints,
  llmMaxTokens })`: the data-source fields that reach the prompt or bound its
  output (the **effective** token budget, so changing the code default
  counts), plus **`CIVICS_EXTRACTOR_VERSION`** — the version of the code
  between the model and the row (JSON repair, grounding, the empty check,
  normalisers, `temperature`/`topK`). A skipped page skips that code too, so
  **bump it whenever post-processing changes what an extraction stores**, or
  the fix never reaches an unchanged page. The next civics lever (code
  normalisation of `lifecycleStages`) is exactly such a change.

When the key equals the one recorded for the page, the page is
**skipped**: no LLM call and no output written — only the record's
`checked_at` — counted as `skipped` with reason `unchanged`, and the run's
skipped total reaches the job's result (`itemsSkipped`).
`buildSkipKey` returns null — always run — when the digest is unknown, so
an unresolved model never matches.

**Where the key is recorded — not only on the block.** A page with no civic
content extracts to an empty block, and #874 deliberately writes no row for
it, so a key kept on `civics_blocks` could never skip those pages: in the
baseline that is 13 of 24 pages, more than half the LLM calls. So each
completed extraction records its key in a small side table,
**`civics_page_extractions`** (`region_id`, `source_url`, `skip_key`,
`outcome` = `block` | `empty`, `checked_at`; unique on region and URL) —
written for a page that yielded a block and for one that yielded nothing,
and **not** for a failure or for the empty-over-existing `stale` case,
both of which must retry. The check reads this table, before the fetch's
LLM call.

The block itself additionally stores `source_text_hash` and `config_hash`
(additive, nullable) — attribution: what input produced it, not only which
prompt and model.

A `block` record skips **only while the block exists**: one deleted to force
a fresh run, or lost to a restore, is re-extracted rather than skipped (a
skip would leave it gone and let the glossary prune retire its terms). A
prompt **detected** as cut short on input (`promptTruncated`: under half of
it read, `MIN_PROMPT_COVERAGE`) is not recorded — its answer came from part
of the page, and the context window is not in the key, so raising it
reaches the page. An overflow below that threshold is not detected and is
recorded; civics prompts (~8k tokens) are far from the window today, and a
window change for an existing page needs `resetWatermark`. A failure is not
recorded either, and the empty-over-existing (`stale`) case **clears** the
page's record — so all of those retry next run, a forced run included.

**Forcing re-extraction** is the sync's existing `resetWatermark` ("ignore
the stored ingestion state for this run"): it now also makes civics extract
every page past its skip records. Not a hand `DELETE`. It is per request and
applies to every type in it — a request for meetings *and* civics with it
set resets the meetings archive walk and re-extracts every civics page (~27
GPU-minutes on the baseline) — so name the one type you mean. The Postman
request `Sync — CIVICS (Admin)` carries it, default `false`.

**Two consequences to know:**
- **Glossary last-writer-wins changes meaning.** `glossary_entries` is keyed
  by term, last writer wins. Before K1 every page rewrote its terms every
  run, in crawl order; now only pages that changed do, so a term defined on
  several pages reflects the most recently *changed* one. Definitions are
  unaltered; which page's wording is current can differ.
- **A model pull needs a worker restart.** The provider caches the model
  digest for the life of the process. Before K1 a stale digest only
  mislabelled attribution; now it also keeps unchanged pages skipping on new
  weights. Restart `region-worker` after `ollama pull`. (`CIVICS_EXTRACTION_SEED`
  is not in the key either — set it with `resetWatermark` to reproduce a run.)

### 2. Attribution gaps

- `glossary_entries` gain `llm_model` and `llm_digest` (additive), written
  with the block's provenance — a definition currently cannot say which
  model wrote it.
- Civics writes through `withProvenance`, the shared write path, instead of
  mapping `outputProvenance` by hand.
- The fetch metric gets the caller's data type.

### 3. S3 — extraction onto the lane

**Owner decision (2026-10-23): build it, though civics gains little from it
today.** Measured, civics is 97% GPU with 3.4% idle, so by the parent plan's
Gate 0 rule ("under ~15% idle: lanes deprioritised") S3 would be skipped,
and K1 already gives civics resumability and per-page retry. The decision
is consistency instead: **every data type runs the same staged pipeline**,
so nobody has to remember which types behave differently; a type whose
content or shape changes later needs no refactor; and the 15% threshold
was measured on California — another region (slower sites, bigger pages)
can exceed it. Civics is the template the other types reuse.

Separate PR, after 1–2 are measured (K1 shipped in #1405).

**Owner decisions (2026-10-23):** the civics sync job **waits for its
pages' extraction jobs** before it finishes; and the page text reaches the
worker through the **source-version store**, not the job payload.

#### What is true today (read 2026-10-23)

- civics already reaches the GPU through S7: `LLM_INGESTION_PROVIDER` is
  wrapped by `withLaneQueue`, so `this.llm.generate` goes through
  `LlmLaneDispatcher` wherever `LLM_LANE_QUEUE_ENABLED=true`. What S3 changes
  is *who waits*: today the fetch loop blocks on every call, so page *n+1* is
  not fetched until page *n* is extracted.
- The template the plan named, `minutes-summary`, is fire-and-forget: one job
  per row (`jobId: minutesId`), the worker reloads `minutes.rawText` and
  re-checks, errors are swallowed (so retries never fire), and nothing reports
  back to the parent. Nothing in the codebase chains BullMQ jobs with flows or
  `QueueEvents`, except S7's dispatcher, which awaits its own job with
  `waitUntilFinished`.
- Three things assume the extract phase is over when `sync()` returns: the
  **glossary prune** (`pruneUnsourcedGlossaryEntries`, after the loop —
  it deletes terms no page sources, so run early it retires terms a pending
  job is about to re-source), the **per-type lock** (released in the
  processor's `finally`; its own comment names concurrent civics prunes as the
  hazard), and the **counts** the job writes to `pipeline_jobs.result`.
- The civics fetch is `fetchTextWithRetry` → `response.text()`: a decoded
  string, no bytes, no archive. `source_versions` (`SourceVersionService`:
  `record`, write-once `attachDerivedText`, `getByHash`; no `getById`) is
  where propositions and minutes keep their bytes, linked by
  `source_version_id`.
- The consecutive-failure abort lives in `SyncPhaseTracker.recordFailure`,
  in memory, in the process that records outcomes.

#### Design

**The parent (the civics `region-sync` job, region-worker) fetches, queues,
then waits.** For each crawled page, in order:

1. Fetch **bytes** (`fetchBytesWithRetry`, a sibling of
   `fetchTextWithRetry` on the same retry, rate-limit and content-type path,
   returning body, `Content-Type` and the HTTP validators).
2. Decode as **UTF-8**, BOM stripped (`decodeFetchedText`) — which is what
   `response.text()` does whatever the declared charset, per the Fetch
   standard, so the text, and K1's key over it, are unchanged by S3 (pinned
   by a test against the real `Response.text()`). Then `htmlToReadableText`
   — one shared function, so parent and worker derive the same text from the
   same bytes.
3. Build the K1 key exactly as today (text hash, prompt template hash, model
   digest, config hash). Unchanged → `skipped`/`unchanged` in the parent, no
   job, **nothing archived** (the archive dedupes on bytes and K1 on text, so
   a page whose markup churns every request — a token, a timestamp — would
   otherwise add an unreferenced row every run). Otherwise `record()` the
   bytes in `source_versions` (identical bytes collide with the row already
   there and write nothing; a page the archive refuses — empty, over 25 MB —
   is `failed`, there being nothing for the worker to reload) and enqueue one
   job on **`civics-extract`** with `{ regionId, sourceUrl, sourceVersionId,
   source: <the data-source fields the extraction reads>, reextract }` and
   `jobId = laneJobId(<sha256(regionId + url), 32 hex>, 'extract' |
   'reextract', skipKey)` — a forced run's own stage, so it never collapses
   onto an unforced job in flight
   — an unknown digest (null key) gets a one-off id, so never collapses. Two
   sources reaching one page with identical inputs share the one job, and
   both are counted.
4. Move to the next page without waiting.

It **listens before it queues**: one `completed`/`failed`/`removed` listener
on a `QueueEvents` for `civics-extract`, ready before the first add, filtered
to the job ids this run queued (or collapsed onto). `removed` — a job someone
else took off the queue — is a failure, not a wait to the timeout. Each outcome goes to the
tracker **as it arrives** — so an abort can fire mid-run — and once every id
has reported (bounded by the lane wait timeout), the parent runs the prune and
returns the same `{processed, created, updated, skipped}` as today. Not
`waitUntilFinished` per job after the loop: it polls the job's state, and a
job that finished during the loop and was removed (below) reads as
*missing*, which BullMQ reports as a failure (`isFinished` status −1,
`job.js` 905–910 in 5.76.10). Lock, prune and counts
keep their current meaning because the job still ends after its work does.

**The worker** — `CivicsExtractProcessor`, a provider in `RegionWorkerModule`
like `minutes-summary`, concurrency `BULLMQ_QUEUE_CIVICS_EXTRACT_CONCURRENCY`
(the worker factory's per-queue setting), **default 1**: the overlap S3 buys is fetch against GPU, which one extraction slot
already gives, and the lane governs GPU concurrency on its own. It loads the
`source_versions` row by id (a new `getById`), derives the text, rebuilds the
prompt, **re-checks the key** (a second run may have finished the page
first) and runs what `extractAndUpsertPage` does after its fetch today —
moved, not rewritten. The block gains `source_version_id`, and
`attachDerivedText` records the text the block was extracted from. It
returns the page's outcome (`created` | `updated` | `skipped` | `stale` |
`unchanged` | `failed`): a deterministic failure (no JSON, JSON beyond repair,
its archived page gone) is returned as `failed`; a transient one (a runner
killed, the lane unreachable) throws, and the queue retries it.

**Retries and failure.** The queue's defaults (3 attempts, 30 s exponential
backoff, `BULLMQ_QUEUE_CIVICS_EXTRACT_ATTEMPTS` / `_BACKOFF_MS`), applied to
a **thrown** error only — a runner killed under memory pressure (the
baseline's #1 failure), the lane unreachable — which now gets another try in
the same run instead of waiting for tomorrow. A deterministic failure (no
JSON, JSON beyond repair) is *returned* as `failed` and not retried: decoding
is greedy (`topK: 1`), so a retry would reproduce it at full GPU cost. A job
that exhausts its attempts is a `failed` outcome in the parent. **The consecutive-failure abort stays in the
parent's tracker**, not the worker, as the plan first said: the parent sees
every outcome, in completion order, so the counter needs no cross-process
state. On abort the parent removes its still-waiting jobs and waits out the one
already running (bounded by the idle timeout — so an abort can take as long as
one extraction), then throws as today.

**Job retention.** `removeOnComplete` / `removeOnFail` **on**. BullMQ treats
an add whose id matches a *retained finished* job as a no-op, so with the
queue defaults (completed kept 7 days) a page whose block was deleted, or a
`resetWatermark` run, would collapse onto last week's job and do nothing.
Removing finished jobs limits collapse to jobs still in flight — two
overlapping runs, or a restarted parent re-queuing what its predecessor
left. The result still reaches the parent, because it listens to the
`completed` event rather than reading the job afterwards.

**Restart.** A region-worker restart kills the parent and the in-flight
job. On the next run the parent re-queues every changed page; ids still in
Redis collapse onto the queued jobs, finished pages are K1-skipped, and
the one interrupted extraction is stalled and re-run (`maxStalledCount` 1:
the upsert is idempotent). Nothing is extracted twice that finished.

**Cancellation.** The parent checks the run's cancel state before each page
and between outcomes; when cancelled it stops fetching, removes its waiting
jobs, and waits out the one already running before it returns — today cancel
is checked only before a sync starts.

**Timeout.** If no outcome arrives for the lane's own wait bound
(`LLM_LANE_WAIT_TIMEOUT_MS`, 6 h), the rest are counted `failed` and the ones
not yet started are removed from the queue, so a consumer that never comes
cannot hold the parent (and its lock) for ever. A job already running is NOT
stopped: it finishes after the parent has returned, released the lock and run
the prune — the one case where the run does not end after its work does. It
is safe for the prune (a block is written before its glossary terms, and the
prune spares a term whose page has a block), and a 6 h silence means
something is already broken.

**Inline fallback.** `BULLMQ_QUEUE_CIVICS_EXTRACT_ENABLED=false` — the switch
that already stops the consumer — makes the sync extract in its own process,
as before S3, rather than queue work nothing will take. The same path runs
when no queue is bound (unit tests).

**Metrics.** Unchanged: per-item outcomes keep the `extract_and_upsert`
phase, names and labels, and the fetch time S3 moves off the critical path
is already visible as the `fetch` stage (`data_type="civics"`). (A separate
`fetch` phase was planned and dropped: fetch and extraction now overlap, so
a phase boundary between them would describe nothing.)

**The template.** Fan-out-and-await has no civics knowledge in it: it lives
in `apps/backend/src/common/` (listen-then-enqueue, await all with a timeout,
per-outcome callback, cancel and abort hooks, remove-the-waiting), so propositions,
representatives and the rest call it rather than copy it.

#### UAT (2026-10-23, local stack, final code unless noted)

| run | what | result |
|---|---|---|
| 1 (pre-review code) | unforced, first run on the S3 image | 25 s, 24 `unchanged`, 0 LLM calls — the byte fetch + UTF-8 decode left every K1 key valid |
| 2 (pre-review code) | forced | 1,782 s, 0/11/13/0 — slower only because unit + integration suites and two review agents ran on the host during it; not a measurement |
| 3 | unforced | 25 s, 24 `unchanged`, 0 calls, **nothing archived** |
| 4 | forced, host idle — **the measurement** | **1,642 s** (baseline 1,646 s), 0/11/13/0, 24 calls, 197.6k in / 76.6k out (identical to baseline); **GPU busy 99.2%** (baseline 96.6%); fetch 23.2 s, now overlapped; all 11 blocks linked, `derived_text_hash` = `source_text_hash` on all 11 |
| 5 | forced, region-worker restarted at page ~20 | the new worker picked up the queued `civics-extract` jobs at once and finished them with no parent waiting; only the page mid-extraction ran twice; no finished page re-ran |
| 6 | unforced, after run 5 | waits on the civics type lock the crashed worker held — see below |

**What a restart does** (S2 behaviour, surfaced here, not changed by S3): the
startup sweep marks the interrupted run's `pipeline_jobs` row **failed**
("stale RUNNING row past lock-renewal window") while its queued pages go on to
finish in the background; the type lock the dead process held expires only
after its TTL — the region-sync job lock, **1 h on UAT**
(`BULLMQ_QUEUE_REGION_SYNC_LOCK_DURATION_MS`), 5 min by default — so the next
civics sync waits that long; and BullMQ re-delivers the stalled region-sync
job when its own lock expires, which for a forced run re-extracts every page.
So "a restart costs only the interrupted page" holds for the queued page work,
not for the run as a whole.

**Archive growth.** 13 of the 24 California civics pages serve different bytes
on every request with the same readable text (a token or timestamp in the
markup). Unforced runs archive nothing; each forced run adds 13 rows (~0.8 MB
total — the 50 rows after these runs are 3 MB).

#### Schema

One additive migration: `civics_blocks.source_version_id` (nullable, FK to
`source_versions` with `ON DELETE SET NULL`, indexed — the
`propositions`/`minutes` shape). Existing blocks keep null until their page
next extracts.

#### Acceptance

- **Equivalence:** a `resetWatermark` civics sync makes the same 24 calls
  and the eval scores match step 0 exactly (S3 moves work, never changes
  it); a second, unforced sync still makes 0.
- **Throughput:** run time at or below the clean baseline (1,646 s). The
  run is 97% GPU, so expect a small gain — the fetch time, now overlapped.
- **Restart:** kill region-worker mid-extraction, re-run: no page that
  finished is re-extracted, the interrupted one is.
- **Abort and cancel:** with the LLM forced to fail, the run aborts after
  the limit with no queued jobs left behind; a cancelled run leaves none
  either.
- **Archive:** every block written has a `source_version_id`, and its
  version's `derived_text` hashes to the block's `source_text_hash` — except
  where `attachDerivedText` logged a mismatch: derived text is write-once, so
  a later `htmlToReadableText` change (or another data type archiving the
  same bytes first) keeps the earlier derivation.

### 4. Re-measure and gate

- **Throughput:** a second sync on the step-1 image must skip every
  unchanged page — expected near-zero LLM calls — and a sync after a forced
  change (a hint edited in the region config) must re-extract exactly the
  pages of that source.
- **Quality:** the eval on the step-1/2 image must match step 0's scores —
  K1 and the attribution changes must not alter any output. Held-out page
  included, untuned.

### 5. UAT

Each PR exercised on the local UAT stack before commit: two consecutive
civics syncs (the second skipping), then one after a config change.

## Schema

One additive migration per PR, via `/op-migration`:
- PR 1 (#1405, shipped): a new `civics_page_extractions` table (above);
  `civics_blocks.source_text_hash`, `.config_hash` (nullable — existing rows
  have none; their first run re-extracts and records a key);
  `glossary_entries.llm_model`, `.llm_digest` (nullable).
- PR 2 (S3): `civics_blocks.source_version_id` (nullable FK, indexed).

## Data classification

Public civic text only. Hashes and model names are not personal data.

## Not in this change

- Two gaps in the shared page fetch that the S3 security review found and that
  predate S3: a redirect off the registered hosts is followed and never
  re-checked, and there is no download size cap (the 25 MB cap bounds what is
  archived, not what is read). The fetch is shared with bills, whose sources
  may legitimately redirect, so neither was changed here — #1406.
- Asserting the archived row's `source_url` matches the job's (suggested by
  the same review): `source_versions` records the URL that FIRST captured a
  set of bytes, so two pages serving identical bytes share a row under one
  URL, and the check would fail a correct job.

- Retiring glossary terms a still-present page stopped emitting (a known
  limitation of the prune).
- Moving civics to the ingestion lane's model — that is Phase C, gated on
  this eval.

## Risks

| Risk | Mitigation |
|---|---|
| A skip serves stale output after a change nothing hashes | The §4 inputs plus the extractor version and effective budget are in the key; a new prompt input fails to compile until it is covered (a `Record` over `CivicsExtractionParams` pins it). **Not** in the key, so covered another way: the context window (truncated prompts are not recorded), the model digest's process cache (restart after a pull), the seed (use `resetWatermark`) |
| A block deleted to force a fresh run is skipped and its glossary pruned | A `block` record skips only while the block exists |
| The readable-text conversion changes (a library bump) and every page re-extracts once | Acceptable: it is a real input change; one run's cost |
| The template hash does not cover the interpolated text | The interpolated values are covered (page text, config fields, the row's region and URL); the client code that formats them is not — a change there must bump `CIVICS_EXTRACTOR_VERSION` |
| S3: a deleted block's page collapses onto last week's finished job and is never re-extracted | Finished `civics-extract` jobs are removed; only in-flight jobs collapse |
| S3: a page that finishes during the fetch loop is removed, then read as failed | The parent listens for its jobs' events before the first add and never reads a finished job back |
| S3: the prune runs before pending pages write | The parent awaits every job before the prune; the per-type lock is held until then |
| S3: the parent and worker derive different text from the same bytes | One shared decode-and-convert function; acceptance checks `derived_text` against `source_text_hash` |
| S3: the bytes fetch decodes differently from `response.text()` | It decodes as `text()` does — UTF-8, BOM stripped, charset ignored — pinned against the real `Response.text()` for BOM, latin-1-declared and invalid bytes |
| S3: a job retried on a deterministic failure burns GPU for the same answer | Only thrown errors are retried; `failed` outcomes are returned |
