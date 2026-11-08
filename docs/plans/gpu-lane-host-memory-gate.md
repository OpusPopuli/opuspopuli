# GPU lane — don't load a model the host has no room for

*2026-11-07. Follows `S7-gpu-lane-queue.md` (the GPU lane) and
`ingestion-resource-lanes.md`. Status: **approved (§5), in progress.***

## 1. Why

On 2026-11-07 the 48 GB dev Mac had to be force-quit 3–4 times. macOS's own
reports show the mechanism:

| Jetsam event | llama-server | wired | compressed | reason |
|---|---|---|---|---|
| 2026-10-31 22:03 | 25.7 GB | 6 GB | 30 GB | low-swap |
| 2026-11-06 18:25 | 26.8 GB | 5 GB | 38 GB | low-swap |
| 2026-11-06 21:22 | 24.9 GB | 29 GB | 16 GB | low-swap |

The other seven events since 2026-10-31 were `per-process-limit` kills of
Apple daemons. They aren't memory exhaustion.

nemotron-3.5-lightning:30b-a3b is 23.7 GiB on disk. Loaded, Ollama runs it with
mmap disabled, so its weights become unswappable GPU memory. **Ollama decides
whether a model fits from the Metal budget ("available 36.9 GiB"), not from
what the rest of the host is using.** On unified memory those are the same
bytes. At 11:52 that day it loaded the model with `free="21.8 GiB"
free_swap="0 B"` in its own log, and the machine froze about 20 minutes later.

The lanes don't cause this by themselves. Everything but the GPU lane runs in
the Docker VM, which is hard-capped at 10 GB. They do make it likelier, because
the point of lanes is that GPU work overlaps CPU, network and DB work. The
Studio has the same unified memory, so the same failure is possible in
production, and nothing there would notice it either.

Already done that day, outside this plan:
- Jest is capped at 50% of cores (#1433).
- Local UAT has the LLM endpoint off unless `UAT_LLM_URL` is set
  (`docker-compose-uat.local.yml`, untracked).

## 2. What the gate does

**Before a generation that would *load* a model, check the host has room for
it.** A generation against a model that is already loaded adds nothing, so it
goes ahead without asking (`/api/ps` on the endpoint says which models are
loaded).

Room means:

  reclaimable host memory ≥ model size + headroom

- `reclaimable` = (free + inactive + speculative + purgeable) pages, from
  `vm_stat`. Compressible memory is deliberately not counted. Compressing it
  to make room *is* the thrash.
- `model size` comes from the endpoint's `/api/tags`.
- `headroom` is `LLM_HOST_HEADROOM_GB`, default 4.

Measured 2026-11-07 19:40, with VS Code, Firefox and Docker open:
reclaimable 22.5 GiB against 23.7 + 4 needed. **The gate would refuse.** On this
Mac, then, a summary pass runs when the desktop is mostly closed. That is the
intent, but it is a real change in when work happens.

## 3. Where it lives

**The host probe.** The workers are in Docker and cannot see host memory. A
small host process answers `GET /memory` with
`{ reclaimableBytes, swapUsedBytes, swapTotalBytes }`, bound to `127.0.0.1`.
Containers reach it at `host.docker.internal`, as they reach Ollama. It carries
numbers only, no personal data. It is a Node script with no dependencies, run
by launchd, in `scripts/host-memory-probe/`. On the Studio it becomes one more
launchd agent in the node repo (a manual port, dev-only phase until then).

**The check sits in the provider seam,** the `OllamaLLMProvider` that every
generation goes through (S7 §"What is true today"), so batch *and* interactive
calls are covered:

- **Batch (GPU lane consumer):** no room means the consumer keeps its slot and
  re-checks every 15 s until the job's deadline. Nothing else could use the
  slot anyway, because loading is the problem. At the deadline the job ends as
  *deferred*, which is not a failure.
- **Interactive (RAG, briefing, petition analysis):** no room means the call
  fails at once, as an unreachable model already does today, and the existing
  "not available right now" paths answer the reader.
- **`isAvailable()`** returns false while the model is unloaded and there is no
  room. The bill sync already treats an unavailable model as "not now": it
  doesn't stamp `ai_summary_failed_at` (`region-sync.service.ts`
  `modelReachable`). So a pass under memory pressure skips cleanly instead of
  marking every bill failed.

**Config.** `LLM_*`, not `GPU_LANE_*`: the gate covers interactive calls,
which never use the lane.
- `LLM_HOST_MEMORY_URL` unset or empty: the gate is off, and boot logs say so.
  This is `docker-compose-prod.yml`, i.e. the Studio, until the probe is ported.
- `docker-compose-uat.yml` sets it to `http://host.docker.internal:11500/memory`.
- Set but unreachable: fail closed (§5 Q2).
- `LLM_HOST_HEADROOM_GB`, default 4.

**Metrics.** `llm_host_gate_total{model, outcome=admitted|deferred|probe_unreachable}`.

## 3a. What was built (2026-11-07, #1434)

- `packages/llm-provider/src/providers/host-memory-gate.ts`: the gate and the
  process-wide `sharedHostMemoryGate()`. It also holds
  `HostMemoryUnavailableError` (an `LLMError`, so existing handlers still catch
  it) and the rate-limited warning.
- `OllamaLLMProvider`: `generate`, `chat` and `generateStream` run `admit()`
  *before* the circuit breaker. A full host is not a failing Ollama, and must
  not open the circuit for calls to a model that is already loaded.
  `isAvailable()` is false while there is no room.
- Both places that build providers attach the shared gate: `buildLane` and
  `createLaneProvider`.
- The GPU lane consumer (`generateWhenHostHasRoom`) keeps its slot and asks
  again every 15 s. It stops at the job's deadline, at shutdown, or once the
  caller is gone. It retries only `HostMemoryUnavailableError`.
- The probe: `scripts/host-memory-probe/` (`probe.ts`, `install.sh`, tests via
  `pnpm test:host-probe`).
  - `install.sh` *copies* it into `~/Library/Application Support`. A launchd
    agent can't read the external volume the dev repo lives on, and hangs
    silently if it tries.
  - The probe compares paths, not URLs, to tell whether it was run directly:
    `Application Support` contains a space.

## 3b. Review of the first draft (2026-11-07) and what changed

Two independent review passes saw the staged diff: correctness, types, tests
and consistency in one; security, data and performance in the other. No
security or personal-data findings. Fixed before commit:

- **Blocker: swapping models stalled.** With `OLLAMA_MAX_LOADED_MODELS=1`,
  Ollama unloads the resident model before loading another. The gate did not
  count that memory as room, so a job for the second model held the only slot
  for up to the 6 h lane deadline. Now, when as many models are loaded as
  `LLM_HOST_MAX_LOADED_MODELS` allows (default 1), the smallest resident one's
  `size_vram` counts as room. Ollama evicts the least recently used, which the
  gate can't see.
- **In-process reservations.** A load let through and not yet listed by
  `/api/ps` holds its size for up to 2 min. Two calls in one process can't both
  be admitted against the same free memory. **Remaining:** loads from
  *different* containers can still race. Narrowing that needs a shared
  reservation (Redis) and is not done.
- **Untagged names.** `mistral` is now matched as `mistral:latest`. Before,
  the exact match missed and silently admitted.
- **Deadline from Redis capped** at enqueue time plus this process's
  `GPU_LANE_WAIT_TIMEOUT_MS`. A non-number counts as passed. The wait made an
  unbounded deadline hold the slot.
- **Shutdown.** The 15 s sleep is aborted at shutdown, and no load starts
  after it.
- **Shutdown, found in UAT.**
  - Stopping `region-worker` while a job waited for room exited 137 (killed)
    after 3 s. Stopping it idle exits 0.
  - Cause: Nest destroys the GPU lane module *last*, after every queue worker
    has closed. A worker closes only once its active job ends, and the
    bill-summary job was waiting on the lane job waiting for room. So
    `onModuleDestroy` was too late to abort anything.
  - The same was already true of an LLM call in flight (`LANE_LOCK_MS`
    documents the cost). A wait for room can last hours, so a deploy is far
    likelier to land in one.
  - Fix: the dispatcher aborts its waits on SIGTERM/SIGINT itself. All three
    lane processes enable Nest's shutdown hooks, which re-raise the signal
    after cleanup, so the process still exits.
- **Probe.**
  - It answers only to the Host names it is reached by (DNS rebinding).
  - One reading per second is shared between requests.
  - The installer validates the port, escapes the XML, retries the launchd
    bootstrap race, and throttles a crash loop to once a minute.
- **Metric wording.** `llm_host_gate_total` counts checks, not jobs. A
  resident model is `admitted`, and a waiting job counts once per re-check.

**Final-diff review (a third pass, on the fixes above).** No blockers.
Fixed:
- **A landed load stays reserved for 5 s.** The probe's reading can be up to
  1 s old and taken before the weights were committed, so dropping the
  reservation the moment `/api/ps` lists the model could admit a second large
  load against memory that is already gone.
- **CPU-held models count.** On unified memory a resident model with
  `size_vram: 0` still holds host memory and still counts against Ollama's
  limit, so the gate uses `size` and counts every listed model.
- **`LLM_HOST_MAX_LOADED_MODELS` is set in compose and named in the boot
  log.** Ollama's own default is 3, and a gate assuming 1 there would count an
  eviction that never happens.
- **A failed admitted call gives its reservation back** (`release`) instead of
  holding other models back for 2 minutes.
- **The dispatcher's signal listeners are registered in `onModuleInit`,**
  after `enableShutdownHooks()`, not in the constructor. A SIGTERM during boot
  can no longer be swallowed.
- **Smaller fixes.**
  - NaN guard on the deadline cap.
  - `library/x` is named as Ollama lists it (`x:latest`).
  - `install.sh` escapes XML with `sed`: bash 5.2's `patsub_replacement`
    broke the `${var//}` form, and a backslash before `&` survives on 3.2.

Accepted as they are:
- **The enqueue-failure fallback** (`dispatcher.generate` calling the provider
  directly when Redis refuses the job) does not wait. A batch call there fails
  at once with `HostMemoryUnavailableError`, as an interactive one does.
- **`/api/ps` is called on every generation.** That is a loopback call of a
  few ms against calls of seconds or minutes.
- **The model-size cache is never invalidated.** A re-pull of the same tag
  keeps the old size until restart.
- **The gate reads `process.env`, not `ConfigService`,** because
  `createLaneProvider` has no `ConfigService`. `llm.module.ts` has the
  precedent (`LLM_INGESTION_URL`).
- **A bill whose deferred job ends just as memory frees** can still be stamped
  `ai_summary_failed_at`. That is rare, and its backoff retries it.

## 4. Not in scope

- Unloading a loaded model when the host later runs short. It is possible
  (`keep_alive: 0`), but a pass in flight would reload it on the next call.
  That is a separate decision.
- Choosing a smaller model for the dev Mac. That needs its own eval
  (`project_dev_machine_standard`).

## 5. Owner decisions (answered 2026-11-07)

- **Q1. Where the probe lives:** a launchd Node script in this repo, ported to
  the Studio later.
- **Q2. Probe configured but unreachable:** **fail closed.** Treat it as no
  room, with `outcome=probe_unreachable` on the metric and a warning that names
  the URL.
- **Q3. Headroom default:** **4 GB.**
- **Q4. Interactive calls under no room:** **fail fast.** Only batch jobs wait.

## 6. Search record

Searched before writing (2026-11-07):
- `gh issue list --search "memory host ollama"` and `"jetsam"`;
- the plans `S7-gpu-lane-queue.md`, `ingestion-resource-lanes.md`,
  `split-ingestion-model-lane.md`;
- code: `vm_stat`, `hostMemory`, `memory_pressure` across `apps/`, `packages/`
  and `scripts/`. No existing probe.
