# Phase B — representatives

Representatives is fourth in Phase B (`ingestion-resource-lanes.md` §10.2,
owner order: civics, propositions, **representatives**, meetings, campaign
finance, bills). Its plan items are **K2** (activity summaries stop
regenerating every run), **S4** (the post-scrape generators onto the GPU lane,
one job per row) and **S5** (extraction-plan derivation and self-heal off the
crawl loop), and, by the consistency principle, every stage the other types
got: skip keys on every axis, attribution, and every lane that applies. The
gate is `representatives-gold-eval.md` — which has fixtures and a guard spec
but no scorer, so building it is part of this plan. Dev only (owner, 2026-10-26): verified on the local UAT stack; no tags, no
Studio deploys.

## What is true today (read 2026-10-27)

**The sync** (`representatives-sync.service.ts:265–450`), six phases:
discover (`provider.fetchRepresentatives(maxReps)` — the detail crawl is
inlined here, through the scraping pipeline), extract_and_upsert (one Prisma
upsert per rep), detail_crawl (a marker), **bio_generation**
(`bioGenerator.enrichBios`), **summaries** (`runSummaries`: committee
summaries, the committee linker — no LLM — committee descriptions, then
activity summaries), prune_stale (a marker). No cancellation check, no queue,
no child jobs. Every generator loops `for (i += concurrency) await
Promise.all(batch)` with its own `*_CONCURRENCY` knob (default 1); activity
summaries are a plain serial loop with no cap.

**Four LLM generators, none with a skip key:**

| generator | selects | regenerates on a prompt/model change? | writes |
|---|---|---|---|
| bios (`bio-generator.service.ts:211`) | `bio` null or empty, region-scoped | **never** — a row with a bio is never touched again | `bio`, `bioSource`, `bioClaims`, prompt hash/version, model, digest; no `generatedAt` |
| committee summaries (`committee-summary-generator.service.ts:96`) | `committeesSummary` null, has committees | **never** | summary + prompt hash/version, model, digest |
| committee descriptions (`legislative-committee-description-generator.service.ts:65`) | `description` null — **not region-scoped** | **never** | description + prompt hash/version, model, digest |
| activity summaries (`entity-activity-summary-generator.service.ts:108`) | every rep/committee with a `legislativeAction` in the 90-day window — not region-scoped | **every run** (K2): `activitySummaryGeneratedAt` is selected and never compared; the docstring at :72 claims a skip that does not exist | summary, generatedAt, window, prompt hash/version, model, digest |

No source-text hash or config hash on any of them; no `generatedAt` except
activity summaries. A scraped bio (`bioSource='scraped'`) clears its AI
attribution at the upsert and must never be regenerated.

**No source link.** `representatives` has no `source_version_id` — the
gold-eval plan's D8 said "filed separately"; **searched 2026-10-27
(`sourceVersionId representatives`, `representatives source page key FK`,
`D8`): never filed.** It is the attribution gap civics closed with
`civics_blocks.source_version_id`.

**The network lane already applies**: reps use the shared detail crawler,
which went concurrent in #1411 (`detail-crawler.service.ts:214`). Hosts: the
Assembly roster plus `a{NN}.asmdc.org`/`ad{NN}.asmrc.org` secondary bio pages,
80 per-senator Senate hosts, ~57 county sites — each at its own token-bucket
rate. **S5 is still inline**: the extraction-plan LLM call
(`resolveExtractionPlan` → `deriveExtractionPlan`, `detail-crawler.service.ts:420/598`)
runs in the crawl's serial prelude, and self-heal (`healManifest`,
`pipeline.service.ts:552/600`, defined :879) calls the analyzer inline even
in async mode. The structural-analysis queue's cache-miss contract
(`pendingManifestAnalysis`, `region.module.ts` callback) is the model to
mirror.

**No CPU lane work**: the sources are HTML; nothing parses PDFs or OCRs.

**The eval** (`representatives-gold-eval.md`): four unmerged axes (recall,
precision, labelling, field presence) over an 8-rep sample, 6 tuning + 2
held out (Matt Haney, Megan Dahle — never looked at while tuning). The gold
set (`fixtures/gold-representatives.json`) pivoted to committees and district
facts for 3 Assembly pages, because no archived page carried a biography
(#1383). Fixtures exist; `representatives-eval.ts` was never built; the only
runner is the verbatim-quote guard spec.

**Baselines on record** (Gate 0, 2026-10-22, an older image): state reps
793 s — llm 434.8 s, fetch 268.3 s, 83 LLM calls, 0/121/0/0; county reps
392 s, GPU saturated, 81 calls.

## Owner decisions (2026-10-27)

1. **Staleness on every axis for all four generators** — prompt, model
   digest, input (source) hash, config hash — as proposition analysis has.
   Scraped bios are never regenerated. Needs an additive migration.
2. **Legacy outputs are stamped current** where prompt and model still match
   (the propositions decision); anything stale on another axis regenerates.
3. **One queue per generator**, named for its work: `representative-bio`,
   `committee-summary`, `committee-description`, `activity-summary` — each in
   the GPU lane, each switchable and movable on its own.
4. **In scope:** the representatives eval scorer; **S5**; and the
   **propositions overlap** — queue each proposition's analysis as soon as
   its text is ready, so propositions has civics' shape (fetch and GPU
   overlapping) rather than analysing in a third phase after all fetching.

## Steps

### 0. Re-take the baseline

An unchanged, uncapped representatives sync on `main` (#1412), run once,
before any change: per-phase time, LLM calls per generator, fetch count and
failures, GPU busy. A second unchanged run then shows K2's cost directly
(every activity summary regenerated again).

**Measured 2026-10-27** (job 139, UAT, `main` image, fetch cache empty after a
reboot; `scripts/gate0-baseline.sh representatives "2026-10-27 14:48:28"
"2026-10-27 14:58:32"`):

| | |
|---|---|
| run | **604 s** — discover 3m42s, bio_generation 14 s, summaries **6m1s** |
| items | 0 / 81 / 0 / 0 (80 reps + 1 discover) |
| LLM calls | **87** — 84 activity summaries (K2: every entity with recent activity, regenerated), ~3 bios; no committee summary or description (all present) |
| tokens | 206.6k in / **4.6k out** — prefill 310 s of 403 s inference: the activity prompts are long, their answers short |
| stage busy | fetch 857 s (142% of run — the network lane's concurrency), llm 408 s |
| GPU busy | **66.7%** (gap 5.0 s) |

**Finding — the run lost the whole Senate, and reported success.** 80
representatives, not 120: every attempt at `www.senate.ca.gov/senators` failed
with "Circuit breaker open for Extraction", and the plugin logged "Fetched 80
representatives items from 2/2 source(s)". The extraction provider had ONE
circuit breaker for every fetch (5 consecutive failures, 60 s open). The
Assembly's `a*.asmdc.org` biography pages fail with `fetch failed` (an
incomplete TLS chain, #1383's cause) — six of them, retried, within seconds of
each other now that the network lane runs four at once — and the Senate
roster, fetched next and healthy, was refused for the minute. **Fixed in this
branch: one breaker per host** (`ExtractionProvider.breakerFor`), so a failing
host stops only its own requests, as the per-host token bucket bounds only its
own rate; regression test reproduces the incident (fails with a shared
breaker). The "2/2 sources" success on a source that returned nothing is a
second, separate defect — a source that fails outright is counted as fetched —
to fix with the sync's per-source accounting in this work.

So the comparison for step 6 is against a baseline missing 40 senators: the
after-run does MORE work (the Senate's members, bios and summaries) and its
numbers are read per item, not as totals.

### 1. Skip keys (K2 and the other three)

One rule for all four, the propositions shape: a generated output is current
when its stored **prompt hash**, **model digest**, **input hash** and
**config hash** all equal the live values; otherwise it is stale and
regenerates. Selection is in the database (both arms per axis, NULL included,
as `staleWhere`), with the live key resolved once per run.

| generator | input hash over | config hash over |
|---|---|---|
| bio | the fields the prompt is given (`formatRepData`: name, jurisdiction, district, party — and source text once #1381 lands) | generator version, max tokens, temperature |
| committee summary | the rep's committee list as given to the prompt | version, max tokens |
| committee description | the committee's fields as given | version, max tokens |
| activity summary | the entity's `legislativeAction` ids + dates inside the window | version, max tokens, window days |

The activity input hash moves when an action enters or leaves the window,
which is exactly when the summary is stale. A scraped bio is excluded from
selection outright.

**Migration** (additive, nullable; `/op-migration`): for each output —
`representatives.bio_*`, `representatives.committees_summary_*`,
`legislative_committees.description_*`, and the activity summary on both
tables — `<x>_source_hash`, `<x>_config_hash`, and `<x>_generated_at` where
missing. Legacy stamping at runtime (decision 2), not in SQL, as propositions.

Each generator gains `<generate>One(id)` returning
created/updated/unchanged/skipped/failed (throwing on a transient LLM error
so the queue retries) and a `select<…>Stale()` returning the pending rows and
the current count, so phases report `skippedInBulk(current, '<x>_current')`.

**As built (2026-10-27) — two departures from the above, both deliberate:**

- **Selection is in code, not SQL.** The input hash is SHA-256 of *exactly
  the text the prompt is given* (`generated-output-key.ts::inputHash`), and
  that text exists only after formatting (`formatRepData`, `formatBundle`, …).
  So `selectStale` reads the candidate rows and assesses each — ~120 reps and
  their committees, cheap — rather than comparing in the database. The prompt
  hash and digest are still resolved once per run (cached a minute in
  `LlmGeneratorBase.liveOutputKey`).
- **The activity input hash is over the formatted bundle**, not action ids +
  dates. Same reason: "the input changed" has to mean "the model would see
  something different", and the bundle carries titles and outcomes as well.
  It still moves when an action enters or leaves the window.

An unresolved prompt hash or digest leaves that axis unchecked and the job a
one-off id (`outputSkipKey` → null), the propositions rule. A deterministic
committee summary (roles only, no prompt) is current on source + config alone.
A committee description the model declined (`null`) is recorded with its key
— a verdict, as civics' `empty` — so it is not asked again until something
changes.

### 2. Attribution

- `representatives.source_version_id` (nullable FK → `source_versions`, `ON
  DELETE SET NULL`, indexed — the civics shape): the archived page the rep
  was extracted from. The D8 join by URL convention (party-encoded Senate
  hosts, zero-padding) is retired by it.
- Every generated output persists its input hash and generated-at alongside
  the prompt/model attribution it already has.

**Found 2026-10-27:** the pages were already archived — 635
`source_versions` rows with `data_type='representatives'` on the dev DB —
and 0 of 125 reps pointed at one. The detail crawler stamps
`sourceVersionId` per item and the pipeline carries it across domain mapping
(#1306), but `Representative` had no such field and the upsert dropped it.
Now written as a relation `connect` (the update is Prisma's checked input),
and left alone when a rep had no detail fetch, as `rowProvenance` does for a
write that carries no text.

### 3. Lanes

- **Network** — already on (#1411). Measured in step 0 and after; the
  secondary bio fetches go through the same token bucket.
- **CPU** — none: HTML only. Recorded, not exempted: a PDF source would take
  the existing CPU lane automatically.
- **GPU — four queues (S4).** The phases select stale rows and queue one job
  per row (`laneJobId(<id>, '<work>', <skip key>)`), settle with the
  child-jobs helpers, and fall back inline when a queue is off. Four
  `ChildJobProcessor`s in region-worker. The per-generator `*_CONCURRENCY`
  knobs retire: the GPU lane bounds inference, the queue's worker concurrency
  bounds jobs (the S7 lesson).
- **DB** — measured (#1412); no change.
- **S5** — plan derivation and self-heal off the crawl loop, mirroring the
  structural-analysis cache-miss contract: the crawl enqueues the plan
  derivation and either proceeds with the previous plan or reports the items
  pending, rather than blocking on an LLM call between fetch #1 and #2.
  Shared pipeline code — every type that crawls details is affected, so it is
  measured on propositions and civics too.

  **Found 2026-10-27 — S5 moves an inline prompt.** `deriveExtractionPlan`
  builds its LLM prompt as a string literal in `detail-crawler.service.ts` —
  the never-inline rule, already recorded as #966 item 6 ("must migrate to
  `prompt-client`/`prompt-service`"). Taking the call off the crawl loop
  without moving the prompt would build new machinery around a violation, so
  S5 carries the migration: a `detail-extraction-plan` template in
  prompt-service (a PR there) and a prompt-client method, with the output's
  hash persisted. **A second inline prompt, not tracked anywhere** (searched
  `pdf-extract handler prompt`, `buildAnalysisPrompt`, `PdfExtractHandler
  prompt`): `PdfExtractHandler.buildAnalysisPrompt`
  (`pdf-extract.handler.ts:145`). Recorded here (the plan is the record);
  outside representatives' path, so not moved in this work.

### 4. The eval scorer

`packages/eval-harness/src/representatives-eval.ts` (`eval:representatives`),
the four axes unmerged, per rep, never a single aggregate (n=8): **recall**
and **field presence** over `gold-representatives.json` (committees and
district facts), **precision** and **labelling** over `bioClaims` marked
`origin: source` against the archived text (exercised only once a bio is
grounded — #1381/#1383; the scorer reports "not exercised" rather than a
number until then). Seeded for eval runs only (D7). Held-out pair scored once
(D6). The gate: the final image scores no worse than the baseline fixture.

### 5. Propositions overlap

`propositions-sync.service.ts` queues each measure's analysis as its text is
upserted (the civics shape) instead of selecting stale rows after the whole
scrape. Same skip key (K-P2), same queue; acceptance is identical analyses
and a changed-measure run whose analysis starts during the fetch.

**Found 2026-10-27 — "as its text is upserted" needs per-source writes
first.** `fetchPropositions` returns every source's items at once
(`fetchByDataType`; only `bulk_download`/`api` sources stream batches), and the
upsert is one batch transaction. So the overlap is: fetch and upsert **per
source**, then queue that source's stale analyses while the next source
fetches. One hazard to design for, not around: two sources may write one row
(Sonoma's filings page names a measure, its voter guide documents it, merged
on `externalId` in config order — `row-provenance.ts`). Analysing after the
first source would analyse a row the second is about to rewrite — and a
later source's externalIds are not known until it is fetched, so "wait until
no later source can write it" is not computable per measure. Open, to settle
before building: either the overlap is per source only where the region
declares its sources disjoint, or a measure's analysis is queued after the
last source that names it and the gain is limited to single-source measures.
Either way the acceptance adds "no measure analysed twice in one run".

### 6. UAT and gate

Unchanged run twice (the second: zero LLM calls for all four generators — K2
proven), a forced run (resetWatermark) regenerating exactly the stale rows,
a prompt-hash change regenerating exactly one generator's outputs, the eval
on the final image, and the propositions/civics unchanged runs re-checked for
S5. Worker restart mid-run as for civics.

**Measured 2026-10-27** (UAT, this branch, jobs 141–143, uncapped):

| run | time | items | LLM jobs | note |
|---|---:|---|---:|---|
| baseline (job 139, `main`) | 604 s | 80 reps | 87 | Senate lost to the global breaker |
| b1 (job 141) | **463 s** | **120 reps** | 87 | 85 committee descriptions stale (prompt or model since they were written) and regenerated; 102 bios, 79 committee summaries, 84 activity summaries current; 2 bio "errors" |
| b2 (job 142) | 114 s | 120 | 2 | all 85 descriptions current — the key holds; the 2 vacant seats decline once and are recorded |
| b3 (job 143) | **95 s** | 120 | **0** | K2 proven: 104 bios, 248 summaries skipped, no generator job queued; the run is the fetch |

- **The 2 b1 bio errors were the vacant seats** (`Member Vacant`, ca-assembly-3 /
  ca-senate-10). The model correctly returned `{"bio": ""}`; the parser
  called that a failure and every sync would have asked again. A well-formed
  empty bio is now a decline, recorded with its key (and clearing the last
  member's AI bio from a seat that falls vacant), asked again only when the
  input changes — someone fills the seat.
- **Attribution:** after b1, 120 of 120 state reps carry `source_version_id`,
  every one pointing at its own district's page (0 whose URL lacks its
  district number). The 5 Sonoma supervisors are a source this sync does not
  run.
- **S5 is not on representatives' path.** Both reps sources declare
  `detailFields` in config, so `resolveExtractionPlan` never calls the LLM
  for them (b3: "Using config-declared detail fields" ×2, no derivation).
  S5 matters only for sources that derive a plan; it is not a representatives
  deliverable, and its measurement belongs to the types it affects.
- **Eval:** `eval:representatives` on the b1 rows (no bio or committee
  summary regenerated for the gold reps) is recorded as
  `fixtures/representatives-eval-baseline.json`; the gate passes against it.
  Committee recall there is low for select committees by design — #1393's
  summaries condense to policy areas.

## Review (2026-10-27) and what it changed

Four independent lenses (correctness, security/regulated data,
performance/TS/consistency, test coverage) on the first full diff; no
blocker in correctness or security, all suggestions fixed in this branch:

- **A decline could delete a sitting member's bio** (found by two lenses).
  An empty answer is now a verdict only when the ROSTER says the seat is
  vacant (`isVacantSeat`); otherwise `failed`, nothing written. Same rule for
  a committee description declined over one we have.
- **Tier-2 salvage kept the last generation's claims** beside a regenerated
  bio — correct while bios were written once, wrong now. Claims now always
  follow the bio written.
- **One bad `sourceVersionId` would roll back the whole roster** (P2025 in
  the batch transaction): unknown ids are dropped, in one query, first.
- **The three summary lanes shared one failure streak**: one lane's
  successes masked another's failures, and one lane's abort aborted the
  others on their next failure. `SyncPhaseTracker.item` takes a `streak`.
- **Duplication/complexity**: `partitionStale` (also assesses 8 at a time —
  activity selection was ~2 queries × ~200 entities in series),
  `runInBatches`/`generateInProcess`, and **propositions moved onto
  `runOutputLane`** (it carried the same lane, byte-identical
  `isCancelled`). jscpd: 0 clones; Sonar cognitive complexity clean on every
  file this branch owns.
- **Per-host breakers** use common `hostOf` (one host for `fec.gov.` and
  `fec.gov`, as the rate limiter), keep unparseable URLs out of every
  breaker, and cap the map (oldest closed breaker evicted).
- **Tests**: the in-job re-check for all four generators (mutation-verified:
  removing it fails them), lookup failures and the one-lookup cache (which
  exposed a race — fixed by caching the promise), queued abort/cancel,
  queued wiring, a real-DB integration spec (`representatives-phase-b`:
  FK `connect` + `ON DELETE SET NULL`, unknown id, decline → SQL NULL +
  claims superseded, legacy stamp); the eval gate's branches and an
  enforced local-database guard.

## Scope decision (2026-10-27)

Shipped here: K2 + skip keys for all four generators, attribution, S4 (four
queues), the per-host breaker and failed-source fixes, the eval scorer.
**Not shipped here, with the reason recorded:**

- **S5** — not on representatives' path (config-declared detail fields; no
  plan LLM call, measured), and taking the call off the crawl loop first
  needs the #966 prompt migration (an inline prompt). Belongs with the types
  that derive plans.
- **Propositions overlap** — needs per-source fetch+upsert and a decision on
  merged multi-source rows (§5 above); an owner decision, not a lane change.


#1381 (bios never see a source page) and #1383 (roster pages archived, not
bio pages) — quality, not lanes; the skip key's input hash is built so that
#1381's source text joins it without another migration.

## Risks

| risk | mitigation |
|---|---|
| A model pull regenerates every bio, summary and description | Intended (decision 1), as for propositions; visible in the counts |
| Activity input hash moves daily as the window slides | Correct — the summary covers the window; measured in step 0's second run |
| A prompt or model that declines broadly (empty bios for sitting members, null descriptions over existing ones) | Those are `failed`, not recorded, so they re-run every sync and can trip the lane's consecutive-failure abort — read such an abort as "the model is declining", not an outage; the vacant-seat decline is the only recorded one |
| S5 changes the shared crawl for every type | Measured on propositions and civics as well; gated on identical items |
| Four queues are four new consumers in region-worker | `WORKER_QUEUES` already selects them per host; default `*` |
| My authorship of the scorer is the measurement's weak point | The gold set is quote-or-omit and `ownerReviewRequired`; countersign |

## Data classification

Public-figure data (officials' names, districts, committee roles, contact
details) — public by policy, and not redacted. Job
payloads carry ids only.
