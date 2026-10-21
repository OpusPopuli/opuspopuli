# Representatives prompt tuning — what the second measurement found

**Issues:** #1381 (bio claims unsourced and some false) · #1393 (committee
summaries credit chairmanships not held) · #1394 (bios regenerate every sync;
a rep missing from one scrape never gets one) · #1391 (a scraped bio kept the
previous AI attribution and claims).

Follows `docs/evals/2026-10-19-representatives-gold.md`, which deliberately
stopped short of prompt tuning because the sourcing defects (#1381/#1382/#1383)
would have made any measured gain a false win. Those are merged. This is the
tuning round.

Two templates were revised to v2 in `prompt-service`
(`document-analysis-representative-bio`,
`document-analysis-representative-committees-summary`), and one deterministic
guard was added in this repo (`bio-source-guard.ts`).

Model: `nemotron-3.5-lightning:30b-a3b`, `temperature: 0.2`, `think: false` —
the production configuration. Inputs are the exact strings
`BioGeneratorService.formatRepData` and
`CommitteeSummaryGeneratorService.formatRepData` build, so the measurement is
of what production sends, not of a cleaner proxy.

## Headline

| surface | metric | v1 | v2 | v2 + guard |
|---|---|---:|---:|---:|
| biographies | training-origin share of claims | 67–79% | 0% | 0% |
| biographies | bios asserting a fact 4 fields can't support (of 22) | 22 | 8–11 | **0** |
| biographies | mean length | ~166 words | ~16 words | ~12 words |
| biographies | bio written for a **vacant** seat | 158 words | none | none |
| committee summaries | assignments dropped (of 27) | 4–5 | — | **0–1** |
| committee summaries | role errors (of 7 non-Member roles) | 4 | — | **0** |

Ranges are across three runs at the production temperature.

## Biographies: the prompt was asking for the confabulation

v1 opened by saying the writer works from source data "supplemented by your
general knowledge", listed education, pre-politics career, community roles,
prior offices with dates, residence and family under **"Prefer training
knowledge for"**, told the model to draw **"freely"** from training knowledge
for well-known figures, and then required **180–320 words in four paragraphs**.

Production hands that template four fields — `Name`, `Jurisdiction`,
`District`, `Party` — for **109 of California's 125 legislators**, because only
16 Senate pages yield a scrapeable bio and the Assembly's 80 are blocked at
TLS. A 180-word floor over four fields can only be met by invention.

v1 output, verbatim, checked against each rep's own official page:

| rep | v1 asserted | actual |
|---|---|---|
| Hadwick (AD1) | BA Political Science, UC Davis | Agriculture Science |
| Hadwick | "resides in the town of Oakley" | Modoc County, ~300 mi away |
| Hadwick | "won the open seat vacated by Republican Jim Frazier" | Frazier was a **Democrat**, from AD11 |
| Ashby (SD8) | first elected 2020; BA CSU Sacramento | 2022; McGeorge School of Law |
| Ashby | Sacramento City Council 2016–2020, District 4 | 2010–2022, District 1 |
| Aguiar-Curry (AD4) | BA UC Davis; Woodland school board; Woodland City Council 2002–04 | San Jose State; **mayor of Winters** |
| Carrillo (AD39) | serves Bell Gardens, Cudahy, Huntington Park… | AD39 is Palmdale / Antelope Valley |
| Carrillo | a spouse, named, with her employer and school district | **a fabricated private individual** — not reproduced here |

The fabricated spouse's name is deliberately **not** quoted. This repository
is public, and reproducing an invented name attached to a real legislator
would publish a searchable claim about a private individual — who may share
the name with someone real. Public-figure details in civic filings are fair
game here; a spouse invented by a model is not. The same omission applies to
the GitHub issues.

Every one was tagged `confidence: "high"`. Aguiar-Curry has served since 2016,
so familiarity is not the discriminator. The same fabricated career recurred
across unrelated people — in the 125-rep corpus, 49 were "community organizers"
and 10 former "legislative aides" in the same chamber, which is the signature
of a length target being filled rather than a recollection being reported.

v1 also wrote 158 words about the holder of a **vacant** Senate district.

### What v2 changes

Every factuality rule is kept. The knowledge tier is inverted: training
knowledge may **extend** a fact source data states but never **introduce** one,
enforced structurally by requiring a `sourceField` on every training claim, so
an unsupported sentence has nowhere to be recorded. The word target is gone,
the four paragraphs became an upper bound rather than a quota, the measured
evidence above is quoted inline so the constraint reads as a finding rather
than a preference, and a STEP 0 returns an empty bio for a vacant seat.

Result: training-origin claims 67–79% → **0%**, and every invented university,
employer, prior office, residence city and spouse disappeared.

### Why a code guard was still needed

v2 alone did not finish the job. Across 22 reps, 8–11 bios still asserted
something four fields cannot support:

| residue | example | truth |
|---|---|---|
| election year | Hadwick, Arreguín, Dahle each "first elected in 2022" | all three elected **2024** |
| term count | Jones "currently serving his first term" | in office since 2018 |
| leadership post | Grove "the current Senate Republican Leader" | left that post in 2022 |
| precedence claim | Cervantes "the first woman to represent the district" | unsupported |

None is recall — 2022 is a fixed prior the model reaches for when asked for a
second sentence about a legislator. All were emitted tagged `origin: "source"`
with a `sourceField` of `"Party"`, which is worse than an honest `training`
label because it tells a reader the fact was checked.

An explicit, worked rule naming exactly this case did not stop it. Further
prompt text would have been guessing, so enforcement moved to code:
`dropUnsupportedSentences` removes any sentence whose year, term count,
leadership post or precedence claim does not appear in the source text, and
drops that sentence's claim with it. Matched **text** is compared rather than
the fact class, so the check self-disables in the right direction: a scraped
bio supplying "elected in 2024" licenses that sentence, while a different year
in the same bio still does not.

Post-guard, across three runs: **0 of 22** bios assert an unsupported year,
term count, leadership post, precedence claim, university, employer, prior
office, residence or family detail. 0 unparseable.

This is a verification layer over named failure classes, not a proof of
groundedness. A class that shows up later belongs in the guard rather than in
another revision of the prompt.

### What the 109 reps now get

> Heather Hadwick is a Republican representing California State Assembly
> District 1.

Twelve words where there were 166. That is the correct output for four fields,
and the honest answer to the gold set's finding. **Coverage is now a job for
the extraction path, not for recall** — the 16 scraped Senate bios bypass this
generator entirely (`bioSource: 'scraped'`), and the Assembly's 80 stay blocked
until the TLS/Wayback route lands.

## Committee summaries: two defects, both in the template

The gold set measured 90.0% recall here, with two specific failures.

**Rules committees were dropped in 3 of 3 occurrences.** v1 framed the entire
output as "policy areas the assignments touch" and required every label be
derivable from a committee name — which leaves a procedural committee (Rules,
Ethics, Legislative Audit) with no representable form, so under a 60-word cap
it was silently discarded. A reader could not tell a rep who sits on Rules from
one who does not, and Rules is among the most consequential assignments in
either chamber.

**Role fidelity was inconsistent.** Hadwick's two vice-chairmanships were
flattened to one while Aguiar-Curry's Co-Chair survived, because v1 asked only
that chair roles be named, and only "at least one" — leaving Vice Chair,
Co-Chair and a second chairmanship ungoverned.

v2 adds RULE 4 (every assignment named or inside a named group; grouping is how
brevity is achieved, dropping is not; procedural committees named for what they
are rather than given an invented subject matter) and RULE 5 (role word used
verbatim, every non-Member role named with its full committee name, and writing
Vice Chair or Co-Chair as a chairmanship called out as a false statement about
who runs a committee). The cap moved from 2 sentences / 60 words to 3 / 90 and
is explicitly subordinated to those rules, since the dropping was a
length-pressure artefact.

Two drafts failed before this one, and both failures are recorded in the
template's `changeNote`:

1. "every **committee**" still dropped a Co-Chair of the Legislative Women's
   Caucus — the model read a caucus as outside the rule's scope. RULE 4 now
   says "assignment" and enumerates caucuses, commissions, task forces, select
   committees, subcommittees and joint committees.
2. Having retained the caucus, it then wrote "chairs the Assembly Committee on
   Local Government **and the Legislative Women's Caucus**" — a chairmanship
   asserted over a co-chaired body by *ellipsis* rather than by substitution.
   RULE 5 now forbids sharing one role word across bodies whose roles differ.

Measured over 5 assignment shapes (27 assignments, 7 non-Member roles),
3 runs each:

| | v1 | v2 |
|---|---:|---:|
| assignments dropped | 4, 5, 5 of 27 | **0, 1, 0** |
| role errors | 4, 4, 4 of 7 | **0, 0, 0** |

The one v2 drop is run-to-run variance, not a systematic omission.

## Verification

- `bio-source-guard.spec.ts` — 18 tests, 100% statement/branch/function/line.
- **Mutation-tested**, per `feedback_verify_regression_tests`: 10 mutations,
  each caught. Disabling any one of the four fact-class patterns fails 1–8
  tests; comparing fact *class* instead of matched *text* fails 13; removing
  the abbreviation guard fails 2; not filtering claims fails 2; keeping empty
  paragraphs, dropping whitespace normalisation, and a lossy sentence rejoin
  each fail 1+.
- Two of my own tests were found vacuous during that pass and rewritten — a
  mis-split away from a year rejoins losslessly, so the honorific test only
  bites when the year sits in the same sentence as the abbreviation.
- 1216 region-domain tests and 318 prompt-service tests pass.

## Confirmed on the UAT stack (first production run, maxReps=5)

The measurements above were taken by driving Ollama directly. This is the same
change running through the real worker — prompt-service rebuilt and reseeded
(both templates at v2, v1 and v2 both in `prompt_version_history` with
distinct hashes), region + region-worker rebuilt, 120 reps synced.

| | before | after |
|---|---:|---:|
| `ai-generated` bios | 123 @ **v1**, avg **991 ch** | 5 @ **v2**, avg **100 ch** (80–151) |
| grounding-check violations | — | **0 rows** |
| `representative` claims current | 1,374 | 0 stale; new ones written per bio |

The runbook's grounding query — years, term counts, leadership posts,
universities, residences, spouses, prior offices — returns **zero rows**
against the generated bios.

**The guard fired in production on its first run**, exactly as designed:

```
WARN [BioGeneratorService] Bio for David A. Alvarez: dropped 1 sentence(s)
  asserting a fact absent from the source data —
  [term count] "He is currently serving his first term in the Assembly."
```

That log line originally said "asserting a year". It was a term count, so
`dropped` now carries the matched class per sentence rather than a bare
string — the operator's only view of which class is drifting should not name
the wrong one. 21 tests, 100% coverage, and the per-class `break` is itself
mutation-covered (two unsupported years in one sentence is one reason, not
two).

### Two findings the run surfaced

**1. The committees prompt was not exercised at all.**
`CommitteeSummaryGeneratorService` selects on `committeesSummary: null`, the
same precedence rule as bios, so the 79 existing summaries blocked it — the
generator did not even log. Those 79 were also the **unattested** summaries
carried since #1281 (all with `committees_summary_prompt_version` NULL).
Cleared (backed up first); regenerating under v2 both exercises the change and
stamps attribution, closing that carried item. Awaiting the next trigger.

**2. The activity-summary feature is running on a fallback prompt that was
never authored.** `EntityActivitySummaryGeneratorService` requests
`representative-activity-summary` / `committee-activity-summary`.
**Neither exists in prompt-service** — not as a template, not in
`prompt_version_history`, and not in the local `prompt_templates` fallback
table. The fetch 404s, the client follows its fallback name, and 76 reps got a
summary anyway. Their attribution proves it: 14 carry the sha256 of
`document-analysis-generic`, and the other 62 a composed variant — two
distinct hashes, both labelled "v1", written minutes apart in the same run.

The text hash is honest about what ran, but the *version* points at a template
a reader cannot go read, which is the attestation chain the governing principle
exists to protect. This is the failure mode CLAUDE.md warns about one step
worse than described: not an empty result that gets cached, but plausible
output produced by a generic prompt and attributed as if purpose-built. It
needs the two templates authored in prompt-service; **not fixed here**, since
that is prompt content to be decided rather than a defect to patch.

## The name prefix on scraped bios

The scraped bios came out as "Jesse Arreguín A lifelong advocate…" and
"Angelique Ashby Senator Ashby was elected…". That name is the systematic
**residue of the chrome patterns**: the heading is "<prefix> <Name>", and
`bioTrimPatterns` can only name the fixed prefix — `^Meet Senator\s+`,
`^Representing California Senate District \d+ State Senator\s+` — so the
variable part survives.

`trimBioChrome`'s own comment records that a surname anchor was tried and
abandoned, because it could not tell chrome from prose and turned the good
"Senator Ashby was elected in 2022…" into "was elected in 2022…". The missing
discriminator is **what follows the name**: a heading is followed by the start
of a new sentence; prose that opens by naming its subject is followed by that
subject's verb, in lower case.

Measured over the nine `sdNN.senate.ca.gov` pages that yield a bio through the
configured selector, after chrome trimming:

| page | after chrome trim | follows the name | |
|---|---|---|---|
| sd02 | `Mike McGuire Mike McGuire is pro Tem…` | `M` | strip |
| sd07 | `Jesse Arreguín A lifelong advocate…` | `A` | strip |
| sd08 | `Angelique Ashby Senator Ashby was elected…` | `S` | strip |
| sd09 | `Tim Grayson Elected to represent…` | `E` | strip |
| sd11 | `Scott Wiener Senator Scott Wiener represents…` | `S` | strip |
| sd18 | `Steve Padilla --> Senator Steve Padilla was…` | `-->` then `S` | strip |
| sd21 | `Senate President pro Tempore Monique Limón **was** elected…` | `was` | **keep** |

Five of nine carry a bare leading name and every one is followed by a capital;
the one page whose title IS its prose is followed by a lower-case verb and is
left alone. The same test protects the case that killed the old heuristic.

`trimLeadingName` anchors on the **surname**, not the full name, because the
roster and the page disagree: the roster says "Timothy S. Grayson" and
"Stephen C. Padilla" where the pages say "Tim Grayson" and "Steve Padilla".
Matching the full name would miss exactly those two.

The separator is `[^\p{L}]+` — at least one non-letter — which is what makes
the surname match end on a word boundary. Mutation testing found this: with a
zero-width separator, a surname that merely PREFIXES the next word severs it,
publishing "Ann Smith Is a lifelong…" for a bio opening "LeeAnn Smith Is…"
under surname "Lee". A `\b` cannot do the job, because JS word boundaries are
ASCII and a surname ending in an accented letter has no boundary before a
space.

17 tests over the real page text, 8 mutations run. Three survived and were
handled honestly rather than papered over: the empty-surname guard was
genuinely untested and now is; the ASCII-vs-unicode separator class and the
greedy-vs-lazy token run are **behaviourally equivalent** under regex
backtracking, since the `\p{Lu}` lookahead forces the same final match either
way, so no test was invented for them.

No data clear is needed: scraped bios are overwritten on every sync, so a
re-sync rewrites the stored rows through the new trim.

### Two extraction defects this measurement surfaced

Neither is fixed here; both are visible in the table above.

- **sd18 leaks `-->` into the extracted text** — an HTML comment terminator
  surviving `htmlToReadableText`. The non-letter separator happens to consume
  it in this position, but it would remain anywhere else in a bio.
- **sd17 and sd28 extract navigation, not a biography** — "Legislation Latest
  Legislation Updates --> Sign Up For The Latest Updates Sign Up Now
  Resources…". They clear the 100-character floor, and the configured
  `^Sign Up For The Latest Updates` noise pattern is `^`-anchored so it does
  not match mid-string. Measured with an approximation of the extractor rather
  than the pipeline itself, so confirm against a real crawl before acting.

## Committee summaries: the deterministic split (#1393)

The smoke run found what the offline fixtures could not. v2 ran against the
five reps the generator reaches first in UAT — 13 to 20 assignments each,
where the offline fixtures had 4 to 9 — and produced **false role claims**:

| rep | roles among assignments | false role claims |
|---|---|---:|
| Aguiar-Curry | 1 Co-Chair of 13 | 0 |
| Ahrens | 1 Chair of 16 | 0 |
| Alanis | 2 Vice Chair of 20 | 0 |
| **Addis** | 2 Chair of 17 | yes — given a Vice Chair role she holds nowhere |
| **Alvarez** | 2 Chair + 1 Co-Chair of 14 | yes — given a chairmanship of 3 select committees he only sits on |

One named role was always handled cleanly; two or three started
misattributing. The mechanism is a long enumeration drifting past the bodies a
role word governs — "Chair of A, B, C, D, E" where only A and B are chaired.
v3 improved it (8 false claims vs v2's 15 on the same checker) but nothing
removed it.

**So the roles stopped being the model's job.** `committee-roles.ts` renders
them from the structured `role`/`name` fields, and the prompt is handed the
Member committee names with **no roles at all**. A role the model is never
shown is one it cannot misattribute — the error class is unreachable rather
than rarer. The prompt also keeps a code-side guard: any policy sentence
containing a role word is discarded, because the model was given none, so a
role word there is invented.

Measured on the same five reps, with the real model at production settings:

| | v1–v3 | v7 + split |
|---|---:|---:|
| false role claims (80 assignments) | 4–15 | **0, structurally** |
| policy sentences claiming a role | — | **0 of 5** |
| procedural committees dropped | 3 of 3 (v1) | **0 of 5** |
| mean policy-sentence length | 92–100w | 29w |

Two incidental findings on the way:

- **A real rep was in the prompt's own examples.** v1–v2 illustrated the rules
  with "Addis" and "the Select Committee on Serving Students with
  Disabilities" — a real legislator and a real committee in our data. Addis's
  own v2 output both chaired that committee and listed it again as a member.
  That is what `project_prompt_example_copied_as_answer` describes (nemotron
  returned a prompt's illustrative values as its answer for 50 of 71
  measures). Examples now use a legislator and committees that do not exist,
  so leakage is detectable rather than plausible.
- **The role vocabulary is not uniform.** 37 rows say `Vice Chair` and one
  says `Vice-Chair`. Untreated that single row renders as a fourth role group
  of one; `normaliseRole` folds it in. The live data also carries at least one
  duplicate assignment, which would otherwise print a committee twice.

### What took four more revisions, and what did not work

Correctness was settled by the split. The remaining work was quality, and it
oscillated — worth recording so it is not repeated:

- v4 eliminated the false claims but the model **enumerated** rather than
  grouped, and used the full name where the rule asked for the surname.
- v5 fixed the surname; enumeration got worse (Alanis 80 words against a
  40-word cap) and a procedural committee was still dropped.
- v6 diagnosed the cause — v1–v5 all posed **lossless** compression ("name the
  areas these eighteen committees cover") and the model resolved the
  impossibility by keeping everything. Reframing it as **selection** (the full
  list renders beneath the preamble, so omitting a minor area is correct) took
  Alanis from 80 words to 25. But one clause of v6 — "say 'include' rather
  than 'cover'" — collided with the sentence the model was already writing and
  produced broken grammar in 2 of 5 outputs.
- v7 removes that clause and keeps the rest. 0 false claims, 0 role-claiming
  sentences, 0 procedural committees dropped, 4 of 5 within the word cap.

The lesson is the one already in `project_civics_nemotron_resync_state`: when
a measurement stops improving across prompt revisions, the next lever is code,
not a further revision. Here the data was already structured, so there was
never anything for the model to interpret.

## Full state sync, 2026-10-21 (maxReps=150, 119 reps)

The definitive run. Both prompts, the bio guard, the deterministic role split
and `trimLeadingName`, over the whole California roster.

| check | result |
|---|---|
| AI bios | **102** at bio v2, mean **108 ch** (v1 averaged 991) |
| Scraped bios | **15**, mean 388 ch (2 before this work) |
| Unsupported facts in generated bios | **0** — no year, term count, leadership post, precedence claim, university, residence, employer, prior office or family detail |
| Vacant seats holding a bio | **0** of 2 |
| Committee summaries | **79**, all at v7 |
| **Named roles attributed wrongly or dropped** | **0 of 126**, across 79 reps |
| Guard drops | 27 (20 year, 5 year+term count, 1 term count, 1 leadership post) |
| Junk bios discarded by the noise patterns | 11 |

126 named roles rendered exactly is the number that matters: the same corpus
under prompt v2 produced 4 false role claims on the first 5 reps alone.

Both vacant seats were caught despite being named "Member Vacant" rather than
the bare "Vacant" that STEP 0 enumerates.

### Three things this run surfaced

**1. One scraped bio still led with the name** — `ca-senate-39`, "Dr. Akilah
Weber Pierson Previously representing…". `extractLastName` stripped only
`Jr|Sr|II|III|IV|Esq`, so for "Akilah Weber Pierson M.D." the surname resolved
to **"M.D."** and `trimLeadingName` had nothing to anchor on. This was
predicted in that function's comment as the fail-safe direction, and it is
worse than cosmetic: `last_name` was stored as `M.D.` for her and `Ph.D.` for
Steven S. Choi, and the committee summary generator selects
`orderBy: { lastName: 'asc' }`, so both sorted under their credential.

Fixed by recognising credential suffixes and popping them in a loop (a name
can carry two). That exposed a second distinction worth keeping: a comma means
opposite things in "Ávila Farías, Anamarie" (surname first — a Spanish double
surname must not be cut to its last word) and "Akilah Weber Pierson, M.D."
(normal order, credential set off by punctuation). They are told apart by
whether what follows the comma is itself a suffix. Deployed after the run;
scraped bios are overwritten every sync, so this corrects itself next run.

**2. Bio generation is roster-driven; committee summaries are DB-driven.**
The roster returned **119** reps, not 120 — Josh Becker (`ca-senate-13`) was
absent from the scrape. `enrichBios` filters the fetched `reps` array, so he
was never a candidate and has no bio at all.
`CommitteeSummaryGeneratorService` reads candidates from the DB instead, and
its doc comment states why: "A scrape might fail or only return part of a
chamber… Reading candidates from the DB makes this job resilient to scrape
flakes." Bio generation does not have that property, so a rep missing from one
scrape stays without a bio until a later scrape happens to include them. Not
changed here — which generator model is right is a decision, not a defect to
patch quietly.

**3. The activity-summary prompt still does not exist**, and the cost is now
visible. 67 failed template fetches in one run (61 for
`representative-activity-summary`, 6 for `committee-activity-summary`) and 14
circuit-breaker open cycles, all of it retry-and-back-off against a template
that was never authored. Zero failures for the bio and committees-summary
templates, and because activity summaries run last the breaker cannot affect
them. All 76 activity summaries are also **rewritten every sync** through the
generic fallback — the rows are timestamped within this run, under two
distinct hashes both labelled "v1". See finding 2 of the earlier section.

## Carried forward

- **Assembly bios remain unsourced at the source** — 80 reps blocked on Entrust
  TLS / Cloudflare. The Wayback route is the open lever.
- **The footnote still overstates grounding.** "Generated from public record
  data" was already flagged in the previous eval; with bios now ~12 words of
  the four input fields, it is further off. The tooltip is precise; the
  footnote is not.
- **`generateActivitySummaries()` is still unbounded** — `maxReps` bounds the
  detail crawl and the bio generator, not this.
- **Bio generation's roster dependency** (finding 2 above) — Josh Becker has
  no bio because one scrape omitted him.
- **`representative-activity-summary` and `committee-activity-summary` do not
  exist in prompt-service** — see finding 2 above. 76 reps currently carry a
  summary attributed to a generic fallback.
- The guard covers four fact classes. Professions, place names and
  organisation names are **not** mechanically detectable and rest on the prompt
  alone — they measured clean across 3 runs, which is evidence, not a
  guarantee.
