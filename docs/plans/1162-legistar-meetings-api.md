# #1162 — Sonoma Legistar meetings via the Legistar Web API

| | |
|---|---|
| **Issue** | [#1162](https://github.com/OpusPopuli/opuspopuli/issues/1162) |
| **Date** | 2026-09-08 |
| **Author** | Claude (self-planned; countersign with the PR) |
| **Branch** | `fix/legistar-meetings-1162` |
| **Data classification** | **None.** Public meeting calendars — body names, dates, locations, agenda/minutes PDF links. No personal information; nothing in the `ca-personal-information` category the `us-state-privacy` profile activates. |
| **Approach** | Option B — replace the HTML scrape with Legistar's public Web API. Chosen over Option A (retarget the manifest at `gridCalendar`) for the reasons below. |

## Problem, and why the issue's framing is incomplete

The issue is correct that the AI-derived manifest anchored on the
`gridUpcomingMeetings` teaser instead of `gridCalendar`. But the numbers in the
issue don't reproduce. Fetched live on 2026-09-08:

| Grid | Issue says | Actually |
|---|---|---|
| `gridUpcomingMeetings` | ~1–3 | **1 row** |
| `gridCalendar` | ~16 | **4 rows** |

Both grids are server-rendered, so both are scrapeable. `gridCalendar` is not 16
because Legistar's calendar carries a period filter (`lstYears`: This Week /
This Month / This Year / All Years) that **defaults to "This Month."** So the
fix as specified would take Sonoma from 1 meeting to 4 — not to a complete
calendar. Widening the period is an ASP.NET WebForms postback, not a URL
parameter, so scraping the full archive would mean driving viewstate.

## The better source, verified live

Legistar publishes a public, keyless Web API, and it is live for Sonoma:

```
GET https://webapi.legistar.com/v1/sonoma-county/events   → 506 events
```

Field coverage maps almost 1:1 onto the `Meeting` domain type:

| API field | Meeting field | Notes |
|---|---|---|
| `EventId` / `EventGuid` | `externalId` | stable ids |
| `EventBodyName` | `body` | 100% populated (Sonoma exposes 1 body: Board of Supervisors) |
| `EventDate` + `EventTime` | `scheduledAt` | **two fields** — `2026-09-03T00:00:00` + `2:45 PM` |
| `EventLocation` | `location` | 100% populated |
| `EventAgendaFile` | `agendaUrl` | absolute URL; 32/40 on recent events |
| `EventMinutesFile` | (not persisted) | 0/40 recent, 16/40 historical — minutes publish later, so sparseness is real |
| `EventInSiteURL` | (not persisted) | meeting detail page; `MeetingSchema` has no `sourceUrl` |

**Not persisted, found in review:** the meetings upsert
(`meetings-sync.service.ts`) writes only `title, body, scheduledAt, location,
agendaUrl, videoUrl`. Mapping `EventMinutesFile` or `EventInSiteURL` would be
dead config, so both were dropped. Legistar publishes minutes URLs the platform
currently discards for `Meeting` — worth a follow-up, out of scope here.

**Timezone (blocker found in review):** `EventDate`/`EventTime` are naive local
wall-clock. Containers run UTC (no `TZ` in any compose file), so
`new Date("2026-09-03 2:45 PM")` resolves to 14:45 UTC and every Sonoma meeting
displays 7 hours early. The composite therefore carries an explicit
`timezone: "America/Los_Angeles"`, and `zonedWallClockToISO` converts
wall-clock → instant DST-aware. Verified identical output under UTC, Pacific,
Berlin and Tokyo hosts.

**506 events versus 4 scraped rows**, deterministic, no LLM in the path, and it
generalizes: 13 county configs already point at `*.legistar.com`.

Two facts that make this viable with the existing `api` handler:

- `fetchMeetings` passes `undefined` for `onBatch`
  (`declarative-region-plugin.ts`), so `useBatch` is false and the
  `sourceType: "api"` streaming-drop bug recorded in the #1163 plan
  **does not affect meetings**.
- OData paging maps onto the handler's existing `offset` type:
  `pageParam: "$skip"`, `limitParam: "$top"` — `applyPaginationParams` sets the
  page param to `page * limit`, which is exactly `$skip` semantics.

## Gaps to close (spike answers, verified in code)

1. **Bare top-level arrays are unsupported.** `resultsPath` defaults to
   `"results"` and `extractItems` walks a dot path, returning `[]` when the body
   is itself an array. Legistar returns a bare array.
2. **`scheduledAt` needs two fields combined.** `fieldMappings` on the api path
   is a flat key rename only. This is the same composite-field gap #1164 solved
   for HTML extraction — the fix is to **reuse `resolveCompositeTemplate`**
   rather than invent a second mechanism.
3. **`MAX_PAGES = 10` is hardcoded.** 506 events at `$top=100` is 6 pages, fine
   today, but archives grow and silent truncation is the failure mode this
   codebase keeps rediscovering.

## Subtasks

1. **`resultsPath` supports bare arrays** (`packages/scraping-pipeline`):
   treat a top-level array as the item list when `resultsPath` is omitted or
   `"$"`. Keeps every existing config working (default stays `"results"` for
   object bodies).
2. **Composite fields on the api path**: add `compositeFields?: Record<string,
   string>` to `ApiSourceConfig` (target field → template) and resolve it with
   the existing `resolveCompositeTemplate`, so `{EventDate} {EventTime}` builds
   `scheduledAt`. Makes the composite primitive shared across HTML and API
   extraction instead of HTML-only.
3. **Configurable page cap**: optional `maxPages` on `ApiPaginationConfig`
   (default 10), and make truncation a loud warning rather than a silent stop.
4. **Regions schema + Sonoma config**: `compositeFields` and `maxPages` in
   `region-plugin.schema.json` (both blocks are `additionalProperties: false`),
   then repoint Sonoma `meetings` at the API. Ship via `@opuspopuli/regions`.
5. **Tests**: JSON fixture of Legistar events; assert bare-array extraction,
   composite `scheduledAt` (date + time, not date-only), agenda/minutes
   mapping, and a regression guard that the count is not 1 (the teaser-widget
   signature).
6. **UAT verification**: invalidate the stale Legistar manifest, run a real
   Sonoma `meetings` sync, confirm rows with times, agenda links, and body.

## Correction to the acceptance criteria

AC #1 says "~16 rows at time of writing". That is not reproducible — the grid
shows 4 today because it is month-filtered, and any absolute count is a moving
target. Restate as: **ingests the full published meeting set (506 via the API),
not the 1-row upcoming widget**, with the regression test asserting a floor
rather than a magic number.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Changing `resultsPath` semantics breaks existing api sources (FEC) | high × possible | Default stays `"results"`; bare-array handling only when the body IS an array; existing handler specs must stay green |
| `scheduledAt` loses time-of-day | medium × likely | Composite field (subtask 2); date-only is a visible downgrade for a meetings feed |
| `MAX_PAGES` truncates as archives grow | medium × possible | Configurable cap + loud warning; no silent truncation |
| Legistar API retired or changed | high × rare | Documented InSite API used across many jurisdictions; the scraped grid remains a fallback path |
| Minutes/agenda sparsely populated read as a bug | low × likely | Documented above as real upstream behavior; tests assert presence only where the fixture has it |
| Volume: 506 events × 13 counties | low × likely | Well within existing sync patterns; `$orderby` + date windows available |
| AGPL-3.0 dependency constraint | — | No new dependencies (native fetch) |
| Regulated-data exposure | — | None; public meeting calendars |

## Effort

**2–3 focused days.** Subtask 2 is the bulk. Date-only `scheduledAt` would cut
it to ~1 day but is the wrong trade for a meetings feed.
