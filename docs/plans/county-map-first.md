# Plan: map-first navigation, and the county as a "treasure trove"

| | |
|---|---|
| **Issue** | Epic [#1474](https://github.com/OpusPopuli/opuspopuli/issues/1474), with 17 sub-issues, #1475–#1491 (§8) |
| **Date** | 2026-11-26 |
| **Author** | Rodney Gagnon (plan drafted by Claude Code under direction) |
| **Design of record** | [Map-first navigation](https://claude.ai/artifact/1YrJrzVCWgtJCtRG4hy3yk), version 9, "Locked v2: web + county treasure trove". The design files are `project/Main.dc.html` (phone), `project/Web.dc.html` (desktop) and `project/Notes.dc.html` (data, questions, pages affected). Every number in it is a stand-in |
| **Supersedes** | #1193 (the "Where you live" jurisdiction stack). Absorbs #1113 (`/c/[fips]` pages) and #1111 (map bundle and LCP) |
| **Release** | #1456 (the open civic record) is merged but held. Nothing ships to production until this lands (owner, 2026-11-26) |
| **Data classification** | **Public aggregate data.** County statistics are published by government sources and are about counties, not people. They are never joined to anything a reader tells us about themselves: `signal_profiles.income_range` is a T3 sensitive, encrypted band, and stays separate. A visitor's county code and district ids stay on their device, as in #1456 |
| **Migrations** | Yes, additive: a `county_statistics` table (§5.1) and a jurisdiction key on `meetings` (§4.2) |
| **New dependencies** | Build-time only: `topojson-server`, `topojson-simplify`, `topojson-client` (ISC). No new runtime map library |
| **Effort** | About 6–8 weeks of focused work across 5 phases, with phase 3 split per source |

## 1. Why

The county is the government where one person counts most. Five supervisors (eleven in San Francisco) decide roads, clinics, jails and land use for each county. A county measure needs thousands of signatures, not the hundreds of thousands a state initiative needs. Today `/region` opens on a stack of three cards, and county data is thin.

The owner's direction (2026-11-26): make the map the way in, and make the county page a treasure trove. The primary persona isn't decided, so the page is layered. It leads with where a reader's effort counts, then six themes to open, and every figure says why it matters. The goal is to get people to care, participate, and put their effort where it makes the biggest difference.

## 2. Decisions already made (owner, 2026-11-24 and 26)

1. **The county is the premise.** The level nav is a three-part strip, State ‹ County › City & town, with County always in the centre. Left goes up a level, right goes down. The sublabels are "Up a level", "Your focus" and "Down a level".
2. **No Federal anywhere in the map navigation, for now.** `/region/federal` stays as it is, reachable by URL and search.
3. **City & town gets an honest "Coming later" page,** with a "meanwhile" note on what the county does for city residents. This departs from #1194, which leaves the city out; the owner accepted that.
4. **"Where do you live?"** has three steps:
   - tap your county, which stores a public FIPS code only;
   - optionally, "Use my location" or an address: `LocateForm`, unchanged from #1456;
   - your districts.

   Change and Clear sit in a location chip.
5. **Accessibility.** The map is `aria-hidden`. A county search and a list of all 58 is the equivalent path (WCAG 2.1.1), reachable on every screen. Focus moves to the H1 on each view change.
6. **Three data-honesty tags,** used in the design: "Sample · we have this data", "Sample · public source, not loaded yet", "Illustrative · no common source yet". §3 sets the production rule.
7. **The county page is layered:**
   - "Where your effort counts": four tiles;
   - "Know your county": six themes. They are collapsed sections on a phone and a grid of cards on the web;
   - a CSV download, with source and date on every figure.

   Comparisons are **with the state, never a ranking of counties.**
8. **Web layout:**
   - The header carries Propositions, Bills, Committees and Search (the non-map paths), plus the location chip, EN/ES and an accessibility toggle.
   - Statewide: map on the left; heading, preview card and county list on the right.
   - County: the shape in the centre column (first in the page source, so it's read first), leverage on the left, board and meetings on the right. Columns stack below 1000 px.

## 3. A rule for production: no stand-ins

The mockup's tags describe a *design*. In production:
- A figure is shown only when it comes from a loaded source. It carries that source's name, its date, and a link.
- A figure we don't have yet **is not drawn with a placeholder value.** Its tile or row says "Not available yet", with the source we're working on. A stand-in number on a civic site would be read as fact. The same principle as #962: label what's uncertain, never invent.
- "Illustrative" content (Sonoma's hand-drawn district lines in the mockup, supervisor race margins) never ships as data.

## 4. Findings that shape the plan

Checked against the code on 2026-11-26. Several "have" claims in the mockup's data table don't hold yet.

### 4.1 What the design assumes against what exists

| The design says | The code has | Consequence |
|---|---|---|
| Population, registered voters, 2022 governor votes: **have** | Yes, in `county_thresholds` (one row per county). Three hard-wired sources feed one bespoke service (`county-threshold-sync.service.ts`). Only population keeps its own source and date, and that isn't exposed | Reuse. Move to the generic table in phase 3 so every figure has its own provenance |
| Supervisors: **have** | Only for **enabled** county plugins (`region_plugins.enabled`), via `supervisorsFor` (`region-query.service.ts`). All 58 county configs declare a representatives source; which are enabled is database state. Rosters beyond the enabled counties are #732 | The county page must handle "no roster yet" honestly, for most counties at first |
| Supervisorial districts: Sonoma only | Correct: only `sonoma.json` has `boundarySources` (#1136) | The other 57 get the whole board and no overlay, and say why (already in the design) |
| Meetings: **have** | Meetings exist, but **no county key**. `Meeting` has only a free-text `body`, and every county board is "Board of Supervisors". The page filters 100 rows on the client (#1139) | Phase 2 adds a jurisdiction key at ingest, a backfill, and a public `upcomingMeetings(fips)` |
| County measures: **have** | **Sonoma only** (12), through `Proposition.regionPluginName` (#1202) | Scoped by plugin; show "not loaded" elsewhere |
| Local campaign money: **have** | **None.** `Committee` has no county key, and the Sonoma NetFile sync writes 0 rows (#1163) | **Reclassified to "not loaded".** Out of scope here; depends on #1163 and its kind |
| City, school, fire, water boundaries: **have** | CITY and SCHOOL_DISTRICT_* (TIGER) and FIRE and WATER (geoportal) are loaded. COMMUNITY_COLLEGE, TRANSIT and SPECIAL_DISTRICT are not. **No endpoint lists them per county** | Phase 2: a per-county count and list, from `jurisdictions` with parent/containment |
| District shapes "in our database but not served" | Correct. **No geometry is served at all** (no `ST_AsGeoJSON` anywhere). County outlines are a static `ca-counties.geo.json`: 110 KB raw, ~21 KB gzipped, simplified per county, so shared borders can show hairline gaps | Phase 1 builds topology-preserving shapes at build time |
| Any county, signed out | The county page **returns the lookup form for a visitor with no location, even with `?fips=`** (`app/region/county/page.tsx`) | Phase 1: the county view takes a FIPS from the URL, whoever is reading |
| "Residents per supervisor (population ÷ 5)" | San Francisco has **11** supervisors | Divide by the roster count, or the seat count from config; never a constant |

### 4.2 No generic way to add a county figure

`county_thresholds` has a column per figure. The sync picks each source by which config key it sets: `sumAllValueColumns` for votes, `valueColumn` for registration, and `csv.field === "population"` (the schema's `field` enum allows only `"population"`). So adding ACS, E-1, Controller or turnout figures the current way means, for every figure:
- a schema enum change;
- a Prisma column;
- a new branch in the service;
- a GraphQL field.

That's about 20 times over. Phase 3 replaces this with one long-format table and one source shape (§5.1).

### 4.3 The map bundle

`CivicMap` imports MapLibre and deck.gl statically: about 273 KB plus 184 KB gzipped. Every screen in the prototype is plain SVG. Statewide and county navigation don't need tiles, WebGL or panning. **Decision for this plan:** navigation uses SVG paths from TopoJSON, and `CivicMap` stays for the petition map and any later zoomable work (#1128). This also settles #1111 (LCP waiting on the bundle) for the map pages.

## 5. Design: the data model

### 5.1 `county_statistics`, one row per figure

| Column | Type | Notes |
|---|---|---|
| `fips` | text | Five-digit county FIPS, or `06` for the state, so every comparison reads from the same table |
| `metric` | text | A stable key, such as `median_household_income`, `renter_share`, `unincorporated_share`, `spending_per_resident`, `turnout_general` |
| `value` | numeric | |
| `margin_of_error` | numeric, null | **ACS estimates carry a margin of error.** It's stored and shown beside the figure ("±$2,100") when it's large relative to the value |
| `unit` | text | `usd`, `percent`, `people`, `years`, `count` |
| `vintage` | text | What the figure describes, such as `2019–2023 ACS 5-year`, `2025-01-01`, `FY 2022–23`, `2024 general` |
| `source_id` | text | The region data source that produced it |
| `source_name`, `source_url` | text | What the reader sees and follows |
| `retrieved_at` | timestamptz | |

The primary key is `(fips, metric, vintage)`. A new vintage is a new row, so a figure's history survives a refresh. The page shows the latest vintage.

**Source config.** A new `dataType: "county_statistics"` in `@opuspopuli/regions`. It has `sourceType: "api"` (ACS, Controller) or `"bulk_download"` (E-1, Statement of Vote), and a `metrics` mapping from source column or variable to `metric`, `unit` and an optional transform (sum, ratio, share of total). One generic handler reads it, reconciles against the state row where the source has one (as `county_thresholds` does), and writes all 58 counties plus the state, or none. **Adding a figure becomes config, not code.**

**GraphQL.**
- `countyStatistics(fips): [CountyStatistic!]!` is `@Public` and returns the latest vintage of each metric, with the state's value beside it.
- `countyStatisticsCsv(fips)` returns every row with its provenance, for the download.

**Migrate `county_thresholds` into it,** in a later release: population, registered voters and governor votes become `county_statistics` rows. Keep `county_thresholds` and its query while the landing page and onboarding use them, and retire it in a follow-up release (the additive-only rule).

### 5.2 Shapes

There's a build-time script, `scripts/build-shapes.ts`, run by hand when boundaries change, about once a decade:
- It exports from PostGIS: counties, Assembly, Senate and Congressional districts, and supervisorial districts where loaded.
- It builds **TopoJSON**, so shared borders are one arc and can't gap.
- It simplifies with `topojson-simplify`, and quantises.
- It writes versioned static files under `apps/frontend/public/shapes/`, such as `ca-counties.v2026.topo.json`. They're immutable at the edge.
- The budget is under 30 KB gzipped for the 58 counties.
- Supervisorial districts ship one file per county, loaded only on that county's page.

A simple `<Shapes>` SVG component draws them. It sits beside `CivicMap`, not inside it, since `CivicMap` is a deck.gl surface.

## 6. Phases and subtasks

### Phase 0: owner decisions and issues (before code)

1. Settle the open questions in §7 marked **blocking**.
2. ~~File the epic and its issues (§8).~~ Filed 2026-11-26: #1474. #1193, #1113 and #1111 now point at it; closing them is the owner's call.

### Phase 1: the map and the county view, with data we have

**Where:** frontend, plus the shapes script.

1. **Shapes** (§5.2): the script, the `<Shapes>` component, and the county outlines replaced with the TopoJSON build. **Tests:** no gaps on shared borders (adjacent counties share arcs); the size budget; every FIPS present.
2. **Statewide page** (`/region` for a reader with no county):
   - the map, `aria-hidden`;
   - the heading and a preview card (name, population, signatures needed) on hover or focus;
   - a two-column list of all 58 counties with search, and a politely announced result count.

   Click or Enter opens a county.
3. **County view** (`/region/county/[fips]`, or `?fips=`; settle the URL in §7) for **any** county, signed in or out:
   - the shape in the centre;
   - the "Where your effort counts" tiles available now: residents per supervisor (population ÷ roster seat count), signatures and their share of registered voters (§9118);
   - the Board of Supervisors when a roster is loaded, or "not loaded yet";
   - the threshold.

   It replaces `JurisdictionStack` and `LayerCard` on `/region`. It absorbs #1113's per-county pages, including OG images.
4. **Level nav,** State ‹ County › City & town, on the county, state and city views:
   - the **State** view gains a shape header and "your legislators";
   - the **City & town** view is "Coming later" with the meanwhile copy, as plain text, not a disabled control.
5. **"Where do you live?"**:
   - step 1 taps or lists a county and stores its FIPS (§7 Q6 decides where);
   - step 2 is `LocateForm`;
   - step 3 shows your districts.

   The location chip in the header holds Change and Clear. A located reader's county opens directly.
6. **Desktop header:** Propositions, Bills, Committees, Search, the chip, EN/ES. The map pages leave `/region/federal` unlinked.
7. **i18n:** a new `map` namespace, EN and ES (informal *tú*, as the region copy uses). County names are proper nouns. "Condado de X" is a pattern, not a translation.

**Tests:**
- Playwright journeys on every PR browser: statewide → county by click and by keyboard, the where-flow, and a visitor viewing any county;
- axe on each view;
- focus moving to the H1 on view change;
- the #1456 signed-out guarantees (no account-only query; only ids stored).

### Phase 2: backend for what's loaded but not served

**Where:** region service. It's a federation change for each new field.

1. **Board by FIPS.** A public `countyBoard(fips)` that shares `supervisorsFor`'s core, so the #1136 seat matching stays in one place. It returns the roster, the seat count, and whether district lines exist.
2. **Meetings by county (#1139):**
   - stamp a jurisdiction key (`regionPluginName`, or the county's jurisdiction id) on each meeting at ingest;
   - backfill existing rows from their source;
   - add a public `upcomingMeetings(fips, take)` with `scheduledAt >= now`;
   - add a `meetingsCount(fips, since)` for the civic-activity theme.
3. **County measures by FIPS:** `countyMeasures(fips, elections: 2)` over `Proposition.regionPluginName` (#1202), honest where it's not loaded.
4. **What's in a county:** counts and lists of cities, school districts, and fire and water districts in a county, from `jurisdictions` by containment or parent. "Special districts" counts only the types we load, and says so.

**Tests:**
- integration, on the real test database: a known county's board, meetings and districts;
- the meetings backfill is idempotent;
- `@Public`, and `@SkipAudit` where an argument is the reader's location. A county FIPS chosen from a list isn't personal, so these are ordinary public reads.

### Phase 3: new county data sources

**Where:** `@opuspopuli/regions` (configs and schema), the generic handler, and `county_statistics`. One issue and one PR per source, in this order:

| # | Source | Figures | Shape | Cadence | Notes |
|---|---|---|---|---|---|
| 3.0 | **The generic table and handler** (§5.1) | — | — | — | First. Migrate nothing yet; the next four use it |
| 3.1 | **Census ACS 5-year** (Census Data API) | Median household income, median age, language other than English at home, poverty rate; renter share, median gross rent, rent burden (30%+ of income) | `api` | Yearly (December release) | Candidate tables: B19013, B01002, S1601/C16001, S1701, B25003, B25064, B25070. Confirm each. **Store the margin of error.** The API key is optional (a Vault secret if used) |
| 3.2 | **Department of Finance E-1** | Population by city and the unincorporated balance, so the share living outside any city | `bulk_download` (xlsx) | Yearly (May) | The figure for "For them, the Board of Supervisors is their only local government" |
| 3.3 | **State Controller,** county financial transactions (the "By the Numbers" open-data portal) | Total spending, spending per resident, the largest function (for example health and human services) | `api` or `bulk_download` | Yearly, about 2 years behind | **Show the fiscal year prominently:** it's old by design |
| 3.4 | **Secretary of State Statement of Vote** | Turnout by county, latest general and primary | `bulk_download` (xlsx) | Per election | The same publisher as the existing governor-votes source. Update both after November 2026 (`county_thresholds` hint) |

**For each source:**
- verify its licence or terms of use (all are expected to be public records, but record each);
- reconcile against its state total;
- write a unit test of the mapping against a fixture of the real file;
- write an integration test that a sync writes 58 + 1 rows or none;
- show its source and date on every figure.

### Phase 4: the treasure trove

**Where:** frontend, plus the CSV endpoint.

1. **"Know your county",** six themes, each figure with a one-line "why it matters" and, where useful, the state comparison:
   - **Power:** cities, the share outside any city, the district counts (phase 2.4);
   - **Elections:** registered voters, turnout (3.4). The supervisor race margin is **not shown** (§3);
   - **Money:** budget, spending per resident, the largest area (3.3);
   - **People:** income, age, language, poverty (3.1);
   - **Housing:** renter share, median rent, rent burden (3.1);
   - **Civic activity:** meetings in the last 12 months (2.2) and county measures (2.3). Local campaign money is "not loaded yet".

   They're collapsed sections on a phone and a grid of cards on the web. Each section is an h3.
2. **The fourth leverage tile,** "next board meeting, with public comment", once 2.2 lands.
3. **CSV download:** every figure for the county, with source, URL, vintage and date, plus the state's value. Built from `countyStatisticsCsv`, the board and the meetings.
4. **Provenance in the UI:** each figure's source and date, one click away, never only in the CSV.

### Phase 5: verify and release, with #1456

1. `/op-verify` on a production build against UAT:
   - every journey on phone and desktop widths;
   - a county with a full roster (Sonoma) and one without;
   - San Francisco's eleven seats;
   - EN/ES;
   - keyboard only.
2. **An accessibility review** of the list-as-equivalent approach (§7 Q7).
3. **Docs:**
   - `frontend-architecture.md`: the map pages, `<Shapes>` and the `map` namespace;
   - `docs/guides/region-provider.md`: how to add a `county_statistics` source.
4. **Release order:**
   - `@opuspopuli/regions` (the new sources);
   - the backend `v*` (new queries and migrations), then a sync of each new source on the node;
   - `frontend-v*`.

   This is the release that also takes #1456 to production, so its release gates apply: the gateway alerts (opuspopuli-node #72, with a real notification path) and the per-client rate limit (#73).

## 7. Open questions

| # | Question | Blocking? | Suggestion |
|---|---|---|---|
| Q1 | Does a tap open a county, or select it first? Small counties are a few pixels wide on a phone | Phase 1 | Tap opens. Add a "Did you mean…" confirmation only for counties under a size threshold, measured in the browser |
| Q2 | Does swiping follow left-is-up? | No | Yes, if swipe is added; a later enhancement |
| Q3 | Where does Federal return, if ever? | No | Leave it out; revisit after launch |
| Q4 | Which "Know your county" sections open by default? | Phase 4 | Power open, the rest collapsed. Count section opens (totals only, no visitor identifier) to learn |
| Q5 | Should a signed-in reader with a saved address skip the statewide map? | Phase 1 | Yes: land in their county, with "All counties" one tap away |
| Q6 | Where does a visitor's county live: `localStorage` or a cookie? | Phase 1 | `localStorage`, beside the #1456 district ids. A cookie would travel to the server on every request and land in edge logs, against the "we don't keep it" promise |
| Q7 | Is the county list an acceptable keyboard and screen-reader equivalent to the map? | Phase 5 | Yes, per WCAG 2.1.1, but get an accessibility reviewer's sign-off before release |
| Q8 | County URL: `/region/county/06097`, `/region/county?fips=06097`, or #1113's `/c/06097`? | Phase 1 | `/region/county/[fips]` with a server `layout.tsx` for metadata and OG images (the #1456 pattern), and redirects from `?fips=` and `/c/` |
| Q9 | Supervisorial districts for the other 57 counties: one statewide source, or county GIS portals? | No | County by county, a separate epic. Each one added upgrades a county from "whole board" to "your seat" with no code |
| Q10 | When browsing another county, do the tools for acting stay with the home county? | Phase 1 | Yes, as today: figures in full, tools with your own county |
| Q11 | Do "Illustrative" figures (race margins) appear at all? | Phase 4 | No (§3) |

## 8. Issues

Epic **#1474**. Its sub-issues:

| Phase | Issues |
|---|---|
| 1. The map and the county view | #1475 shapes (TopoJSON and `<Shapes>`) · #1476 statewide page · #1477 county view for any FIPS (absorbs #1113) · #1478 level nav, state and city views · #1479 where-flow and location chip · #1480 desktop header |
| 2. Backend for what's loaded | #1481 `countyBoard(fips)` · #1482 meetings by county (extends #1139) · #1483 `countyMeasures` (extends #1202) · #1484 cities and districts in a county |
| 3. New county data sources | #1485 the generic `county_statistics` table and handler · #1486 ACS 5-year · #1487 DoF E-1 · #1488 State Controller · #1489 Statement of Vote turnout |
| 4. The treasure trove | #1490 "Know your county" · #1491 CSV download |

**Separate epics, out of scope here:**
- supervisorial districts for the other 57 counties;
- supervisor rosters beyond the enabled counties (#732);
- local campaign finance (#1163);
- the city layer.

## 9. Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| A stand-in or wrong figure is read as fact about a named county | High × Possible | §3: no placeholders in production; source and date on every figure; ACS margins of error shown; reconcile each source against its state total, all-or-nothing |
| Most counties look empty (no roster, no meetings, no measures) | High × Likely at first | Lead with what every county has (population, threshold, the ACS, E-1, Controller and turnout figures); say plainly what isn't loaded and why; enable county plugins (#732) in parallel |
| A county statistic is joined to a reader's own signals | High × Rare | Never joined (data classification). A test asserts no query reads both `county_statistics` and `signal_profiles` |
| The map excludes keyboard and screen-reader users | High × Possible | The county list as the equivalent on every screen; axe and Playwright keyboard journeys; an accessibility reviewer's sign-off (Q7) |
| A data source changes its format or URL | Medium × Likely | Reconcile and abort on mismatch (no partial writes); a fixture test per source; an alert on a failed source sync |
| The ~2-year lag on Controller data reads as current | Medium × Likely | The fiscal year is shown beside the figure, not only in the CSV |
| Shapes drift from the database's boundaries | Low × Possible | Built from PostGIS by one script; versioned file names; regenerate on a boundary refresh (#1137) |
| Release coupling: this ships with #1456 | Medium × Possible | #1456's gates (alerts #72, rate limit #73) are listed in phase 5; no partial release |
| GPL dependency | Low × Rare | Build-time TopoJSON tools are ISC; no runtime additions |

## 10. Not in scope

- The city and town layer beyond "Coming later": officials, meetings and petition rules for 482 cities.
- Supervisorial districts outside Sonoma; supervisor rosters beyond enabled counties (#732); local campaign finance (#1163).
- Ranking counties against each other.
- Federal in the map navigation.
- A zoomable or tiled map for navigation.
