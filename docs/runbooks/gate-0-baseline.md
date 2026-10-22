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

| data type                | run   | items (c/u/s/f) | dominant stage                               | GPU busy | llm calls | gap    | notes                                                                                                                                                                                                                                                                 |
| ------------------------ | ----- | --------------- | -------------------------------------------- | -------- | --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| civics                   | 2032s | 0 / 12 / 13 / 2 | llm 2009.8s (98.9%)                          | 52.4%    | 22        | 944.3s | **Not clean.** Two calls died (`unexpected EOF`, runner killed under memory pressure); the gap is almost entirely those.                                                                                                                                              |
| propositions             | 553s  | 1 / 51 / 0 / 0  | **pdf_parse 404.1s (73.1%)**                 | 13.4%    | 3         | 0.2s   | The CPU lane dominates, not the GPU. A 0.2s gap is what healthy looks like at concurrency 1.                                                                                                                                                                          |
| representatives (county) | 392s  | 0 / 6 / 0 / 0   | llm 432.3s (110.3%)                          | 104.2%   | 81        | 23.9s  | Saturated. Over 100% is scrape-boundary quantization on a short run, not an error.                                                                                                                                                                                    |
| representatives (state)  | 793s  | 0 / 121 / 0 / 0 | llm 434.8s (54.8%), **fetch 268.3s (33.8%)** | 52.1%    | 83        | 21.8s  | **Post-fix, 2026-10-22.** Accounted time 53.4% -> **88.7%**. The pre-fix run reported the same 121 items and the same ~53% llm with fetch at ZERO; the missing third was the scraping pipeline's own fetches, most of them failing Assembly pages plus retry backoff. |
| meetings                 |       |                 |                                              |          |           |        |                                                                                                                                                                                                                                                                       |
| campaign finance         |       |                 |                                              |          |           |        |                                                                                                                                                                                                                                                                       |
| bills                    |       |                 |                                              |          |           |        | ~48h, weekend only                                                                                                                                                                                                                                                    |

**All four rows predate the fetch-path fix** and show no `fetch` time worth
trusting. The stage was wired only into region's own `fetchTextWithRetry`,
while the scraping pipeline reaches the network through
`ExtractionProvider.fetchWithRetry`. The state-reps run makes the cost plain:
it crawled 120 members, failed roughly **80 Assembly biography pages**, and
reported a `fetch` stage of zero with **0 failed items**. Re-measure after
rebuilding the images.

Those Assembly failures are #1383, with two distinct causes worth keeping
apart because only one is ours to fix:

- `a*.asmdc.org` — **incomplete TLS chain**. `openssl s_client` reports
  "unable to get local issuer certificate"; the server omits the intermediate.
  curl and browsers recover by fetching it via AIA, Node's undici does not, so
  it surfaces as `fetch failed` with no HTTP status at all.
- `ad*.asmrc.org` — **HTTP 403**, a real refusal from bot protection. It
  reproduces from the host, so it is not a container problem.

Neither is counted as a failed item: the detail crawler collects them into a
`warnings` array and the phase still reports `0 errors`. A sync can lose 80
pages and look clean.

## Reading the result

`stage-minus-inference gap` is queue wait plus HTTP overhead **plus any failed
calls**. At concurrency 1 with no failures it is near zero — on a single
healthy call the two instruments agreed to 0.09s. A large gap is therefore a
signal to look at failures first, not to conclude the pipeline needs lanes.

`data_type` is only set on the bills fetch path, so `sum by (data_type)` over
stage durations is one dominant empty bucket. Item counts carry it for every
type; stage durations do not yet.
