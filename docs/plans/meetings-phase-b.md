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

### Finding M5 — minutes summaries have had no prompt since 2026-09-13 (found in step 3)

`#1246` (`f7502a98`) removed every inline prompt from this repo.
`document-analysis-minutes-summary` was among them, and it was never seeded in
prompt-service: it is in neither repo's history after that commit. The
prompt-client falls back to `document-analysis-generic` when a
`document-analysis-*` name is missing, so every minutes summary since then was
written from the generic prompt. That prompt asks for `keyPoints` and
`entities`, not `claims`, so those summaries have no claims. Nothing logged an
error.

On UAT, before step 3:

| Summaries | Prompt hash | Claims |
|---|---|---|
| 38 | none (pre-attribution) | yes, from the original template |
| 10 | none (pre-attribution) | no |
| 8 | `0b981bb5…` (= `document-analysis-generic` v1) | no |
| 2 | `d793db60…` | yes |

This is why step 3 cannot ship its skip key alone. The key reads all 58 as
stale. Regenerated under the fallback, the 38 claim-bearing summaries would
lose their claims. Production has run v1.28.0 since 2026-09-16, which includes
`f7502a98`, so its minutes summaries are presumably the same. That is unverified
here: there are no Studio reads in this phase.

**Owner, 2026-10-31:**
- Restore the template in prompt-service, with its literal examples neutralised,
  because nemotron copies a prompt example into its answer.
- Guard the summarizer, so it refuses a prompt that is not its own template.

Searched `minutes summary` and `document-analysis-generic fallback` in both
repos: not filed. #1246 is the closed migration that dropped it. This plan is
the record.

Only `minutes-summary` is affected. Every other `documentType` requested in
this repo has its template, and `unknown` falls back to generic by design.

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
- **Minutes summaries that fail on every attempt** (added after step 3): 5 of
  64 on UAT. Three hit the 4000-token cap again on retry, and two produce JSON
  the shared repair cannot fix. They are always the same documents, they store
  no key, and each sync retries them at about a minute each. Diagnosing them
  needs the raw responses. Those are not logged, because minutes name members
  of the public.

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

## As built: step 3 (2026-10-31, UAT)

### What landed

- **Meetings carry attribution.** Each meeting stores its source's key URL, the
  pipeline run and the manifest version. The Senate rows record the calendar
  URL without its daily window. All 12 current hearings are stamped. The other
  520 rows predate attribution and stay null until they are next scraped.
- **Minutes summaries have a skip key.** It covers prompt, model weights, input
  text and settings: the representatives rule, via `outputCurrency`. It
  replaced "has a summary".
- **The template guard.** The summarizer refuses any prompt that is not
  `document-analysis-minutes-summary`, so finding M5 cannot recur silently.
- **The template.** prompt-service#125 restored it, merged on 2026-10-31.
- **The output cap is 4000 tokens, up from 2000** (owner, 2026-10-31). At 2000,
  7 of 37 summaries were cut off mid-JSON. It is exposed as
  `MINUTES_SUMMARY_MAX_TOKENS`, documented in `.env.example`, and set on
  region and region-worker in the UAT compose file.
- **Node repos.** opuspopuli-node-us-ca#45 and opuspopuli-node#65 (both
  merged) expose the cap the same way. They also give the four background LLM
  services the 600s request timeout that UAT already had. Production ran them
  on the provider's 60s default, and one summary took 66s at the old cap.
  `documents` and `knowledge` keep 60s. create-op-node needed no change: it
  creates nodes from the template and manages only model keys.

### Not as planned

- **No `source_version_id` on meetings.** Meetings come from list pages, and
  list pages are not archived, so the column would always be null. Adding it
  is additive once they are.
- **Selection covers every active minutes row, not only the rows a sync
  wrote.** The archive ingest skips PDFs it has already seen, so a summary
  that goes stale under a new prompt would otherwise wait for its PDF to
  change. The representatives generators also select over every candidate,
  but they cap the selection and this does not. The key covers the text, so
  every row's `rawText` is read, in pages of 50 so memory does not grow with
  the corpus. The phase also runs when discovery finds no new PDFs. Before,
  it returned early. A failed selection warns and does not fail the sync, as
  the representatives `selectSafely` does. Unlike that rule, it falls back to
  queueing the rows this sync wrote, because each job re-checks currency.
- **Summary jobs are not retained.** BullMQ keeps finished jobs for a week. A
  summary that reported `failed` kept its skip-key id, so the next sync's
  retry was dropped as a duplicate. This was measured on UAT: the 12 failed
  rows were not requeued. With `removeOnFinish`, the id collapses only work
  still in flight, which is what the GPU-lane batches already do. The bare
  row id the key replaced had the same flaw. Failed jobs go too, so there is
  no 30-day failed-job history for this queue. The outcome is in the worker
  log and on the row (no key).
- **The guard refuses the fallback, not "a different hash".** An A/B variant
  is served under its own hash, while `getPromptHash` reports the canonical
  template's. Exact equality would have refused every variant-bucketed
  summary. The guard refuses when the template is not found, when the served
  hash is the generic template's, or when the generic hash cannot be looked
  up: then a variant and the fallback look alike, so it fails closed.
- **Failure logs carry no model or document text.** V8's "Unexpected token"
  parse message quotes about 20 characters of its input, which here is the
  minutes quoted verbatim. A Prisma validation error prints the write's
  arguments, including the summary. The parse logs now give the position
  where V8 reports one, and "an unknown position" where it does not. The
  write-failure log gives the error's name and code. Found in review. The
  parse `debug` line on main logged the message too.
- **The prompt-client cached a fallback under the name asked for.** In DB
  mode, the first fallback to `document-analysis-generic` was cached as
  `document-analysis-minutes-summary`. Every later `getPromptHash` for the
  minutes template then returned the generic hash, which defeats the guard.
  The template is now cached under the name of the row found. Found in
  re-review.
- **Ceiling and repair logging.** The summarizer now warns when output hits
  the cap. It also parses through the shared JSON repair that civics uses.
  The repair has not yet fired on minutes. The two parse failures that
  recurred were neither of the classes it repairs.
- **`summarizeMissing` is removed.** It had no callers, and it still encoded
  the old rule. So are `MINUTES_SUMMARY_CONCURRENCY` and
  `MINUTES_SUMMARY_MAX_ROWS`, which only it read and nothing sets.

### Recorded, not changed

- **A/B variants read as stale on every sync, for every generator.**
  `outputCurrency` compares the stored prompt hash, which is the variant's,
  against `getPromptHash`, which is canonical. Any output served under an
  experiment is regenerated on every sync. That covers bios, committee and
  activity summaries, and now minutes. It predates this step, and no
  experiment runs on these templates today. The fix belongs to the shared key
  (compare against the variant the row was assigned), not to one generator.

### Migration

`20261031120000_meetings_phase_b_attribution`, additive and nullable:

- `meetings` gains `source_url`, `pipeline_execution_id` (indexed, FK
  SET NULL), `manifest_id` (FK SET NULL) and `manifest_version`.
- `minutes` gains `summary_source_hash` and `summary_config_hash`.

Applied locally with `prisma migrate deploy`. `migrate diff` shows no drift on
either table. Neither table has RLS, and no column holds personal data.

### UAT measurements

| Run | Queued | Written | Failed | Notes |
|---|---|---|---|---|
| Restored prompt, cap 2000, rows from one ingest | 12 | 8 | 4 | All 4 cut off. Found the selection gap |
| Restored prompt, cap 2000, every active row | 37 | 30 | 7 | All 7 at the ceiling |
| Cap 4000, every active row | 63 | 52 | 12 | 6 cut off at 4000, 6 invalid JSON |
| Next sync | 0 | — | — | 52 current rows skipped, 12 failed rows dropped (retention) |
| After `removeOnFinish` | 12 | 7 | 5 | Exactly the failed rows. Repair fired 0 times |
| Review fixes | 5 | 2 | 3 | Only the failing rows |
| Re-review fixes (final code) | 3 | 0 | 3 | Only the failing rows, all at the 4000 ceiling |

End state:
- 61 of 63 summaries are on the restored template (`0f11dfcf`), every one
  keyed, and 60 carry claims.
- One summary is still from before attribution, and one is from the generic
  prompt. Both are among the documents that keep failing. Three documents
  still hit the 4000 ceiling on every attempt.
- No claim copies a removed example value. The one regex hit was `SB-569`, a
  real bill.
- No guard refusals and no timeouts.

Meetings themselves were unchanged across every sync: 12 hearings (5
Assembly, 7 Senate), 0 created and 12 updated each time.

### Checks

- **Tests:** backend 3650, scraping-pipeline 683, including the new tests.
- **Mutation-checked:** each guard and fix was removed in turn, and a test
  failed every time:
  - the template guard;
  - the "has a summary" skip;
  - the bare job id;
  - `sourceUrl` stamping;
  - the attribution spread;
  - the empty-ingest summarize phase;
  - upserted-only selection;
  - the ceiling warning;
  - the JSON repair.
- **Static checks:** type-check is clean. The complexity gate is clean on
  every changed file, with a control check against
  `deriveSummariesFromDigest` at 18.

### Review of step 3 (2026-10-31) and what it changed

`/op-review` ran three independent lenses on the final diff (`mpb3-v1`):
correctness and consistency; security and regulated data; tests, typing and
performance. This is a self-review: Rodney Gagnon is the only human author,
so it needs a countersign. There were no blockers. Every suggestion was fixed:

- **Security:**
  - The repair `warn` logged the `JSON.parse` message, which can echo a
    public commenter's words.
  - Both parse logs now give the position only. A test fails if the quoted
    text reaches the log.
- **Correctness:**
  - A selection failure failed the whole sync. It is now wrapped, as
    `selectSafely` is, and falls back to this sync's rows.
  - The guard's exact-hash check would have refused every A/B variant. It now
    detects the fallback itself.
- **Performance:** selection read every `rawText` at once. It now reads pages
  of 50.
- **Tests:**
  - The processor spec still asserted the old boolean contract.
  - Added:
    - legacy stamping through `selectStale`;
    - the key moving with the template;
    - paging;
    - `undefined` when the summarizer is unconfigured, with the sync falling
      back to the upserted rows;
    - `removeOnFinish` on the force path.
- **Nitpicks taken:**
  - one temperature constant for the key and the call;
  - an explicit return type on `meetingAttribution`;
  - a comment on force jobs running beside keyed jobs.
- **Nitpicks left:**
  - `rollback.sql` versus `down.sql`: both conventions are in use.
  - `formatMinutes` runs twice per job: it is deterministic.

Each new behaviour was mutation-checked, and a test failed every time:
- the fallback-only guard;
- the selection wrap;
- the paging cursor;
- the unconfigured `undefined`;
- the no-leak log.

**Re-review (on `mpb3-v1-v2`, the fixes above).** No blockers. Each
suggestion was fixed, and each fix was mutation-checked:

- **Prompt-client DB cache.** A fallback was cached under the requested name,
  so `getPromptHash` reported the generic hash as the minutes template's and
  the guard passed it. It is now cached under the found row's name. A test
  is added in `prompt-client.service.spec.ts`.
- **Guard failed open** when the generic hash lookup failed. It now refuses.
- **Write-failure log** printed Prisma's message, which can quote the
  summary. It now logs the error's name and code.
- **Selection failure** dropped every pending row. It now falls back to this
  sync's rows.
- **Paging** used Prisma's `cursor`, which ends early on a deleted cursor row.
  It now uses `id > cursor`.

- **`mirrorClaims`**, shared by every generator, logged Prisma messages at
  `error`: the same leak. It now uses the same `errorKind` helper, moved to
  `llm-generator.base.ts`.

Nitpicks left, both predating this change:
- the 60s cache of a failed hash lookup;
- a window of up to 5 minutes after a generic-template edit.


## Plan: step 4 (2026-11-01)

Measured on UAT before any change (`meet-e0`, the first sync after midnight):

- **The structure hash churns daily, and every churn is a new, unchecked
  manifest.** Both chambers read `structure_changed` and queued a GPU
  re-analysis. The Assembly's took 29 s and wrote v17. No two of the 17
  Assembly versions, or of the 4 Senate versions, have identical extraction
  rules, so each re-analysis swaps in rules generated afresh. The cause is in
  `extractHtmlSkeleton`: it keeps one subtree per repeated element, so a page
  with one more hearing, or one more day in the window, hashes differently.
  The Senate skeleton for adjacent windows differs by exactly one
  `page-events--day-wrapper` block.
- **The three documents at the ceiling are not the long ones.** They are
  21 k, 55 k and 107 k characters, while the five longest rows (262 k, the
  text cap) summarize fine. They run out of output, not input. Whether that
  is a long, legitimate claim list or a repetition loop cannot be told from
  the current logs, and the response itself must not be logged (§3).
- **Nothing waits on the stuck job row.** `a5240300` is a parentless `cron`
  row, `queued` since 2026-07-15 with no BullMQ job behind it. Every reader
  of open rows is scoped to a parent (`cancelChildren`, `settleParent`), and
  the jobs list shows only the most recent rows. It is harmless, but its
  status is wrong and nothing will ever correct it: the startup sweep only
  fails stale `running` rows.
- **A max-tokens mismatch between region and region-worker costs no-op jobs,
  not regenerations.** The pre-push gate on #1422 said a mismatch would
  regenerate the corpus daily. It would not: the worker re-assesses each row
  against its own config before calling the model, so the jobs region queues
  in error end `unchanged`. The real cost is one no-op job per row per sync,
  plus a one-time regeneration of any legacy rows region stamped with its
  own value. That is still silent, so it is still worth surfacing.

### 4a. Structure hash ignores repetition

The skeleton keeps each element's **distinct** child skeletons, in first-seen
order, instead of every child. One more hearing or day adds nothing new; a
renamed class or a new kind of block still changes the hash.

Prototyped against the live pages: over 15 consecutive Senate windows, the
current hash takes 2 values and the proposed hash 1. The Assembly also
differed from yesterday's stored hash under the current algorithm.

**Cost:** every stored hash changes, so each of the 13 active manifests
(propositions 8, meetings 3, representatives 1, campaign finance 1) reads
`structure_changed` once and re-derives, about 30 s of GPU each. **D4** below.

### 4b. Manifest config axis

`structural_manifests` gains `config_hash`: a hash of the data-source fields
that shape the derivation (`contentGoal`, `hints`, `category`, `dataType`).
`ManifestComparator` adds `config_changed`. A manifest with no config hash
(every one today) is stamped with the current one on its next use, not
re-derived, as the output keys treat legacy rows. Additive migration via
`/op-migration`. This closes "a hint edit never re-derives a manifest" from
steps 1–2.

### 4c. Ceiling documents

1. **Diagnose without the text.** On a refusal, log shape only: response
   characters, the number of claims parsed so far where the JSON is partial,
   and the share of repeated lines. That separates a long claim list from a
   loop with no document text in the log.
2. **Stop retrying the same failure.** **D5** below.

### 4d. Max-tokens mismatch visible

Both services log the effective minutes-summary config at startup. When a job
that selection queued as stale ends `unchanged` in the worker, the worker
warns once per run that the two disagree, naming the setting.

### 4e. Prompt-client negative cache

A missing template name is cached as missing, for the same TTL as a hit, so
`document-analysis-unknown` → generic does not query the DB, or count a
fallback, on every call.

### 4f. Bounded selection

`selectStale` takes a cap (`MINUTES_SUMMARY_SELECT_MAX`), as the
representatives selectors do, and logs when it is hit. The default is above
today's corpus (64 rows), so nothing changes now.

### 4g. Orphaned queued rows

The startup sweep also fails `queued` rows older than a day whose BullMQ job
no longer exists, with a reason saying so. That clears `a5240300` and any
future orphan.

### Measure

LLM calls per meetings sync, before and after, on two consecutive days: the
gate is 0 structural analyses on a day when only the counts changed.

### Owner decisions for step 4

| | Decision | Suggestion |
|---|---|---|
| **D4** | Accept a one-time re-derivation of all 13 manifests when the hash algorithm changes | **Yes.** About 7 minutes of GPU, once. The alternative, keeping both algorithms and accepting either hash, carries the old churn forward until each source changes |
| **D5** | A document that fails under the same skip key | **Record the failed key and skip it** until the key changes (prompt, model, text or config), with the failure counted in the sync log. Today each of the 3 costs about a minute of GPU per sync, forever. Needs one more additive column on `minutes` |

**Owner, 2026-11-01: D4 accept the one-time re-derivation; D5 record the failed key and skip until it changes.** Both as suggested.

## As built: step 4 (2026-11-01, UAT)

### What landed

- **4a. Repetition-tolerant structure hash.** `extractHtmlSkeleton` keeps
  each element's distinct child skeletons, in first-seen order. As D4
  expected, the first sync after deploying re-derived both chambers once
  (Assembly v18, Senate v6). Every sync after that, six of them, hit the
  cache: 0 structural analyses.
- **4b. Manifest config axis.** `structural_manifests.config_hash` is
  `manifestConfigHash(source)`: `dataType`, `contentGoal`, `category` and
  `hints`, the source fields the analysis prompt is given. A test pins that
  list against the prompt call. Absent and empty hash alike, because the
  analysis worker defaults `contentGoal` to `""` and the pipeline passes the
  source's own value. `ManifestComparator` reports `config_changed` only when
  structure and prompt both match, so existing reasons keep their meaning. A
  manifest without a hash is stamped with the current one on use, not
  re-derived. The stamp is best-effort: a failed write is logged and retried
  on the next use, and the extraction goes ahead from the cache. Both
  re-derived manifests carry a config hash.
- **4c. Ceiling documents.**
  - **Shape-only diagnostics** on every refusal: characters, claims begun,
    distinct titles, repeated lines. The parse-failure lines move from `debug`
    to `warn`, because a refusal at `debug` is invisible in production (#1085).
    For 09-25 they read `chars=18511 claims=25 distinctTitles=25/25`: a long
    and legitimate claim list, not a loop. The 95 repeated lines of 176 are
    JSON punctuation.
  - **D5, as revisited.** A model-output refusal records its skip key in
    `summary_failed_key` and counts it in `summary_failed_attempts`. A row is
    not retried once its key has failed 3 times. Any axis moving gives a new
    key, which starts again at one, and a successful write clears both
    columns. Transient failures are not recorded: the LLM call, the write, or
    the prompt guard. Selection books skipped rows to the phase totals as
    `summary_current` and `summary_failed_same_key`. The count is written
    conditionally on the stored key, not on the key read at job start: a
    forced job can fail beside a keyed one, and a write chosen from a stale
    read would lose one of the two failures. The claim of a row for a new key
    names `NULL` explicitly, because `summary_failed_key <> $1` is never true
    for `NULL`. The integration suite shows that on `postgres_test`.
  - **A repetition abort counts as a model-output refusal.** Ollama stops a
    generation that loops with an HTTP 500, "token repeat limit reached".
    The provider surfaces that as a thrown `LLMError`, which was first
    classified as transient and retried every sync without being counted.
    It now records the key like any other refusal. Found in `meet-h1` on 08-14.
  - **The cap moves to 8000** (owner, 2026-11-01). It is set in the code
    default, the UAT compose file, `.env.example`, and both node repos
    (opuspopuli-node-us-ca#46, opuspopuli-node#66). Regenerating every
    summary at 8000 hit the ceiling 0 times. 09-25, which never fitted in
    4000, came out with 36 claims.
- **4d. Config mismatch is reported.** Both services log the effective
  summary config at startup. Each job carries the config hash its selection
  ran under (`selectedUnderConfigHash`), and the worker warns once per
  mismatched pair, naming `MINUTES_SUMMARY_MAX_TOKENS`.
- **4e. Prompt-client remembers missing names.** In DB mode, a name found
  missing is remembered for the cache TTL. A repeat fallback is then served
  from the cache without querying the name again. The record is used only
  when a fallback is asked for, so `getPromptHash` on a missing name still
  reports it missing. `clearCache` clears it.
- **4g. Orphaned `queued` rows.** On startup the worker also fails `queued`
  rows older than a day whose BullMQ job will never run them: gone, or
  finished but retained (failed jobs are kept 30 days). This runs in its
  own try block, so a failure in it skips neither the running sweep nor the
  parent settle. On first boot, under the gone-only rule, it failed exactly
  `a5240300`, and no `queued` rows remain. The finished-state arm came from
  review and is unit-tested only: UAT had no such row left to find. It
  catches a real case: a second boot on the same day reuses
  `startup-<yyyymmdd>`, and BullMQ drops that add while the first job is
  retained as completed.

### Not as planned

- **4f was not built, and it is not a cap.** A cap limits how many jobs are
  queued, but the cost the review gate flagged is the read: every row's text,
  every sync. I built a SQL prefilter instead: this sync's written rows, plus
  rows whose stored prompt, model or config is missing or differs. Then I
  reverted it. The filter cannot see a row whose text changed in an earlier
  sync and whose regeneration then failed transiently, which records no key;
  such a row would never be selected again. A correct bounded selection needs
  a stored hash of the text. That is recorded here, not built; the full walk
  costs milliseconds at 64 rows. A regression test asserts that the walk
  carries no filter.
  - *When it has to be built.* A page is 50 rows, and a row's text is capped
    at 256 KiB, so a page can read 12.8 MB. The cost grows with the corpus:
    64 active rows span 2026-02-06 to 2026-10-23 for California. Build the
    text hash before a second region's minutes land, or once a sync's
    selection phase passes a second, whichever comes first.
  - *A misreading, corrected.* At first I took `meet-f1` as UAT showing this
    gap. 04-21 and 10-02 were not queued there, and I attributed that to the
    filter. In fact both had been summarized that morning by `meet-e0`'s jobs,
    so they were simply current. The gap is real by reasoning, not by
    measurement.
- **D5 went from one attempt to three.** 04-21 and 10-02 hit the 4000 ceiling
  on every step 3 attempt, then fitted on the morning's attempt under the same
  key. At temperature 0.2, output length varies from run to run, so a single
  failure is not a verdict. Owner, 2026-11-01: up to 3 attempts per key. This
  needed a second migration, because the first was already applied locally.
- **The node repos never passed the context window to a container.** Found
  while checking that 8000 tokens fit. #44 documented `LLM_CONTEXT_TOKENS` in
  the `.env` examples, but `x-llm-env` named none of the three variables, so a
  production node sent no `num_ctx`. On a GGUF build, that reads 16,386 tokens
  of a long input. The Studio's own Ollama settings were not checked. Fixed in
  the same node PRs (owner, 2026-11-01); opuspopuli-node also gains the
  documentation it never got.

### Migrations

- **`20261101120000_meetings_phase_b_skip_fixes`:** adds
  `structural_manifests.config_hash VARCHAR(64)` and
  `minutes.summary_failed_key VARCHAR(80)`.
- **`20261101130000_minutes_summary_failed_attempts`:** adds
  `minutes.summary_failed_attempts INTEGER NOT NULL DEFAULT 0`.

Both are additive and need no backfill. They were applied locally with
`prisma migrate deploy` and run on `postgres_test` by the integration suite.
`migrate diff` shows no drift. No column holds personal data.

### UAT measurements

| Sync | Manifest analyses | Summaries queued | Skipped | Notes |
|---|---|---|---|---|
| `meet-e0` (main, first after midnight) | 2 | 3 | — | Both chambers `structure_changed`; v17 had different rules from v16 |
| `meet-f1` (deploy, D4) | 2 | 1 | — | One-time re-derive; 09-25 failed and its key was recorded |
| `meet-f2` | 0 | 0 | 63 current, 1 failed key | One attempt per key, as first built |
| `meet-g1`–`g3` (3 attempts) | 0 | 1 each | 63 current | 09-25 attempts 1 → 2 → 3 |
| `meet-g4` | 0 | 0 | 63 current, 1 failed key | Skipped at 3 attempts |
| `meet-h1` (cap 8000, config axis moves) | 0 | 64 | — | 58 updated, 1 created (09-25), 5 failed, 0 ceiling hits |
| `meet-h2` (repetition-abort fix) | 0 | 5 | 59 current | All 5 written on the second attempt |
| `meet-i1` (review fixes) | 0 | 0 | 64 current | Healthy boot; no `queued` pipeline_jobs rows |

Before the hash change, the current algorithm took 2 values over 15
consecutive Senate windows; the repetition-tolerant one took 1.

In `meet-h1`, 05-05, 06-03, 06-30 and 08-11 returned JSON that the repair
could not parse, though the diagnostics show nothing pathological (every
claim title distinct). 08-14 was a repetition abort. All five wrote at their
next attempt under the same key. That is run-to-run variance, which is why
D5 allows 3 attempts. The repetition-abort path is covered by a unit test,
because 08-14 did not loop again in UAT.

### Observed, not fixed here

- **Two summaries have no claims.** 02-06 and 10-05 are both at the 256 KiB
  text cap and write a short summary with 0 claims. The model is shown the
  first 60,000 characters. Whether that window holds only procedural matter
  has not been checked, because reading it means reading minutes that name
  members of the public. This belongs to the input window, not to step 4.

### Kept as built, against a review suggestion

- **First-seen sibling order stays in the structure hash.** The review
  pointed out that a window starting on a different kind of row (a day with
  no hearings, then a day with them) changes the order of distinct siblings
  and so the hash. Sorting them would remove that, but it would also hide a
  real reorder, which can break a sibling selector, and it would re-derive
  all 13 manifests again. Measured first: over 15 consecutive Senate windows
  on 2026-11-01, plus the Assembly daily file, first-seen order took 1 value
  per page, the same as sorted order. A test now pins first-seen order. If a
  page is ever seen re-deriving on order alone, sort then.

### Fixed in passing

- **The worker's per-job outcome line named the row's UUID.** The job data
  has always had an `externalId` field, but the sync never filled it.
  `OutputTarget` now carries an optional `externalId`, minutes selection sets
  it, and the enqueue passes it on. Jobs queued by the selection-failure
  fallback still log the UUID: that path has only the ids this sync wrote. This predates step 4; it was found
  because the UAT scripts grep the outcome lines.
- **The selection-failure warn printed the error's message.** It now prints
  `errorKind`, as every other catch on the minutes path does. Its message is
  safe today, but a Prisma validation error prints its call's arguments.
- **The comment in `20261101120000`'s SQL describes D5 as one attempt.** It
  was applied locally before the change to three, and editing an applied
  migration changes its checksum, so the comment stands and this note
  supersedes it.

### Checks

- **Tests:**
  - scraping-pipeline 702, prompt-client 125, queue-provider 63, common 274,
    backend 3674;
  - the minutes-summary integration spec on `postgres_test`, 3 tests. It had to move
    to the outcome contract: #1422's CI failed on it, and the fix went in on
    the branch before merge.
- **Mutation-checked:** each change was undone in turn, and a test failed
  every time:
  - the sibling collapse;
  - the config comparison, the legacy stamp, the absent-equals-empty
    normalisation, and the analyzer's stamp;
  - the failed-key match, refusal-only recording, the clear on success, the
    selection skip, the attempts threshold, the increment, and the attempts
    reset;
  - the conditional failure count's retry, and both arms of its claim, `NULL`
    and a different key (each in the unit fake and on `postgres_test`);
  - the negative-cache hit, and its TTL;
  - the mismatch warning and its once-per-pair rule;
  - the orphan sweep's existence check, its finished-state check, and its
    parent settle;
  - the best-effort legacy stamp;
  - the `externalId` carried into job data, and the selection warn's
    `errorKind`.
- **Static checks:** lint and `lint:sonar` are clean (one nested template
  literal fixed). jscpd finds no new clones; the two it reports are in
  unchanged code.

### Review

`/op-review` ran on the final diff (`step4-v2.diff`) as three independent
lenses: correctness and test coverage; security and regulated data;
performance, types and consistency. It found no blockers. Every suggestion
was fixed except the sibling order, kept above with its reason. The
nitpicks were fixed too, except two: folding the two migrations, which
would need a local `migrate reset`, and extracting from `summarize()`, which
`lint:sonar` passes. A first cut of the diff was taken against a stale local
`main` and included #1422; the lenses were rescoped to the true diff.
A fresh re-review of the fix round (`step4-v3.diff` and the v2→v3
interdiff) found no blockers. Its findings were fixed: the unit fake now
evaluates each `OR` arm as SQL does, and the integration test covers a
moving key. The orphan sweep's wording and constant comment now cover
finished jobs. This record states what UAT did and did not exercise.
`/op-security`: no dependency changes; the only CRITICAL is the frontend's
suppressed `maplibre-gl` CVE (`.trivyignore.yaml`); gitleaks clean.
This is a self-review: the author and the reviewer are the same, so it needs
a countersign.
