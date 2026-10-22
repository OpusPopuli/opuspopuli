# Runbook — Gate 0 baseline

How to capture the measurement that `docs/plans/ingestion-resource-lanes.md`
M4 requires: per-stage busy time, LLM calls per run, and the GPU idle
fraction, for each of the six data types, **before** any restructuring lands.

Everything below was derived from a real civics run on 2026-10-22, not
assumed. Where a step exists only because something went wrong, it says so.

## Why this is fussy

Every pipeline histogram is observed when work **completes**. That single fact
produces most of the ways a baseline can lie:

- A rate window shorter than the longest call reports zero while the GPU is
  saturated. One civics extraction ran nine minutes on a 76k-character prompt
  while `rate(...[5m])` said no inference was happening.
- `increase()` cannot see a counter that did not exist when the window opened,
  so it under-reports exactly the series a sync creates. On the civics run it
  reported 8 updated / 11 skipped / 1 failed where the log said 12 / 13 / 2.
  `scripts/gate0-baseline.sh` therefore takes an exact two-instant delta.
- A call that DIES contributes its wall clock to the stage total and nothing
  to inference, so a run with killed calls shows a low GPU figure that has
  nothing to do with parallelism.

## Preconditions — check these or the numbers are fiction

**1. Memory headroom.** A run whose LLM calls get killed produces a GPU-idle
figure that means nothing.

```bash
memory_pressure | grep -i "free percentage"   # want well above 25%
sysctl -n vm.swapusage                        # want swap far from full
```

The model holds ~24.5 GiB of this host's 48 GiB and that is not reducible by
lowering `num_ctx` — measured, see the plan. Close the browser and editor
before a baseline run; they are ~3.5 GiB.

**2. The services under test run the code you think.**

```bash
docker inspect opuspopuli-uat-region-worker --format '{{.Config.Image}}' \
  | xargs docker image inspect --format '{{.Created}}'
```

**3. Tempo's blocklist poll is healthy**, or traces come back truncated with
no error:

```bash
docker logs --since 10m opuspopuli-tempo 2>&1 | grep "failed to poll tenant blocks"
```

A hit means a block has a zero-byte `meta.json`. Find it with
`find /var/tempo/traces -name 'meta*.json' -size -2c`, move it aside, restart.

**4. Bring the stack up with BOTH compose files**, or services recreate
without `SUPABASE_ANON_KEY` and crash-loop:

```bash
docker compose -f docker-compose-uat.yml -f docker-compose-uat.local.yml up -d <svc>
```

## Procedure

1. Note the wall-clock **start**, trigger the sync, note the **end**. The
   phase-complete log line gives the authoritative duration:

   ```bash
   docker logs --since 2h opuspopuli-uat-region-worker 2>&1 \
     | grep -E "complete:|Job succeeded"
   ```

2. Capture, giving the run length in seconds and the end time **in the host's
   local zone** — container logs are UTC:

   ```bash
   ./scripts/gate0-baseline.sh civics 2032 "2026-10-21 21:28:30"
   ```

   The script refuses a future anchor and flags a GPU figure above 100%,
   because both previously produced confident nonsense.

3. Cross-check the item counts against the phase-complete log line. They come
   from the same accounting inside `SyncPhaseTracker` and must agree exactly.
   If they do not, trust the log and work out why before recording anything.

4. Record the row below, **including failures**. A run with killed calls is
   still worth recording; it just cannot be read as evidence about lanes.

## Results

| data type        | run   | items (c/u/s/f) | llm stage       | GPU busy | calls | tokens in/out    | notes                                                                                                                                                                                                   |
| ---------------- | ----- | --------------- | --------------- | -------- | ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| civics           | 2032s | 0 / 12 / 13 / 2 | 1924.1s (94.7%) | 47.5%    | 21    | 170,857 / 32,957 | **Not a clean baseline.** Two calls died (`unexpected EOF`, runner killed under memory pressure) burning ~1,120s, which is most of the 968.6s stage-minus-inference gap. Re-run with the desktop quiet. |
| bills            |       |                 |                 |          |       |                  | ~48h, weekend only                                                                                                                                                                                      |
| propositions     |       |                 |                 |          |       |                  |                                                                                                                                                                                                         |
| representatives  |       |                 |                 |          |       |                  |                                                                                                                                                                                                         |
| meetings         |       |                 |                 |          |       |                  |                                                                                                                                                                                                         |
| campaign finance |       |                 |                 |          |       |                  |                                                                                                                                                                                                         |

## Reading the result

`stage-minus-inference gap` is queue wait plus HTTP overhead **plus any failed
calls**. At concurrency 1 with no failures it is near zero — on a single
healthy call the two instruments agreed to 0.09s. A large gap is therefore a
signal to look at failures first, not to conclude the pipeline needs lanes.

`data_type` is only set on the bills fetch path, so `sum by (data_type)` over
stage durations is one dominant empty bucket. Item counts carry it for every
type; stage durations do not yet.
