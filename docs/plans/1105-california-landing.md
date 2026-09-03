# Plan: California landing page — county initiative thresholds

| | |
|---|---|
| **Epic** | [#1105](https://github.com/OpusPopuli/opuspopuli/issues/1105) |
| **Stories** | [#1106](https://github.com/OpusPopuli/opuspopuli/issues/1106) schema · [#1107](https://github.com/OpusPopuli/opuspopuli/issues/1107) ingestion · [#1108](https://github.com/OpusPopuli/opuspopuli/issues/1108) GraphQL · [#1109](https://github.com/OpusPopuli/opuspopuli/issues/1109) CivicMap · [#1110](https://github.com/OpusPopuli/opuspopuli/issues/1110) hero · [#1111](https://github.com/OpusPopuli/opuspopuli/issues/1111) perf · [#1112](https://github.com/OpusPopuli/opuspopuli/issues/1112) philosophy · [#1113](https://github.com/OpusPopuli/opuspopuli/issues/1113) per-county |
| **Date** | 2026-09-02 |
| **Author** | Rodney Gagnon |
| **Target** | `california.opuspopuli.org/` — replaces the feature-card landing page |
| **Data classification** | **None — public records only.** Active profile `us-state-privacy` + `soc2`. That no personal data appears on this route is a *tested property*, not an incidental one (epic criterion 9). |
| **Migrations** | One, additive: `counties` + `county_adjacency`. |
| **Federation** | Yes — [#1108](https://github.com/OpusPopuli/opuspopuli/issues/1108) adds a query to the region subgraph. |
| **Source brief** | `SPEC-california-landing.md`, **purged after this plan was written** — everything load-bearing from it is reproduced here. |
| **Visual comp** | `docs/design/california-landing-mockup.html` — kept. A standalone mockup with real county geometry and placeholder figures. **Treat it as a comp, not as code to port**: it renders inline SVG, and production uses the real map stack (see Rendering). |
| **Philosophy source of truth** | `opuspopuli.org` repo — `src/pages/foundation.astro`, `src/pages/why.astro`. Published at https://opuspopuli.org/. Not duplicated into this repo. |

## One line

Lead with a checkable fact about the visitor's own county — how few people it
takes to put an initiative on their ballot — and let the feature cards answer
the question that fact raises.

## The thesis

California Elections Code **§9118**: a county initiative petition signed by
voters equal to at least **10% of the entire vote cast in that county for all
gubernatorial candidates** at the last gubernatorial election obliges the board
of supervisors either to adopt the ordinance without alteration or submit it to
the voters.

That number is small — on the order of **60 people in Alpine County**, about
**5,137 in Nevada County**. The page shows it for all 58 counties.

The argument is **not** "join us and we can reach this." It is **"a group this
size already governs where you live, and it may not be you."**

## The constraint that outranks visual polish

**Every figure must trace to a public record**, with a stored source URL and
retrieval date. No modeled figures, no estimates presented as facts, no borrowed
statistics.

The rhetorical weight rests entirely on a skeptical reader being able to verify
the numbers against their county elections office. This is why `source_url` and
`retrieved_at` are `NOT NULL` on the fact table rather than living in a
metadata table: a row that cannot cite itself cannot be rendered.

## Rejected, and why — do not reintroduce

| Rejected | Why |
|---|---|
| Chenoweth's 3.5% rule / ~26,000 statewide target | The arithmetic does not work — 26,000 is 0.066% of California — and the underlying research concerns maximalist campaigns against authoritarian governments, not liberal democracies |
| "Plant a seed / watch democracy grow" sunflower density map | Requires user data the platform does not have yet, and looks broken before anyone signs up. May return later as its own feature |
| "Adopt a county you don't live in" | Reads as astroturf, gamifies places into trophies, and invites gaming of the one number that must stay honest |
| Signup counts or activation progress anywhere on this route | This page uses public records only. Keep it that way |
| A statewide "counties activated" headline metric | A dozen coordinated people could produce it in a weekend |

## Framing constraint

The share-of-registered view makes low-turnout counties look "cheapest." The
copy must **not** present that as an opportunity to exploit. The correct
reading, and the one the page states: where turnout is low, a small organized
group *already governs*, whether or not that group is you. Same arithmetic,
honest framing, and much harder to dismiss.

## Data sources

| Field | Source | Notes |
|---|---|---|
| `gubernatorial_votes` | CA SOS **Statement of Vote**, Nov 2022 general, county totals for **all** gubernatorial candidates | The §9118 denominator. **Not votes for the winner.** Update after Nov 2026 |
| `registered_voters` | CA SOS **Report of Registration** | Store `as_of` |
| `population` | US Census county population estimates | Display only; never used in a threshold |
| `geom` | US Census **cartographic boundary** file, CA subset, simplified | ~60–80KB TopoJSON at 500k |

Statutes to cite inline: **Elections Code §9118** (county initiative, 10%; 20%
compels a special election) at `leginfo.legislature.ca.gov`; **Cal. Const. art.
II §8(b)** with **Elections Code §9035** for the statewide 5%/8% requirements
(**546,651** and **874,641**) at
`sos.ca.gov/elections/ballot-measures/how-qualify-initiative`.

**Locate current URLs at build time rather than hardcoding deep links** — the
SOS reorganizes paths between cycles.

## Data design — corrected against production

**The brief's schema is superseded.** It proposed a `counties` table carrying
`fips`, `name`, `geom` and the threshold facts. Checked against production
before planning:

```
jurisdictions WHERE state_code='CA'
  COUNTY                   58 rows   with_fips 58   with_geom 0
  CONGRESSIONAL_DISTRICT   52 rows   with_fips 52   with_geom 0
  STATE_ASSEMBLY_DISTRICT  80 rows   with_fips 80   with_geom 0
```

Two facts follow, and they pull in opposite directions:

**County identity already exists.** All 58 counties are `jurisdictions` rows
with `fips_code`, `name`, `type = COUNTY`. A `counties` table duplicating that
gives the platform two answers to "what is FIPS 06057 called", and they will
diverge the first time one is reloaded and the other is not.

**County geometry does not exist anywhere.** `jurisdictions.boundary
geography(MultiPolygon, 4326)` is declared, the TIGER fetcher and
`boundary-loader.service.ts` are built, and **nothing is loaded** — for any
jurisdiction type in California. This is almost certainly why
`jurisdiction-resolution.service.ts` logs *"boundary geometries don't cover this
point"*: the PostGIS query runs against an empty column.

### Revised

| Brief said | Revised | Why |
|---|---|---|
| `counties.fips`, `.name` | Join `jurisdictions` on `fips_code` | 58 rows already exist; a second identity source drifts |
| `counties.geom geometry(…, 4269)` | Populate `jurisdictions.boundary geography(…, 4326)` | Column, fetcher and loader all exist and are unused. Two geometry sources at two SRIDs is a trap, and 4326 is what the resolution query already assumes |
| threshold columns on `counties` | New narrow `county_thresholds`, keyed by `fips` | These facts genuinely have no home today |
| `county_adjacency` from `counties.geom` | Same, computed from `jurisdictions.boundary` | Unchanged in spirit |

```sql
CREATE TABLE county_thresholds (
  fips                  varchar(20) PRIMARY KEY
                          REFERENCES jurisdictions(fips_code),
  gubernatorial_votes   integer  NOT NULL,   -- ALL candidates, last gubernatorial general
  gubernatorial_year    smallint NOT NULL,
  registered_voters     integer,
  registration_as_of    date,
  population            integer,
  population_source     text,
  population_as_of      date,
  source_url            text        NOT NULL,
  retrieved_at          timestamptz NOT NULL
);

CREATE TABLE county_adjacency (
  fips      varchar(20) REFERENCES jurisdictions(fips_code),
  neighbor  varchar(20) REFERENCES jurisdictions(fips_code),
  PRIMARY KEY (fips, neighbor)
);
```

Derived in the query, never stored:

- `signatures_required = ceil(gubernatorial_votes * 0.10)` — round **up**; a
  fractional signature is not a thing, and rounding down understates a legal
  requirement.
- `share_of_registered = signatures_required::numeric / registered_voters`

`source_url` and `retrieved_at` are `NOT NULL` on the fact table rather than in
a metadata table, because a row that cannot cite itself cannot be rendered.

### Consequence worth naming

Loading county boundaries is no longer landing-page-only work. It fills a gap
that currently breaks county representative resolution, so
[#1107](https://github.com/OpusPopuli/opuspopuli/issues/1107) touches a path
other features depend on. Its tests must cover jurisdiction resolution, not only
the map.

## Verification

**Nevada County must show 5,137 signatures**, from 51,370 votes cast in November
2022, matching the county's own published figure. That is the canonical check
that the pipeline read the right column.

Range smoke tests across all 58: `signatures_required` roughly **60 to
240,000**; `share_of_registered` between about **3% and 8%**. Anything outside
that band means the Statement of Vote parse grabbed the wrong column — most
likely the winner's votes rather than all candidates', which would understate
every threshold on the page.

Ingestion **fails loudly rather than partially**: a county missing from the
parse aborts the run rather than writing a null, because a missing county
renders as an unshaded polygon that reads as data rather than as absence.

## Rendering

`<CivicMap>` is a new shared component — MapLibre GL, deck.gl `MapboxOverlay`
interleaved, viewport state internal, `layers` as a prop. The landing page is
its first consumer; the petition map passes its clustered scatter layers to the
same component later. **No California-specific logic inside it.**

**No tile source.** A style with only a background layer is valid MapLibre.
County polygons on the brand ground: no basemap, no zoom, no third-party tile
requests — a privacy property as much as a performance one.

**Bundle cost is the real constraint**: MapLibre plus deck.gl is ~400–450KB
gzipped on the highest-traffic route. `next/dynamic` with `ssr: false`, and a
pre-rendered static SVG snapshot as the placeholder, regenerated on the data
cadence. The snapshot is the LCP element and must be the real picture — the map
*is* the argument, so a spinner there means the first thing a visitor sees is a
loading state where a fact about their county should be.

### Map modes

1. **Share of registered voters** (default), linear ramp. **This mode carries
   the argument**, because the §9118 threshold is pegged to votes cast rather
   than registration, so its share of the electorate moves with turnout.
2. **People**, log ramp. Raw counts span four orders of magnitude; linear
   renders 55 of 58 counties identically.

## Page structure

1. Header — existing, plus EN/ES and the appearance toggle
2. Hero — headline, two-paragraph lede stating §9118, map + rail
3. "The minority is organized" — Mosca, Michels, Schattschneider, Tocqueville
4. "Why unequal knowledge is a justice problem" — Rawls, Dewey, Habermas, Paine
5. "The strongest objection" — Downs at full strength, the two-term answer, Lippmann/Brennan, four concessions
6. Features — existing four links, unchanged targets
7. Trust — existing two panels
8. Footer — existing disclaimer **verbatim; it is legal copy, do not rewrite**

Rail per county: population, registered voters, gubernatorial votes (with source
tag), signatures required (the large figure), share of registered voters, rank
among 58, cheapest adjacent county with a link. Default state: statewide figures
plus 546,651 / 874,641.

Footnote: statute citations, the 20% special-election variant, the explicit
caveat that **qualifying a measure is not passing one**, and the note that
general-law cities use a different basis (10% of *registered voters*; charter
cities set their own).

## Requirements

**Accessibility.** Every county polygon keyboard-reachable and activatable
(`tabindex`, Enter, Space) with an `aria-label` carrying name and threshold. Map
modes a labelled radio group. Respect `prefers-reduced-motion` on the fill
transition. **No figure encoded only in colour.**

**i18n.** Every string in the message catalog, including all thinker copy. ES is
a shipping locale, not an afterthought. Numbers through `Intl.NumberFormat` with
the active locale.

**Performance.** LCP driven by the static snapshot. Data query cached with ISR
on the order of hours.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| A second county identity source diverges from `jurisdictions` | high × likely | Superseded before implementation: join `jurisdictions` on `fips_code`, never restate name or FIPS |
| First-ever load into `jurisdictions.boundary` breaks jurisdiction resolution for other features | **high** × possible | Subtask 2's tests cover resolution, not just the map; the column is empty today so the change can only add behaviour, but the query path is shared |
| Geometry stored at two SRIDs (4269 vs the existing 4326) | medium × possible | Single source: `jurisdictions.boundary geography(…, 4326)`, which the resolution query already assumes |
| Statement of Vote parse reads the winner's column rather than all candidates | **high** × possible | Nevada County = 5,137 asserted in a test; 3–8% band across all 58 |
| A county missing from the parse renders as an unshaded polygon that looks like data | high × possible | Ingestion aborts on any gap rather than writing null |
| 450KB map bundle lands on the highest-traffic route | medium × likely | Static snapshot drives LCP; map dynamically imported, `ssr: false` |
| Low-turnout counties read as "cheap targets" | medium × likely | Framing constraint above is a copy requirement, not a preference |
| Nov 2026 election silently invalidates every figure | **high** × certain | Open question 3 must be decided before that cycle; `gubernatorial_year` stored per row |
| SOS reorganizes deep links between cycles | medium × likely | Resolve URLs at build time, never hardcode |
| ES machine translation flattens the philosophy sections | medium × likely | Open question 1; decide the approach before [#1112](https://github.com/OpusPopuli/opuspopuli/issues/1112) starts |
| `PHILOSOPHY-foundation.md` absent, so the copy has no committed source | medium × certain | Preserved verbatim in the appendix below; confirm whether the companion doc lands here |
| `<CivicMap>` accretes California logic and stops being reusable | medium × possible | Epic criterion 10; petition map is the second consumer that proves it |

## Subtasks

Each is one focused session. Dependencies are listed; nothing else blocks.

### 1 — Schema ([#1106](https://github.com/OpusPopuli/opuspopuli/issues/1106), P0)

**Package:** `packages/relationaldb-provider` · **Migration: yes, additive**

- `prisma/migrations/<ts>_county_thresholds/migration.sql` + `down.sql`
- `prisma/schema.prisma` — `CountyThreshold`, `CountyAdjacency`; no changes to `Jurisdiction`

Two tables as in *Data design*. No new geometry column — county geometry lands
in the existing `jurisdictions.boundary`.

**Tests:** integration against a real database — the FK to `jurisdictions.fips_code`
rejects an unknown FIPS, and `NOT NULL` rejects a row without provenance.

### 2 — County boundaries into `jurisdictions.boundary` ([#1107](https://github.com/OpusPopuli/opuspopuli/issues/1107), P0)

**Service:** `region` · Depends on 1

- `src/apps/region/src/domains/boundary-loader.service.ts` — extend, do not fork
- `src/apps/region/src/domains/boundary-fetchers/tiger.fetcher.ts` — reuse

Load CA county boundaries via the existing TIGER path. **This is the first
geometry in the column**, so verify against `jurisdiction-resolution.service.ts`:
an address inside a county must now resolve to it. That query has been running
against an empty column.

**Tests:** integration — 58 counties with non-null `boundary`; a known
lat/lng resolves to the right county; `ST_Touches` adjacency is symmetric.

### 3 — Threshold ingestion, verified ([#1107](https://github.com/OpusPopuli/opuspopuli/issues/1107), P0)

**Service:** `region` · Depends on 1, 2

- `src/apps/region/src/scripts/ingest-county-thresholds.ts` — mirrors the
  existing `backfill-*` script shape
- Adjacency materialized after load, from `jurisdictions.boundary`

Idempotent; **aborts** on a county missing from the Statement of Vote parse
rather than writing a null.

**Tests:** **Nevada County = 5,137** asserted, not eyeballed. All 58 present.
`signatures_required` 60–240,000; `share_of_registered` 3–8% for every county.
A second run writes nothing.

### 4 — GraphQL surface ([#1108](https://github.com/OpusPopuli/opuspopuli/issues/1108), P0)

**Service:** `region` · **Federation: yes — validate composition at the gateway** · Depends on 3

- `src/apps/region/src/domains/region.resolver.ts` — `countyThresholds` query
- `.../models/county-threshold.model.ts` — derived `signaturesRequired`,
  `shareOfRegistered`, `rank`, `cheapestNeighbor`, plus `sourceUrl` / `retrievedAt`

Unauthenticated — this is the public landing route. Geometry is **not** served
here; it ships as a static TopoJSON asset.

**Tests:** unit on the derived fields incl. `ceil` rounding; integration for
all 58 and cheapest-neighbor; gateway composition check.

### 5 — `<CivicMap>` ([#1109](https://github.com/OpusPopuli/opuspopuli/issues/1109), P1)

**App:** `apps/frontend`

- `components/map/CivicMap.tsx` — MapLibre + deck.gl `MapboxOverlay`, `layers` prop
- `components/map/CivicMap.test.tsx`

No California concept inside it. Background-only style: **zero external tile
requests**, asserted in a test.

### 6 — Hero, modes, rail ([#1110](https://github.com/OpusPopuli/opuspopuli/issues/1110), P1)

**App:** `apps/frontend` · Depends on 4, 5

- `app/page.tsx` — replaces the feature-card landing
- `components/landing/CountyMap.tsx`, `CountyRail.tsx`, `MapModeToggle.tsx`
- `lib/graphql/counties.ts`
- `locales/{en,es}/landing.json` — every string, no inline copy

**Tests:** unit per component; a11y — full keyboard traversal, radio-group
modes, `prefers-reduced-motion`; `pnpm test:a11y`.

### 7 — Static snapshot ([#1111](https://github.com/OpusPopuli/opuspopuli/issues/1111), P1)

**App:** `apps/frontend` · Depends on 5, 6

- `scripts/generate-map-snapshot.ts` — regenerated on the data cadence
- `app/page.tsx` — `next/dynamic`, `ssr: false`

**Tests:** map bundle absent from the route's initial JS; no layout shift on swap.

### 8 — Philosophy sections ([#1112](https://github.com/OpusPopuli/opuspopuli/issues/1112), P2)

**App:** `apps/frontend` · Depends on 6

- `components/landing/{Minority,Knowledge,Objection}Section.tsx`
- `locales/{en,es}/landing.json`

Wording condensed from `opuspopuli.org` `src/pages/foundation.astro` — **not**
from this plan's appendix, which is the older mockup variant.

### 9 — `/c/[fips]` + OG images ([#1113](https://github.com/OpusPopuli/opuspopuli/issues/1113), P3)

**App:** `apps/frontend` · Depends on 4, 6

- `app/c/[fips]/page.tsx` — `generateStaticParams` for all 58
- `app/c/[fips]/opengraph-image.tsx`

**Tests:** all 58 routes generate; OG image renders name and threshold.

## Effort

| | |
|---|---|
| P0 (1–4) | ~4 days. Subtask 2 carries the unknown — it is the first geometry ever loaded into that column |
| P1 (5–7) | ~4 days |
| P2 (8) | ~2 days, plus whatever the ES decision costs |
| P3 (9) | ~2 days |

~12 days, assuming the Statement of Vote parses cleanly. It is a published
spreadsheet, not an API, so that assumption is the soft spot in the estimate.

**Branch:** `feat/california-landing-1105`, one branch per subtask off it.

## Open questions

1. **ES translation approach for the philosophy sections.** Dense prose where the paraphrases carry the argument; machine translation will flatten them.
2. **Should `/c/[fips]` surface the nearest local contest margin** from county returns? The most persuasive number available, same ingestion layer, but a considerable scope expansion.
3. **November 2026 resets every threshold.** Show the current cycle with an "as of" date, or both cycles during the transition? Decide now — it changes the schema's read path.
4. ~~`PHILOSOPHY-foundation.md` is not in this repository.~~ **Answered.** The
   canonical argument lives in the `opuspopuli.org` repo —
   `src/pages/foundation.astro` (long form, all eleven thinkers, the objections
   with their answers, and the four concessions as structured data) and
   `src/pages/why.astro`. It is published at https://opuspopuli.org/ and its
   latest commit is *"feat(content): rebuild the argument on the §9118 county
   threshold (#16)"* — the same statutory argument this page is built on. Do not
   commit a copy into this repository; reference it.

---

## Appendix — philosophy copy, preserved from the mockup

**This is not the source of truth.** The canonical argument lives in the
`opuspopuli.org` repo at `src/pages/foundation.astro` and `src/pages/why.astro`,
published at https://opuspopuli.org/. That version is fuller: it carries all
eleven thinkers, states each objection *with its answer*, and holds the four
concessions as structured data rather than prose.

What follows is the **condensed variant written for the landing page**,
extracted verbatim from `docs/design/california-landing-mockup.html`. The two
differ in development, not in argument — compare Downs:

> mockup: *"the cost is real. Staying ignorant is not a failure of character."*
> canonical: *"the cost is entirely real. Remaining ignorant is not a character failure; it is the correct decision."*

Keep it for the shape and length the landing page needs.
[#1112](https://github.com/OpusPopuli/opuspopuli/issues/1112) should take its
wording from `foundation.astro` and condense to this shape, not treat the text
below as authoritative.

### The minority is organized. That is the whole of its advantage.

The claim on this page is not that democracy is broken. It is older and more specific: that in any large polity, an organized few decide, and the many do not, because the few can coordinate and the many cannot. Every serious student of this has said so for a century, and the county threshold is what it looks like in arithmetic.

*Gaetano Mosca — The Ruling Class, 1896*

A minority governs not because it is wiser or better born but because it is **organized against a disorganized majority**. Numbers are not power until they are coordinated.

*Robert Michels — Political Parties, 1911*

The iron law of oligarchy: organization itself concentrates control, even in movements founded to prevent exactly that. **This applies to us too**, and we say so again below.

*E. E. Schattschneider — The Semisovereign People, 1960*

Power lies in **defining which alternatives get considered** at all. The chorus of organized interests, he argued, sings with an upper-class accent. Whoever frames the ballot has already won most of the argument.

*Alexis de Tocqueville — Democracy in America, 1835*

Local institutions are where citizens actually **learn the practice of liberty**. This is why the county, not the state, is the unit of this map.

### Why unequal knowledge is a justice problem and not a curiosity.

If the county threshold were merely interesting, it would belong in a civics textbook. What makes it urgent is that the right to participate is worth close to nothing when the knowledge required to use it is distributed as unevenly as everything else.

*John Rawls — A Theory of Justice, 1971*

Political liberties must have **fair value**, not merely formal equality. A right that some citizens lack the resources to exercise is a right in name only, and a just society is obliged to guarantee its worth rather than declare it. Information asymmetry is a defect in the fair value of political liberty, precisely in Rawls's sense.

*John Dewey — The Public and Its Problems, 1927*

The public is **eclipsed, not absent**. It cannot recognize itself or trace which decisions affect it, and the remedy is to improve the conditions of inquiry and communication rather than to hand the work to experts.

*Jürgen Habermas — The Structural Transformation of the Public Sphere, 1962*

Legitimacy comes from **reasoned discourse among informed equals**. As the public sphere is captured by commercial and administrative interests, the discourse that legitimizes decisions thins out into publicity.

*Thomas Paine — Common Sense, 1776*

Wrote in the plainest available language on purpose, because **comprehensibility was the political act**. The pamphlet was the argument and the distribution method at once.

### The strongest objection, and what we are actually doing about it.

A platform premised on better civic information has to answer the argument that better civic information changes nothing. That argument is good, and it is older than we are.

**Anthony Downs, An Economic Theory of Democracy, 1957**

**Rational ignorance.** A single vote decides essentially nothing, so the expected benefit of becoming informed is near zero while the cost is real. Staying ignorant is not a failure of character. It is the correct decision. On this account, publishing more information changes no one's behavior, because cost was never the binding constraint — pointlessness was.

**The answer has two terms, and we are attacking both.** Downs's conclusion depends on a product: how much it costs you to know, multiplied by how little your participation matters. The platform attacks the first term by making a ballot measure legible in minutes instead of an evening. The county threshold attacks the second, and attacks it harder. One signature out of the 5,137 that compel Nevada County's board is not a lottery ticket. It is roughly one part in five thousand of a binding outcome, which is several orders of magnitude away from one vote in a statewide election. Downs is right about the state. He is much weaker about the county.

**Walter Lippmann, The Phantom Public, 1925 · Jason Brennan, Against Democracy, 2016**

Ordinary citizens cannot know enough to govern a modern society, so decisions should rest with those who can. Dewey answered Lippmann by relocating the problem from citizens to the conditions they act under, and that is the wager here: that what looks like incapacity is substantially an access cost.

**This is falsifiable and we intend to leave it that way.** If civic knowledge becomes cheap and participation does not improve, Brennan gains ground and we should say so rather than move the goalposts.

**What we concede**

- Ten percent qualifies a measure. It does not pass one. A majority at the ballot is a separate and larger problem.
- Lowering the cost of knowing does not supply a motive for caring, and we have no evidence yet that it does.
- Michels applies to Opus Populi. An organization built to disperse civic power will tend to concentrate it, which is why the code is open, the AI charter is public, and the governing structure is a foundation rather than a company.
- A tool that makes organizing cheaper makes it cheaper for everyone, including people whose aims we would find objectionable. That is what neutrality costs, and we think it is the right price.
