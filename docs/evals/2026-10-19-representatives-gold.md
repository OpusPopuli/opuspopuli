# Representatives gold set — what the first measurement found

Plan: `docs/plans/representatives-gold-eval.md`. Baseline:
`packages/eval-harness/fixtures/representatives-baseline-nemotron.json`.
Gold: `packages/eval-harness/fixtures/gold-representatives.json`.

**The exercise did not reach prompt tuning, and should not have.** Steps 1–4
of the plan were measurement; they found the root cause three layers below the
prompt, so tuning would have been fitting noise on top of a sourcing bug.

## Headline

nemotron is not the problem. The same model, on the same day, with the same
digest:

| surface | source material | result |
|---|---|---|
| committee summaries | roster page listing committees verbatim | **90.0% recall** (36/40) |
| biographies | **nothing** — four structured fields | **71.1% of claims unsourced** |

When the source contains the facts, the model finds them. When it is handed
`Name / Jurisdiction / District / Party` and asked for a biography, it invents
one. That is a sourcing failure wearing a model failure's clothes.

## The three defects, in causal order

**#1383 — the crawl archives the wrong page.** All 120 archived rep pages are
roster or landing pages. Reading the extracted text of six:

| page | extracted | contains |
|---|---:|---|
| `assembly.ca.gov/assemblymembers/01` | 1,804 ch | district, party, counties, offices, committees. No bio. |
| `assembly.ca.gov/assemblymembers/04` | 1,385 ch | same. No bio. |
| `assembly.ca.gov/assemblymembers/53` | 1,005 ch | same. No bio. |
| `sr04.senate.ca.gov` | 1,217 ch | Google Translate disclaimer, 3 news headlines, social links. No bio. |
| `sd08.senate.ca.gov` | 96 ch | a real biography, discarded in extraction |
| `sd25.senate.ca.gov` | 99 ch | same |

The real biographies are one link away and never followed —
`a04.asmdc.org`, `a53.asmdc.org`, `ad01.asmrc.org`.

**#1382 — the extractor discards biographies where they exist.** Census over
all 120 archived pages:

| extracted text | pages | where |
|---|---:|---|
| **<200 chars** | **25** | **all `sd*.senate`** |
| 200–999 | 22 | 18 assembly, 2 `sd*`, 2 `sr*` |
| ≥1000 | 73 | 62 assembly, 8 `sr*`, 3 `sd*` |

25 of 30 Senate Democrat pages yield nothing. Not JS-rendering: `sd08` has
127 `<div>` and 24 `<p>`, and reading its `<p>` blocks directly returns the
biography. `htmlToReadableText` returns the `<title>` and a skip link.

**#1381 — the prompt never receives source text anyway.**
`formatRepData()` passes four fields; `sourceText`/`sourceTextHash` persist as
null, honestly recording that there was none.

## The cost, made concrete

Ashby (`sd08`, content hash `14385905b972`). The archived page says:

> Senator Ashby was elected in 2022 to represent Sacramento and Elk Grove.

> The only woman on the Sacramento City Council for over six years, the
> first-ever in history to give birth while in office

What was published instead:

> She was first elected to the State Senate in **2020** and is currently
> serving her second term, which expires in **November 2024**. […] she served
> as a **legislative aide in the California State Assembly** […] She also
> served on the **Elk Grove Unified School District Board of Education from
> 2012 to 2018**.

Wrong election year; a current term that expired two years ago; a prior role
the page contradicts; a school-board tenure absent from the page. The true
biography was in the archive throughout.

## Confabulation is measurable internally

No external ground truth needed — these are repeated verbatim phrases across
distinct people:

| phrase | reps |
|---|---:|
| "community organizer" | **49 of 125** |
| "legislative aide in the California State Assembly" | 10 |
| "first-generation" | 16 |
| "policy analyst for a nonprofit advocacy organization" | 3 |

39% of California legislators did not independently turn out to be community
organizers.

## Committee summaries: the measured baseline

Scored against the gold set, token-overlap matching (a first approximation —
the real scorer should use the embedding matcher `omission-eval` has):

| rep | recall | role fidelity |
|---|---|---|
| Heather Hadwick | **18/18 (100%)** | **both Vice Chair roles lost** |
| Cecilia M. Aguiar-Curry | 12/13 (92.3%) | Co-Chair preserved |
| Michelle Rodriguez | 6/9 (66.7%) | ok |
| **total** | **36/40 (90.0%)** | |

Two findings worth more than the aggregate:

1. **Rules committees are systematically dropped** — "Joint Committee on
   Rules" missed in 2 of 2 reps that have it, plus standing "Rules" for
   Rodriguez. 3 of 3 occurrences. A pattern, not noise.
2. **Role fidelity is inconsistent.** Hadwick's two Vice Chair roles flattened
   to "serves on committees addressing"; Aguiar-Curry's Co-Chair survived.
   The page states these; a summary that drops them loses a stated fact.

Recall also tracks extraction length — 66.7% on the thinnest page (1,005 ch)
versus 100% on the fullest (1,804 ch), which again points at sourcing.

## A false alarm, retracted

I flagged `e.g. "Health" + "Reproductive Health"` in the committees prompt as
the civics copy-hazard (nemotron returning a prompt's example as its answer).
It is not: **"Select Committee on Reproductive Health" is a real assignment**
on Aguiar-Curry's page, quoted in the gold set. The prompt's examples are
drawn from genuine California committee names, so their appearance in output
is not evidence of copying. The hazard remains unaudited for `bill-extraction`
(seven literal `e.g.` values), which needs its own gold set.

## What exists now

- `fixtures/representatives-baseline-nemotron.json` — 8 reps, 93 claims,
  71.0% training. Captured before any change; nothing older survives (D5).
- `fixtures/gold-representatives.json` — 58 gold items across 3 Assembly
  pages, **every one verbatim-quoted** and verified against the embedded
  `extractedTextForAudit` for a pinned `contentHash`. 3 pages recorded as
  blocked, 2 reps held out.
- `src/gold-representatives.spec.ts` — 7 tests; the verbatim-quote guard is
  mutation-verified (corrupting one quote fails it).

## What is deliberately not done

- **Prompt tuning.** Blocked behind #1383/#1382/#1381, and doing it first
  would bank a false win.
- **A biography gold set.** Cannot be authored: no archived page contains a
  biography that survives extraction.
- **Any corpus-wide regeneration.** Nothing should be regenerated at scale
  until the sourcing chain is fixed and re-measured on the 6 tuning reps.
- **Committees and bills.** Same machinery, after reps proves it.

## Owner review required

This gold set was authored by a model scoring a model. Every entry is
quote-backed so it can be audited without trusting me, but it has not been
countersigned. Four specific decisions are listed in the fixture's
`ownerReviewRequired` — the one that matters most: **should a biography be
generated at all for a rep whose source carries none?**
