# Silent county-sync failures — #1184 and #1172

Two independent defects that combine into one user-visible outcome: **a county
can be enabled, report `succeeded`, and hold zero rows.** Both were found on
2026-09-08 while onboarding Sonoma to production, and both fail *silently* —
no error, no failed job, logs that claim success.

Fixing them together because they sit on the same path and share a root cause
in spirit: a guard written for one situation quietly swallowing another.

---

## #1184 — enabled plugins register no scheduler

`region-sync.scheduler.ts` registers a cron per data source only when that
source declares a `syncCadence`:

```ts
if (source.syncCadence) { await this.registerSourceScheduler(...) }
```

There is a global daily fallback, but it registers only when **no** source
anywhere declares a cadence:

```ts
const hasCadences = configs.some(({ sources }) =>
  sources.some((s) => s.syncCadence || s.statusScanCadence));
if (!hasCadences) { /* register 'daily-cron' */ }
```

`california.json` declares 22 cadences; `sonoma.json` declares none. So
California suppresses the fallback and Sonoma registers nothing — enabling the
plugin schedules no work at all.

### Fix

Register a scheduler for **every** source, defaulting a missing `syncCadence`
to `DAILY_CRON`. A configured data source that never runs is not a
configuration choice anyone makes on purpose; it is the bug.

Chosen over the alternatives because:

- **Warn-only** leaves the county broken until someone reads a boot log. It
  makes the failure visible without making it stop happening.
- **Schema-required cadence** breaks every existing config at once and pushes
  the burden onto the config authors we are explicitly trying to serve — the
  region-launch goal is that a county is *only* JSON.

Existing `staggeredCron(cron, seed)` already spreads load by source, so
defaulting many sources to one base cron does not stampede.

Two observability additions, because the silence is what made this expensive:

1. `warn` naming each source that fell back to the default — a config author
   should see that the platform picked a cadence for them.
2. `warn` naming any **enabled** plugin that ends up with zero schedulers.
   After this change that should be unreachable; if it ever fires, the guard
   has regressed.

The global `hasCadences` fallback is kept only for a genuinely empty config
(no plugins, no sources), which is the case it was written for.

---

## #1172 — manifest-ready follow-up silently deduplicated

`structural-analysis.processor.ts` enqueues the follow-up sync with a
deterministic jobId:

```ts
const dedupeJobId = `manifest-ready:${regionId}:${dataType}`;
```

The comment says this "deduplicates concurrent analyses… BullMQ silently skips
if already queued/active" — but BullMQ no-ops a duplicate id in **any** state,
including `completed`, and completed jobs are retained 7 days
(`removeOnComplete: { age: 60*60*24*7 }`). So the id stays occupied by the
previous run and every follow-up in that window is dropped. `enqueue()` returns
normally, so the log claims success.

Confirmed twice: UAT 2026-09-07 (2-day-old occupant) and production 2026-09-08
(~19h-old occupant).

### Fix

Scope the id to the manifest that triggered it:

```ts
`manifest-ready:${regionId}:${dataType}:${manifestId}:v${manifestVersion}`
```

This keeps the original intent — collapse concurrent analyses of **the same**
manifest — while letting a genuinely new manifest through. The version is
included because a re-analysis can bump a manifest in place.

Also add no-op detection in `queue.service.ts`: BullMQ's `add()` returns the
*existing* job when the id is taken, so a returned job carrying `finishedOn` in
the past means our enqueue did nothing. Warn on that. This is general — it
protects every deterministic-jobId caller, not just this one.

---

## Tests

Both changes are scheduling/queueing behaviour, so both get unit tests that
**fail against the current code** (verified by reintroducing, per the standing
convention that a regression test is unproven until seen failing):

- scheduler registers a source with no `syncCadence` (fails today: skipped)
- scheduler still honours an explicit cadence
- scheduler warns for a source that fell back
- follow-up jobId differs between two distinct manifests (fails today: identical)
- follow-up jobId is stable for the same manifest (dedupe intent preserved)
- `enqueue` warns when the returned job was already finished

## Out of scope

Adding explicit `syncCadence` values to `sonoma.json` in `opuspopuli-regions`.
The default makes Sonoma work at next boot without it, and a config change
carries the full chain (regions PR → publish → lockfile bump → backend release
→ redeploy). Worth doing later for explicitness, not needed for the fix.
