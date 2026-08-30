# Plan: lazy county activation on first registration

| | |
|---|---|
| **Issue** | TBD — file before implementation |
| **Date** | 2026-08-17 |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** Reads a user's resolved county jurisdiction (derived from their address) to decide what to scrape. No personal data leaves the system; the scrape targets public county government sites. The county↔user link is already stored in `user_jurisdictions`. |
| **Status** | Drafted 2026-08-17. Not started. |

## Problem

No county content has ever been scraped. Production carries **0 county-level
representatives** — only Assembly (80) and Senate (40). A user in Sonoma County
sees their state reps and nothing about their Board of Supervisors, which is
the layer of government closest to them.

Pre-scraping all 58 California counties is the obvious alternative and the
wrong one: it spends AI extraction budget and scrape traffic on 57 counties
that may have no users for months, and it puts 58 sets of county-site
scraping into the critical path before launch.

## What already exists

More than expected. This plan is mostly wiring, not construction.

| | Status |
|---|---|
| Per-county scrape configs | **Done.** All 58 exist in `opuspopuli-regions` at `regions/california/counties/<name>/<name>.json`, each with `regionId: california-<name>`, `parentRegionId: california`, `fipsCode`, and `dataSources` carrying URLs + `contentGoal`. |
| County jurisdiction records | **Done.** All 58 `jurisdictions` rows, `type: COUNTY`, with `fips_code` (e.g. `06037`) and `ocd_id`. |
| User → county resolution | **Done.** The census geocoder resolves a county jurisdiction at address entry; `user_jurisdictions` links user → address → jurisdiction. |
| Region-scoped sync | **Done.** `syncRegionData(regionId:)` enqueues a `region-sync` job; the worker already handles per-region sync. |
| **County "is live" state** | **Missing.** |
| **Trigger on first user** | **Missing.** |
| **Cold-start UX** | **Missing.** |

So the work is: record which counties are active, activate one when its first
user arrives, and tell that user what is happening.

## Design

**Activate a county the first time a user resolves into it; every later user in
that county gets the data immediately.**

### Trigger point

Where jurisdictions are resolved — `profile.service.ts`, after `createAddress`
geocodes and writes `user_jurisdictions`. That is the moment the county becomes
known, it already runs on the registration path, and it is after the
geocoding-must-succeed gate, so we never activate a county from a bad address.

Deliberately **not** in onboarding completion: address entry can happen later
from `/settings/addresses`, and a user who changes address to a new county
should activate it too.

### State: a `region_activations` table

```
region_id          text primary key      -- 'california-sonoma'
status             text                  -- pending | active | failed
first_requested_by uuid                  -- audit: who caused it
requested_at       timestamptz
activated_at       timestamptz
last_error         text
attempts           int
```

Rejected: inferring activation from existing sync-job rows. It works but says
nothing about intent, needs a scan per registration, and gives no natural place
to hang retry state. A dedicated row is cheaper to read on a hot path and
expresses "this county is open for business".

### Dedupe

Two problems, two mechanisms:

1. **Same-instant races** — two users from one county registering together.
   Insert with `ON CONFLICT (region_id) DO NOTHING`; only the winning insert
   enqueues.
2. **Requeue on retry/restart** — BullMQ `jobId: county-activate-<regionId>`,
   the same pattern the nightly cron uses for its dedup key.

### Ongoing freshness

Activation must also **enrol the county in the nightly sync rotation**,
otherwise it is a one-shot snapshot that silently goes stale — precisely the
failure mode already live today with committee data last synced 2026-07-16.
The nightly job should iterate `region_activations WHERE status = 'active'`.

### Activate in two phases, not one

Every county config declares **four** data types — `representatives`,
`meetings`, `propositions`, `campaign_finance` — 232 sources across the 58
counties, all already authored.

They are not equally cheap. No county sync has ever run, so there is no direct
measurement, but the state-level history is a warning:

| data type | state-level avg |
|---|---|
| meetings | 37s |
| propositions | 94s |
| representatives | 594s (120 legislators) |
| campaign_finance | **7616s (~2 hours)** |
| bills | 60716s (~17 hours) |

County scope is much smaller — five supervisors rather than 120 legislators —
so the first three should be fast. `campaign_finance` is the unknown: county
NetFile portals are paginated and slow, and it is the one type where the
state-level cost suggests hours rather than minutes.

**So activation runs in two phases:**

1. **Blocking-ish (what the user is waiting for):** `representatives`,
   `meetings`, `propositions`. These are what make the county section of the
   briefing non-empty. Mark the county `active` when these succeed.
2. **Deferred:** `campaign_finance`, enqueued separately at lower priority.
   Its absence degrades gracefully — finance attribution is a secondary
   surface, and the user is not staring at it during onboarding.

This keeps the cold-start wait proportional to what the user actually sees, and
prevents the slowest source from deciding how long a new user waits. Without
the split, one slow NetFile portal makes every first-user-in-a-county wait for
data they did not ask for.

## Failure modes worth designing for

**The first user waits.** County sync duration is unknown and unmeasured; it
could be minutes or considerably longer. That user sees an empty county section
with no explanation. Reuse the pattern just shipped for personalization: a
notice driven by real job status, not a timer — *"You're the first person from
Sonoma County. We're gathering your county's data now."* That is a good product
moment rather than an apology, but only if it is honest about duration, which
means measuring a real county sync before writing the copy. (The
personalization estimate was nearly shipped at 4× too fast for exactly this
reason.)

**Activation fails.** A county site is down, or extraction yields nothing.
Status must go to `failed` with the error, not silently to `active` — the
platform has now been bitten three times by failure recorded as success
(empty caches written as success, jobs with 85/85 failures marked `succeeded`,
and a 200 on auth failure). Retry with backoff; a failed county must be
retryable without a new user arriving.

**Thundering herd at launch.** A LinkedIn announcement could bring users from
many counties within minutes, each triggering a scrape. Needs a concurrency cap
on county activations specifically — the per-county `rateLimit` in config
(1 req/s) governs politeness to one county's site, not how many counties we hit
at once. Worth a small fixed concurrency and a queue.

**Extraction cost.** Each activation is AI extraction against a new site. The
whole point of lazy activation is spending that only where users exist, but the
cost is now user-triggered and therefore unbounded by us. Worth a cap and an
alert.

## Subtasks

1. **Migration** — `region_activations` table (additive; no changes to existing tables).
2. **Activation service** (region service) — `ensureCountyActivated(countyJurisdictionId, userId)`: map jurisdiction → `regionId` via `fips_code`, upsert-if-absent, enqueue on insert. Idempotent and safe to call on every address write.
3. **Trigger** — call it from `profile.service.ts` after jurisdictions resolve. Fire-and-forget: a failure must never block address save or registration.
4. **Worker** — handle the county-activation job: run the region sync for that `regionId`, then mark `active` or `failed`. Concurrency-capped.
5. **Nightly rotation** — include `status = 'active'` counties in the existing nightly sync.
6. **UX** — "first person from your county" notice on the briefing/reps surfaces, driven by activation status. Copy written *after* measuring a real county sync.
7. **Backfill** — activate the counties current users already occupy (there are only a handful today), so existing accounts are not waiting on a new registration.

## Risk register

| Risk | Severity × Likelihood | Mitigation |
|---|---|---|
| First user waits an unknown, possibly long time | **High × Likely** | Honest status UX; measure a real county sync before promising a duration |
| Activation failure recorded as success, county silently empty | **High × Possible** | Explicit `failed` status + retry; never mark active without a verified result |
| Launch spike activates many counties at once | **High × Possible** | Concurrency cap on activation jobs; per-county rate limits already in config |
| Duplicate activation from concurrent registrations | Medium × Likely | `ON CONFLICT DO NOTHING` + deterministic BullMQ jobId |
| Activated counties go stale | **High × Likely** | Enrol in nightly rotation as part of activation (subtask 5) — this is already a live problem elsewhere |
| Unbounded AI extraction cost | Medium × Possible | Cap concurrent activations; alert on activation volume |
| County site blocks or rate-limits us | Medium × Possible | Existing per-region `rateLimit`; failure is contained to one county |
| Address change moves a user to an unactivated county | Low × Likely | Trigger sits on jurisdiction resolution, not registration, so this is covered by design |

## Explicitly out of scope

- **Cities / municipalities.** Same pattern will apply, but county is the
  larger win and the configs exist today.
- **Other states.** The mechanism is state-agnostic, but only California has
  county configs.
- **Backfilling all 58 counties.** That is the thing this plan exists to avoid.

## Open questions

1. **How long does one county sync actually take?** Nothing has ever run one —
   confirmed: every `pipeline_jobs` row is `region_id = california` or null.
   The two-phase split above is designed to make this matter less, but the
   phase-1 duration still sets the cold-start wait and must be measured before
   any UX copy promises a number.
2. **Does a county config actually yield anything?** The configs exist and
   declare four data types each, but have never been exercised end-to-end.
   "Activate on first user" is worthless if activation produces nothing, and a
   county site that has changed shape since the config was authored would fail
   silently unless subtask 4 records it.

**Both are answered by running ONE county manually** — Los Angeles or Sonoma —
before any of this is built. That is roughly an hour and it de-risks the entire
feature: it produces the phase-1 duration, proves the configs still match the
live sites, and shows what the data actually looks like in the briefing.
