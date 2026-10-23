# S1 — one per-host rate limit, shared by every process

Phase A, step 3 of `ingestion-resource-lanes.md` (§6 S1, §7 H2). That plan
calls S1 mechanical; reading the code showed a design choice it did not
anticipate (below), so it gets this short plan first.

## What exists today

Two limiters, with different shapes and different numbers, apply to the same
government sites:

| Path | Limiter | Scope | Rate |
|---|---|---|---|
| Scraping pipeline, via `ExtractionProvider` | `RedisRateLimiter`, key `extraction:ratelimit` | **one bucket for every host**, shared across processes | 2 rps, burst 5 (`EXTRACTION_RATE_LIMIT_*`) |
| Bills sync (`fetchTextWithRetry` in region-sync) | `HostThrottle` | per host, **per process** | 1 rps (1000ms gap), `rateLimitOverride` per source |
| `HttpFetcherService` | its own `HostThrottle` | per host, per process | 1 rps — a second copy; region-sync notes it is unused |

So every host serialises on one bucket in the pipeline (S1's stated
problem — fetch concurrency cannot help), while the bills path multiplies its
rate by the number of processes (H2).

## Finding: the region config's `rateLimit` is never applied

Region configs declare one, and the validator checks it, but nothing reads it
(searched `region-provider`, `scraping-pipeline`, `extraction-provider` and
the backend, 2026-10-22):

| Region | Declares | Hosts | Gets today |
|---|---|---|---|
| `federal` | **0.25 rps, burst 1** | `api.open.fec.gov`, `www.fec.gov` | a share of the global 2 rps |
| `california` | 1 rps, burst 3 | leginfo, assembly, senate, sos, oag, … (9 hosts) | a share of the global 2 rps |

The federal number is the FEC API's quota (~1,000 requests/hour ≈ 0.28 rps):
ignoring it risks 429s or a suspended key. **No region sets
`rateLimitOverride`**; only the code path for it exists.

This is why S1 cannot be "key the bucket per host" alone: with per-host
buckets each host gets a full budget, so the FEC host would go from a share
of 2 rps to 2 rps of its own — 8× what its config asks for.

## Design

1. **One bucket per host**, `extraction:ratelimit:<host>`, in the Redis
   instance the limiter already uses (`REDIS_URL`, noeviction). Same token
   bucket Lua script; it already takes rate and burst per call.
2. **One policy per host, resolved from config**, in this order:
   1. the data source's `rateLimitOverride` (rps), for that source's host;
   2. the region's `rateLimit` (rps and burst), for every host that region's
      data sources name;
   3. the global default, `EXTRACTION_RATE_LIMIT_RPS` / `_BURST` (2 / 5).

   A host named by **two regions** (a county config pointing at a state
   site) takes the **strictest** policy — the lower rate and the lower burst.
   Politeness to a government site is not something two configs should be
   able to add up.
3. **Policy lives in Redis beside the bucket**, `extraction:ratelimit:policy:<host>`,
   and the token-bucket script reads it on every call (falling back to the
   default when absent). Written by `RegionPluginService` whenever plugins
   (re)load — the path every load goes through ends in
   `reloadActiveLocalPlugin`, after the federal plugin is up.

   Why Redis and not one shared object: `ExtractionProvider` is built inside
   `ScrapingPipelineModule`'s own DI scope, which `RegionSyncService` cannot
   see (the scoping that already forced `OCR_SERVICE` and `SOURCE_ARCHIVE` to
   be declared inside it). Two limiter instances are unavoidable; a policy
   held in one of them would leave the other enforcing the default — the FEC
   host at 2 rps again. In Redis, every instance in every process reads the
   same policy.

   Policies have **no TTL** (each write also `PERSIST`s, because `HSET` keeps
   a TTL an older build left — caught on UAT) and are published
   **additively**: written, never deleted. `RegionPluginService` republishes
   **hourly** — loads happen only at boot and on admin action, and a node
   runs for weeks between them, so a publish that failed at boot or policies
   lost with Redis's data would otherwise stand until the next deploy.

   Two earlier designs were reviewed out. A 7-day TTL "refreshed on every
   load" — nothing refreshed it, and the FEC host would have gone back to the
   default a week into any release. Then publish-as-replacement — three
   processes publish (region, region-worker, structural-analysis-worker),
   each hourly, and one holding a partial view (a local plugin that failed,
   the window inside a reload, a stale set after an admin toggle elsewhere)
   deleted every other host's policy. A host left behind by additive
   publication keeps a clamped, at-worst-stricter policy: the recoverable
   error.

   Without Redis (dev, unit tests), the memory implementation shares
   **policies** process-wide, so they still reach every instance, but keeps
   **buckets** per instance. Shared buckets were tried first and broke
   isolation: a throttled acquire from one instance resumed inside another's
   work (ten `ExtractionProvider` tests failed on it). Production and UAT
   always have Redis, which shares both.
4. **`HostThrottle` is retired.** `fetchTextWithRetry`'s `throttle` becomes
   the shared limiter (same `acquire(url)` shape), and `HttpFetcherService`'s
   copy goes with it.
5. **Handlers that fetch on their own go through it too.** The API and
   bulk-download handlers stream with a bare `fetch`, outside
   `ExtractionProvider`; they now wait on `ExtractionProvider.acquireHostSlot`
   before every request. **These are the FEC paths** — without this, the
   0.25 rps policy was published and nothing read it (see below).
6. **Every policy is validated and bounded.** Rate and burst must be finite
   and positive — anything else is ignored with a warning — and are clamped
   to 0.01–10 rps and a burst of 1–20, so no config typo can flood a site.
   `rateLimitOverride: 0` means "no override", as it did before. The Lua
   script guards the same values again, uses Redis's `TIME` rather than each
   client's clock, and the caller caps and jitters every wait. Rate 0 had
   produced an infinite wait and a 1 ms spin against the BullMQ Redis.
7. **Failure degrades, not open.** On a Redis error a request waits on an
   in-process limiter holding this process's mirror of the published
   policies — per limiter instance, so looser across a fleet (and up to 2×
   per process, which holds two instances), but bounded, which the throttle
   it replaced also was. The limiter reconnects after ioredis gives up (which
   the old one never did), logs once per outage and on recovery, and after
   `destroy()` never reconnects, so a waiter that wakes during shutdown cannot
   hold the process open.
8. **The wiring cannot silently go missing.** The pipeline handlers'
   `ExtractionProvider` inject is required (optional, a refactor that lost it
   would have handed them null with every test green); `RegionPluginService`
   warns at every load when no limiter is bound. The script enforces the
   ceiling too, not only publication.

## What changes in practice

- Multi-host syncs speed up: hosts stop sharing one 2 rps bucket.
- **Single-host bursts on California slow down**, from 2 rps to the 1 rps
  the region config declares.
- **Federal campaign finance slows from about 4 rps to 0.25 rps.** The first
  version of this plan said "from 2 rps" — wrong, and the owner decision was
  taken partly on it: both FEC sources (`api`, `bulk_download`) bypassed
  every limiter, the API handler paced only by a fixed 250 ms gap between
  pages. Schedule A pages by cursor at 100 per page with no page cap, so a
  full pull at ~4 rps would have exhausted the ~1,000-requests/hour quota in
  minutes. At 0.25 rps it is ~900 pages an hour — slow, but within quota. The
  decision ("honour the declared config") is unchanged by the correction; its
  consequence for federal is larger than first stated.
- **Hosts no config names** (detail pages on other hosts, PDFs on CDN
  subdomains, boundary sources) get the 2 rps / burst 5 default per host. The
  bills path used to run every host at 1 rps; configured California hosts go
  from a strict 1 s gap to 1 rps with a burst of 3.

## Tests

- Two hosts drain independently; one host's bucket throttles its own calls.
- Precedence: override > region > default, and strictest-wins across regions.
- The bills path and the extraction path share one bucket for a host (one
  process, two callers).
- Two processes, one Redis: a host's rate holds across both (integration,
  against the real Redis the integration stack already runs).
- Redis down: requests degrade to the in-process limiter, warned once.
- Bad values: rate 0, negative, NaN, huge; override 0; a bad stored policy.
- Both FEC handlers wait on the slot before fetching; the API key is never
  logged.
- Each verified by reintroducing its defect.

## Review

Two independent reviews of the first implementation (code; security). The
code review found **three blockers**: the FEC paths bypassed the limiter
entirely (B1, above), policies lapsed after 7 days (B2), and a rate of 0 hung
the caller in a Redis spin (B3). The security review independently found B2
and B3, the missing ceiling, the fail-open regression and the unretried boot
publish. All are fixed in this change; so is a debug log line in the API
handler that printed the full page URL, FEC `api_key` included.

**Not changed, recorded:**
- **Plugin init runs twice, concurrently, in every process.**
  `RegionSyncService.onModuleInit` is a "test-time shim" that delegates to
  `RegionPluginService.onModuleInit`, which Nest also calls; both run under
  `Promise.all`. Vault resolution, config sync and both plugin loads happen
  twice, and the two `reloadActiveLocalPlugin` runs can interleave
  `unregister()` with `registerLocal`. Pre-existing (#828 Step 6), harmless
  for S1 (both publish the same set). Fix separately: delete the shim and have
  the legacy spec call `regionPluginService.onModuleInit()`.
- **Waiters are not FIFO.** Jitter spreads them, but a request can lose
  several rounds at 0.25 rps. Acceptable at current concurrency.
- **The regions schema allows `minimum: 0`** for `requestsPerSecond` and
  `rateLimitOverride`; the code now ignores 0, but the schema should say
  `exclusiveMinimum: 0` with a maximum. That is an `opuspopuli-regions`
  change.
- **`EXTRACTION_RATE_LIMIT_RPS` is parsed with `parseInt`** in
  `config/extraction.config.ts`, so `0.5` becomes 0; that config is not wired
  into the limiters, so it is latent.
- **Third review, of the final diff: no blockers.** It confirmed
  `ExtractionProvider` resolves in the pipeline scope (so the FEC paths are
  throttled in the real app) and that Nest destroys the factory-built
  limiter. Its four suggestions — reconnect-after-destroy, cross-process
  wipe by replace semantics, an unpinned optional inject, a silently
  optional limiter — are design points 3, 7 and 8 above.
- **One integration test leaves Jest waiting on exit** — the one that points
  the limiter at an unreachable Redis. The same client exits cleanly from
  plain Node, and `--detectOpenHandles` finds nothing; it is an ioredis retry
  timer racing Jest's teardown check, not a leak in the limiter.

## Owner decision

Whether to honour the declared region `rateLimit` now, slowing federal
campaign finance to 0.25 rps and single-host California bursts to 1 rps.
**Decided 2026-10-22: honour it** — precedence override > region > default,
strictest wins across regions.
