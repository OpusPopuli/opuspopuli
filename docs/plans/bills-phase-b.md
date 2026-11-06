# Phase B — bills

Bills is the last data type in the owner's order (`ingestion-resource-lanes.md`
§10.2, owner decision 2026-10-23), and the one with the most findings and the
longest run (~48h uncapped, weekend-only). F2 (#1399) and F4 (#1400) have
already shipped. This plan covers what is left, starting from what the code
does today rather than from what §4–§5 of the lanes plan say, because they were
written before #1399–#1403 moved things.

| | |
|---|---|
| **Plan items** | K3, K5, K6, F3, §5.1 open items, S3, S4 (bill summaries), §5.2 lazy path |
| **New findings** | B1–B6 below |
| **Data classification** | Public civic records only. Bills, votes, co-authors and committee assignments are about public officials acting in office (public-figure data, `feedback_public_figure_pii_not_redacted`). The lazy-summary mutation (§5.2) records a bill id and the caller's session, nothing else. No CCPA personal information enters any new column |
| **Federation** | Additive only: `summaryStatus`, `requestBillSummary` (step 5). Checked at the gateway |

## What is true today (read 2026-11-05, HEAD 69f06c88)

All bills code still lives in `region-sync.service.ts` (3,308 lines; "RSS"
below). `syncBills` (RSS:1318) runs the phases in `BILL_SYNC_PHASES`
(`sync-phase-logger.ts:47`): `discover` → `extract_and_upsert` (serial, one bill
at a time) → `votes_only` → `stage_backfill` (+ F4 lifecycle refresh) →
`prune_stale` (F2) → `summarize`.

Local dev DB (last bills sync 2026-07-16): 5,019 bills; 2,698 active, 1,002
dead, 1,319 passed. 2,121 would be cold at a 180-day window. 459,826 vote rows.
602 bills have no summary, 481 of them active.

### Finding B1 — a status change without new text is never stored

`tryStatusOnlyRecheck` (RSS:2716) fetches every existing bill's status page and
regex-parses `lastAction` / `lastActionDate`. If either changed it returns
`fall-through`, "defer to LLM for authoritative update". But the extraction
path then calls `checkBillSkipCondition` (RSS:2596, called at :2821), which
fetches the **text** page and returns `'skipped'` — **no write** — when its
"Date Published" equals the stored `sourcePublishedAt`.

So a status change that does not come with a republished text — a committee
referral, a floor vote, a veto, "Approved by the Governor" — is detected, then
dropped. The bill keeps its old `status` / `lastAction` / `lastActionDate`,
and since F4 those decide `isActive` / `isDead`, i.e. whether the bill is in
the personalized feed. A vetoed bill stays active. This is the drift #819 said
it closed; the two checks were each correct alone and wrong in sequence.

The weekly `statusScanCadence` job (`forceStatusRecheck: true`,
`region-sync.scheduler.ts:122-136`) skips the status fetch and falls through to
the same text-page skip. So the lanes plan's K5 premise — "every bill through
the 8,000-token LLM extraction every week" — is **wrong while `textPageTemplate`
is set**, which it is for California. The weekly cost is a full fetch of every
status page and text page; the LLM runs only where text was republished. The
regions schema text for `statusScanCadence` (region-plugin.schema.json:363-366)
says the force run bypasses the `sourcePublishedAt` skip; it does not.

No test covers the combination. Magnitude on real data is unmeasured: step 0
counts how many bills' status pages differ from the stored row.

### Finding B2 — row provenance is read from the model's JSON

The extraction upsert spreads `...rowProvenance(raw)` (RSS:2926), where `raw`
is the parsed LLM response (`parseBillJson`, RSS:2853). `pipelineExecutionId`,
`manifestId` and `manifestVersion` are therefore whatever keys the model chose
to emit — in practice none: **0 of 5,019 dev bills** have any of them. Bills
is also the only LLM type `syncDataTypeFrom` (RSS:1044) passes no
`pipelineJobId` or `archiveOptions` to (compare RSS:1033-1042), so there is no
run id to write even if the spread were fixed. A model that did emit a
`pipelineExecutionId` would fail the FK and lose the bill.

### Finding B3 — the "status page" columns are an LLM read

F4's owner decision (2026-10-22) made extraction and the status-only re-check
the only writers of `status` / `lastAction` / `lastActionDate`, on the grounds
that they read the official status page. Extraction does read that page, but
it writes the three columns from the LLM's answer (RSS:2898-2902), and its
`currentStageId` is `raw.currentStageId ?? resolveStageFromStatus(...)`
(RSS:2875) with no taxonomy check — the open item §5.1 carried here. Both
are the channels F4 closed on the summary pass, still open on extraction. The
regex parse `extractBillStatusFields` (RSS:2655) already reads `lastAction` /
`lastActionDate` deterministically.

### Finding B4 — votes are extracted twice and re-extracted every run (K3)

- Discovery builds a votes URL for every discovered bill (RSS:2513).
  `runVotesPhase` (RSS:2136) fetches each and always runs the votes prompt
  (RSS:3001) — no hash, no skip.
- Extraction **also** links votes from the metadata prompt
  (`linkBillVotes(bill.id, raw.votes ?? [])`, RSS:2941); the votes phase then
  deletes and rewrites them.
- `linkBillVotes` (RSS:3209) is `deleteMany` + `createMany` with no
  transaction: a crash between the two leaves a bill with no votes.
- The raw extraction is not persisted, so re-linking a vote to a
  representative who appears later needs the model again, although
  `BillVote.representativeName` is stored.

### Finding B5 — attribution gaps (F3 and more)

- Extraction (RSS:2834) and votes (RSS:3001) keep only `promptText`. `Bill`
  has no extraction prompt/model/digest columns; `BillVote`, `BillCoAuthor`
  and `BillCommitteeAssignment` have no provenance columns at all.
- The summary set has `aiSummaryPromptHash` / `Version` / `LlmModel` but no
  `aiSummaryLlmDigest`, unlike reps and committees (`*LlmDigest`). **No dev
  bill has an `aiSummaryPromptHash`** (0 of 4,417 summaries): every summary
  predates the columns. A K6 skip keyed on the hash would regenerate all of
  them (D5).
- Bill pages are not archived (`fetchUrlText`, RSS:3281, is a plain throttled
  fetch), so there is no `sourceVersionId` to point at.

### Finding B6 — no cancellation, no resume

There is no `isCancelled` check anywhere in the bills path, so a cancelled
bills job runs to the end. Five consecutive failures abort the sync
(`SyncAbortedError`) and every later phase is lost; a rerun starts at
discovery. #1037 (no watermark) is still open. With B1 fixed and K3/K5 in, a
rerun of unchanged bills costs fetches only, which may make a watermark
unnecessary — step 6 measures that before #1037 is built.

### What already works

- F2 prune scope + deletion guard (#1399); F4 lifecycle writer and per-sync
  date refresh (#1400).
- The summary pass validates its stage against the taxonomy and against the
  official status (`validateStageId`, `officialStatusAllows`, RSS:2400-2468),
  and records its prompt hash and version.
- LLM calls already go through S7's per-endpoint queue (`withLaneQueue`,
  `GPU_LANE_QUEUE_ENABLED`) — transparently; bills has no per-item job id or
  skip key.

### Not in scope, flagged

- **The session flip.** The California config hard-codes session `20252026`.
  The 2027–28 session convenes in early December 2026; its bills are not
  discovered until regions changes the source. F2 makes the flip safe; it
  does not make it happen. A regions config change, separate from this plan.
- **No bills-extraction eval leg** (`packages/eval-harness` has none). §10.2
  makes it a precondition for moving extraction to a different *model*, not
  for S3, which keeps the model (D6).

### Issue search (2026-11-05)

Open issues matching "bill": #1037 (watermark, B6), #903 (votes 503 under
load — K3 reduces the load), #831 (bills extraction refactor; S3 overlaps it),
#882 (`manifest_ready` ignores caps), #776 (caps input). None covers B1–B5.
This plan is the record for them.

## Owner decisions

**Decided 2026-11-05: all as suggested.**

| # | Decision | Decided |
|---|---|---|
| D1 | `coldAfterDays` default (regions field) | 180 days |
| D2 | Dead bills go cold immediately | Yes |
| D3 | B1 fix: a status change without new text | Write the regex-parsed status fields through `writeBillLifecycleFields`, no LLM. Extraction runs only when the text changed |
| D4 | B3: who writes the status columns on extraction | The regex parse wins where it parses; the LLM's value only where it does not. Extraction's stage goes through the same taxonomy + official-status check as the summary pass |
| D5 | The 4,417 summaries with no prompt hash | Treat a null hash as stale for **hot** bills only, regenerated under a per-sync cap; cold bills regenerate on read (§5.2) |
| D6 | Eval leg for bill extraction | Not in this phase. S3 moves extraction off the fetch loop on the same model; the leg is built before Phase C changes the lane's model |
| D7 | Lazy path (§5.2): caps, anonymous button | Its own PR after steps 1–4. Button for anonymous viewers; global 200/day, per session 10 |
| D8 | Baseline | A capped run (`maxBills` 250, ~3h) on UAT now, plus a full run the weekend before the gate |

## Steps (re-planned 2026-11-06 for D9)

The steps below replace the page-scrape plan. The findings above stay as the
record of why, and still apply to any region that has no bulk source.

### The source, measured (`pubinfo_daily_Thu.zip`, 2026-11-05)

1.1 GB zipped, ~2 GB unzipped, current session only. Every table has one
record per line and a constant field count, so the existing line parser
holds once it understands backtick quoting.

| Table | Rows | Feeds |
|---|---|---|
| `BILL_TBL` | 5,065 | `bills`: status, measure, chapter, location |
| `BILL_VERSION_TBL` (+ 666 MB `.lob` text) | 19,437 | title (`subject`), fiscal flags, the text the summary reads |
| `BILL_VERSION_AUTHORS_TBL` | 106,793 | author, co-authors |
| `BILL_HISTORY_TBL` | 88,995 | `lastAction`, `lastActionDate`, committee referrals |
| `BILL_SUMMARY_VOTE_TBL` / `BILL_MOTION_TBL` | 21,541 / 107,196 | roll calls, motion text |
| `BILL_DETAIL_VOTE_TBL` | 610,499 | `bill_votes` |
| `LEGISLATOR_TBL` | 124 | legislator name → representative |

`current_status` values: Chaptered 2,254, In Committee Process 1,175, Died
788, Passed 268, Vetoed 212, In Floor Process 206, Pending Referral 140,
Failed Passage in Committee 12, Failed 6, In Desk Process 3, NULL 1.
`measure_state` ("Introduced", "Amended Assembly", "Enrolled", …) is the
vocabulary of B8's corrupt `status` strings.

### Design decisions (Claude, under owner delegation 2026-11-06; revisit at review)

| # | Decision | Why |
|---|---|---|
| D10 | Import each table into a **mirror table** (`pubinfo_*`, one row per source line, keyed as the source keys it), then **derive** `bills`, `bill_co_authors`, `bill_votes` from the mirrors in code | A bill joins six tables, but the bulk path maps one table at a time. Mirrors keep K4's per-line skip and the line hash (#1277), and the derive step runs only for bills whose mirror lines changed |
| D11 | The lifecycle comes from `current_status` through a **status → lifecycle map in region config**, not from "Active Bill - …" regexes | Config-only regions. The regexes stay for regions without a structured status |
| D12 | Store only the **latest version's** text (`latest_bill_version_id`) | The summary reads that one. All versions would be 666 MB with nothing reading them |
| D13 | Committee referrals derive from history actions in a later step; existing rows are left alone | Not needed for the feed or B8; the action text needs its own parser |
| D14 | Retire the California page source in regions config; keep the page-scrape code | Other regions may have no bulk source. K3/K5/B1/B3/B4 move to the issue backlog for those |
| D12′ | **Revised while building:** store **every** version's text, not only the latest | Lines arrive unordered, so the latest version is only known after the table is read; and comparing amendments needs the earlier texts. ~666 MB a session, TOAST-compressed |
| D15 | Link votes and authors to representatives **by chamber and district**, through `LEGISLATOR_TBL` | Roll calls name legislators as pubinfo's `legislator_name`; the legislator table maps that name and house to a district, and dev holds exactly one representative per Assembly (80) and Senate (40) district. The page path's last-name match lets two members with one surname collide |
| D16 | Vote position: `AYE` → yes, `NOE` → no, `ABS` → no_vote. Chamber: `AFLOOR`/`SFLOOR` → Assembly/Senate, a committee code → its `LOCATION_CODE_TBL` description with `Asm`/`Sen` spelled out | Matches the values `bill_votes` already holds (`yes`/`no`/`no_vote`, "Assembly Appropriations"). pubinfo's `ABS` is "absent, abstaining or not voting" |
| D17 | `title` is the latest version's `<caml:Title>` ("An act to …"); `subject` is its `subject` | The same two strings the page path stored |

### 1. Pipeline: read pubinfo

- Line parser: a `quoteChar` option (backtick) and `.lob` columns. A column
  value naming a zip entry is read from the archive, only for rows that
  need it (D12).
- Read several tables from **one** download of the zip. Today every bulk
  dataSource downloads its own copy, which is 8 × 1.1 GB for bills.
- `bulk-line-parser.ts` changes, so the mapping version goes to **bm2**
  with a new pin (D2 pins).

### 2. Schema and config

- `/op-migration`: the mirror tables, additive. `bills` gets
  `ai_summary_llm_digest` (F3/K6) and `status_source`.
- opuspopuli-regions: bulk bills sources (one per table, one shared URL),
  the status → lifecycle map (D11), `coldAfterDays` (D1). Remove the
  leginfo page source (D14) and fix the `statusScanCadence` description.

### 3. Derive, lifecycle and the B8 repair

- Derive bills, authors and votes for changed bills; votes link to
  representatives through `LEGISLATOR_TBL`, deterministically.
- The lifecycle refresh never recomputes from a status that did not come
  from the official source (`status_source`). That is the B8 guard for
  page-scrape regions.
- The first import rewrites every California bill's status: that is the B8
  repair. The phase counts the refresh's writes.
- B7: an aborted sync records `failed`, not `succeeded`.

### 4. Summaries (K6, F3)

The summary reads the mirrored latest-version text, with no fetch. Hot bills
only (D1, D2). Regenerate on prompt hash or digest change, never the
`{skip: true}` sentinel, capped per sync (D5).

### 5. UAT and gate

- A full import on UAT.
- Gate against the raw file, as for campaign finance:
  - mirror rows equal the file's lines;
  - every derived status, last action, author and vote count equals the raw tables;
  - the 24 vetoes from 2026-11-05 read dead.
- A second import of the same file writes nothing and calls no LLM.
- Timing against the ~48h page run.

### 6. Lazy path (§5.2): its own PR (D7)

### Side effects

- **The session flip handles itself.** The daily file carries the current
  session, so the hard-coded `20252026` page source goes away (D14) and the
  2027–28 bills arrive when the Legislature publishes them. The closed
  session's bills stop changing, and F4's session rule ends them.
- **No prune for the bulk source.** A bill missing from a later file has
  moved to a closed session, not been deleted. The F2 prune stays for the
  page path only.

## As built so far (2026-11-06)

**opuspopuli-regions [#99](https://github.com/OpusPopuli/opuspopuli-regions/pull/99)** (open):
- Schema: `quoteChar`, `nullToken`, `lobColumns` (zip-only, as a draft-07
  `dependencies` rule), `rotatingFile { name, publishedAfter }`,
  `billStatusLifecycle`, `coldAfterDays`.
- California: nine pubinfo sources replace the leginfo page source.
- Review against the real export found two blockers, both fixed:
  - `Passed` appears only on HR/SR, meaning adopted, so it is `enacted`, not `active`.
  - The `LOCATION_CODE_TBL` key needs `consent_calendar_code`; without it 77 rows collapsed.
- A first design put `{weekday}` in `url`. The type generator then emitted
  `DataSourceConfig` twice (jscpd and SonarJS gates), so the rotation moved
  into `bulk`, and `url` stays the directory, a stable identity.

**Pipeline** (`packages/scraping-pipeline`, this branch):
- The parser reads `quoteChar` and `nullToken`.
- A `.lob` cell is replaced by the zip entry it names
  (`zip-entry-reader.ts`, 32 MB per-entry cap), and the line hash covers
  the content, not the renumbered name.
- `rotating-file.ts` resolves the weekday file once per run.
- `pubinfo-schemas.ts` maps each table to a typed `PubinfoRow`, and the
  mapper routes `pubinfo:<TABLE>` there.
- bm1 was re-pinned in place under the documented exception: the new
  options are opt-in, so existing sources' rows and hashes are unchanged.
- 760 package tests pass. The `.lob` hash, the content hash and the null
  token were each mutation-checked.

**Migration** `20261106120000_bills_pubinfo_mirror`: nine `pubinfo_*`
mirrors plus `bills.status_source` and `bills.ai_summary_llm_digest`.
- Approved by the owner, then applied to the dev DB.
- A Prisma diff against `postgres_test` shows no drift from it.

**Next:** the provider method, the mirror sync (K4 skip shared with
finance), the derive step (D15–D17), lifecycle from the status map,
summaries from the mirrored text, then UAT.

## Step 0, attempt 1 (2026-11-06 02:12 UTC, UAT job 197): blocked

- **leginfo answered the discovery seed with HTTP 403.** Discovery found 0
  bills, so extract, votes and the prune (skipped, `max-bills-set`) did
  nothing. The summary pass then aborted after 5 consecutive failures, 68
  items in. Nothing was deleted; `stage_backfill` changed one bill's flags.
- **No workaround was attempted.** Getting past a site's block is not ours
  to decide. The owner checks whether this is a block on this host or this
  client, or an outage, and how leginfo wants automated access made.
- **Finding B7:** the job is recorded `succeeded` although the sync
  aborted. The abort appears only in `result.errors`. A dashboard or alert
  reading `status` sees a green run that produced nothing.

Attempt 2 (job 198, 05:33 UTC): same 403, same abort.

**Why (2026-11-06):** the owner's browser on the same network loads every
page, so this is not an IP block or an outage. Our fetcher sends a bare
Node `fetch()` with no user agent of its own (`resilient-fetch.ts:241`).
And `https://leginfo.legislature.ca.gov/robots.txt`, read by the owner,
says `User-agent: *` / `Disallow: /` with `Crawl-Delay: 10`. **Automated
access to the whole site is disallowed.** The 403 enforces that, so
changing our user agent is not a fix, and imitating a browser is ruled out.
The bills dataSource is the only leginfo use in config or code.

## D9 — bills come from the Legislature's bulk download (owner, 2026-11-06)

`https://downloads.leginfo.legislature.ca.gov/` has no robots.txt (404) and
publishes the legislative database for download ("pubinfo"; schema in
`pubinfo_load.zip` → `capublic.sql`, docs in `pubinfo_Readme.pdf`):

| File | Size | Refreshed |
|---|---|---|
| `pubinfo_2025.zip` (session) | 1.2 GB | weekly, Sunday |
| `pubinfo_daily_<Day>.zip` (full) | 1.1 GB | nightly ~21:23 PT |
| `pubinfo_<Day>.zip` (that day's changes) | 0.3–800 KB | nightly ~21:20 PT |

Format: tab-delimited `.dat`, backtick-quoted fields, large text in
`<TABLE>_<n>.lob` side files. `bill_id` is exactly our `externalId`
(`202520260AB1165`). Tables that cover what we scrape and LLM-extract today:
`bill_tbl` (`current_status`, `measure_state`, chapter, `current_location`,
`active_flg`), `bill_history_tbl` (every action, dated, coded),
`bill_version_tbl` (subject, urgency, fiscal flags, `bill_xml` text),
`bill_version_authors_tbl` (authors and co-authors, primary flag),
`bill_summary_vote_tbl` / `bill_detail_vote_tbl` / `bill_motion_tbl`
(roll calls by legislator name), `veto_message_tbl`.

Measured on the 2026-11-05 change file: 24 bills vetoed that day. In our DB
**all 24 are wrong**: 21 read "passed", 3 "active".

What this does to the plan:

- **Status, actions, authors and votes become deterministic data.** The
  extraction prompt, the votes prompt, the status page, the text-page skip,
  the weekly forced pass and the 48h serial scrape all go for California.
  B1, B3, B4, K3 and K5 stop applying to it; F3 narrows to summaries.
- **B8 is repaired by the first import**, which rewrites every bill's status
  from `bill_tbl`. The lifecycle rules move from "Active Bill - …" strings to
  `current_status` / `measure_state` and the history.
- **The LLM keeps the summary only,** from `bill_xml`, with no page fetch.
  K6 and the lazy path (§5.2) stand.
- **The bulk path from campaign finance carries it:** download, archive, K4
  skip of unchanged lines, the `bulk_imports` ledger. New are backtick
  quoting and `.lob` side files.
- **Region config:** a bulk bills source in `opuspopuli-regions`. The page
  scraper stays for regions without a bulk source.

## Finding B8 — the F4 date refresh flipped 2,180 active bills to "passed" (dev, 2026-11-06)

Attempt 1's `stage_backfill` ran `refreshBillLifecycleFlags` (F4), which
rewrote **3,122** bills, although the phase logged "1 updated". Active went
2,698 → 518 and dead 1,002 → 61. Nothing was deleted; the flags are wrong.

Cause: `status` is corrupt on **4,486 of 5,019** dev bills. It holds text-page
version labels ("Amended IN Assembly", "Introduced February 21, 2025", "Filed
with Secretary of State…"), not the status page's "Active Bill - …" /
"Inactive Bill - …". 4,377 of them have a summary. That is the summary pass
before F4: its LLM read the full-text page and wrote `status`, without
recomputing the flags (the F4 finding). The flags kept their extraction-time
values until F4's refresh recomputed them from the corrupt status;
`isBillActive` requires `^Active Bill`, so every one became inactive and not
dead, the "passed" class. The personalized feed reads `isActive`.

- **Prod is not affected today** (v1.28.0, no F4). It is a release blocker:
  prod ran the same pre-F4 summary pass, so the first bills sync after F4
  deploys (or the F4 backfill script) flips prod the same way.
- **A sync does not repair it.** The status-only re-check compares only
  `lastAction`/`lastActionDate`, never `status`, and B1 skips extraction when
  the text is unchanged. With leginfo returning 403, no fetch can repair it
  now either.
- The phase's "updated" count does not include the refresh's writes, which
  is why the log showed nothing.

## Risks

| Risk | Mitigation |
|---|---|
| The full run is ~48h and shares Ollama with everything | Capped runs for development; one full run, on a weekend, never overlapping another heavy job |
| B1's fix writes status for bills that drifted months ago, flipping flags at once | Expected and correct; step 0 counts them first so the flip is a known number |
| D5 regenerates ~2,200 hot summaries | A per-sync cap spreads the GPU cost; quality checked on a sample before the cap is raised |
