# Direction: the search surface (amends SPEC-bills-propositions-search)

| | |
|---|---|
| **Amends** | `docs/plans/SPEC-bills-propositions-search.md` — epic [#1152](https://github.com/OpusPopuli/opuspopuli/issues/1152) |
| **Date** | 2026-09-08 |
| **Author** | Rodney Gagnon (direction set in a design session with Claude Code) |
| **Status** | **Direction, mixed maturity.** Every item below is tagged `DECIDED` or `PROPOSAL`. Only `DECIDED` items should change work in flight. |
| **Scope** | The **surface**: scope model, result shape, presentation, honesty rules. |
| **Explicitly NOT in scope** | The retrieval architecture. FTS + generated `tsvector` columns, nomic-embed-text-v2-moe @ 768, HNSW-from-empty, RRF k=60, the golden-set flip-on gate, the migration plan and the audit/complexity posture in the SPEC are all **unchanged and unchallenged**. |
| **Mockups** | Round 1 concepts <https://claude.ai/code/artifact/34c21f5a-bd6b-44f1-bd03-8e88c8111c88> · Layer pages + banded search <https://claude.ai/code/artifact/9fb5f54c-4c53-413f-a12e-eaa3214fd961> · The header box, six states <https://claude.ai/code/artifact/81204a59-8e3d-4091-8099-f2159d273e33> |
| **Figures in those mockups** | Anything marked with a degree mark (°) is a **placeholder invented for the comp** — Sonoma's threshold, all counts, all dollar figures, "Ordinance 6412". Do not read a number off a mockup. |

## Why this document exists

The search epic was specced before a parallel design session reframed the
`/region` surface around the **county** rather than the state. That reframing
has one consequence for search that is cheap today and expensive in three
weeks, plus a set of presentation decisions that cost nothing to adopt now.

Nothing here asks for rework of retrieval. **Read §1 first** — it is the only
part that is time-sensitive against a shape that is about to freeze.

---

## §1 — Time-sensitive: three additions to the result shape `DECIDED`

The context: `/region` is being restructured from a state directory into a
**stack of the jurisdictions that claim the reader's address** — County, State,
Federal (city deliberately omitted; we hold no city data and a permanent
"Building" row on the highest-leverage government advertises the gap forever).

Search is the **transverse axis** through that stack. The stack answers *"what
governs me?"*; search answers *"where does housing appear across everything that
governs me?"* So results group by **jurisdiction level**, not by entity type.

Today that grouping is a no-op — bills and propositions are both state-level, so
there is exactly one band. **That is precisely why it is cheap to add now.**
The moment county minutes are indexed it stops being a no-op, and by then the
result shape is public API with a frontend built on it.

### 1.1 Put a jurisdiction on every result item

```graphql
type ResultJurisdiction {
  level: JurisdictionLevel!   # FEDERAL | STATE | COUNTY | MUNICIPAL | DISTRICT
  name: String!               # "California", "Sonoma County"
  id: ID                      # jurisdictions.id where one exists
}

type RegionSearchItem {
  result: RegionSearchResult!
  snippet: String
  rank: Float!
  jurisdiction: ResultJurisdiction!   # ← add
}

type SearchSuggestion {
  id: ID!
  kind: SearchSuggestionKind!
  label: String!
  sublabel: String
  jurisdiction: ResultJurisdiction!   # ← add
}
```

`JurisdictionLevel` already exists (`packages/common`, and the frontend union in
`lib/graphql/region.ts`). For bills and propositions the value is a constant
today — derive it in the resolver, do not add a column. **Do not infer it at
query time later**: when minutes and county records land, jurisdiction must be
stored on the indexed row, because inferring a county from document text is
exactly the kind of guess this platform does not make.

### 1.2 Stop shaping the API around two types

`billCount` / `propositionCount` are two-type-shaped and will not survive the
first additional corpus. Add a generic alongside them; keep the existing fields
until the frontend is migrated.

```graphql
type SearchTypeCount { type: SearchResultType!, count: Int! }

type PaginatedRegionSearch {
  items: [RegionSearchItem!]!
  total: Int!
  hasMore: Boolean!
  billCount: Int!            # keep — deprecate later
  propositionCount: Int!     # keep — deprecate later
  counts: [SearchTypeCount!]!  # ← add
  degraded: Boolean!         # already specced — keep
}
```

Expected order of corpus additions, so the enum and union arms are designed to
widen additively: **minutes/agendas first** (that is where county activity
lives, and the county band is empty without it), then representatives, then
legislative committees, then campaign finance.

### 1.3 Report what was searched, not only what was found

This is the single most important honesty property in the whole surface.
"Zero results" and "we never indexed that" look identical to a reader and mean
opposite things. Conflating them is how the product accidentally tells someone
their county does nothing about housing.

```graphql
type PaginatedRegionSearch {
  # …
  searchedTypes: [SearchResultType!]!   # ← add: what this query actually covered
}
```

The frontend renders a permanent line from it: *"We did not look in
representatives, legislative committees or campaign finance — those are not
indexed."* The SPEC already distinguishes **empty** from **error** (good, and
correct — the knowledge-service swallow-to-empty mistake). This adds the third
state: **not looked**.

---

## §2 — Scope model `DECIDED`

**The header box is global on every route. It never scopes itself to the current
view.** List pages get their own local filter instead.

We considered and rejected making the header contextual (top level → everything,
county page → county, bills page → bills). Three reasons:

1. **Mode error in the most persistent chrome in the product.** Same pixels, same
   `/` shortcut, different behaviour depending on where the reader was standing —
   and the failure is silent, because a scoped zero-result looks exactly like
   "this platform has nothing on housing."
2. **It defeats the point of search.** Search's job is to cut *across* the stack.
   Scoping to the current view turns it back into a filter that reinforces
   whichever silo you are already in — on the Bills page, "leaf blower" should
   surface a county ordinance, and scoped-by-default is the one setting that
   hides it.
3. **Location is weak evidence of intent.** Being on the Bills page is usually
   incidental; you arrived from the briefing.

### What this means for #1155 (list-page search)

**#1155 is a filter, not a search.** Build it deliberately dumb: local narrowing
of the rows already on screen, live count, no interpretation. Three UI contracts
so the two controls can never be confused:

| | Header | List page |
|---|---|---|
| Label | "Search everything" | "Filter these bills" / "Filter these propositions" |
| Shape | round pill, in the chrome | square field, in the page body |
| Scope | global, always | this list, always |

Plus one required line under every filter: **"Looking for something outside this
list? Search everything — or press `/`."** It costs nothing and it is what stops
a reader concluding we hold no leaf-blower ordinance because the *Bills* list
does not contain one.

Context survives as an **offer, never a default**: in the header palette, `Tab`
narrows to wherever the reader is standing, shown in the palette footer.

---

## §3 — Presentation `DECIDED` (grouping) / `PROPOSAL` (palette)

### 3.1 Band results by jurisdiction, then group by type inside the band `DECIDED`

A flat relevance list buries two county hits under twenty state ones **every
time**, because the state produces more paperwork. That is a ranking function
quietly making a political claim. Banding fixes the ordering by fiat and tells
the truth about volume at the same time.

Order: County → State → Federal. The county band carries the gold rule (gold
marks "you can act on this" throughout the new `/region` design). Within a band,
the SPEC's existing direct-match → Bills → Propositions grouping is unchanged.

**Today this renders as one band.** Ship it that way; it costs a wrapper.

### 3.2 Literal first, enforced server-side `DECIDED`

Exact text and identifier matches render above anything fused or interpreted.
The SPEC already does this for suggest (`kind: DIRECT` for measure-number-shaped
queries); extend the same guarantee to `regionSearch` results and make it a
property of the resolver, never of a prompt or a client-side sort. Someone who
typed a bill number wants that bill, not a semantically adjacent one — and this
is also the guardrail that keeps the semantic leg from ever *degrading* a query
it was supposed to improve.

### 3.3 Palette instead of dropdown `PROPOSAL`

`/` or `⌘K` opens a centred palette rather than an inline dropdown. Banded
results, a parsed query row and a sourced answer do not fit in eight
single-line rows. The empty state carries three teaching examples, one per query
type. Keeps every existing #1154 behaviour: `/` focus, arrow keys over
`aria-activedescendant`, gold rule on direct hits, ink rule on the active row,
Escape to dismiss.

**Not a blocker for anything in flight.** #1154 shipped and works; this is a
later upgrade to the same component.

---

## §4 — Later, and not yet approved `PROPOSAL`

Listed so the API is not accidentally designed to preclude them. **None of these
should pull scope into the current epic.**

### 4.1 "What would it take…" — a lever, not a list

A query class returning the **cost of acting** rather than documents: for
*"what would it take to ban gas leaf blowers here?"* → three routes, cheapest
first (3 minutes at Tuesday's podium · 1 supervisor, yours · N signatures under
§9118).

Worth flagging to whoever holds this epic: **it needs no model at all.** It is
arithmetic over `county_thresholds` plus meeting data we already hold, and it is
the most distinctive thing the box could do. Cheapest-first ordering is
load-bearing — leading with the signature count makes acting look impossible.
Deserves its own issue.

### 4.2 Visible, editable query interpretation

If natural-language parsing is ever added, the interpretation renders as
**removable tokens** — `[housing] [Bills] [Sonoma County] [since 1 Jun]` — not as
a hidden rewrite. When a chat box misreads you, the repair cost is a rewritten
paragraph; when a token is wrong it is one keystroke. It also surfaces a wrong
resolved address instead of silently skewing every result. Every token must map
to a filter the API already supports; a chip that cannot be executed is worse
than no chip.

### 4.3 Written answers — the four-field contract

If the semantic work grows an answer surface, the UI contract it must return is
small and worth agreeing before it is built:

1. `answerText`
2. `sources: [ ... ]` — **ordered**, each resolving to a route that already exists
3. `promptVersion`
4. `promptHash`

Per `CLAUDE.md`, prompt text lives only in `prompt-service` and the version +
hash must be persisted on the output row (`CivicsBlock` is the reference
pattern). An answer that cannot name the prompt that produced it is
unattributable, which is what that rule exists to prevent. If the search work
returns those four things, the answer card is a rendering problem; if it returns
prose, it is not publishable on this platform.

Two hard behaviours: **the answer never replaces the results** (it sits above a
list that is always still there), and **exact matches render before the answer
streams** — the fast thing must never wait for the slow one.

---

## §5 — Non-negotiables

Six rules the surface has to satisfy, in priority order. The first, fifth and
sixth are already the SPEC's own instincts; they are restated so they survive
contact with the answer layer.

| Rule | Why |
|---|---|
| **Literal first, server-side** | A typed bill number is not a request for something adjacent. |
| **Interpretation is visible and editable** | The reader can see and correct what the system guessed. |
| **Every sentence carries a source, or it is not printed** | Same rule that makes `source_url`/`retrieved_at` `NOT NULL` on `county_thresholds`: a claim that cannot cite itself cannot be rendered. |
| **Prompt version + hash on any generated output** | Attestation chain, per the prompt-service boundary. |
| **Absence is stated, never implied** | "We did not look there" ≠ "there is nothing." §1.3. |
| **The model is additive, never load-bearing** | Model down → no written answer, fully working search, said plainly. The SPEC's `degraded: true` is exactly this posture; it must extend to any answer layer. A search box that errors because an LLM is unavailable has made a language model a dependency of reading public records. |

---

## What to do with this, concretely

**If the epic has not frozen `RegionSearchItem` / `PaginatedRegionSearch`:**
land §1.1–1.3 now. It is three fields, one derived constant, no migration, and
it is the difference between adding a corpus later and re-versioning a public
query later.

**If it has frozen:** §1.3 (`searchedTypes`) is still the one to force in — it is
purely additive and it is the honesty property, not a convenience.

**#1155**: build it as a filter with the labels and escape-hatch line in §2.

**Everything in §3.3 and §4**: do not pull into this epic. They are recorded so
the shape stays open, not so the scope grows.

## Open questions for the owner

1. **Does §1.1's `jurisdiction` need to be stored, or derived, for minutes?**
   Derived is fine for bills and propositions. For county minutes it must be
   stored on the row at ingest — worth confirming that lands with the minutes
   indexing work rather than after it.
2. **Is "what would it take" (§4.1) a search feature or a `/region` feature?**
   It reads as search, but it is computed from `county_thresholds` and meeting
   data, so it may belong to the county layer page with a search entry point
   rather than inside the search epic.
3. **Does the banded results page ship before a second jurisdiction exists?**
   One band is honest but looks like a wrapper with no purpose. Shipping it
   early is cheap; shipping it late means retrofitting a live surface.
