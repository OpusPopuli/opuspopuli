# Civics extraction: a gold set, and an answer to "is nemotron better?"

**Status:** plan, 2026-09-26. Not started.
**Prompted by:** the 2026-09-24 model switch to `nemotron-3.5-lightning:30b-a3b`,
which left civics extraction visibly *different* and nobody able to say whether
it was *better*.

## The problem this exists to fix

Four civics syncs on 2026-09-24/25 produced a clear picture of change and no
picture of quality:

- glossary extraction went from **30 terms to 254** on the same page
- `lifecycle_stages` on `assembly.ca.gov/resources/legislative-process` **lost 5
  stage ids** and gained 3, and dropped `citizenAction` and `longDescription`
  from every stage
- three pages extract to **nothing** where qwen produced 12–17 KB
- total content across 18 shared URLs: **89% of the qwen baseline**

Every one of those is a diff, not a judgement. "89% of baseline" is only bad if
the baseline was right, and we know it partly was not: qwen stored page headings
as lifecycle stage names — `"Step 1: How Your Idea Becomes A Bill"`,
`"goes to the second House to go through the committee"`. Tuning toward that
baseline would optimise toward a known defect.

So the yardstick has to be something neither model produced.

## Method

### The gold set is authored from the text the model sees

Not the rendered web page. The gold set is built from
`htmlToReadableText(fetchUrlText(url))` output — the same function production
uses, now shared from `@opuspopuli/common` (#1324).

This distinction is load-bearing. If a fact is absent from the extracted text,
the model never had it, and no prompt change can recover it — that is a scraper
finding, not a prompt finding. It already paid off once: `how-qualify-initiative`
returned nothing, and checking the extracted text showed the signature
thresholds (`546,651`, `874,641`) *were* present, which made it a genuine model
miss rather than a scraping gap. The same check on the ballot-measure status
pages may well land the other way, because their facts are tabular and
`htmlToReadableText` keeps cell text while losing row/column structure.

### Every gold entry cites its evidence

This is the amendment that makes the approach defensible. The gold set is
authored by Claude, which is a model — so a gold set that is merely "Claude's
reading" measures *how close nemotron is to Claude*, and encodes any error of
mine as truth. That is the same trap as using qwen's output as the baseline, one
layer up.

The fix is provenance rather than authority: **every entry carries a verbatim
quote from the extracted text.** If it cannot be quoted, it does not go in the
gold set. That makes the reference auditable in minutes by someone who did not
author it, and it matches the platform's own stance — the verification layer
matters more than which model produced something.

Existing precedent to follow: `fixtures/gold-provisions.json` records `note`
with *how* it was authored and when, uses stable ids, and is matched by
embedding similarity so a plain-language rewrite still counts. Same shape here.

### Scoring: recall and precision, per field, never merged

| measure | question | failure it names |
| --- | --- | --- |
| **recall** | of the gold items, how many did the model find? | missed real content |
| **precision** | of what the model emitted, how much is in the text? | invented content |
| **field presence** | did a field that has gold content come back empty? | the three failing pages |
| **depth** | for a found item, are the sub-fields populated? | `citizenAction` / `longDescription` loss |

A single score hides which failure you have, and these four have different
fixes. Yesterday's byte-count diff could not distinguish "nemotron is terser"
from "nemotron dropped a field from every stage" — it showed one number, 23%,
for both at once.

Matching is by embedding similarity, reusing whatever `omission-eval` already
does, so paraphrase counts and a stricter register does not read as a miss.

### Both models are scored against it

The captured qwen baseline stops being the yardstick and becomes a **second
candidate**. That is what finally answers the question: per field, with recall
and precision separated, is nemotron better, worse, or differently-shaped?

### Determinism is mandatory for this work

Extraction is unseeded in production deliberately (#1327: a fixed seed would
make a page that extracts on half its attempts fail on *all* attempts forever).
But an eval must hold everything constant except the thing under test, and two
identical runs disagreed about 2 of 24 pages. So every eval run sets
`CIVICS_EXTRACTION_SEED`, and a prompt comparison without it is invalid.

## Scope: six pages first, not twenty-four

Three that fail reliably across all four runs — these are the targets:

- `assembly.ca.gov/resources/teachers-and-students` (qwen: 15.6 KB)
- `sos.ca.gov/.../initiative-and-referendum-status/failed-qualify` (12.4 KB)
- `sos.ca.gov/.../qualified-ballot-measures` (12.2 KB)

Three that succeed, as controls — so a scoring change that "improves" the
failures can be seen breaking something that worked:

- `assembly.ca.gov/resources/glossary` (the 254-term case)
- `assembly.ca.gov/resources/legislative-process` (the lifecycle-stage case)
- `senate.ca.gov/citizens-guide/legislative-process`

Six pages proves the method for a few hours of work. Expanding to 18 is
mechanical once the scoring is trusted, and pointless before.

## Deliverables

1. `fixtures/gold-civics.json` — `schemaVersion`, `kind: civics-gold`, `note`
   recording authorship and date, then per-source entries whose items carry
   `id`, `field`, `text`, `evidence` (verbatim quote), and `essential`.
2. `fixtures/civics-baseline-qwen.json` — **rescued from
   `results/civics-baseline-pre-nemotron.json`**, which is 18 qwen rows captured
   on 2026-09-24 before anything overwrote them and currently sits in a
   gitignored `results/` directory, one `rm` from gone. This is the only
   surviving qwen side of the comparison; promoting it to a committed fixture is
   step one, before any other work.
3. `src/civics-eval.ts` — `eval:civics`, per-URL, scoring both candidates
   against the gold set, following the existing leg conventions
   (`assertFreshBuilds`, `probeModel` provenance, `ranAt`, ROOT-relative output,
   non-zero exit).
4. `docs/evals/<date>-civics-gold.md` — the result, including any place it
   contradicts a claim already in the repo.

## Risks and limits, stated up front

- **The gold set's author is a model.** Mitigated by mandatory evidence quotes,
  not eliminated. A human spot-check of the six pages is cheap and worth doing
  before the numbers are quoted anywhere.
- **`essential` flags are a domain judgement, not an extraction fact.** Whether
  `second-house-third-reading` deserves to be distinct from `third-reading` is a
  civic-process call, and bills in the corpus *are* staged by chamber
  (`senate-third-reading`, 478 rows). Claude should propose these flags; the
  owner should review them. They are the one part of the fixture not
  self-verifying.
- **Fixtures land in git history.** Civics pages are government pages and the
  extracted content is chambers/measure-types/glossary rather than personal
  data, but each page gets checked for contact details before committing, per
  the `build-fulltext-fixture.ts` precedent. Note the separate ruling that
  public-figure contact details are *not* to be redacted from runtime paths —
  that is about runtime, not about what gets committed.
- **Six pages cannot characterise 18.** The output is "the method works and here
  is what it says about these six", not a corpus verdict.
- **A prompt change lands in `prompt-service`, not here.** Prompt text is never
  inlined in this repo. The loop is: variant published there as a new version →
  harness fetches it → scored → kept or dropped. The harness can pull variants;
  it cannot own the text.

## Sequence

1. Rescue the qwen baseline into a committed fixture. *(do first — it is
   perishable)*
2. Fetch the six pages' extracted text; record char counts and whether each
   page's facts survive `htmlToReadableText` at all.
3. Author the gold set with evidence quotes; propose `essential` flags for
   review.
4. Build `eval:civics` with the four measures above.
5. Score nemotron and the qwen baseline; write up per field.
6. Only then: propose prompt variants, in `prompt-service`, with the seed pinned.

## Deliberately not in this plan

- **Chunking large documents.** Argued for from two directions now (#1329's
  timeout analysis and #1324's half-window overflow) and it will change what a
  civics prompt even looks like. It is a prerequisite for the *bills* work, not
  for this.
- **The `citizenAction` / `longDescription` loss.** Real, and this eval will
  quantify it, but whether those fields should be required is a prompt-contract
  question for `prompt-service`.
- **Bills.** Returning to them after this, with the ~150-bill overflow tail
  (#1324) as the starting point.
