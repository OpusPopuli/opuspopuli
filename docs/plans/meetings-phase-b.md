# Phase B — meetings

Meetings is fifth in Phase B (`ingestion-resource-lanes.md` §10.2, owner
order: civics, propositions, representatives, **meetings**, campaign finance,
bills). Its plan item is **S6** (PDF/OCR onto a CPU lane), and, by the
consistency principle, every stage the other types got: skip keys on every
axis, attribution, and every lane that applies. There is no meetings eval leg.

Dev only (owner, 2026-10-26): verified on the local UAT stack, with no tags
and no Studio deploys.

Related: #919 (Senate PDF meetings rejected), #921 (self-heal misses a
mapped-yield collapse), #911 (the July regression), #814 (link minutes to
meetings), #1414 (the PDF prompt move, which found the Senate gap).

## What is true today (read 2026-10-31)

**No state legislative meeting has landed since 2026-07-16.** The dev DB holds
13 Assembly meetings, all created that day and scheduled 2026-08-04 to 08-12,
plus 507 Sonoma Board of Supervisors meetings from Legistar. Both chamber
sources run every sync and both produce zero rows. Neither failure surfaces as
an error: the sync reports `succeeded` with 0 meetings, and only a `WARN`
("No meetings extracted … see #911") records it.

> Correction: the #1414 plan read `meet-b0`'s "11 created" as meetings. They
> were **minutes** (the second tracker in the same sync). That plan only
> recorded the Senate rejections, so nothing there was wrong, but no meetings
> run in this period created a meeting.

### Finding M1 — Assembly: the manifest invents field names, and nothing checks

Source `https://www.assembly.ca.gov/schedules-publications/daily-file`
(`html_scrape`). The page lists real hearings. Manifest v12's own notes say
"10/29/26 has 3 meetings".

Manifest v12, derived fresh on 2026-10-31, has **correct selectors**
(`tr.committee-hearing-details`, `td.committee_hearing-date`, …), but the
fields are named `date`, `time`, `committeeName`, `location` and `agendaUrl`.
The mapper keys on `title`, `scheduledAt` and `externalId`, so all 5 items are
rejected with "no externalId and no title".

| Manifest | Derived | Field names |
|---|---|---|
| v8 | 2026-08-19 | `committeeName, dateRaw, timeRaw, location, agendaUrl, title, body, scheduledAt, externalId` |
| v9 | 2026-08-19 | the same set, reordered |
| v10, v11, v12 | 2026-10-29 to 10-31 | `date, time, committeeName, location, agendaUrl` |

The prompt is not the gap. `structural-schema-meetings` (prompt-service seed)
lists `externalId`, `title` and `scheduledAt` as required, and the model ignores
it 3 times in 3. A prompt rule that fails keeps failing
(`feedback_enforce_dont_instruct`). The region config adds to the pull: the
Assembly `contentGoal` asks for "committee name", which #911 noted in July.

**Three checks that should have caught it, and why each didn't:**

1. **`ExtractionValidator.checkRequiredFieldCoverage`** checks items against
   the **manifest's own** required fields. A manifest that misnames every field
   passes its own validation.
2. **The mapping-aware heal** (`SelfHealingService.evaluateMapping`, #966 W1)
   fires on `selectorFailures` of kind `schema_reject`, which counts Zod
   rejections. `mapMeeting`'s two pre-Zod guards (no externalId and no title;
   an empty composed externalId, `domain-mapper.service.ts:367/381`) `return
   null` **without incrementing `diag.schemaRejects`**, so a 100% rejection is
   invisible to it. These are the only uncounted rejects in the mapper. The
   committee-filing filter at :436 is a deliberate drop of valid rows. This is
   the unfinished half of #921.
3. **Manifest derivation** (`StructuralAnalyzerService`) saves and activates
   whatever the model returns, if it parses.

### Finding M2 — Senate: the model never sees a hearing

Source `https://www.senate.ca.gov/publications/senate-daily-file` (`pdf`, the
only `pdf` source in any region). It follows the gateway's first PDF link, the
Committee Hearings file (`SEN_COM_2025_R_<date>.PDF`, 28 pages, 40,752 chars).

`PdfExtractHandler` sends the model the **first 12,000 characters**
(`MAX_TEXT_SIZE`). The hearings are on page 24, in the **last ~700
characters**. Everything before that is front matter: the cover, the ADA
notice, the table of contents, officers, the member directory, the seating
chart, committee rosters and the weekly schedule. So the model writes rules for
text it has never seen. The rules from 2026-10-31 (now logged at debug, see
below):

- `dataSectionStart: "COMMITTEE HEARINGS"` first matches the **cover title**,
  and `dataSectionEnd: "OFFICERS OF THE SENATE|…"` matches page 5. The data
  section is therefore the cover and the table of contents.
- The 2 extracted "items" are front matter (the cover's publication date and a
  page header), not the 2 hearings. **Rejecting them was correct.**
- `scheduledAt` takes capture group 2 (the time only) and expects `AM|PM`. The
  PDF prints `p.m.`.

**Even a model that saw the hearings could not express them.** In this PDF the
date is a group heading ("WEDNESDAY, OCTOBER 28, 2026") with hearings beneath
it that carry only a time. `TextExtractorService` splits on `itemDelimiter` with
`String.split`, which discards the delimiter text. `TextExtractionRuleSet` has
no way to carry a heading into the items under it, so no block holds a full
date.

**Dead config:** `PdfSourceConfig.skipPages` and `maxPages` are declared in the
type and schema, and nothing reads them.

### Finding M3 — the Senate publishes the same data as structured HTML

`https://www.senate.ca.gov/calendar` is a Drupal events view. Its GET
parameters are `startDate`, `endDate` (`YYYY-MM-DD`), `committeeHearings=1` and
`selectedCommittee[]`. Fetched 2026-10-31:

- `startDate=2026-10-26&endDate=2026-11-30&committeeHearings=1` returns the
  same 2 hearings as the PDF (Rules on Oct 28; Joint Legislative Audit on Oct
  29). Each event card carries its own date, the committee, the chair, a time
  and location line, and a "View Agenda" link.
- `startDate=2026-08-01&endDate=2026-08-31&committeeHearings=1` returns **40
  hearings on one page**, with no pagination.
- `endDate` alone returns today through `endDate`. With neither parameter it
  returns today only.

As an `html_scrape` source, the Senate gets the same pipeline the Assembly uses:
a manifest, self-heal, the structure-hash skip and manifest attribution. That
follows `feedback_consistent_pipeline_across_types`. The one missing piece is a
**relative date window**, because a fixed `endDate` goes stale. No source
config supports date placeholders today. Legistar avoids needing them by
sorting `EventDate desc` and paginating.

### Finding M4 — attribution

- **`meetings`** has no `source_url`, `manifest_id`, `manifest_version`,
  `source_version_id` or pipeline execution id. A row cannot be traced to the
  manifest or page that produced it. `minutes` has all five, so `minutes` is
  the pattern to copy.
- **`minutes.summary`**: 58 of 67 rows have a summary, and **48 of those 58 have
  no `summary_prompt_hash`**. These are legacy rows from before attribution
  existed. `MinutesSummaryService` skips any row that already has a summary
  (`meetings-sync.service.ts:359`), so a prompt change never regenerates them.
  That is the same gap reps bios had.

### What already works

- **Minutes** (`pdf_archive`: Assembly daily journals and weekly histories)
  ingest correctly: 11 created on 2026-10-29.
- **`minutes-summary`** is already one job per row (`jobId` = row id), which
  is lane-shaped.
- **Sonoma** meetings come from the Legistar API (#1162) and do not depend on
  the structural analyzer.

### Fixed during the investigation

`PdfExtractHandler` now logs the derived rule set at `debug`. The path keeps no
manifest, so before this nothing recorded which rules a run used. The rules
come from a public civic PDF.

### Issue search (2026-10-31)

Searched: `manifest field names`, `fieldName schema structural analysis`,
`self-heal mapping rejected meetings`, `Assembly daily file meetings`,
`url date placeholder`, `relative date url`. M2 is #919 (open). The heal gap in
M1 is #921 (open); this plan finishes it. Field-name enforcement is not filed:
#911 named it as a likely cause and closed without it. The URL date window is
not filed. This plan is the record for both.

## Owner decisions

| | Decision | Suggestion |
|---|---|---|
| **D1** | Move the Senate source from the Daily File PDF to the HTML calendar (M3) | **Yes.** Same pipeline as the Assembly. The PDF path stays as a generic capability with no current source, and its truncation and heading problems are recorded here rather than fixed |
| **D2** | The calendar's window | **Today − 30 days to today + 60 days.** Upcoming hearings, plus the recently adjourned ones that minutes (#814) will link to |
| **D3** | Field-contract enforcement (step 1b) applies to every data type, not just meetings | **Yes**, per the consistency principle. Each type's contract is only the fields its mapper cannot do without, measured against today's active manifests before it is switched on |

**Owner, 2026-10-31: D1 yes, D2 −30d/+60d, D3 every data type.** All three as
suggested.

## Steps

### 0. Baseline

Measured above: both chambers produce 0, Sonoma is unaffected, minutes work.
Still to record before step 1: a full meetings sync on `main` (wall time, LLM
calls by kind, rows per source), using `sync.sh`, as `meet-c0` did.

### 1. Correctness — the gates that should have caught M1

These are pipeline-wide, so every `html_scrape` type gains them.

**1a. Not this: counting the identity-gate drops as schema rejects.** This
was the first draft. It is wrong, and W1 already decided against it: its spec
"does not count intentional drops as schema rejects" holds that a meeting
without identity is dropped **by design** and must not feed the heal loop. A
recess page whose only rows are "No hearings scheduled" placeholders would then
trigger a GPU re-analysis on every sync, with nothing broken. The failure in M1
lives in the **manifest** (its field names), not the items, so 1b and 1c check
the manifest. Placeholder rows never trip a manifest-level check.

**1b. Enforce the field contract at derivation.** A code-side table,
`REQUIRED_DOMAIN_FIELDS[dataType]`, holds the fields each mapper cannot do
without. For meetings that is `scheduledAt` plus one of `title` or
`externalId`, since `composeMeetingExternalId` can build the id. When a
derived manifest's `fieldMappings` don't cover the contract,
`StructuralAnalyzerService` treats it as an analysis failure: it is not saved
or activated, the reason is logged with the offending names, and the existing
retry applies.

- **Not by renaming.** Mapping `committeeName` to `title` in code would
  silently accept whatever the model invents next.
- **Not by omitting a field.** Per `feedback_enforce_dont_instruct`, an omitted
  field makes the model invent a value.
- **Before switching it on:** run the check against every active manifest in
  the dev DB, for every type. Any manifest it would reject that currently lands
  rows is a contract bug, fixed before the gate goes live.

**1c. A cached manifest that breaks the contract is invalid.** The same
contract check runs on the cached manifest's `fieldMappings` when it is used.
That check is on names, not item values, per 1a. A manifest saved before 1b
(Assembly v12 today) therefore heals on its next use, through the existing
pre-mapping heal under the one-heal-per-run bound.

**#921 stays open, narrowed.** 1b and 1c cover the misnamed-field cause. A
correctly named manifest whose selectors drift onto elements with no title
still drops every row without healing. That case is indistinguishable, item by
item, from a page of placeholders, so it needs a different signal: for
example, mapped yield against `last_item_count`, which is #921's own
suggestion. It is out of scope here, and the comment on #921 will say so.

**1d. Region config.** The Assembly `contentGoal` says "committee name".
Change it to the domain names, as the Senate hints already do. This is a
publish in opuspopuli-regions, bundled with step 2. It is belt and braces: 1b
is the guard.

**Gate:** on UAT, the Assembly lands the hearings its page lists, with no
manual cache clear.

### 2. Senate source → HTML calendar (D1, D2)

- **Pipeline: date tokens in a source URL.** `{{date:+60d}}` and
  `{{date:-30d}}` (`YYYY-MM-DD`, region timezone) are resolved **at fetch
  only**. Manifests, watermarks and logs keep the **template URL**, so a URL
  that changes daily doesn't mint a new manifest per day. Where the code keys
  anything on `source.url` today, the plan is to keep that key and resolve only
  in the fetch call.
- **opuspopuli-regions:** schema support for the tokens, and the Senate entry
  becomes `html_scrape` on
  `https://www.senate.ca.gov/calendar?startDate={{date:-30d}}&endDate={{date:+60d}}&committeeHearings=1`,
  with hints in domain field names. Publish, then pin the version.
- **The pdf path:** no source uses it after this. It stays, with M2's
  limitations recorded here. Deleting a generic capability is a separate
  decision.

**Gate:** on UAT, the Senate lands the hearings the calendar lists for the
window, and a second sync updates rather than duplicates them.

### 3. Attribution (M4)

- **`meetings`** gains `source_url`, `manifest_id`, `manifest_version`,
  `source_version_id` and the pipeline execution id, copying `minutes`. The
  migration is additive and nullable, via `/op-migration`, with no backfill.
  The next sync stamps rows as it upserts them.
- **`minutes.summary`** gains a skip key (prompt hash and source-text hash,
  the reps pattern), so the 48 unattributed summaries regenerate once under the
  current prompt and are attributed from then on.

### 4. Skip fixes

- **Minutes summaries:** the skip key in step 3 replaces "has a summary".
- **Meetings `html_scrape`:** already skips on the manifest structure hash.
  Measure the LLM calls per sync before and after to confirm.

### 5. Lanes — S6 (CPU lane)

`pdf_archive` text extraction (the minutes PDFs) becomes a queue-fed CPU lane:
the input is a source-version id and the output is stored text. Petition-scan
OCR moves where it runs per `1234-petition-scan-ocr-eval.md` and stays
synchronous for the user. `minutes-summary` is already lane-shaped, so confirm
it runs on the analysis GPU lane and move it if not.

### 6. UAT and gate

There is no meetings eval leg, so the gate is at the row level:

- both chambers land rows (zero today);
- minutes counts unchanged;
- summaries regenerated only where the skip key says so;
- no duplicate meetings across two syncs;
- wall time and LLM calls recorded against step 0.

## Risks

| Risk | Mitigation |
|---|---|
| 1b rejects a manifest that works today, for another type | Dry-run the check over every active manifest before switching it on (1b) |
| The model keeps inventing names, and analysis now fails instead of landing nothing | The failure is visible: logged with the names, plus a failed analysis. Today's state is 0 rows and silence. Retries apply. If it persists, the next lever is the structured-output schema, not a 7th prompt rule |
| A daily-changing URL churns manifests or caches | The key does not churn: the window is resolved at fetch only and `source.url` is the key (step 2). **The structure hash does** (review, 2026-10-31): `extractHtmlSkeleton` keeps every element, so a hearing or day count that changes with the moving window reads as `structure_changed`, roughly a Senate re-analysis and a new manifest version per day. The mechanism predates this plan (the Assembly hits it whenever its count changes). Measured in step 4, with the manifest config axis |
| The Senate calendar markup changes | Same exposure as every `html_scrape` source, with self-heal now working (step 1) |

## Data classification

No new data flow. Public legislative meeting schedules: committee names,
chairs (public officials), times, rooms and agenda links. No personal
information.

## As built: steps 1 and 2 (2026-10-31, UAT)

### What landed

| | Before | After |
|---|---|---|
| Assembly meetings from a sync | 0 (since 2026-07-16) | **5 of 5** listed on the page |
| Senate meetings | 0 (ever) | **7 of 7** listed on the calendar for the window |
| Second sync | — | updates the same rows, no duplicates |

Every time checked against the page: 10/29 10am → `17:00Z`; 10/29 5pm →
`2026-10-30 00:00Z` with id day `2026-10-29`; 11/05 9am (after the DST change)
→ `17:00Z`; Senate Rules 3:30 p.m. → `22:30Z`.

**Model variance, measured:** 4 Assembly analyses in 4 (v13–v16) and 4 Senate
analyses in 4 (v1–v4) produced the same field set, every one meeting the
contract, and every Senate one using `closest`. The samples were taken through
the app's own `pipeline-structural-analysis` queue, one at a time
(`analysis-sample.sh` in the session scratchpad).

### Code

- **Field contract** (`mapping/field-contract.ts`): enforced in
  `StructuralAnalyzerService` (an unusable manifest throws like malformed JSON,
  is never saved) and in `ExtractionValidator` (a cached one heals on next use).
  Dry run over every active manifest in the dev DB: nothing that lands rows
  today is rejected. The only other failure is an orphaned SOS manifest whose
  source is no longer in the config.
- **Wall-clock times.** `DataSourceConfig.timezone`, stamped from the region by
  the declarative plugin. `mapMeeting` reads a `scheduledAt` with no zone in
  that zone, and builds the id from the wall-clock day. A value that carries a
  zone, which is every existing row, is unchanged, so no id churns. The parser
  behind `zonedWallClockToISO` now reads `5pm`, `9 a.m.` and `3:30 p.m.`, and
  refuses a bare hour.
- **`closest` on a field mapping**: read from the item's nearest matching
  ancestor. This is for a value printed once per group, like the date heading
  over a day's hearings. It is the structure that also defeated the PDF path.
- **`dateQueryParams`** (`pipeline/fetch-url.ts`): day offsets resolved at fetch
  time in the source's zone. `source.url` stays the key. The analysis job
  carries the resolved `fetchUrl`, because the worker re-fetches the page and the
  bare URL is the calendar's empty default view.
- `PdfExtractHandler` logs its derived rules at debug.

### Region config (opuspopuli-regions `fix/meetings-chamber-sources`)

- **Assembly hints rewritten.** The old ones described the failure: "extract the
  committee name and the date as their own fields, then join them" (there is no
  join transform; the model obeyed the first half), and "grab each cell and let
  the consumer parse" (so `date` and `time` came out separate). The new ones
  name the fields, compose `scheduledAt` with a `composite` template, and drop
  `externalId`/`body`, which the mapper builds. Example values were taken out:
  every one of them was a real row on the live page, and nemotron copies
  examples (`project_prompt_example_copied_as_answer`).
- **Senate** moved to the calendar, with `dateQueryParams`
  `{ startDate: -30d, endDate: +60d }` (D2). Its first manifest took
  `div.page-events--day-wrapper` (one per day) as the container and kept only
  the first day; a hint now names the container.
- The schema gains `timezone` and `dateQueryParams` on a source.

### Found along the way

- **Every Assembly row ever stored was a day early in Pacific time.**
  `date_parse` dropped the printed time and stored UTC midnight, which is 5 p.m.
  the previous day in California. The 13 existing rows are past hearings, keep
  their ids, and are corrected only if they are re-scraped. Fixing old rows in
  place is not in this plan.
- **A hint edit never re-derives a manifest.** Staleness has prompt and
  structure axes but no config axis, which is the gap civics closed with K1.
  On UAT the edited Senate hints had to be forced through the analysis queue.
  This is step 4's.
- **A `pipeline_jobs` row has been `queued` since 2026-07-15**
  (`a5240300-…`). Anything that waits for "no queued jobs" never returns.
  Step 4 measures whether any app path reads it that way.
- **`time` cells can be empty** ("upon adjournment"). The composite is
  all-or-nothing, so such a hearing gets no `scheduledAt` and is rejected,
  visibly. None of the 12 current hearings has one. Revisit if one appears.

### Review (2026-10-31) and what it changed

Self-review: Rodney Gagnon is the sole author, so this needs a countersign.
Two independent reviewers were run on the step 1–2 diff (`mpb-v1`): one on
correctness, tests and consistency, one on security, data, performance and
types. Fixed:

- **Blocker: a failed heal threw away the run's result.** `analyze()` now
  throws on a contract violation, and `healManifest` did not catch it, so a
  mapping heal on a partial result (say 40%) failed the whole source. Now
  `healManifest` returns undefined, the caller keeps what it has, and a warning
  goes on the result. The remap moved into `remapHealed`.
- **Text after a date that is not a time** ("TBD", "Upon adjournment") had
  become midnight. It is now refused, and the row is rejected visibly. No
  Sonoma row sits at local midnight, so nothing that lands today changes.
- **The id's day depended on the value's form.** A manifest that switched
  between `date_parse` and a composite would file one hearing under two ids.
  Both forms now id by the printed date (`YYYY-MM-DD`). The 13 pre-existing
  Assembly rows embed full timestamps; they are past hearings that the page no
  longer lists, so no duplicate can form.
- **`fetchUrl` from a queue job is checked against the source's page**
  (`assertSamePage`: same origin and path). Before this, a job could point the
  worker anywhere and file the result under the source.
- **Timezones must be real IANA zones** (region and source). A misspelt one
  had silently disabled zoning.
- **A naive time the parser cannot read** becomes `""`, so the schema rejects
  it, instead of falling through to `z.coerce.date()` in UTC.
- **`dateQueryParams` is rejected** on anything but a plain `html_scrape`
  source. A link-discovery hub would pass it to its leaves, and the other
  handlers ignore it.
- Tests: the fetch-vs-key invariant, `performManifestAnalysis` under a
  `fetchUrl`, both heal-failure paths, a null mapping entry, and the
  `closest` miss asserted per field. Each fix was mutation-checked.

Not changed: `safe-regex.ts` is not a ReDoS guard for model-written
patterns; that predates this plan.

**Re-review of the final diff (`mpb-v2`).** A third reviewer read the v1→v2
delta, the overrides and the lockfile. Fixed in `v3`:

- **`executeHtmlScrape` went to cognitive complexity 16** (gate: 15) with the
  heal-failure branches. `healManifest` now always returns a result (the stale
  one, marked `failed`, on a failed re-analysis), so the pre-mapping call site
  is back to its original shape, and Stage 4.5 moved to `healAfterMapping`.
  Checked with `sonarjs/cognitive-complexity` over every changed file: the
  only two functions over 15 are the same two over 15 on `main`
  (`declarative-region-plugin.ts:130` at 19, `deriveSummariesFromDigest` at
  18).
- **`HAS_ZONE_RE` read a naive time range as a UTC offset.**
  `"2026-10-29 9:00-11:00"` ends in `-11:00`, so it skipped zoning and a 9 a.m.
  hearing was stored at 1 p.m. Pacific. The regex is now anchored to a full
  ISO timestamp. A test pins the range, and fails under the old regex.
- The pre-mapping heal-failure test now asserts the stale items are mapped and
  carry the warning.

Recorded, not changed:

- **Day-granular ids.** Two sessions of the same committee on the same day
  (morning and afternoon) share an id and upsert over each other. Day
  granularity is what #815 asks for and what `date_parse` already gave; adding
  the time would instead duplicate a hearing every time it is rescheduled. None
  of the 12 current hearings is affected. Revisit if a same-day pair appears.
- **A failed heal does not mark the stale manifest checked,** so an analyzer
  that keeps failing pays one LLM call per sync. That cost predates this
  change; step 4 measures it with the structure-hash churn.
- **`@smithy/core@3.34.1` is now marked deprecated in the lockfile** ("bug in
  custom logger data redaction", aws-sdk-js-v3#8393). It comes in through the
  storage provider's S3 client and is unrelated to this change. Searched
  `smithy deprecated` and `aws-sdk logger redaction`: not filed.


**Security gate (`/op-security`):** two new HIGH advisories, unrelated to this
change, would have blocked the push: follow-redirects (GHSA-mrwp-f3q8-3g9p)
and joi (GHSA-4528-x5fx-h6hg). The root overrides were raised to `>=1.16.2`
and `>=18.3.1 <19.0.0`. The lockfile diff is 53 lines, including pnpm dropping
a duplicate `serwist` entry keyed to `browserslist@4.29.0` in favour of the
`4.28.8` one already present. The audit now shows no HIGH, and the one
CRITICAL is the suppressed maplibre-gl advisory.
