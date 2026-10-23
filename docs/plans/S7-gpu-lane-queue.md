# S7 — one lane queue per Ollama endpoint: bounded, batch only

Phase A, step 4 of `ingestion-resource-lanes.md` (§6 S7, §7 H5). That row
calls for "one BullMQ queue per Ollama endpoint, bound with
`setGlobalConcurrency`, with an interactive reserve". Reading every inference
call site (2026-10-23) changed the mechanism; this plan says why, and asks
the owner to confirm it before code.

## What is true today

**Every generation goes through one seam.** All batch work _and_ every
interactive path — RAG (`knowledge.service.ts:172`), the briefing summary
(`briefing-summary.service.ts:253`), petition analysis
(`analysis.service.ts:189`), personalized impact
(`personalized-impact.service.ts:118`) — call `ILLMProvider.generate` on an
`OllamaLLMProvider` built by `buildLane` (`llm.module.ts:111`). The row's
claim that the interactive paths "call Ollama directly over HTTP" is wrong:
they bypass every _queue_, not the provider. The only true bypasses are
vision OCR (`vision.provider.ts:121`, inactive unless `OCR_PROVIDER=vision`)
and Ollama embeddings (`/api/embed`; the default embeddings provider is
in-process xenova).

**Nothing bounds the total.** Seven `*_CONCURRENCY` knobs (all default 1)
each bound one loop in one process; BullMQ worker concurrency bounds each
queue per process. Concurrently, region-worker (bills, reps, propositions,
minutes, inline structural analysis), structural-analysis-worker,
llm-rerank-worker, the region API (`regeneratePropositionAnalysis`), and the
knowledge and documents APIs all send to one Ollama with
`OLLAMA_NUM_PARALLEL=1`, which serves them **first come, first served**.

So:

- **A citizen's RAG question waits behind every queued batch request** —
  bill extraction is 8,000 tokens a page, proposition analysis 6,000.
- **The two models evict each other.** Both lanes share the Studio; with
  `OLLAMA_MAX_LOADED_MODELS=1`, interleaved ingestion and analysis calls
  reload weights on every switch — the condition that degraded analysis from
  2m17s to 11m46s per measure _within one run_
  (`split-ingestion-model-lane.md` §6).
- **A user's "refresh my feed" click waits behind the nightly rerank
  fan-out** — the manual jobs and the 03:00 cron share the `llm-rerank`
  queue at concurrency 1.

## Owner decision (2026-10-23): BullMQ, batch queued, interactive direct

A first draft proposed a custom Redis lease semaphore in the provider. The
owner chose BullMQ — one queuing model the team already runs, with
`setGlobalConcurrency` and job priority built in — over a bespoke gate. The
draft's objections to BullMQ were (a) interactive calls becoming jobs, (b) a
slot "reserve" being zero at one slot, and (c) no model affinity. The design
below keeps BullMQ and removes all three:

- **(a) Interactive calls stay direct.** Only batch inference is queued.
- **(b) No reserve is needed.** With at most one batch request in flight per
  endpoint, an interactive request waits behind at most that one call inside
  Ollama — never behind the queued backlog. That is what the reserve was for.
- **(c) Affinity is deferred to Phase C.** Prod runs one model today; lanes
  are introduced by this work and cut over in Phase C (§10.3). When two
  models share a host, "drain one before switching" is BullMQ-native: a
  coordinator pauses one lane queue while the other drains. UAT runs both
  lanes on one model, so nothing evicts in the meantime.

## Design

1. **One lane queue per Ollama endpoint**, `llm-lane-<host>-<port>`, named
   from the lane's resolved URL — two lanes on one host share a queue, two
   hosts get two. Bounded with `setGlobalConcurrency(LLM_LANE_GLOBAL_CONCURRENCY)`,
   default **1** (= `OLLAMA_NUM_PARALLEL`), set by every process at boot. It
   is a Redis-side bound, so it holds however many processes consume.
2. **The process decides batch vs interactive**, not the call site. Every
   batch call already runs in a worker process (region-worker,
   structural-analysis-worker, llm-rerank-worker); every interactive one in
   an API process (knowledge, documents, region API). Only the worker
   processes bind the lane dispatcher, so no call site changes and none can
   be mislabelled.
3. **The seam is `buildLane`.** `LLMModule` injects an optional, global
   `LLM_LANE_DISPATCHER`; when bound, `generate()` becomes: enqueue a job
   naming the lane, endpoint URL and model, with the prompt and options,
   await its result (`waitUntilFinished`), return it. Unbound, the provider
   is untouched — which is how the API processes, and every process before
   this change, behave. `chat()` and `generateStream()` have no production
   callers and pass through.
4. **Consumers.** Every process that binds the dispatcher also runs a lane
   worker, and any consumer can run any producer's job. A consumer runs a
   job only for a lane, URL and model **its own process registered** when it
   built that lane, using its **own** endpoint configuration — a job is
   data read from Redis, not an instruction to call whatever endpoint it
   names. The per-call options a job carries are rebuilt from known fields
   and clamped (`maxTokens` positive and ≤ 131,072, `requestTimeoutMs` ≤ the
   62-minute transport floor, at most 16 stop sequences), so a forged job
   cannot hold the only slot indefinitely. Every worker process configures
   its lanes from one environment, so they agree; one that does not fails
   the job without echoing the URL, and warns once per lane and model so
   the process with the mismatch says so. A sync job
   awaiting a lane job never deadlocks, because the lane worker is a
   separate BullMQ worker from the queue the sync job runs on — and the
   producing process always has one. Per-process worker concurrency equals
   the global bound, so a bound above 1 is reachable from one process.
5. **Failure.** Jobs run once (`attempts: 1`); the provider's own breaker
   and the callers' retries are unchanged. A failed job rejects the waiter
   with an `LLMError` carrying the failure, so callers see the type they see
   today. An error _thrown_ before the job is queued sends the call direct,
   logged once. **A Redis outage is different, and stated plainly:** BullMQ's
   connection retries without limit, so an enqueue _waits_ rather than
   throws. That is no worse than today — the sync job doing the waiting is
   itself a BullMQ job, stopped by the same outage. (The first draft claimed
   "Redis down → direct"; the connection's `maxRetriesPerRequest: null`
   makes that untrue.)
   - **No GPU time for nobody.** Each job carries a deadline (enqueue +
     `LLM_LANE_WAIT_TIMEOUT_MS`, 6 h) and its producer's id; each producer
     keeps a 60 s liveness key refreshed every 20 s. A consumer skips a job
     whose deadline has passed or whose producer's key is gone — a killed
     sync's backlog does not occupy the only slot for hours. A missing key
     is re-checked once after 5 s — a host that slept resumes with every TTL
     expired before its overdue heartbeat runs — and a producer confirmed
     gone is remembered, so the rest of its backlog skips without paying
     the grace — but its key is still checked once per job, so a live
     producer that only missed its window is served again as soon as the
     key is back. A waiter that times out removes its job if it has not
     started, and releases BullMQ's listeners for it (a removed job never
     finishes, so they would otherwise live as long as the process). A job
     already running when its waiter gives up still finishes on the GPU.
   - **Stalls fail, they do not re-run** (`maxStalledCount: 0`): the first
     run may still be on the GPU, and a redelivery would be a duplicate call.
     The lane lock is 30 s (renewed while the process lives), so a killed
     consumer's job releases the global slot within about a minute, not
     the 5½ minutes `createWorker`'s 5-minute default lock would take. It is
     set in code, so it overrides `BULLMQ_QUEUE_<NAME>_LOCK_DURATION_MS`
     (unexportable for a dotted queue name anyway). The cost: an event loop
     blocked for over 30 s — or a host asleep — loses the lock, and with
     stalls failing rather than re-running, that job fails while Ollama
     may still be computing it.
   - **Shutdown** rejects every caller still waiting, at once. The wait
     timeout is the dispatcher's own timer, not `waitUntilFinished`'s ttl —
     BullMQ's ttl timer survives an abandoned wait and held the integration
     run open for the full timeout after shutdown; in production it would
     have held a stopping worker open until its container was killed.
   - The dispatcher owns a duplicate of the queue connection. Nest destroys
     a global module last, after `QueueModule` has quit the shared one, and
     shutdown still needs Redis: to close the worker, clear the liveness key
     and remove abandoned jobs.
   - The consumer's provider circuit breaker sees every process's jobs on
     its endpoint, so it opens for all of them together when Ollama fails —
     one GPU, one health signal; waiters fail fast instead of queueing.
   - A failure's text crosses Redis truncated to 200 characters and wrapped
     once; the direct-fallback warning is rate-limited to one a minute, with
     a count.
6. **Observable.** Measured on the **producer**, around the whole queued
   call: the `llm` stage a sync records is what it actually spent — wait plus
   inference — which keeps Gate 0's accounted time honest, and
   `lane_wait_seconds{lane, endpoint}` (the plan's §3 metric, recorded by the
   consumer) breaks out the queue's share. (The first implementation measured
   on the consumer, which dropped the wait from the sync's accounting.)
7. **Rerank priority.** The 03:00 cron fan-out is enqueued with a BullMQ
   priority; manual (user-click) jobs are not, and BullMQ serves its plain
   wait list before the prioritised set — so a click is no longer behind the
   nightly run.
8. **Inert until enabled.** `LLM_LANE_QUEUE_ENABLED` (default off), as
   Phase A's "merged to main, inert" asks. UAT turns it on; prod gets it with
   the Phase C release.

**The seven `*_CONCURRENCY` knobs stay**, default 1. They now bound how many
requests a loop queues, not how many reach the GPU — the lane queue does
that. Retiring them is S3/S4's job, when those loops become lane jobs.

## Not in this change

- **Vision OCR and Ollama embeddings** bypass the provider. Vision is off by
  default (`OCR_PROVIDER=tesseract`); embeddings default to in-process
  xenova. Gating them needs their own wrapper; recorded, not done.
- **`OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_LOADED_MODELS`, keep-alive in node
  config.** The row asks for them to be set explicitly; they live in the
  host's launch config and the node repo, not this repo. The gate's
  capacity default (1) assumes `NUM_PARALLEL=1`, which the plan already
  records the Studio as running.
- **Splitting the manual and cron rerank onto separate queues** — priority
  on one queue is enough for "a click is not stuck behind the 03:00 run".

## Data classification

**Redis now holds rendered personalization prompts.** A rerank prompt
carries a user's interest tags and ranking flags. On a _manual_ rerank the
flags are the client's own derivation (`personalized-feed.resolver.ts`),
which includes T3 — the sensitive tier the cron deliberately omits
(`llm-rerank.scheduler.ts`, "T3 omission"). Redis was already a processor of
those flags: they sit in the `llm-rerank` job's data today. What S7 adds is
the _rendered prompt_ — the same data, plus the candidate text — in a second
queue. Bounded so:

- **While waiting**, the prompt is whole — up to `LLM_LANE_WAIT_TIMEOUT_MS`
  (6 h) behind a backlog, and for a dead producer's jobs until a consumer
  reaches and skips them. The consumer blanks `prompt` the moment it picks
  a job up, before any check or call; a failed blank is logged, without
  content.
- **Completed jobs** hold the generated text and are removed after 5
  minutes or beyond 1,000; failed ones after an hour or beyond 500.
- **The events stream carries results too**: BullMQ writes each job's
  return value into its `completed` event. The stream is capped at ~500
  entries and trimmed exactly to the last 5 minutes every 20 s (the heartbeat).
- **Failure text** is truncated to 200 characters before it is stored. It
  is Ollama's error JSON or a transport message; one edge case can carry
  generated text — a 200 response whose body is not valid JSON, where
  Node's `SyntaxError` quotes a fragment of the body.
- **On disk.** The queue Redis runs with `--appendonly yes` locally and on
  UAT (`docker-compose.yml`), so blanked and reaped values persist in the
  AOF until its next rewrite. The prod node's compose lives in the node
  repo; check its Redis flags there before treating "minutes" as the
  on-disk bound.

Redis is on the node, not exposed, and already holds every queue's job data;
nothing here leaves the host. The UAT PI scrub (`scripts/uat/scrub-pi.sql`)
is unaffected — it covers Postgres; this is short-lived queue state.

## Tests

- Two dispatchers (two processes' worth), one Redis: never more than the
  global concurrency running at once, across both; at a bound of 2, two —
  from two processes and from one.
- A queued `generate()` returns exactly what the provider returned; a failed
  job rejects with an `LLMError` carrying the reason, wrapped once and
  truncated.
- A job queued by another process is run; one naming an endpoint or model
  this process never registered is refused, without echoing either.
- A job whose producer is gone, or whose deadline has passed, is skipped —
  the rest of a dead producer's backlog at once; a producer whose key
  reappears within the grace is served; a timed-out waiter's job leaves the
  wait list before it runs, and no listener for it remains.
- A job's options are clamped: `maxTokens: -1` and a 10¹² ms timeout do not
  reach the provider.
- The prompt is blank in the completed job; the events stream is trimmed by
  age.
- Shutdown still clears the liveness key after the shared connection has
  closed; only one heartbeat interval is ever started, even when another
  lane fails to open while the first publish is in flight.
- Shutdown rejects waiting callers at once and leaves no timer behind — the
  integration run first hung on exit twice: once on the unclosed
  `QueueEvents` connection, once on BullMQ's ttl timer.
- An error thrown at enqueue sends the call direct, warning once a minute.
- `LlmLaneModule.forRoot()` enabled compiles with `LLMModule` against real
  Redis; both lanes route through the dispatcher and register with it; the
  metrics wrapper sits outside the queue.
- Unbound dispatcher: the provider is untouched (API processes).
- Queue naming: one queue per host:port; two lanes on one host share it.
- Both cron rerank enqueue sites carry a priority; manual jobs do not.
- Each verified by reintroducing its defect. `maxStalledCount: 0` and the
  30 s lock are not (their pass-through to BullMQ is unit-tested):
  a stall cannot be caused deterministically in a test.

## Risks

| Risk                                                                  | Mitigation                                                                                                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A prompt's size in Redis                                              | Prompts are tens to hundreds of KB; blanked on start, completed jobs gone in 5 minutes, count-capped. The noeviction instance already holds every queue                                |
| No consumer for a queued job                                          | Every process that enqueues also consumes; waits are capped at 6 h and reject loudly                                                                                                   |
| Anything that can write to Redis makes a worker call an arbitrary URL | A consumer runs only endpoints its own process registered, and clamps the options a job carries                                                                                        |
| A consumer's config differs from the producer's                       | The job fails, naming neither URL nor prompt, and the refusing process warns once per lane and model; every worker reads one environment                                               |
| Workers disagree on `LLM_LANE_GLOBAL_CONCURRENCY`                     | The last to start wins, and a mismatch is logged at lane open                                                                                                                          |
| Batch slows because it is now strictly serial per endpoint            | It was already serial at the GPU (`OLLAMA_NUM_PARALLEL=1`); the difference is that interactive requests stop waiting behind it. Raising the bound is config, gated on the eval harness |
| An API process accidentally binds the dispatcher                      | Bound only by the three worker modules; a test pins which modules import it                                                                                                            |

## Owner decision

**Mechanism — decided 2026-10-23: BullMQ**, batch queued per endpoint with
`setGlobalConcurrency`, interactive direct, affinity deferred to Phase C
(see "Owner decision" above the design).
