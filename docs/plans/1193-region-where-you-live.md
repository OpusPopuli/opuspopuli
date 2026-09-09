# Plan: /region → "Where you live" — the jurisdiction stack

| | |
|---|---|
| **Epic** | [#1193](https://github.com/OpusPopuli/opuspopuli/issues/1193) |
| **Date** | 2026-09-09 |
| **Author** | Rodney Gagnon (direction set in a design session with Claude Code) |
| **Stories** | [#1194](https://github.com/OpusPopuli/opuspopuli/issues/1194) stack index · [#1195](https://github.com/OpusPopuli/opuspopuli/issues/1195) county · [#1196](https://github.com/OpusPopuli/opuspopuli/issues/1196) state · [#1197](https://github.com/OpusPopuli/opuspopuli/issues/1197) federal · [#1198](https://github.com/OpusPopuli/opuspopuli/issues/1198) banded search · [#1199](https://github.com/OpusPopuli/opuspopuli/issues/1199) switcher · [#1200](https://github.com/OpusPopuli/opuspopuli/issues/1200) i18n + a11y |
| **Status** | Filed 2026-09-09. Not started. |
| **Target** | `/region` — replaces the five-card state directory |
| **Data classification** | **PII — no PHI.** This route is behind `ProtectedRoute` and deliberately uses the reader's resolved jurisdictions and address-derived county. That is the opposite of the landing route's public-records-only rule (#1105 criterion 9), and the distinction must stay explicit in tests. No new personal data is collected; everything comes from `user_jurisdictions` and `UserAddress` already captured at onboarding. |
| **Migrations** | **None of its own.** Depends on #1139 for jurisdiction on propositions/meetings. |
| **Federation** | None — the layer pages compose existing queries. |
| **Supersedes** | [#702](https://github.com/OpusPopuli/opuspopuli/issues/702) (county supervisor on region home) — absorbed by subtask 2. Close it as superseded when that lands, or the work gets done twice. |
| **Mockups** | Concepts <https://claude.ai/code/artifact/34c21f5a-bd6b-44f1-bd03-8e88c8111c88> · Stack + layer pages <https://claude.ai/code/artifact/9fb5f54c-4c53-413f-a12e-eaa3214fd961>. **Comps, not code to port**, and both predate the scope cut below — read them for the stack idea and the row anatomy, not for the page weight. Every figure marked `°` is a placeholder. |
| **Related** | `docs/plans/search-surface-direction.md` — the search half of the same session. Already yielded [#1179](https://github.com/OpusPopuli/opuspopuli/issues/1179), [#1180](https://github.com/OpusPopuli/opuspopuli/issues/1180). |

## One line

Invert the containment: `/region` stops being a directory of California and
becomes **the three governments that claim the reader's address** — each one a
short, scannable page that says who governs here and what has happened here
lately.

## The problem

`/region/page.tsx` renders five cards under the heading "California":
Propositions, Representatives, Campaign Finance, Bills, Legislative Committees.
The word "county" appears nowhere on it.

That is out of step with everything else shipped this year. Onboarding **opens**
on the reader's county and shows them their own §9118 threshold in step two
(`CountyStep`, `ThresholdStep`). The landing page is a county choropleth. The
briefing is personal. Then `/region` hands them five nouns and a filing cabinet.

It is also the wrong shape for *using*. To find out whether anything happened
about housing near you, today you pick a noun, then wade — 1,240 bills behind
one of those cards, with no indication of that before you click.

## Scope decision — the cost column is out (owner, 2026-09-09)

An earlier draft of this plan carried a "what it would take" column on every
row — signatures to repeal, minutes at the podium, one assemblymember — plus a
matching lever band on each layer page. **Dropped: less is more.**

What that changes, deliberately:

- `/region` is now an **organizing** surface, not an argument. The argument
  lives on the public landing page (#1105) and in onboarding, where a reader
  meets it once, at the right moment. Restating it on every repeat visit spends
  attention the platform exists to save.
- The per-page **lever band is gone**, including the rhetorical empty one on the
  federal page.
- **One exception survives**: the county's §9118 threshold, on the county page
  header, as a single cited fact. It is live data with provenance, it is one
  line, and it is the reason the county is first.
- [#1179](https://github.com/OpusPopuli/opuspopuli/issues/1179) ("what would it
  take to…" as a search query type) **continues independently** in the search
  epic. It needs no model and no service from here. This plan no longer owns it
  and no longer blocks it.

**Do not reintroduce** a per-row cost column into these pages without revisiting
this decision.

## The constraint that shapes everything

**The level where the reader has leverage is the level where we hold the least
data.**

| | County | State |
|---|---|---|
| Live | thresholds (58/58) · Sonoma supervisors (#1136) · Sonoma meetings (#1162, landed) | propositions · bills · legislative committees · campaign finance · representatives |
| Building | county measures (#1113) · local filers (#1163) | — |

The design must carry that asymmetry rather than hide it, which is why the layer
pages reuse the **Live / Building** tags already shipping in
`components/onboarding/steps/ExpectationsStep.tsx`. A reader who finds the gap
by its absence reads a broken product; a reader told up front reads an honest
one.

## Design

### Three layers, not four or five

`County → State → Federal`, listed **smallest first**.

**The city is deliberately omitted.** It is the smallest unit and probably where
a reader has the most leverage per signature — which is the argument for leaving
it out rather than stubbing it. A `Building` row on the highest-leverage
government in the stack advertises that gap on every page load, indefinitely. It
slots back in as a fourth card, no structural change, the day there is something
behind it.

**The supervisorial district is not a layer.** It is one of five seats on one
board, and there is no district-level petition — §9118 is county-wide. It
renders as a *seat line inside the county card* ("5 seats · yours is District 5
· Lynda Hopkins") with the re-resolve link beside it. For the 57 counties
without supervisorial boundaries the line degrades exactly as #1136 specifies:
no district resolved → all supervisors, nothing false claimed.

### Two parts per layer page, not three

1. **Who governs here** — the body, its size, and the reader's own seats,
   resolved from their address. County only: the §9118 threshold as one cited
   line.
2. **What's here** — recent and relevant first, then a compact index by type
   with counts.

That second part is the whole redesign. Today's page is *only* the type index,
unsorted and uncounted. Leading with recency-and-relevance, and putting a number
on every door before the reader opens it, is what makes the same data worth
interacting with.

Target page weight: roughly **five recent rows and five index rows**. If a layer
page needs a scrollbar to show its own shape, it has drifted.

### One row anatomy, everywhere

Every row on every layer page is one line: type badge · what happened · when.
Same anatomy on all three levels, so scanning transfers between them and a
reader learns it once. The existing `LayerNav` depth idiom
(`components/region/LayerNav.tsx`) stays where it is — on detail pages — and is
not re-invented here.

### Seats are navigation, not decoration

The reader's own seats render as chips in the header, and clicking one **filters
the list in place** — client-side, instant, over rows already loaded. Same
"deliberately dumb" principle as the list filters shipped in #1155. This is the
cheapest interaction in the plan and the one most likely to be used twice.

### Gold is wayfinding

The brand rule (`globals.css`: fill, ≥3px rule, or text-on-ink — never gold text
on paper) is spent in one place: the county. Gold left rule on the county card,
gold badge on county rows. With the argument gone, gold is now a **wayfinding**
device — "this is the near one" — rather than a claim about leverage. It must be
redundant with a text label, never the sole carrier of the distinction.

### Routes

**Keep `/region`.** Deep links survive, `/region/bills` and friends do not move,
no migration. Change the **nav label** to "Where you live" (`Region` is a system
word from `region-provider` / `region_plugins`; readers have no such concept).

| Route | Is |
|---|---|
| `/region` | the stack index — three cards |
| `/region/county` | county layer page |
| `/region/state` | layer page; absorbs today's five cards as its type index |
| `/region/federal` | layer page |
| `/region/bills`, `/propositions`, … | unchanged — the layer pages link into them |

### The county switcher

Pre-selected from the reader's resolved county. Three rules, all derived from
the epic-#1105 rejection of "adopt a county you don't live in":

- **Home is a permanent badge** — no state in which the page forgets where you live.
- **Visiting is read-only and explained** — action affordances go quiet with one
  line saying why. Disabled-and-explained, never disabled-and-silent.
- **Never sorts by fewest signatures.** That ordering is the "cheapest county"
  reading with a UI around it, which the epic's framing constraint forbids.

## Subtasks

Each is one focused session. Dependencies listed; nothing else blocks.

### 1 — Stack index + rename (P0)
**App:** `apps/frontend` · no dependencies

- `app/region/page.tsx` — replaces the five-card grid with three layer cards
- `components/region/JurisdictionStack.tsx`, `LayerCard.tsx`
- `components/Header.tsx` — nav label, desktop + mobile
- `locales/{en,es}/region.json`

Cards read from the existing user-jurisdiction path. Each card carries a count
of what is new at that level; the county card carries the seat line. Cards are
**links**, not accordions — collapsing the state's genuinely rich data behind a
disclosure triangle is the wrong trade.

**Counts — cheap version, decided 2026-09-09.** A fixed **7-day window** over
data the layer already fetches. *Not* "since your last visit": no last-visit
timestamp exists anywhere in the codebase, so that framing needs a new column, a
write on page view, and a privacy note — its own issue, not this one. Three
constraints follow: no new resolver or server-side aggregate (no count is better
than a query for one); label the window ("4 this week") rather than implying
personalization ("4 new for you"), which is a claim we cannot back; and an
absent count must be visually distinct from a zero count, for the same reason
`searchedTypes` exists in #1180 — "nothing happened" and "we didn't look" are
different sentences.

**Tests:** unit per component; three-card order asserted; a11y.

### 2 — County layer page (P0)
**App:** `apps/frontend` · depends on 1 · **absorbs #702**

- `app/region/county/page.tsx`
- header: board + seats + `myCountySupervisors` (already filtered by #1136) +
  the re-resolve link + the §9118 threshold as one cited line
- recent: county meetings/minutes (#1162)
- type index: `Building` rows for measures (#1113) and local filers (#1163)

**The re-resolve link is load-bearing**, not decoration: it turns readers into
detectors for the district-resolution bug class #1136 was filed about.

**Tests:** unit; integration for the no-supervisorial-district fallback; a11y.

### 3 — State layer page (P0)
**App:** `apps/frontend` · depends on 1

- `app/region/state/page.tsx`
- header: Assembly + Senate seats, as filter chips
- recent: bills and propositions matching the reader's topics
- type index: the five destinations from today's `/region`, **with counts**

Nothing is lost and no route moves. This is where the current page survives,
demoted from "the whole page" to "one level's index" and gaining the counts it
never had.

**Tests:** unit; assert every one of the five existing destinations is still
reachable — the regression that would hurt most.

### 4 — Federal layer page (P1)
**App:** `apps/frontend` · depends on 1

- `app/region/federal/page.tsx`
- header: CA-04 + two senators; short list; federal ingestion is deliberately
  shallow and the page should look it

**Tests:** unit; a11y.

### 5 — Banded search results (P2)
**App:** `apps/frontend` · **blocked by [#1180](https://github.com/OpusPopuli/opuspopuli/issues/1180) and [#1139](https://github.com/OpusPopuli/opuspopuli/issues/1139)**

Group `/region/search` results by jurisdiction level — County → State → Federal
— then by type inside each band, preserving the shipped direct-match ordering.
Today this renders as one band; that is fine and it costs a wrapper.

**Do not start before #1180 lands `jurisdiction` on `RegionSearchItem` and #1139
puts jurisdiction on propositions and meetings.** Inferring a county from
document text is exactly the guess this platform does not make.

### 6 — County switcher (P2)
**App:** `apps/frontend` · depends on 2

Home badge, read-only visiting state, alphabetical or adjacency sort.

**Tests:** unit; assert the visiting state disables action affordances *and*
renders the explanation; assert no sort-by-threshold code path exists.

### 7 — i18n + a11y pass (P1)
**App:** `apps/frontend` · depends on 1–4 · **needs [#1160](https://github.com/OpusPopuli/opuspopuli/issues/1160)**

Region pages are hardcoded English today (#1160). Every string on the new
surface goes through `react-i18next` from the start; ES is a shipping locale,
not an afterthought. Figures through `Intl.NumberFormat` with the active locale.

`pnpm test:a11y` before this is called done. No distinction encoded only in
colour — the gold county rule must be redundant with a text label.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Enabled county plugins never sync ([#1184](https://github.com/OpusPopuli/opuspopuli/issues/1184)), so the county page is empty in production regardless of design | high × **mitigated** | Fix in flight — PR [#1190](https://github.com/OpusPopuli/opuspopuli/pull/1190) (`fix/silent-county-sync-failures-1184`, also covers #1172). Subtask 2 should still verify county rows are actually flowing on the node before it is called done, rather than assuming the merge fixed it |
| "Recent and relevant" needs topic matching the layer pages don't own | medium × likely | Reuse the briefing's existing personalization path; do not build a second ranker |
| County band empty in search because meetings carry no jurisdiction | **high** × certain | Subtask 5 explicitly blocked on #1139; subtask 2 reads the county's own meeting rows, which need no discriminator |
| #702 gets built separately | medium × likely | Close it as superseded the moment subtask 2 merges |
| "Smallest first" fights every spatial intuition (maps, addresses go big→small) | medium × likely | Subhead states the ordering; accept the comprehension cost as deliberate |
| Five existing destinations become unreachable in the reshuffle | **high** × possible | Subtask 3's test asserts all five |
| Layer pages accrete sections and the "less is more" cut erodes | medium × likely | The five-and-five page-weight target is in this plan for review to point at |
| New surface ships hardcoded English, worsening #1160 | medium × likely | Subtask 7; no inline copy accepted in review |
| Route rename breaks deep links | low × rare | `/region` is kept deliberately; only the label changes |

## Effort

| | |
|---|---|
| P0 (1–3) | ~3 days — subtask 3 is largely moving existing cards and adding counts |
| P1 (4, 7) | ~2 days |
| P2 (5, 6) | ~3 days, and 5 cannot start until its blockers land |

~8 days. **Branch:** `feat/where-you-live-1193`, one branch per subtask off it.

## Open questions

1. **What sorts "recent and relevant"?** The briefing already ranks by topic
   match; the simplest defensible answer is to reuse it verbatim and sort by
   date within it. Anything cleverer needs a reason.
2. **Does the state page keep a type index at all**, or do those five
   destinations live only in the header search and the briefing? Keeping them is
   the conservative call and this plan assumes it.

### Resolved

- ~~Does the county page ship before #1184 is fixed?~~ **Moot** — the fix is in
  flight (PR #1190). Verify on the node rather than assume.
- ~~Is the cost column a real feature?~~ **No** — dropped, owner, 2026-09-09.
  See *Scope decision* above.
- ~~What is `/region` for on repeat visits?~~ **The organized index**: what
  governs you, and what changed there lately, scoped and counted. The argument
  belongs to the landing page and onboarding, not here.
