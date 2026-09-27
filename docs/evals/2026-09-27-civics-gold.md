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
