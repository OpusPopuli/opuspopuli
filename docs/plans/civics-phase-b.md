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

Separate PR, after 1–2 are measured. The fetch loop fetches and records each
page, then enqueues one extraction job per page on a `civics-extract` queue
(the `minutes-summary` shape: one job per row, the worker reloads and
re-checks), with `jobId = laneJobId(<page>, 'extract', skipKey)` so two runs
of an unchanged page collapse onto one job. The worker's LLM calls go
through S7's lane queue like every other batch call. The consecutive-failure
abort moves into the worker, keyed per parent job. Civics fetches decoded
strings, so recording the page for the worker needs either a bytes-returning
fetch into the source-version store or the readable text itself; decided in
S3's own section when it is written.

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
- PR 1: a new `civics_page_extractions` table (above);
  `civics_blocks.source_text_hash`, `.config_hash` (nullable — existing rows
  have none; their first run re-extracts and records a key);
  `glossary_entries.llm_model`, `.llm_digest` (nullable).

## Data classification

Public civic text only. Hashes and model names are not personal data.

## Not in this change

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
