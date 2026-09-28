# Civics extraction, scored — 2026-09-27

First measurement of civics extraction against a reference neither model produced.
Every gold item is a verbatim quote from the text the model receives, and the
fixture records that text, so each number below is auditable rather than asserted.

## Result

**Nemotron is not abstaining. It is answering the wrong field.**

Four civics syncs described it as "returning an empty block" on these pages. It is
reading them correctly — every claim it made was warranted, precision 1.00, zero
fabrications — and putting the content in `glossary` while leaving `measureTypes`
and `lifecycleStages` empty.

That is a prompt-contract problem with a specific fix, not a capability problem.

## The comparison

| | qwen3.6:35b-a3b | nemotron-3.5-lightning:30b-a3b |
| --- | --- | --- |
| `failed-qualify` recall | **0.60** | **0** |
| `qualified-ballot-measures` recall | **0.30** | **0** |
| precision, all pages | 0.75 – 0.92 | **1.00** |
| ungrounded claims | **7** | **0** |
| gold-bearing fields left empty | 0 | **4** |
| invention on empty-expected fields | all four fields on one page | `glossary` only |

Seed pinned to 7. Source text is the gold set's recorded text, so page drift is
not a variable. Runtime 1m11s for three pages, ~62 tok/s.

### Where nemotron's output went

| page | measureTypes | lifecycleStages | glossary |
| --- | --- | --- | --- |
| failed-qualify | **empty** (gold: 2) | **empty** (gold: 5) | 3 (gold: empty) |
| qualified-ballot-measures | **empty** (gold: 5) | **empty** (gold: 2) | 1 (gold: empty) |
| teachers-and-students | empty ✓ | empty ✓ | 5 (gold: empty) |

The same pull toward `glossary` that produced **254 terms where qwen got 30** on
`assembly.ca.gov/resources/glossary` — read as a triumph on 2026-09-24 — is what
produces a total miss here. One bias, two opposite-looking outcomes.

### They fail in opposite directions

- **qwen** finds more and invents constantly: a lifecycle stage named after the
  **page title**, `ELIGIBLE` and `Final Random Sample Count` carried in from
  sibling pages in the same crawl, and on a page of links it manufactured a
  `Senate` chamber plus four Assembly measure types.
- **nemotron** never invents but misroutes, so the structured fields that feed
  bill staging come back empty.

For a platform whose bar is being above reproach, "never invents but
under-reports" is the better failure and the more fixable one.

## A correction this eval had to make about itself

The first run of the scorer was **invalid**, and it is worth recording why.

Precision was scored against page text alone. But `hints` and `contentGoal` from
`@opuspopuli/regions` go **into the prompt**, and California's are prescriptive to
the point of naming ids and thresholds. The Secretary of State source says:

> "measureTypes here are DIRECT-DEMOCRACY measures — Initiative Statute,
> Initiative Constitutional Amendment, **Referendum, Recall**"

> "use distinct kebab-case ids such as **'signature-gathering',
> 'signature-verification', 'qualified-for-ballot', 'general-election-vote'**"

So the scorer recorded five qwen *compliances* as fabrications. **An eval with
that bug rewards whichever model ignores its configuration.** Fixed: a claim is
warranted by `page` or by `hint`, and the output reports the split
(`8 page / 2 hint`) so config-driven output stays distinguishable from reading.

qwen's precision on `failed-qualify` moved 0.667 → 0.833 once corrected.

## What is NOT measured

- **Only three pages.** Two genuine misses plus one precision trap. The three
  control pages are unauthored: the glossary page has 254 terms and needs a
  sampling rule agreed before hand-authoring is proportionate.
- **The matcher is normalised containment, not embedding cosine.** Reported in
  every result file. It is strict about phrasing, so cross-page recall
  comparisons are provisional — one qwen item scored ungrounded is a *paraphrase*
  of the page, recorded as `scorerCaveat`. `scoring/omission.ts` already
  calibrates a real cosine threshold and is the upgrade path.
- **Depth.** `citizenAction` and `longDescription` loss is visible in the field
  data but not yet a scored measure.
- **One run per candidate.** Extraction is unseeded in production by design
  (#1327); this pinned a seed, so these numbers do not characterise variance. Two
  identical syncs previously disagreed about 2 of 24 pages.
- **`essential` flags are unreviewed.** They are a civic-process judgement, and
  the one part of the fixture that is not self-verifying.

## What changes next

The prompt must make field selection explicit for direct-democracy pages: a
measure type named in a page heading (`INITIATIVE STATUTE.`) belongs in
`measureTypes`; a dated process milestone (`Raw Count Deadline`,
`Failed 07/14/2026`) belongs in `lifecycleStages`. Neither belongs flattened into
`glossary`.

That is a `prompt-service` change — versioned and hashed, never inlined here —
and this eval can score the variant against the same reference with the seed
pinned. At 1m11s for three pages, the loop is cheap.

## Prompt v2 — the routing fix, measured

`civics-extraction` v2 (prompt-service `fix/civics-field-routing`, hash
`b8c9cbaa792159e2`) adds the third page shape and explicit routing. Same model,
same seed, same recorded text:

| page | v1 | v2 |
| --- | --- | --- |
| `failed-qualify` | recall **0**, 2 fields emptied, 3 invented in `glossary` | **recall 0.50**, precision **1.00**, nothing emptied, nothing invented |
| `qualified-ballot-measures` | recall 0, 2 fields emptied, 1 invented | recall 0, precision 0.75, nothing emptied, nothing invented |
| `teachers-and-students` | 5 invented in `glossary` | **clean — emitted nothing** |

Three things moved:

1. **Routing works.** `failed-qualify` went from empty to 11 `measureTypes` and a
   `lifecycleStage`, with precision still 1.00, and its output grew 1,734 ->
   14,543 chars. It is extracting rather than abstaining.
2. **`glossary` invention is gone on all three pages** — the "a term the page
   merely USES is not a glossary entry" rule.
3. **The precision trap passes for the first time.** `teachers-and-students`
   returned a 110-char empty block. That page is also where nemotron was already
   correct, so this is a non-regression as much as a fix.

The risk in making a prompt more prescriptive — that it starts filling fields
which should be empty — did not materialise. Invention went DOWN.

### Still failing, and why

`qualified-ballot-measures` remains recall 0, emitting 3 items for a page with 5
gold measure types and 2 gold stages. Its propositions name their type INLINE at
the end of a line ("Authorizes Bonds for Housing Affordability Programs.
Legislative Statute."), and v2's rule speaks of a type "named in a heading or
title". That is a v3 candidate, not a model limitation.

### The instrument is now the larger error term

Its one "ungrounded" item is `"Qualified for Ballot"` against a page that says
`"qualified for the ballot"` — containment fails on the word *the*. That is the
second paraphrase in two runs scored as a fabrication (the first is recorded as
`scorerCaveat` on the same page).

So the containment matcher, not the model, is the next thing to fix. Two of three
apparent fabrications across both runs were paraphrases, which means precision is
understated and recall may be too. `scoring/omission.ts` already calibrates a
cosine threshold against an embeddings model; moving to it comes BEFORE further
prompt iteration, so v3 is measured with an instrument that is not itself the
biggest source of error. Tuning against a noisy scorer is how the hints mistake
happened once already.

## The matcher, fixed — and the numbers it changes

Warrant was scored by strict substring, which called two paraphrases
fabrications. Getting it right took three wrong rules, and each is worth keeping
on the record because each failed in a different direction:

1. **Substring only.** `"Qualified for Ballot"` was a fabrication because the page
   says "qualified for **the** ballot" — a fabrication verdict on a dropped
   article.
2. **Token set within a window.** Swung too far: warranted `"Assembly Bill"` on a
   page of links, because *bill* and *assembly* both appear — six words apart, in
   unrelated sentences.
3. **In-order within a window, applied to hints too.** Still warranted
   `"Assembly Bill"`, now off the config's own prose: *"...CA **Assembly**
   description of how a **bill** becomes law"*. An accidental in-order pair inside
   6,000 characters of instructions.

The rule that holds splits the two warrants by what the model is doing with each:

| warrant | rule | why |
| --- | --- | --- |
| **page** | content tokens in order, within `2n+4` | the model paraphrases prose it read |
| **hint** | literal substring | the model copies an instruction; when the config names a type it names it exactly |

Both ends are pinned by tests, so neither drift returns silently.

Embedding cosine was deliberately NOT used here. Warrant is the measure that
catches invention, and a semantic threshold would let a plausible-sounding
fabrication through — the one thing this eval exists to detect. Embeddings belong
on RECALL, where paraphrase should count, and that remains the open upgrade.

Known limitation, chosen rather than hidden: **no stemming**. `"signature"` does
not match `"signatures"`, which costs exactly one false fabrication on the qwen
baseline. That is the price of a warrant check a fabrication cannot talk its way
past.

### Corrected numbers

| | qwen3.6:35b-a3b | nemotron + prompt v2 |
| --- | --- | --- |
| `failed-qualify` recall | 0.60 | **0.50** |
| `qualified-ballot-measures` recall | 0.30 | 0 |
| precision | 0.75 – 0.92 | **1.00 on every page** |
| ungrounded claims | **7** | **0** |
| fields emptied | 0 | 0 |
| invention on empty-expected fields | all four fields on one page | **none** |

The fix made the headline sharper rather than softer. nemotron's
`qualified-ballot-measures` precision moved 0.75 -> 1.00 once its paraphrase
stopped being scored as invention, so the corrected picture is: **perfect
precision and zero invention across all three pages, against qwen's seven
fabrications** — at the cost of lower recall on two pages and zero on one.

## Three levers, and the one that mattered was not the prompt

`qualified-ballot-measures` resisted two prompt revisions. The reason was a bug in
the EVAL, not in either the prompt or the model: the driver passed `hints: []`, so
every measurement to that point described a prompt production never issues. Hints
and `contentGoal` from `@opuspopuli/regions` are part of the real prompt.

Once the driver passed them, the cause was immediate. The Secretary of State hint
said "measureTypes here are DIRECT-DEMOCRACY measures — Initiative Statute,
Initiative Constitutional Amendment, Referendum, Recall", and the page carries five
types of which THREE are excluded by that framing — `Legislative Statute`,
`Legislative Constitutional Amendment`, and the combined
`Initiative Constitutional Amendment and Statute`. Told only citizen-initiated
types belonged, the model met a page of mostly legislature-referred measures and
emitted a single catch-all: `"Proposition"` — which is the ballot LABEL, the number
the Secretary of State assigns, and never a legal classification.

| lever | effect |
| --- | --- |
| prompt v2 — field routing | fixed `failed-qualify` (recall 0 -> 0.50); removed `glossary` invention on all three pages; link-directory page clean |
| prompt v3 — inline measure types | small gain only (`qualified-ballot-measures` 0 -> 0.25) |
| **region hints** (opuspopuli-regions#89) | **`measureTypes` recall 0 -> 1.00** on the resistant page; page recall 0.30 -> 0.50 |

Three prompt iterations were spent on something that was ~80% a config problem.
The eval found it, but only after it was made to send what production sends.

### Verified against the PUBLISHED package, not a local swap

The hint experiment above was first run by copying a local checkout over the
installed package. That is enough to test a hypothesis and not enough to claim a
result, so it was repeated against `@opuspopuli/regions` **1.0.99** as published
(opuspopuli-regions#89, merged), with prompt v3 live in prompt-service and the real
hints in the prompt. Same numbers:

| page | recall | precision | ungrounded |
| --- | --- | --- | --- |
| `failed-qualify` | 0.50 | 0.75 | 2 |
| `qualified-ballot-measures` | **0.50** | 0.875 | 1 |
| `teachers-and-students` | n/a (correctly empty) | n/a | 0 |

`measureTypes` on `qualified-ballot-measures` is recall **1.00** — all five types,
including the combined form — from a page that returned nothing four runs ago.

### Hints cost precision, which was invisible until they were passed

| | hints absent | hints present (production) |
| --- | --- | --- |
| `failed-qualify` | recall 0.50, precision **1.00**, 0 ungrounded | recall 0.50, precision **0.75**, 2 ungrounded |
| `qualified-ballot-measures` | recall 0.25, precision 1.00 | recall 0.30 -> **0.50** (with new hints), precision 0.875 |

Hints raise recall and lower precision — a real trade, and one that cannot be seen
at all while measuring a prompt without them. `--no-hints` is kept as the
deliberate A/B arm for asking what the configuration itself contributes.

### Still open on that page

`lifecycleStages` remains recall 0: four stages emitted, none matching gold's
*Eligible* or *Qualified for the ballot*. Likely the same shape of problem — the
SoS hints enumerate the INITIATIVE path (`signature-gathering`,
`signature-verification`, `qualified-for-ballot`, `general-election-vote`) while
this page describes eligibility and qualification for measures already through
that path. Not yet investigated.

## Two instrument faults found while testing prompt v4

Prompt v4 (prompt-service, `feat/civics-hints-are-not-answers`) targets the
`lifecycleStages` recitation: it adds a HOW TO READ THOSE HINTS section saying an
illustrative list is not the set to emit, a hint can never be the evidence, and two
pages about one process describe different SEGMENTS of it. Measuring it surfaced two
faults that had nothing to do with the prompt.

### 1. The container served v1 text labelled v4 (prompt-service#118)

The first v4 run recorded a large regression — both pages to recall 0, `glossary`
invention back. It was not v4. Restarting the prompt-service container re-seeds it from
the **baked** `dist/seed/seed.js`, which is several versions behind (`Seeded 30 prompt
templates` where the tree has 32), and that older seeder overwrote
`prompt_templates.template_text` with v1's 11,278 chars while leaving `version = 4`:

| time (UTC) | event | active `template_text` |
| --- | --- | --- |
| 04:10:09 | `pnpm db:seed` — history row v4 written, 14,866 chars | 14,866 (v4) |
| 04:10:23 | `docker restart opuspopuli-prompts` | — |
| 04:10:24 | boot re-seed from the baked build | **11,278 (v1)** |

The give-away was arithmetic: every prompt was exactly 2,089 chars shorter than in the
previous run, and 13,367 − 11,278 = 2,089. Beyond the wasted run this is an
**attestation** fault — `version` and `template_text` can disagree, so an output row
persisting `promptVersion = 4` may have been produced by v1. Filed as
prompt-service#118 with a fix proposal: refuse to seed *downward*, and assert
`hash(template_text)` against the version-history row at boot.

The earlier v2 and v3 measurements are unaffected — the container had been up for four
days across both, so nothing re-seeded between writing those rows and reading them.

### 2. The recall matcher swung on a single article

Re-run properly, v4 looked like a real gain: `qualified-ballot-measures` recall
0.50 → 0.75. It was one function word.

| run | emitted | similarity vs gold "Qualified for the ballot — becomes qualified on the 131st day…" |
| --- | --- | --- |
| v3 | `Qualified for Ballot` | **0** |
| v4 | `Qualified for **the** Ballot` | **0.80** |

The 0.6 threshold sits between them, so a dropped article moved a page's recall by 0.25
while the model's stage list was otherwise identical. `warrantFor` was given
function-word tolerance when this same class of bug was found in *precision*;
`containmentSimilarity` never was, and it was living in the driver where no test could
see it. It now lives in `scoring/civics.ts`, compares content tokens, and is pinned in
both directions — verified by reintroducing whole-string containment and watching the
two new tests fail.

Still not stemming: `Signature Gathering` does not match the page's *"circulation
period … proponents gather signatures"*. Those are different stage names, and crediting
one for the other is precisely how a recitation of the config's example ids would pass
as a reading of the page.

### The corrected numbers, and what they change

Re-run on the corrected matcher with the published `@opuspopuli/regions` 1.0.99 and
prompt v3 live:

| page | recall (as reported earlier) | recall (corrected matcher) | precision | ungrounded |
| --- | --- | --- | --- | --- |
| `failed-qualify` | 0.50 | 0.50 | 0.75 | 2 |
| `qualified-ballot-measures` | 0.50 | **0.75** | 0.875 | 1 |
| `teachers-and-students` | correctly empty | correctly empty | n/a | 0 |

So the 0.50 published earlier on `qualified-ballot-measures` was an **under-count** by
one gold item: *"Qualified for the ballot — becomes qualified on the 131st day"* was
recalled all along and scored 0 because the model wrote "Qualified for Ballot". Every
number this eval has produced for that page has now been revised twice, in both
directions, by the instrument rather than the model — which is the case for keeping the
matcher under test and reporting the matcher alongside every result.

### What v4 actually did

Nothing measurable. On the corrected matcher the stage list is unchanged — the same four
hint examples on both pages — and `failed-qualify` `lifecycleStages` is still recall 0
with the same two ungrounded claims. A +1,499-char prompt with no measured effect does
not ship on the strength of its reasoning, so v4 stays on a branch until either it earns
a number or the config lever is tried. On the `measureTypes` evidence, the config is the
likelier lever: the SoS hint enumerates four kebab-case ids, and the model treats an
enumeration as the answer set no matter what the prompt says about it.

## The config lever for lifecycleStages, and a caveat about measuring it

With the prompt lever exhausted, the remaining hypothesis is the one the
`measureTypes` fix already proved: the hint is the answer set. The SoS hint said

> lifecycleStages describe the INITIATIVE path … use distinct kebab-case ids such as
> 'signature-gathering', 'signature-verification', 'qualified-for-ballot',
> 'general-election-vote'. Do not reuse the bill-process stage ids.

Rewritten (opuspopuli-regions `fix/sos-lifecycle-stages-per-page`) to say which stages
the SoS documents **on which kind of page** — circulation and counting on the
qualification pages, eligibility and the 131st day on the status pages, terminal
outcomes on the failure pages — and to state outright that the ids are a naming
convention, not a pipeline to reproduce.

### The caveat, stated before the number

That hint was authored by the same model that authored the gold set, with the gold set
in view. **Recall on these three pages is therefore no longer an independent measure of
this change** — it is partly a measure of me writing down the answer. Two things keep it
from being circular:

- **Precision and warrant are independent.** They ask whether a claim is on the page,
  which the hint cannot fake: a hint-warranted claim is reported separately
  (`warrantedByHint`) precisely so config-driven output stays visible as such.
- **The `--no-hints` arm** still measures what the page alone supports.

The honest fix is a **held-out page** — a fourth gold page authored from a source whose
hints were written without it — and that is the next piece of work on this eval rather
than an optional extra. Until it exists, treat a recall gain on `lifecycleStages` as
evidence the mechanism was identified, not as a quality number.

### `--region-config`, so this is measurable at all

The harness now reads the region config from the installed `@opuspopuli/regions` by
default and from a checkout when given `--region-config <path>`. The first hint
experiment was run by copying a checkout over the installed package, which then had to
be repeated against the published artifact before it could be reported; this replaces
that with a flag whose use is printed in the banner and recorded in every result file
(`regionConfig`, `regionConfigIsOverride`). A number measured against an unpublished
config is a hypothesis, and the result file now says so on its own.

## The result, all on one matcher and one rule

Every number below uses the content-token matcher and the `pageOnly` rule, so the three
columns are comparable for the first time. nemotron runs the real prompt through
prompt-service; qwen is the captured fixture from before the switch, produced under the
v1 prompt and the v1 config, which is why it is a lineage comparison and not a
model-versus-model one.

| | qwen3.6:35b-a3b (fixture) | nemotron + v3 + published hints | nemotron + v3 + **new hint** |
| --- | --- | --- | --- |
| `failed-qualify` recall | 0.60 | 0.50 | **0.70** |
| `failed-qualify` precision | 0.833 | 0.50 | 0.70 |
| `qualified-ballot-measures` recall | 0.55 | 0.75 | **1.00** |
| `qualified-ballot-measures` precision | 0.917 | 0.625 | 0.75 |
| `teachers-and-students` (correct answer: nothing) | invention in **all four** fields, 4 ungrounded | clean | clean |
| ungrounded claims (inventions) | **7** | 3 | **0** |
| off-page claims | 0 | 4 | 5 |

Read plainly:

- The config fix beats the published config on **every** axis: higher recall on both
  pages, higher precision on both, and invention eliminated.
- Against the qwen lineage it trades precision for abstention. qwen scores better on
  page-level precision (0.833 / 0.917) and pays with seven fabrications and a
  link-directory page filled in all four fields. nemotron with the new hint invents
  **nothing**, anywhere, and still abstains correctly on the trap page.
- `lifecycleStages` on `qualified-ballot-measures` is recall **1.00**, from a field that
  returned nothing five runs ago.

Prompt v4 does not ship. It measured **identical** to v3 both before and after the config
fix, so a +1,499-char prompt bought nothing; the branch stays unmerged
(`prompt-service` `feat/civics-hints-are-not-answers`) as the record of a lever that was
tried and did not move.

### The residual defect is architectural, not a wording problem

Off-page claims went **up**, 4 to 5. The model no longer recites the four bill-ish stage
ids — those are gone, replaced by the page's own terms — but it now recites the *new*
hint's vocabulary across pages: `failed-qualify` emitted `Random Sample Count`,
`eligible` and `qualified for the ballot`, none of which are on it, and
`qualified-ballot-measures` emitted `failed` and `withdrawn by proponents`, likewise.

That is not a phrasing failure. **Hints are scoped to a SOURCE, and a source is a whole
crawl** — one seed URL plus its siblings — while the pages inside it describe different
segments of one process. So any page-specific instruction is delivered to every sibling
page, and the more accurately a hint describes the source, the more off-page material it
hands each individual page. Two attempts have now hit this from opposite directions: a
hint too narrow for the source (measureTypes, excluded three of five types) and a hint
accurate for the source but too broad for each page (lifecycleStages).

The fix is per-page hint scoping in the region schema — attaching an instruction to a URL
pattern rather than to a seed — and it is filed rather than attempted here.

## The held-out page, and what it says about prompt levers

A fourth gold page was authored to break the circularity above: the **Senate Citizens'
Guide legislative-process page**, from a different `dataSource` whose four hints were
written months earlier, are untouched by anything measured here, and — the part that
makes it a test — never enumerate lifecycle stage ids. 17 items, 31 quotes verified
offline, a `sessionScheme` trap, and two `ownerReviewRequired` items.

First measurement (prompt v3): **page recall 0.398, `lifecycleStages` recall 0.091** —
against 0.70 and 1.00 on the three SoS pages. So the tuned-page recall *was*
substantially inflated by authoring a hint with the gold set in view, exactly as the
caveat predicted. The held-out number is the one to quote.

### What it is actually doing is more useful than the number

`lifecycleStages` precision is **1.00** with everything page-warranted. It is reading the
page and routing it wrongly:

| field | what it got |
| --- | --- |
| `lifecycleStages` | the page's **section headings** — "How Your Idea Becomes A Bill", "What To Do When Your Bill Goes To Policy Committee" |
| `glossary` | the actual process vocabulary — Veto, Override, Chaptered, Conference Committee, Second House, Policy Committee, Third Reading (recall 1.00) |
| `chambers` | `Senate` only, ignoring the 41/54 Assembly thresholds in the same sentence |

The chambers miss is **hint-as-answer-set for a third time**, on a hint nobody touched
here: the Senate source says "Emit a chambers[] entry for the Senate", and the model
emitted exactly that and nothing else.

### v5 targeted this and did not move it

prompt-service `feat/civics-bill-process-routing` adds a whole page-shape block: a stage
is named for the stage and not the heading, read stages out of the prose, emit both a
stage and a glossary entry where the page does both, and emit every chamber whose facts
the page states. Measured:

| | v3 | v5 |
| --- | --- | --- |
| `lifecycleStages` emitted | the 7 section headings | **the same 7 section headings** |
| `chambers` | Senate only | **Senate only** |
| `glossary` size | 16 | 10 |
| page precision | 0.828 | **0.933** |
| inventions | 3 | **2** |
| off-page | 1 | **0** |

The recall move on that page (0.091 → 0.364) is the **matcher's** head-term credit, added
in the same change, not the prompt's doing.

Because two things changed at once, v3 was re-run on the same matcher to separate them.
Matcher held constant on both sides:

| | v3 | v5 |
| --- | --- | --- |
| `failed-qualify` recall | 0.70 | **0.90** |
| `qualified-ballot-measures` precision | 0.75 (3 hint-warranted, 2 off-page) | **1.00 (0, 0)** |
| held-out page **recall** | 0.466 | **0.466 — identical** |
| held-out page precision | 0.828 | **0.933** |
| held-out inventions | 3 | **2** |

**v5 ships, and not for the reason it was written.** It lifts recall on one ballot-measure
page and takes the other to perfect precision with no config-only claims at all, and it
raises precision on the held-out page while dropping an invention. Its contribution to
held-out RECALL is exactly zero, and the behaviour it was authored to change — stage names
copied from section headings, one chamber where the page documents two — is
byte-for-byte unchanged. A prompt revision that improves three things it was not aimed at
and nothing it was aimed at is worth shipping and worth describing accurately.

### The held-out page must stay un-tuned, which costs something real

The `chambers` miss has an obvious fix in the same family as the two that worked: the
Senate source's hint says "Emit a chambers[] entry for the Senate", and rewriting it to
"emit an entry for every chamber whose facts the page states" would very likely take that
field from 0.5 to 1.00.

**Deliberately not done.** The moment that hint is edited, this page becomes a tuned page
and the eval has no independent number left. There is exactly one page here whose config
was written without reference to the gold set, and spending it to gain 0.5 on one field
would be trading the only unbiased measurement for a better-looking one.

The cost is that a known, cheap improvement sits unshipped. The way out is more held-out
pages — each new one lets an older one graduate into the tuned set — not a decision to
tune this one. Worth stating plainly because the pressure to fix it will recur every time
this table is read.

### Three levers, one hit: this looks like a model boundary, not a wording problem

| lever | target | result |
| --- | --- | --- |
| v2 — field routing | ballot-measure pages | **large** (recall 0 → 0.50, invention removed) |
| v4 — how to read hints | hint recitation | nothing |
| v5 — bill-process routing | stage vs heading vs term | nothing on its target page |
| **region config** (#89, #90) | the hint itself | **decisive both times** |

The pattern across four measurements: this model follows a hint's **enumeration** far
more strongly than the prompt's **instruction**, and when a page offers strong surface
cues — numbered section headings — it takes those over a described abstraction. Both are
capability boundaries, and neither is likely to yield to more prompt text.

So the next lever for the bill-process shape should not be a sixth prompt revision. The
options are a deterministic **normalisation step** — map a heading-shaped stage name onto
a stage id in code, where it is testable and does not depend on a model obeying prose —
or a different model for that page shape. The project's own standing principle
(verification layer over model choice) points at the first.

## Reproducing

```bash
# qwen baseline: no inference, reads the captured fixture
pnpm --filter @opuspopuli/eval-harness eval:civics

# a model, through the real prompt-service template
PROMPT_SERVICE_URL=http://localhost:3210 PROMPT_SERVICE_API_KEY=dev-key-1 \
LLM_INGESTION_CONTEXT_TOKENS=131072 \
pnpm --filter @opuspopuli/eval-harness eval:civics -- \
  --candidate model --models nemotron-3.5-lightning:30b-a3b
```

The template resolved as `civics-extraction` v1, hash `5c27303154854c01` — the
same hash stored on the civics blocks production wrote, so this measures the
prompt production used.
