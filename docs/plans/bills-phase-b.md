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
  - every vetoed bill reads dead. (This said "the 24 vetoes from
    2026-11-05"; those 24 were in that day's change file but are dated
    September. The gate checks every `Vetoed` bill instead.)
- A second import of the same file writes nothing. (The summary pass still
  runs: it works through the hot backlog, capped per sync.)
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

**opuspopuli-regions [#99](https://github.com/OpusPopuli/opuspopuli-regions/pull/99)** (merged 2026-11-06, published as 1.0.107):
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

**Backend** (commits 8a069cd1, 7321e9f9):
- `fetchBillsBulk` on the provider. The page path now ignores bulk sources.
- `BillsPubinfoSyncService` mirrors each table through the shared K4 skip,
  which moved to `bulk-row-skip.ts`, and derives only the bills that
  written rows touch. A change to a lookup table (legislators, location
  codes, motions) derives every bill.
- Bills are written through `upsertOfficialBill` in the writer module, so
  the F4 enforcement spec still holds.
- Lifecycle follows `status_source`: `page` uses the regex rules;
  `official` is set by the derive and moved only by the closed-session
  rule; legacy rows are never re-read (B8 guard, mutation-checked).
- Summaries for official bills read the mirrored current version. Export
  regions summarize hot bills only (D1/D2) and regenerate hot summaries
  that have no prompt hash, 200 per sync (D5). The model digest is
  recorded (F3).
- **Found and fixed while building:**
  - The summary candidate lacked `statusSource` and the stored flags, so
    every summary write would have re-read the status by regex. That was
    B8 again, for official and legacy rows alike. The candidate type now
    requires them; dropping them fails compilation.
  - A Prisma JSON `path` filter is NULL on a summary without the key, so
    `NOT` excluded every summary. The sentinel check now compares the
    whole value.
- Tests: 3,719 backend unit tests, 6 new integration cases on
  `bills-pubinfo-sync`, and 4 new on the summary merge.
  - Mutation-checked: the K4 skip, the current-version rule and the B8
    guard.
  - `region.integration.spec.ts` (35 failures) queries the running region
    service on :3004, which reads the dev DB, not `postgres_test`. It does
    not exercise this change; not re-run on `main`.

## UAT run 1 (2026-11-06, job 199): `pubinfo_daily_Thu.zip`

Regions pinned at 1.0.107; only the five regions lines of the lockfile
changed (a plain install also moved serwist's `browserslist` peer, which
was reverted). Disk before: 29 GB free. The scratchpad copy of the file
has the same SHA-256 as the imported snapshot (`b33a2d23…`), so the gate
compares against what was imported.

**Timing:** download 1 min (1,108 MB); mirror plus derive 7 min (959,853
rows, 5,065 bills); summaries 84 min for 200 bills. Against ~48 h for the
page run.

**Gate against the raw file:**

| Check | Result |
|---|---|
| Mirror rows = file lines | 8 of 9 tables exact. `LEGISLATOR_TBL` 122 of 124: the 2 others are vacant seats (AD03, SD10) with no name, rejected by the schema, with a warning. Correct. |
| Status, source | 5,065 of 5,065 equal `current_status`, all `official`; no legacy rows left. |
| Lifecycle flags | Each status maps as configured. Active 518 → 1,524: the B8 repair. All 212 `Vetoed` are dead. |
| Last action | **146 wrong.** Fixed (below). |
| Votes | **4,285 missing across 123 bills.** Fixed (below). |
| Authors | 4,777 of 5,065 linked. The other 288: 287 committee-authored bills (no representative to link) and GRP 1. |
| Co-authors, vote links | 31,524 co-authors, all linked. 606,210 of 606,214 votes linked. |

GRP 1 (the Governor's reorganization plan) has no status, so it is neither
active nor dead. Accepted.

**Found and fixed:**
- **Same-day roll calls collapsed.** `bill_votes` was unique on (bill,
  member, date, chamber), so a member's second vote that day was dropped:
  1,803 groups; SB 280 kept 208 of 524 votes. A roll call is (location,
  `vote_date_time`, `vote_date_seq`), unique in the export. Migration
  `20261106180000_bill_votes_roll_call` (approved by the owner) adds
  `roll_call` (default `''`, so page rows keep one vote per day) and widens
  the key. Readers list votes by date, so the extra rows display as the
  separate votes they are. Integration test mutation-checked.
- **Last action followed load order.** `action_sequence` ties within a
  day on 3,434 bills (AB 133: "From committee: Do pass" and "Read second
  time" are both 11). The history id never orders against the sequence, so
  it breaks the tie. Unit test mutation-checked.
- **A derive change did not reach unchanged bills.** A bill is derived
  again only when one of its lines changes, so neither fix would have
  reached existing rows. The derive and the sync service now join the
  backend's mapping-version pin. `BULK_MAPPING_VERSION` is bumped to bm2
  rather than re-pinned in place: the dev ledger already holds bm1 for these
  sources. Cost: one full rewrite of bills, and of finance on its next sync.
- `maxBills` now caps the export path's summaries, as it caps bills on the
  page path. A gate run then needs no GPU hour.

**Summary failures:** 15 of 200. 6 timed out at 120 s (long bills, up to
38k tokens), 8 returned no JSON, 1 returned malformed JSON. These are model
failures, not pipeline failures. A failed bill keeps no summary and is a
candidate again next sync.

## UAT run 2 (job 200): bm2, same file, `maxBills` 10

**Import:** 959,853 rows rewritten and 5,065 bills derived in 9 minutes, as
bm2 should.

**Gate:**
- Votes: all 610,499 written, 0 bills differing (SB 280: 524); 610,495 linked.
- Last action and status: 0 mismatches.

**The summary pass aborted.** Candidates had no order, and the bills that
failed in run 1 came first again. Five in a row tripped the abort before any
other bill was reached, so every nightly pass would have stopped the same
way. Two further problems showed:
- The job was recorded `succeeded` (B7).
- The import's counts were replaced by the abort's zeros. The log keeps them.

**Fixed:**
- **A failed summary waits a week.** Migration
  `20261106200000_bills_ai_summary_failed_at` (approved by the owner) adds
  `bills.ai_summary_failed_at`. A failure sets it and a success clears it.
  Candidates skip bills that failed in the last 7 days, and bills that never
  failed come first, so the abort trips only when the model is actually
  down. Both rules were mutation-checked.
- **B7:** a job whose results carry errors is recorded `failed`, with its
  results kept. It is not thrown, so BullMQ does not retry the whole sync.
  This applies to every data type: a boundary refresh with failed upserts
  now reads `failed` too. Mutation-checked.

The text is not the cause. The summary already passes the CAML through
`htmlToReadableText`, and the markup left over (escaped inside the CAML) is
under 1% of the text. The failing bills are long (budget bills run to 2 M
characters), as they were on the page path.

## UAT run 3 (job 201): same file again

The import wrote nothing: 959,853 rows unchanged, 0 derived. It took 22 s
after a 1-minute download. All 10 summaries succeeded, including one of 55 k
tokens. The job was recorded `succeeded`.

## Review of the final diff (`main...4506d47e`, 2026-11-07)

`/op-review` ran as four independent lenses: pipeline correctness, backend
correctness, security and regulated data, and performance, types, tests and
consistency. The data scan passed with 0 findings. This is a self-review: Claude
wrote the code and ran the review, so it needs a human countersign.

**Blocker, fixed: a derive that died left its bills stale.** The ledger
records an import complete when its stream ends, before the derive runs, and
the bills to derive were held only in memory. After an error, a crash or an
out-of-memory kill, the next sync skipped those unchanged lines, so the bills
were never derived again. Migration `20261107120000_pubinfo_bills_derived_at`
(approved by the owner) adds `pubinfo_bills.derived_at`. The derive now takes:
- every bill never derived;
- every bill with a mirror row written since it was last derived;
- every bill when a legislator, location code or representative was added or
  removed;
- the bills whose votes use a changed motion (indexed), not all 5,065.

Each bill, its co-authors, its votes and its `derived_at` are written in one
transaction. A bill that fails is logged and the rest continue; the job is
recorded failed and the bill is retried. `derived_at` is written by raw SQL,
so Prisma's `@updatedAt` does not move past it. Four new integration tests,
each mutation-checked.

**Fixed (suggestions):**
- **Votes were credited to the wrong member.** Linking by seat alone gave a
  predecessor's votes to the seat's current member. In the export: AD63
  (Essayli, who resigned, and Johnson), and AD03 and SD10, whose former
  members now map to "Member Vacant" rows. A legislator now links only when
  their last name, folded for case and accents, is in the seat holder's name
  (AD15's two spellings of one member still link).
- **The weekday file was resolved per source.** A sync that crossed 21:30
  could read two days' files. The download scope now carries the sync's start
  time.
- **A week-old file could be imported.** A run after 21:30 on a late night
  fetched last week's file and would roll statuses back. A rotating export
  last modified over 48 h ago is refused.
- **An empty `.lob` entry left its file name as the text.** It now reads as
  empty. None is empty in the 2026-11-05 export.
- **Lob resolution was outside the pin.** It moved into the pinned parser.
- **The status map and lifecycle code were outside the pin.**
  `billStatusLifecycle` is now part of the import key, and `bill-lifecycle.ts`
  and the writer joined the backend pin. Bumped to bm3.
- **Legacy rows never ended with their session.** The closed-session rule
  reads no status, so it now applies to legacy rows as well as official ones.
- **Bills with no text took a place in the cap every sync.** They wait a week
  too.
- **Outages made bills wait.** A bill waited only after a timeout or an
  unusable answer. (Reversed by the next review: see below.)
- **Parse errors logged model output.** V8's message quotes it, so the log
  now uses a fixed string.
- **Batch size for text tables.** Sources with `.lob` text default to 500
  rows per batch, not 10,000.
- **Rotating file name host.** It must stay on the source's origin.
- **Small fixes:** the leginfo link's id is URL-encoded. The zip is closed
  when indexing fails, and the content stream when the lob reader fails.

**Deferred, recorded here:**
- **Summary regeneration.** Summaries are regenerated when they predate prompt
  hashes (D5), but not yet when the prompt hash, the model digest or the bill's
  version changes. That is K6, next.
- **Removed export lines.** A line that drops out of the export (a corrected
  vote, a removed author) stays in its mirror. Tracking which lines a full
  import saw is a separate change. Low impact so far.
- **A bad `.lob` entry fails the whole version table.** A missing or oversized
  entry is a corrupt export, so the failure is loud on purpose.
- **Per-bill writes.** The derive writes bill by bill: 9 min for 5,065 bills.
  Batching is possible but not needed yet.

## UAT runs 4 and 5 (jobs 202, 203): bm3, after the review fixes

Before run 4 the Docker VM disk was at 14.7 GB free, under the 25 GB stop
line. The database had grown only about 1.7 GB on this branch; the rest was
image and build cache from the day's rebuilds. With the owner's approval,
dangling images and build cache were pruned (no volumes), leaving 149.6 GB
free.

**Run 4 (bm3, same file):** every row rewritten, all 5,065 bills derived in
about 1 minute after the mirror, and none left with a NULL `derived_at`.
- Votes: 610,499, 0 bills differing from the raw table. Last action and
  status: 0 mismatches.
- 599,199 votes linked. The 11,296 unlinked are the members no longer in
  their seats: Wahab 7,978, Gallagher 3,062 and Essayli 256, plus 4 Weber
  votes that also failed to match before the change.
- Lead authors linked fell from 4,777 to 4,670: the 107 bills those three
  authored.

**Run 5 (same file again):** 959,853 rows unchanged, 0 written, 0 derived.
The derive query took about 40 s after the mirror pass.

**Both runs' summary passes aborted after five failures in a row**, and both
jobs are recorded `failed` (B7, working as intended). The ten failed bills are
recorded and wait a week, so each run gets past them:
- 5 timed out at 120 s on bills of 345 k to 5 M characters (AB 109, SB 121
  and other budget bills).
- 5 returned no usable JSON in 18 to 55 s on bills of 5 to 28 kB.
- 9 of the 10 already had an older summary, so they are not bills the page
  path had always failed on.

This is how the summary prompt and model behave on these bills, and this
change does not touch either. It is recorded for the owner. The question is
whether to raise the timeout for long bills and find why the model returns no
JSON for some short ones. That needs the eval harness, not production logs,
which may not print model output.

## Review of the review fixes (`4506d47e..a349e738`, 2026-11-07)

A fresh single-agent review covered all lenses on the delta. `/op-security`:
`pnpm audit --prod` showed 3 low, 30 moderate and 1 critical, the critical
already on the ignore list. trivy found one critical, maplibre-gl
CVE-2026-85061, which is suppressed with an enforced guard and untouched by
this branch. gitleaks found no leaks. The data scan found 0. The branch's only
dependency change is regions 1.0.106 → 1.0.107.

**Blocker, fixed: a representative renamed in place was never noticed.**
Representatives are keyed by seat (`ca-assembly-63`), and the reps sync
renames the row when the seat changes hands. So the "added or removed" check
never fired, and votes linked under the old name stayed on the renamed row.
The reps' `updated_at` cannot be used instead, because bio writes touch it
constantly. Migration `20261107140000_pubinfo_bills_derived_links_hash`
(approved by the owner) stores, per bill, a hash of the legislator →
representative links it was derived under. Each derive computes the current
hash; a bill derived under another is derived again. This replaces the
representatives and legislators timestamp checks: a legislator change that
leaves the links as they were derives nothing.

**Fixed (suggestions):**
- **Waits:** every summary attempt that ends without a summary now waits a
  week. The timeout regex left failures that repeat on the same bill (a
  refused page fetch, a write that fails for one bill) leading every sync. It
  also made a saturated Ollama's timeouts wait. An outage costs at most the
  five bills tried before the abort.
- **Whole-word match:** `isSeatHolder` matches whole words, so "Lee" is no
  longer found in "Kathleen". Hyphenated names match their spaced form.
- **Query speed:** `billsToDerive` reads each mirror once, for rows written
  since the oldest derive. It used to run seven correlated probes per bill
  (about 40 s on an unchanged export). The motion join casts only numeric ids,
  so the motion index is used.
- **Error logging:** a failed derive logs the Prisma error code or a short
  first line, never the whole call.
- **Tests:** two-bill integration tests now cover:
  - a legislator change that leaves the links as they were (nothing derived);
  - a representative renamed in place (every bill derived);
  - a changed motion (only the bills that use it);
  - one bill failing (the rest kept, the failed bill retried with no export
    change).

  Each test was mutation-checked, as was the whole-word match.

bm3 was re-pinned in place on the backend: it never left dev, the change
touches only the derive, and the new NULL column re-derives every bill.

**UAT runs 6 and 7 (jobs 204, 205):**
- **Run 6:** with the links hash NULL, all 5,065 bills were derived in about
  1 minute. Votes 610,499 with 0 bills differing; 599,199 linked; 4,670
  authors linked. One links hash across all bills.
- **Run 7 (same file):** 0 written, 0 derived. The derive query now takes
  under a second (it was 40 s).

## Review of the last fixes (`a349e738..545b34a2`, 2026-11-07)

A single-agent review across all lenses found no blocker. Its checks:
- `billsToDerive` misses no bill: a NULL `min(derived_at)`, a bill derived
  long after the oldest, and same-instant writes were each checked.
- The query is parameterized.
- The links hash captures renames, soft deletes and added legislators.
- The bm3 in-place re-pin is within the spec's rule: the version never left
  dev, and the change is equivalent to deleting the rows.

**Fixed (suggestions):**
- **Outages made bills wait.** Skips reset the abort streak and concurrent
  batches overshoot it, so an outage could hold back up to 200 bills for a
  week. A failed attempt now waits only if the model answers `isAvailable()`
  afterwards. A bill with no text still waits, since no model is involved.
  Mutation-checked.
- **Model output could reach the log.** The summary catch logged Prisma's
  full message, which can quote the summary the model wrote. `shortError`
  moved to `short-error.ts` (with its own spec) and is used there too.
- **The links hash could flip.** Legislators are now read in a fixed order, so
  a key two rows share resolves the same way every run.
- **Generational suffixes broke the match.** They are dropped when matching,
  so "Smith Jr." matches "John Smith". O'Brien and O’Brien match too.
  Mutation-checked.
- **Motion id overflow.** The id cast is capped at 9 digits, so an id too
  long for an integer cannot fail the query.
- **Vacuous test.** The "any failed attempt" test now also asserts it found
  both rows.

**UAT run 8 (job 206), same file, final code:** 0 written, 0 derived; the
links hash is unchanged across all bills; 599,199 votes linked.

**Pre-push AI gate (code and security):** passed, with no critical or high
findings. Its four notes:
- **Fixed:** a subject over `bills.subject`'s 500 characters would fail its
  bill's derive every night (the mirror allows 1,000; none is over 500
  today). It is now clipped, with an ellipsis.
- **Fixed:** a non-numeric history id would throw in the tie-break (none
  today). It now falls back to text order.
- **Intended:** B7 records every data type `failed` when its results carry
  errors, boundary refreshes included.
- **Not a defect:** `getModelDigest()` cannot reject. The provider catches
  internally and returns undefined.

**Second pre-push gate:** passed, with no critical or high findings.
- **Fixed:** the derive matched representatives by chamber and district in
  any region, so on a node holding another state, that state's Assembly 7
  could be linked (only the surname check stood in the way). It now reads
  this region's members only. Tested with another state's same-seat,
  same-surname member, and mutation-checked.
- **Expected:** bm3 changes every bulk source's import key, so finance
  rewrites all its rows once on its next sync, about 22 minutes.
- **Already recorded:** the B7 scope, and the `min(derived_at)` prefilter
  (below).

**Third pre-push gate:** passed, with no critical or high findings.
- **Fixed:** one bill that failed to derive threw out of the sync, so the
  lifecycle refresh and the summary pass were skipped for that run, and every
  night while the bill kept failing. The derive now reports its failures; the
  sync finishes both phases, then fails the job (B7). Unit test,
  mutation-checked.
- **By design:** legacy rows keep their stored flags (B8). The B7 scope is
  intended.
- **Not a defect:** unlinked votes have a NULL `representative_id`, which the
  unique key treats as distinct. Each bill's votes are replaced as a set, and
  the export has no duplicate roll-call rows, so nothing duplicates.

**Fourth pre-push gate:** passed, with no critical or high findings.
- **Fixed:** a bulk bills source with `BillsPubinfoSyncService` not
  registered logged a warning and reported an empty, successful sync. It now
  fails. Unit test, mutation-checked.
- **Already recorded:**
  - the B7 scope;
  - the one-time rewrite under bm3;
  - the `min(derived_at)` prefilter;
  - the roll-call rollback dropping the extra same-day votes, which its
    rollback file states.

**Recorded, not changed:** bills that never change keep their first
`derived_at`, so `min(derived_at)` stays put and the prefilter reads more
rows over time. That costs speed only. If it shows in timings, compare per
table against each bill's own `derived_at` through `(bill_id, updated_at)`
indexes.

**Not new:** the 1.1 GB zip exceeds local Supabase storage's object limit,
so the snapshot was not archived. The finance zip has never archived
locally either. The import continues, and the snapshot row records no
storage key. The worker's memory health check failed for about 40 s
while parsing (heap ~1.2 GB); the job was unaffected.

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

## K6 — summaries regenerated when what wrote them changes (2026-11-07)

Branch `feat/bills-summary-staleness`, after #1428 merged.

A current (hot) bill's summary is regenerated when any of these change:
- **The prompt template:** the stored `ai_summary_prompt_hash` differs from
  the live hash of `bill-status-summary` (`getPromptHash`, the same bare
  template hash the compose returns). A summary with no hash counts as
  stale.
- **The model build:** the stored `ai_summary_llm_digest` differs from the
  live digest. This only applies when the live digest is known.
- **The bill's text:** for export bills, the version a summary was written
  from differs from the bill's current version. Migration
  `20261107160000_bills_ai_summary_source_version` (approved by the owner)
  adds `bills.ai_summary_source_version`, which records which text a summary
  describes. That is an attestation fact as well as the staleness test. NULL
  counts as stale, so each export bill is regenerated once, inside the cap.

Two rules sit around these:
- **Skip sentinel:** `{skip: true}` is retried only when the bill has a new
  version. Under the same text it would only skip again, so a new prompt
  does not retry it.
- **Unreadable hash:** if the live template hash cannot be read, the pass is
  skipped rather than treating every summary as stale.

Order: bills never failed first, then bills with no summary, then the oldest
summary, then by id. Still 200 per sync. Cold bills are the lazy path's (D7).

Six integration tests, each mutation-checked, cover:
- live inputs leave a summary alone;
- each of the three changes regenerates it;
- the sentinel is retried only on a new version;
- an unreadable hash skips the pass.

### Newer exports: what changed, measured on the raw files

A script compared Thursday 11-05, Friday 11-06 and Saturday 11-07 line by line
in the nine tables, with `.lob` text compared by content. It reads only the
downloaded files, not our code.
- **Thu → Fri:** 0 lines new, changed or gone in any of the nine tables.
  14,140 `.lob` entries changed, but by name only: the nightly renumbering.
  `BILL_ANALYSIS_TBL`, which we do not import, also changed.
- **Fri → Sat:** byte-identical entries.

The session ended on 2026-08-31, so the data is still until the 2027–28
bills arrive. Saturday's file was published at 04:23 PST, not about 21:23
like the weekday files. With `publishedAfter: 21:30` a Saturday run before
21:30 takes Friday's file, which is harmless here because the two are
identical.

### UAT (job 207): Friday's file, three lines made to look changed

There was no real change to test. So the stored line hash was altered on
three mirror rows, each in a different bill and table: AB 1089's bill row,
SB 1179's current version (the lob path) and one roll call of AB 1359. The
import writes the hashes back, so the change repairs itself.
- **Import:** 959,853 rows, 3 updated and 959,850 unchanged, though 14,140
  `.lob` entries had been renamed since Thursday.
- **Derive:** 3 bills derived, exactly those three. Every other bill kept its
  `derived_at`.
- **Summaries (K6):** 10 attempted, 9 written, each recording its prompt hash
  and source version. 1 timed out and was recorded so it waits. Bills with no
  summary went first.

### K6 review 1 (working tree before the fixes below)

**Blocker, fixed: the hash compared was not the hash stamped.** Prompt-service
`GET /prompts/:name/hash` hashes the canonical active template. A compose is
served the template its API key resolves to, which can be an experiment's
variant, or a cached older copy. While a node is in an experiment, every
summary would have looked stale on every sync, cycling 200 at a time through
every hot bill.

The fix: `PromptClientService.getServedPromptHash()` hashes the template the
compose path is served. It shares `resolveTemplate` with `getTemplate`, so
the two cannot drift apart. K6 compares against it.

**Fixed (suggestions):**
- **Fallback skip:** the pass is skipped when the served template came from
  the local fallback while a prompt service is configured. The real
  `getPromptHash` never threw on an outage; it silently hashed a local copy
  that may have drifted.
- **Version check scope:** the stale-version query covers only hot bills, as
  the candidates do, and only bills whose current version has text. A bill
  with no text would have failed and waited every week, indefinitely.
- **JSON null:** `jsonb_typeof(ai_summary) = 'object'` replaces
  `IS NOT NULL`, which a JSON `null` would pass.
- **Docblock:** `enrichBillSummaries`'s doc comment is back on it, and its
  out-of-date "only `ai_summary IS NULL`" paragraph now describes K6.
- **Tests added**, each mutation-checked:
  - local fallback skips the pass;
  - no loop, a second run calls the model 0 times;
  - an unknown live digest does not judge a summary with no recorded build;
  - a page-path bill under the live prompt is left alone;
  - a current version with no text is not chased;
  - no summary comes before an old one.

  The prompt-client spec gains three `getServedPromptHash` cases: served
  hash equals compose hash, fallback flagged, no service configured.

### K6 review 2 (final working tree, after review 1's fixes)

No blocker. It confirmed:
- No path regenerates a bill every sync. Experiment variants are stable per
  API key, and served and stamped hashes come from one `resolveTemplate`.
- The digest is resolved once per process.
- `resolveTemplate` keeps `getTemplate`'s behaviour for every existing caller.
- The raw SQL is parameterized.
- No bill text or model output is logged.

**Fixed:**
- **Version ties:** a bill's current version is picked by `version_num`,
  which is not unique. A tie could make the SQL and `billTextFor` name
  different versions, so the summary would look stale forever. Both now break
  ties by `external_id`. There are no ties in the 2026-11-05 export; the
  derive's own pick is unchanged, since it is under the mapping pin.
- **Fallback too strict:** the local-fallback skip also stopped bills with no
  summary from getting one during an outage. Now, under the fallback, missing
  summaries are written and none is refreshed (`LiveSummaryInputs.refresh`).
  A circuit that opens mid-pass stamps the rest with the local hash; they are
  refreshed once next sync, not in a loop.
- **Nitpicks:**
  - `getPromptHash`'s doc comment is back on it;
  - `hot && live` is now `live`, with the cut-off and clock carried on it;
  - the cut-off has one helper (`coldCutoff`);
  - `hotSummaryCandidates` was split, adding `staleSummaries`.
- **Tests:** a version tie (no loop), the fallback writing missing summaries
  and refreshing none, `getServedPromptHash` differing from the canonical
  `/hash` under an experiment, and the API-key misconfiguration throwing
  rather than reading as a fallback. Each new rule was mutation-checked.

## D7 — summaries on first read (plan, 2026-11-07)

Design in `ingestion-resource-lanes.md` §5.2. Owner decisions already made
(D7): its own PR; a button for anonymous readers; caps of 200 a day globally
and 10 a day per session. Branch `feat/bills-lazy-summary`, stacked on K6
(#1430), whose staleness rules it reuses.

### What the code has (survey, 2026-11-07)

- **Bill page** (`app/region/bills/[id]/page.tsx`): client-rendered,
  `GET_BILL` cache-first.
  - With no summary it shows a static "pending… check back shortly" block,
    hardcoded English, no `aria-live` and nothing that starts generation.
  - Every bill-page string except the title is hardcoded English.
- **Region subgraph:** every mutation is admin-only, so this would be the
  first public mutation there. Summary status is not exposed on `Bill`.
- **No single-bill summary job.** The summary path is private methods of
  `RegionSyncService`, and there is no bill-summary queue. The template for
  one is `ChildJobProcessor` (single-proposition analysis).
- **Job ids:** BullMQ rejects `:`, so the §5.2 id `bill:<id>:summary:<hash>`
  cannot be used. The repo convention is `__` (`laneJobId`).
- **No session for anonymous readers.** The subgraph sees no cookies: the
  gateway forwards `user`, the client IP and the user agent only. No visitor
  id exists. The `csrf-token` cookie is stable per browser for 24 h.
- **No counter utility for caps.** Redis is available: the `FallbackCache`
  in the region module, and the queue connection.

### Plan

1. **Backend, the job.**
   - New queue `bill-summary`, processed in `region-worker` by a
     `ChildJobProcessor`.
   - It calls a public `summarizeOne(billId)` extracted from the batch path,
     so lazy and batch output are identical: summary, stage, F4 flags and
     provenance.
   - Job id `bill-summary__<billId>__<servedPromptHash>`, removed on finish.
     Concurrent first readers collapse onto one job, and a finished job never
     blocks a later request.
2. **Backend, the API (additive, region subgraph, gateway federation
   check).**
   - `Bill.summaryStatus`, an enum:
     - `CURRENT`: summary written under the live template, model and
       version;
     - `STALE`: summary shown, and a refresh may be requested;
     - `MISSING`;
     - `PENDING`: a job is queued or running;
     - `UNAVAILABLE`: capped, or waiting after a failure.
   - `requestBillSummary(billId)`, `@Public()`: enqueues when the bill is
     `MISSING` or `STALE` and under the caps, and returns the status.
   - A mutation, never a side effect of the `bill` query.
3. **Caps.**
   - **Global:** Redis `INCR` with expiry, one key per UTC day.
   - **Per reader:** a signed-in reader is counted by user id. An anonymous
     reader needs an identity, which is decision Q1.
   - **Fail closed:** when Redis is unavailable, nothing is generated lazily.
     The batch still runs.
4. **Frontend.**
   - **Trigger:** a signed-in reader triggers the request on load when the
     summary is missing or stale; an anonymous reader gets a "Summarise this
     bill" button.
   - **Polling:** a `PENDING` state polls `GET_BILL` (network-only, bounded:
     about 8 tries at 15 s, then "check back later") inside one persistent
     `aria-live="polite"` region.
   - **Strings:** new en/es keys for the summary states. The rest of the bill
     page's hardcoded English is out of scope (the "Not in scope" list
     below).
   - **Tests:** an a11y test for the states, and unit tests extending the
     bill-detail mocks.
5. **Metrics:** `lazy_analysis_requests_total{data_type, result}` (`enqueued`,
   `deduped`, `capped`) and `lazy_analysis_ready_seconds`, per lanes plan §3.

**Owner decisions (2026-11-07):**

| | Question | Decision |
|---|---|---|
| D18 | Identity for an anonymous reader's daily cap | The gateway forwards `sha256(csrf-token)` as `x-client-session`. It is stable per browser for 24 h, needs no new cookie, and never carries the raw token. (The HMAC signs the URL only, not headers. Like `user`, the header is trusted because only the gateway sets it and subgraphs accept only HMAC-signed gateway requests.) |
| D19 | A cold bill whose summary is stale | Show it, with a note that an updated summary can be generated. Signed-in readers refresh it automatically; anonymous readers get the button. |

**Not in scope:**
- translating the rest of the bill page;
- the Grafana row (row 6);
- other data types' lazy paths.

### D7 as built (2026-11-07)

**Backend:**
- **Single-bill path:** `RegionSyncService.summarizeOne(billId)` is the
  batch's own path. `BILL_ENRICHMENT_SELECT` is shared with the batch and
  typed by the candidate.
- **Per-bill rule:** `summaryStateOf` (`bill-summary-state.ts`) applies K6's
  rule to one bill. An integration test pins it to the batch's SQL selection
  across eight provenance cases, mutation-checked.
- **`BillSummaryService`:**
  - status: CURRENT, STALE, MISSING, PENDING or UNAVAILABLE;
  - request: deduped on the in-flight job; both daily caps in Redis (`INCR`
    in `MULTI`), with a refused request returning its count;
  - fails closed with no reader identity or no counters;
  - generate: re-checks first, then writes through the batch path.
- **Resolver:** `BillSummaryResolver` adds `Bill.summaryStatus` (a field
  resolver, so only the detail page pays for it) and `@Public()
  requestBillSummary`.
- **Queue:** `bill-summary`, consumed by `BillSummaryProcessor` in
  region-worker.
- **Gateway:** `clientSessionId` reads the cookie through a `readCookie`
  helper, now shared with the CSRF middleware, and forwards
  `x-client-session`.
- **Metrics:** `lazy_analysis_requests_total` and
  `lazy_analysis_ready_seconds`.

**Frontend:**
- `BillSummarySection` replaces the static "pending" block. A signed-in
  reader's page asks once; an anonymous reader gets a button.
- While pending it polls `GET_BILL_SUMMARY_STATUS` every 15 s, at most 8
  times, inside one persistent `aria-live` region.
- en/es strings under `region:bill.summary.*`.
- The schema snapshot was refreshed from the UAT gateway; the composition is
  the federation check.

**Found while testing:**
- **The per-reader cap never applied.** The `MULTI` result was read at the
  wrong index (the first `EXPIRE`'s reply). A unit test caught it; fixed.
- **No anonymous reader can reach a bill page today.** `app/region/layout.tsx`
  wraps every region route in `ProtectedRoute`. In the app as it stands the
  live path is therefore the signed-in auto-request. The anonymous button,
  and its D18 cap, matter once region pages are made public (an owner
  decision) or for direct API callers. Both are built and tested.

**UAT, through the gateway, as an anonymous API caller:**
- **AB 1138:** `MISSING`, then `PENDING`. A second request was deduped, with
  both counters left at 1, and a per-reader counter was created, so the
  gateway forwarded the session. Its 341 kB text timed out at 120 s, the
  known long-bill failure; the attempt was recorded, and the bill reads
  `UNAVAILABLE` for a week.
- **AB 2503 (short text):** `PENDING`, then `CURRENT`, with the prompt hash,
  model digest and source version (`20250AB250396CHP`) recorded.

**Browser check of the signed-in page:** not done. It needs a dev login,
and creating a test account in the dev database, or using the owner's, is
the owner's call.

**Tests:**
- backend: 3,761 unit (23 new), and 30 summary integration cases (1 new pin);
- frontend: 8 component tests and 5 axe states;
- the bill-page test was updated;
- frontend 1,904 unit tests and 77 a11y tests pass;
- `lint:sonar` clean.

Mutation-checked:
- an anonymous reader is never auto-requested;
- a signed-in reader is asked once, even if the status moves;
- the poll ceiling;
- the D7 pin.

### D7 reviews (working tree, 2026-11-07)

Two independent `/op-review` lenses ran on the working tree as built above:
security, abuse and regulated data; and correctness, frontend, a11y, tests
and consistency.

**Blockers, fixed:**
- **The worker never re-checked.** `generate()` asked `status()`, which saw
  the worker's own running job as `PENDING`, so it always regenerated: a bill
  a sync had just summarized, or one waiting after a failure. `judge()` now
  reads the bill's own state without the queue, and the worker uses it.
- **Polling never stopped after a reader's request.** `requested` stayed
  `PENDING`, so the page polled every 15 s for as long as the tab was open.
  The page now settles on the polled answer, but only from a poll that ran:
  a skipped query can still hold old data.

**Fixed (suggestions):**
- **Status on list queries (security review; confirmed on UAT).** As a field
  on `Bill`, `bills(take:100){items{summaryStatus}}` passed the complexity
  limit, which does not multiply by `take`, and ran 100 status lookups. A
  `complexity: 20` weight did not stop it. Now `billSummaryStatus(billId)`
  is a root query, one bill at a time, and `GET_BILL` fetches it alongside
  `bill`.
- **The per-reader cap did not bind an adversary.** A client chooses its own
  CSRF cookie, so a script can mint a session per request. A per-IP daily cap
  (30, env `BILL_SUMMARY_LAZY_IP_DAILY_CAP`) is taken with the others. It is
  higher than the per-reader cap because a household or school shares an IP.
  The global 200 still bounds GPU cost. The plan's D18 note was about header
  forgery and was right about that, but said nothing of this.
- **Linkable keys:** reader and IP keys are an HMAC under
  `GATEWAY_HMAC_SECRET`, not a bare hash, so a Redis key cannot be linked
  back to a user, browser or address.
- **Cap order and refunds:** the global count is checked first, so a refusal
  there creates no per-reader key. A failed enqueue gives back what it took.
- **Job id:** `bill-summary__<billId>`, not including the template hash, so a
  template change while a job waits cannot enqueue a second one.
- **Smaller fixes:**
  - the template is resolved once per request;
  - `no_reader` is its own metric label;
  - a bill id over 64 characters is refused without a lookup;
  - if the batch wrote the summary after the page loaded, the page fetches
    it once;
  - focus moves to the status when the button goes (WCAG 2.4.3);
  - the Spanish "slow" string uses *tú*, as the rest of the app does.
- **Tests added, each mutation-checked:**
  - the worker re-check with its own job active;
  - the IP cap;
  - no reader key on a global refusal;
  - the refund on a failed enqueue;
  - HMAC'd keys;
  - polling stops after a request lands;
  - the batch-wrote-it refetch;
  - focus.

**Recorded, not changed:**
- **Privacy page.** The reader and IP keys are pseudonymous identifiers, kept
  48 h for abuse prevention. `app/privacy/page.tsx` mentions no cookies or
  identifiers; whether to add a line is the owner's call.
- **Header trust.** The HMAC signs the URL, not headers, so a replayed
  signature sent directly to a reachable subgraph could carry forged `user`
  or `x-client-session` headers. That is pre-existing, and this change adds
  one header behind it.
- **Model swap.** The model digest is cached per process. After a model swap
  the region API calls summaries stale until it restarts. Requests then reach
  the worker, which re-checks with its own digest and writes nothing. They
  spend caps, not GPU.

**UAT after the fixes:**
- `summaryStatus` on `Bill` is rejected (`Cannot query field`).
- `billSummaryStatus` works beside `bill`.
- AB 2504 and AB 2518 each went `MISSING`, then `PENDING`, then `CURRENT`.
- Dedupe held: the global count went up once per bill.
- Per-IP and per-reader keys were present and HMAC'd.
- The gateway must restart to recompose after a region schema change. The
  snapshot was refreshed after that restart.

### D7 pre-push gate (first push, blocked)

The AI code gate blocked the first push with one high finding, which was
right.

**High, fixed:** a Redis or database failure would have broken every bill
page. `status()` did not catch errors from its queue and DB lookups, and
`billSummaryStatus` was a non-null root field inside `GET_BILL`. One failed
lookup would have nulled the page's whole response. Now:
- `status()` never throws: a failed lookup reads as UNAVAILABLE.
- The status is no longer in `GET_BILL` at all. `BillSummarySection` runs
  its own `GET_BILL_SUMMARY_STATUS` query (`errorPolicy: "ignore"`). If it
  fails, only the section goes quiet and the page renders as before.
- That also settles the gate's medium finding: an older gateway without the
  field would have failed `GET_BILL` validation. So the frontend can deploy
  before or after the backend.

The section then settles a request on an outcome only, CURRENT or
UNAVAILABLE. Right after a request the query still holds the earlier MISSING
or STALE, and settling on that would end the wait at once. It polls a
summary that was already being written when the page opened.

**Lows, fixed:**
- **Global count leak:** a reader or IP `INCR` that throws after the global
  one now gives the global count back.
- **Missing secret:** with `GATEWAY_HMAC_SECRET` unset, reader keys would
  have been an unkeyed hash. The request is now refused (fail closed).

Tests were added for each fix, each mutation-checked. UAT after a rebuild
and gateway restart: snapshot current; MISSING, then PENDING, then CURRENT.

### D7 pre-push gate (second push, passed)

The gate passed, with no critical or high findings.

**Lows, fixed:**
- **Negative counters:** a refund after a partial `INCR` failure decremented
  keys that were never incremented, which could drive a counter negative and
  hand out extra allowance. Now only the keys taken are given back.
- **Request errors:** `request()` now reads a failed lookup as UNAVAILABLE,
  as `status()` does. Before, it surfaced as a GraphQL error.

Both have tests, mutation-checked.

**Lows, recorded:**
- **Double charge:** two simultaneous first requests can both pass the
  in-flight check and both spend caps. BullMQ's fixed job id still makes it
  one job, so the cost is an allowance, not GPU.
- **Duplicate cookies:** the `readCookie` fallback (no cookie-parser) takes
  the first duplicate cookie where the old CSRF code took the last.
  Production always runs cookie-parser, which takes the first too.

## D13 — committee referrals from the hearings table (plan, 2026-11-07)

**Why it matters.** The committee page's bill list (`CommitteeBillsList`,
`/region/legislative-committees/[id]`) reads `bill_committee_assignments`. Dev
has 3 rows, so that list is nearly empty.

**What was measured** (Saturday 2026-11-07 export, dev DB):
- **Referral text.** History actions name committees by abbreviation ("Com.
  on APPR.", "PUB. S."): 11,586 actions on 4,706 bills. Nothing in the export
  expands them.
- **No Senate committees.** `legislative_committees` holds only the 85
  Assembly committees. They come from representatives' pages through the
  committee linker, and none of the 40 Senate members' pages yields a
  committee list.
- **`COMMITTEE_HEARING_TBL`** has 17,166 rows. Columns: `bill_id`,
  `committee_type`, `committee_nr`, `hearing_date`, `location_code`,
  `trans_uid`, `trans_update_date`. They cover 4,154 bills and 55 committee
  codes (31 Assembly, 24 Senate), giving 13,099 distinct bill–committee
  pairs.
  - Bill, code and date repeat on 11 rows, which differ only in
    `trans_update_date`, so that column joins the key.
- **Matching:** all 31 Assembly hearing committees match an existing
  committee by chamber and normalized name.

**Owner decision (2026-11-07), D20:** referrals come from the hearings
table, not from parsing history text.

**Plan:**
1. **Regions:** a 10th pubinfo source, `pubinfo:COMMITTEE_HEARING_TBL`,
   keyed on bill, committee code, hearing date and `trans_update_date`. A
   regions PR, then publish, then bump the pin.
2. **Mirror:** migration `pubinfo_committee_hearings`, the pubinfo row type
   and schema, and the write shape (pinned).
3. **Committees for every hearing code:**
   - the chamber is read from the code (`CX` Assembly, `CS` Senate) and the
     name from `LOCATION_CODE_TBL`;
   - the key is the linker's own `chamber:normalized-name`, so a committee
     later scraped from a member page lands on the same row;
   - existing committees are matched by that key, and the 24 Senate ones
     are created.
4. **Derive:** `bill_committee_assignments` for each derived bill is replaced
   in the bill's transaction, one row per distinct committee it was heard
   in. `referred_at` stays NULL: a hearing date is not a referral date, and
   nothing reads the column. The committee mapping joins the links hash, so
   a new committee re-derives every bill.
5. **Version and verification:** bump to bm4. Then UAT: a gate against the
   raw file, an unchanged re-import, and the committee page's bill list.

### D13 as built so far (2026-11-07)

- **Regions:** [opuspopuli-regions#100](https://github.com/OpusPopuli/opuspopuli-regions/pull/100)
  adds the tenth pubinfo source, keyed on bill, code, date and
  `trans_update_date`. Removing a key column from its headers fails the
  config test.
- **Migration** `20261107180000_pubinfo_committee_hearings` (approved by the
  owner) is applied to the dev DB and `postgres_test`, with no drift.
- **Row type:** `PubinfoCommitteeHearingRow`, its Zod schema and the write
  shape. Each is enforced by a table-keyed record, so a missing entry fails
  to compile.
- **Shared committee key:** `normalizeLegislativeCommitteeName` and
  `committeeExternalId` were lifted out of the committee linker as exported
  functions. The linker and the derive build the same
  `chamber:normalized-name` key, and the linker's 8 tests are unchanged.
- **Derive:**
  - `committeeIndex` maps every heard location code to a committee, created
    when missing. An existing committee keeps the name its member pages gave
    it. The short-description fallback drops the "Asm"/"Sen" prefix (no code
    lacks a long description today).
  - The committee map joins the links hash.
  - Hearings join `billsToDerive`'s changed-rows pass.
  - `bill_committee_assignments` is replaced in the bill's transaction,
    with `referred_at` NULL.
- **Version:** bumped to bm4, not re-pinned, since bm3 is on main. The next
  sync rewrites every bulk row once.
- **Tests:** two integration tests, mutation-checked:
  - referrals match an existing Assembly committee and create the Senate one,
    with repeat hearings giving one referral;
  - a new hearing re-derives only its bill.

  Backend 3,775, pipeline 768 and common 280 unit tests pass. `lint:sonar`
  is clean.

**Next:** #100 merged and published, then bump the pin. Then the UAT gate:
- referrals against the raw file's distinct bill–committee pairs (13,099 on
  2026-11-07, less any code with no committee);
- the 24 Senate committees created;
- the committee page's bill list;
- an unchanged re-import;
- the reviews.

### D13 on UAT (jobs 209, 210, 211), regions 1.0.108

**Version pin:** regions pinned at 1.0.108. Only the five regions lines of
the lockfile changed (`browserslist` drift reverted); a frozen install
accepts it.

**Run 209 (bm4, full rewrite):** 977,019 rows, including 17,166 hearings
created. All 5,065 bills were derived.
- **Referrals:** 13,099 across 4,154 bills, exactly the raw file's distinct
  bill–committee pairs. Compared bill by bill, 0 differ.
- **Committees:** all 24 Senate committees were created.
- **Found: a duplicate committee.** The export names "Economic Development,
  Growth, & Household Impact"; member pages spell it "and". The linker key
  did not fold "&", so the derive created a second Assembly committee.
  - My pre-check folded "&" itself and so missed this.
  - Fix: the shared `normalizeLegislativeCommitteeName` folds "&" into "and".
    No existing committee or member committee list contains "&", so no
    existing key changes. Unit test, mutation-checked.
  - The orphan row run 209 created had 0 referrals and 0 members, and was
    deleted (one row, a test artifact).

**Run 210 (same file, after the fix):** 0 rows written. Every bill was
derived again because the committee map changed, as designed. The existing
committee now holds its 38 bills; Assembly 85, Senate 24.

**Run 211 (same file again):** 0 written and 0 derived.

**Gateway:** `bills(committeeId)` for Senate Appropriations, a committee that
did not exist before, returns 1,803 bills. That is the committee page's bill
list, which had 3 rows in dev before.
