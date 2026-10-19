# Representative bios: a gold set, and the plumbing gap it exposed

Companion to `civics-gold-eval.md`, which this follows in shape. It does **not**
follow it in diagnosis, and that difference is the whole plan.

## The problem this exists to fix

Measured 2026-10-19 against the local corpus (120 state reps, nemotron
`e7a64ff1`, prompt hash `833edcbb`, v1 — one uniform generation from
2026-10-12/13):

| metric | value |
|---|---:|
| bio claims `origin: training` (unsourced) | **991 — 71.1%** |
| bio claims `origin: source` (grounded) | 402 — 28.9% |
| reps whose bio says "community organizer" | **49 of 125** |
| reps whose bio says "legislative aide in the California State Assembly" | 10, verbatim |
| reps whose bio says "policy analyst for a nonprofit advocacy organization" | 3, verbatim |

Those repeated phrases are internal evidence of confabulation and need no
external ground truth to read: 39% of California legislators did not
independently turn out to be community organizers. One Senate bio asserts prior
Assembly service for a district and term that appear not to match the real
record — but adjudicating that is the gold set's job, not mine, because my own
training knowledge is the thing under test.

**28.9% grounding is approximately where propositions started** (28%) before
the v4 work took them to 63%. None of that work has been applied to reps.

## The finding that reframes it

`BioGeneratorService.formatRepData()` gives the model **four fields**:

```
Name: Tasha Boerner
Jurisdiction: California State Assembly
District: 77
Party: Democratic
```

That is the entire input. No detail page, no scraped text — and the persisted
provenance says so honestly: `sourceText: null`, `sourceTextHash: null`.

So **71.1% unsourced is structurally guaranteed, not a prompt defect.** A
biography cannot be grounded in four fields; everything beyond "represents
District 77 as a Democrat" must come from training weights. The 28.9% "source"
claims are those four fields restated.

This is exactly the distinction `civics-gold-eval.md` drew — *"If a fact is
absent from the extracted text, the model never had it, and no prompt change
can recover it — that is a scraper finding, not a prompt finding."* Reps are
that case wholesale.

**And the text exists.** `source_versions` holds **120 `representatives` rows**,
one per state rep, fetched 2026-10-12, averaging 45,748 bytes of real
`text/html` at per-member URLs:

| pattern | rows |
|---|---:|
| `https://www.assembly.ca.gov/assemblymembers/{district}` | 80 |
| `https://sd{district}.senate.ca.gov/` | 30 |
| `https://sr{district}.senate.ca.gov/` | 10 |

`content` is populated for all 120. `derived_text` is **NULL for all 120**
(propositions, by contrast, retain 24,526 chars on average). The pages are
fetched, hashed, archived — and then discarded before the model is asked to
write the biography they contain.

So the headline is: **reps have a plumbing gap, not a prompt gap.**

## Decisions

### D1. Fix the input before touching the prompt

No prompt change can ground a bio in four fields, so prompt tuning first would
measure noise and bank a false win. The sequence is: plumb the archived source
text into the bio path, re-measure grounding, *then* tune.

Prompt work is not cancelled — it is sequenced after the input fix, where its
effect is observable.

### D2. The gold set is authored from the archived bytes, not a fresh fetch

Author from `htmlToReadableText(source_versions.content)` for the pinned
`content_hash`. Three reasons: no re-crawl, so the pages cannot shift under the
gold set; the exact bytes are identifiable forever by hash; and it is the same
text a fixed pipeline would see, so a gold miss is a model finding rather than
a fetch-timing artifact.

Record `content_hash` and `fetched_at` per entry. A gold set that cannot name
the bytes it was authored from is not auditable.

### D3. Every gold entry carries a verbatim quote, or it does not exist

Carried verbatim from the civics plan, and it is the amendment that makes a
Claude-authored reference defensible at all: a gold set that is merely my
reading measures *how close nemotron is to me* and encodes my errors as truth.

So: **if a fact cannot be quoted from the extracted text, it does not go in the
gold set** — however confident I am about it. That makes the reference
auditable in minutes by someone who did not author it.

This has a consequence specific to reps that must be stated rather than
discovered: because the gold set admits only quotable facts, it will be almost
entirely `origin: source`. It therefore **cannot** score the 71% of current
output that is unsourced. That is not a gap in the gold set; it is the point.
Which is why D4 exists.

### D4. A mislabelling axis, provable without ground truth

The product deliberately permits unsourced claims — `origin: training` with a
`sourceHint` is a modelled, legitimate state. So an eval that simply penalises
every training claim would be measuring a product decision, not a defect.

The integrity question is different and sharper: **a claim labelled
`origin: source` must be quotable from the source text.** If it is not, the
model has passed invention off as grounded, which is a provable failure
needing no external truth — only the archived bytes.

Four axes, never merged into one score:

| axis | question | failure it names |
|---|---|---|
| **recall** | of quotable gold facts, how many found? | missed real content |
| **precision** | of claims marked `source`, how many are quotable? | invention sold as grounded |
| **labelling** | are unquotable claims marked `training`? | dishonest attribution |
| **field presence** | did a field with gold content come back empty? | silent dropouts |

`precision` and `labelling` are two readings of the same comparison and are
reported separately on purpose: the first says *how much is wrong*, the second
says *whether the model admitted it*.

### D5. The baseline is the current output, because no older model survives

Civics kept `civics-baseline-qwen.json`. Reps have no equivalent: the corpus was
regenerated in place on 2026-10-12/13 and nothing was retained, so the only
pre-nemotron rows are the 5 Sonoma supervisors from 2026-09-06 — which carry
**no model or prompt attribution at all** (pre-#1281), so they cannot serve as
an attributable baseline.

Therefore capture the **current** nemotron output as
`fixtures/representatives-baseline-nemotron.json` before changing anything.
This is a one-way door: regeneration overwrites in place, and an uncaptured
baseline is gone. Capture is the first task, not a later one.

### D6. Two reps are held out and never looked at while tuning

The #1333 lesson, applied from the start rather than retrofitted: tuned numbers
measured on the tuning set are circular.

### D7. Determinism is required, and is currently absent

`bio-generator.service.ts` calls `llm.generate` with `temperature: 0.2` and
**no seed**, while `ollama.provider.ts` already supports `options.seed`. Two
runs are therefore free to disagree, and a prompt comparison without a fixed
seed is invalid — civics learned this when two identical runs disagreed on 2 of
24 pages.

Add a seed for eval runs only. Production stays unseeded deliberately (#1327: a
fixed seed turns a page that extracts on half its attempts into one that fails
on all of them, forever).

### D8. There is no key from a rep to its source page

`representatives` has no `source_url` or `sourceVersionId`; the only columns are
`bio_source` (which holds `'ai-generated'`, not a URL) and `photo_url`. Matching
a rep to its archived page must be done by URL convention — and the Senate
convention encodes **party** (`sd` for Democrats, `sr` for Republicans), so a
party correction silently breaks the join.

The eval will derive the join and assert it resolves for all 8 sample reps. A
real `sourceVersionId` FK is the right fix and is **out of scope here**; filed
separately so this plan is not blocked on a migration.

## Scope: 8 reps, 6 tuning + 2 held out

Stratified 2×2×2 on chamber × `aide` phrase × `organizer` phrase, picked
deterministically (lowest district in each cell) so the sample cannot be
cherry-picked after the fact. Spans both parties without being selected for it.

| rep | chamber | dist | party | aide | organizer | training/total | role |
|---|---|---:|---|:--:|:--:|---:|---|
| Michelle Rodriguez | Assembly | 53 | D | ✓ | ✓ | 11/15 | tune |
| Cecilia M. Aguiar-Curry | Assembly | 4 | D | — | ✓ | 11/14 | tune |
| Heather Hadwick | Assembly | 1 | R | — | — | 5/8 | tune |
| Sasha Renée Pérez | Senate | 25 | D | ✓ | ✓ | 9/13 | tune |
| Angelique V. Ashby | Senate | 8 | D | ✓ | — | 6/9 | tune |
| Marie Alvarado-Gil | Senate | 4 | R | — | ✓ | 7/10 | tune |
| **Matt Haney** | Assembly | 17 | D | ✓ | — | 10/13 | **held out** |
| **Megan Dahle** | Senate | 1 | R | — | — | 7/11 | **held out** |

Held-out pair spans one flagged and one clean case, one per chamber, so it
tests generalisation rather than only the easy end.

The 5 Sonoma supervisors are **excluded**: a different source shape, no
attribution, and no `source_versions` row. Noted as a separate question.

## Sequence

1. **Capture the baseline** (D5) — one-way door, do it first.
2. **Author the gold set** for the 6 tuning reps from archived bytes (D2, D3),
   recording `content_hash` per entry.
3. **Build the scorer** with the four axes (D4) separate.
4. **Score the baseline.** Expect low `precision`/`labelling` — that is the
   number the input fix has to move.
5. **Plumb the source text** into the bio path (D1): populate `derived_text`,
   pass it as the prompt input, persist `sourceText`/`sourceTextHash` so the
   provenance stops being null.
6. **Re-score.** This is the real measurement.
7. **Only then** tune the prompt, re-scoring each change.
8. **Score the held-out pair once**, at the end (D6).

Steps 1–4 are measurement and change no behaviour. Step 5 is the substantive
change. A reader should be able to stop after 4 and still know what is wrong.

## Deliverables

- `packages/eval-harness/fixtures/gold-representatives.json` — quote-backed,
  content-hash-pinned, with `notAuthoredYet` and `ownerReviewRequired`
  following `gold-civics.json`
- `packages/eval-harness/fixtures/representatives-baseline-nemotron.json`
- `packages/eval-harness/src/representatives-eval.ts` — four axes, unmerged
- `packages/eval-harness/src/gold-representatives.spec.ts`
- `docs/evals/<date>-representatives-gold.md` — results, including the
  baseline's own numbers
- An issue for the `sourceVersionId` FK (D8)

## Risks and limits, stated up front

| risk | mitigation |
|---|---|
| **My authorship is the measurement's weak point** | D3: quote-or-omit, plus `ownerReviewRequired`. A countersign is required; I am a model scoring a model |
| Assembly pages are one site, Senate are 80 separate ones | Both patterns in the sample; shape differences are a finding, not noise |
| `htmlToReadableText` may flatten structure these pages rely on | Record `extractedChars` per entry; a page whose facts vanish in extraction is a **scraper** finding, logged as such, not a model miss |
| n=8 cannot support a significance claim | Report per-rep, never a single aggregate. The sample is for direction, not for a p-value |
| Plumbing the full page may blow the context window | #1322/#1323 already detect truncation and make the window configurable; assert no truncation rather than assume |
| The gold set gets tuned toward | D6 held-out pair, scored once |
| Fixing input changes bios users may have read | Bios are already unattributed to a source; improving grounding is the correction, not a regression |

## Execution findings — 2026-10-19

Steps 1–4 ran. They stopped the plan short of tuning, correctly. Results in
`docs/evals/2026-10-19-representatives-gold.md`; the corrections to this plan
are here.

**The diagnosis was one layer too shallow.** This plan said "reps have a
plumbing gap, not a prompt gap" — the source is archived and discarded. True,
but incomplete: **the archived page does not contain a biography in the first
place.** Reading the extracted text of all six tuning reps showed Assembly
pages are roster/committee pages and `sr*` pages are landing pages. Passing
that text to the bio prompt, as D1 proposed, would have grounded committees and
contact details and left the biography exactly as unsourced — more tokens, same
confabulation.

The chain is three defects, filed in causal order:

1. **#1383** — the crawl archives the roster page; the real biography is one
   link away (`a04.asmdc.org`, `ad01.asmrc.org`) and never followed
2. **#1382** — where a biography *is* present (`sd*`), `htmlToReadableText`
   discards it: 25 of 30 pages extract to <200 chars
3. **#1381** — the prompt receives four fields regardless

So D1 ("fix the input before touching the prompt") holds and is vindicated —
but "the input" means #1383, not the plumbing of #1381.

**The gold set pivoted to what the sources support.** A biography gold set
cannot be authored at all, so D3 (quote-or-omit) forced the honest move:
`gold-representatives.json` covers **committees and district facts** for the
three Assembly pages, where the source is rich and quotable, and records the
other three pages as blocked with the issue blocking each. That is a smaller
deliverable than planned and a truer one.

**D4's mislabelling axis is not yet exercised.** It needs `origin: source`
claims to test against source text; with no source text in the bio path there
is nothing to test. It stays in the design for after #1383.

**The headline result reframes the whole question.** Same model, same digest,
same day: **90.0% recall** on committee summaries where the roster page lists
committees verbatim, against **71.1% unsourced** on biographies where it is
given nothing. nemotron is not the problem.

**Two scoring findings worth keeping:** Rules committees are dropped in 3 of 3
occurrences, and role fidelity is inconsistent (Hadwick's two Vice Chair roles
flattened; Aguiar-Curry's Co-Chair preserved).

**A retraction.** I flagged `e.g. "Health" + "Reproductive Health"` in the
committees prompt as the civics copy-hazard. It is not — "Select Committee on
Reproductive Health" is a real assignment on Aguiar-Curry's page and is quoted
in the gold set. The prompt's examples are real committee names, so their
appearance in output proves nothing. `bill-extraction`'s seven literal
examples remain unaudited.

**D8 was worse than stated.** The URL join also requires zero-padding
(`sd08`, `assemblymembers/04`) while `representatives.district` is unpadded —
only 3 of 8 sample reps resolved before that was found. The `sourceVersionId`
FK is still the right fix.

### Revised sequence

Steps 1–4 are done. Steps 5–8 are blocked on the defect chain:

5. **#1383** — archive a page containing a biography
6. **#1382** — stop discarding biographies on pages that have one
7. **#1381** — pass that text to the prompt, persist `sourceText`/`sourceTextHash`
8. Re-measure, *then* tune, then score the held-out pair once

Committee-summary tuning is **not** blocked — the gold set and baseline for it
exist now, and the Rules-dropping and role-fidelity findings are actionable
immediately.

## Deliberately not in this plan

- Committees and bills. Same exercise, same machinery, after reps proves it.
  `bill-extraction` carries seven literal `e.g.` examples and
  `representative-committees-summary` carries `"Health" + "Reproductive Health"`
  — the exact civics copy-hazard shape — but auditing those needs the scorer
  this plan builds.
- The `sourceVersionId` FK (D8) — filed, not done here.
- Re-running the full 120-rep corpus. Nothing should be regenerated at scale
  until step 6 shows the input fix works on 6.
- Changing what `origin: training` means as a product decision. This plan
  measures whether labels are honest, not whether unsourced claims are allowed.
