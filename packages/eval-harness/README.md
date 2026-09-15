# `@opuspopuli/eval-harness`

The measurement instrument for AI-architecture changes. Roadmap **R3**, milestone **M4** (`docs/plans/ai-architecture-roadmap.md`).

## Why this exists

Several confident claims about retrieval in this project turned out to be wrong when measured:

- that a 768-dim multilingual model must beat a 384-dim MiniLM — **it does not, on English**
- that Metal-backed inference would be faster — **~73× slower per query**
- that nomic v1.5 was a reasonable fallback — **0/14 on this corpus**

Each was plausible. Each was stated with confidence. Each was overturned by ten minutes of measurement. The harness exists so that retrieval changes can say what they did to a number, instead of what they ought to have done.

## Quick start

**Build the providers first.** The harness executes each provider's `dist/`, not its source, and `pnpm install` does not build:

```bash
pnpm -r --filter './packages/*' build
```

Every eval entrypoint refuses to run against a stale build rather than reporting a number from it — see [The stale-build trap](#the-stale-build-trap).

```bash
# The in-process Xenova default (NOT MiniLM any more — see baselines)
pnpm --filter @opuspopuli/eval-harness eval:baseline

# A candidate
pnpm --filter @opuspopuli/eval-harness eval:retrieval -- \
  --provider ollama --model nomic-embed-text-v2-moe:latest --prefix
```

Results land in `results/` as JSON (gitignored), keyed by provider+model, so runs stay comparable instead of scrolling past in a terminal.

## What it measures

| Metric              | Meaning                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `top1` / `top1Rate` | Gold document ranked first                                                                                                                                                                                                      |
| `MRR`               | Mean reciprocal rank — credits near-misses                                                                                                                                                                                      |
| `meanMargin`        | Top score minus the best **non-gold** score. **The one to watch.** A correct answer winning by 0.036 is nearly a coin flip; the same answer winning by 0.223 is a retrieval. Hit rate alone hides that difference.              |
| `corpusSeparation`  | Query-independent. How far apart the model spreads the corpus. Predicts failure before any query runs: nomic v1.5 scored **0.942 mean** here and returned 0/14. A `max` of 1.000 means two documents are identical — see #1219. |
| `byLang`            | EN and ES reported separately. Spanish parity is a platform non-negotiable, and an aggregate number hides it.                                                                                                                   |

Margin is computed against the best _non-gold_ document deliberately: several filings are genuine duplicates, so ranking two of them 1st and 2nd is correct behaviour and must not be scored as a narrow win.

## Baselines — 2026-09-14

65 propositions, 22 items (14 EN + 8 ES), post-#1219 summaries, current build.

| Model                                    | dims | Overall                          | EN                  | ES                    | Corpus sep. (mean) |
| ---------------------------------------- | ---- | -------------------------------- | ------------------- | --------------------- | ------------------ |
| `Xenova/all-MiniLM-L6-v2`                | 384  | 18/22 · MRR .865 · margin .1366  | 13/14 · margin .1941 | 5/8 · margin **.0360** | 0.375              |
| `Xenova/bge-base-en-v1.5` *(the current `eval:baseline` default)* | 768 | 21/22 · MRR .977 · margin .0931 | 13/14 · margin .1115 | 8/8 · margin .0610 | 0.693 |
| `nomic-embed-text-v2-moe` **prefixed**   | 768  | **21/22 · MRR .977 · margin .1794** | 13/14 · margin .1542 | **8/8 · margin .2234** | 0.470              |
| `nomic-embed-text-v2-moe` unprefixed     | 768  | 21/22 · MRR .970 · margin .1814  | 13/14 · margin .1554 | 8/8 · margin .2270    | 0.367              |

**Read the margin, not the hit rate.** `bge-base-en-v1.5` ties nomic on hits (21/22) and matches its MRR, yet its Spanish answers clear the next-best document by **0.061** where nomic-prefixed clears by **0.223**. MiniLM's Spanish margin of 0.036 is the number this README has always called "nearly guessing"; bge is not far above it. Its corpus separation tells the same story from the query-independent side — 0.693 mean, by far the most compressed corpus of the four, i.e. it maps these 65 documents closer together than any other candidate.

**`eval:baseline` no longer means MiniLM.** It runs the Xenova provider's *default*, and that default moved to `bge-base-en-v1.5` (768d) with the #1156 cutover work. Earlier revisions of this table labelled that column "MiniLM-384 (production)". To measure MiniLM now, name it:

```bash
pnpm --filter @opuspopuli/eval-harness eval:retrieval -- \
  --provider xenova --model Xenova/all-MiniLM-L6-v2
```

**Prefixing is worth ~0.05 of ES margin and costs nothing.** Prefixed and unprefixed agree on every hit (21/22, 8/8 ES); the prefixed leg holds a higher MRR (.977 vs .970) and a corpus separation of 0.470 vs 0.367. The provider still defaults task prefixes **off** — the comment in `ollama.provider.ts` records an earlier measurement ("margin 0.160 prefixed vs 0.168 unprefixed, within noise") which was taken against a build where prefixing could not run at all (below).

**Both remaining misses are the same corpus defect.** `ret-en-008` misses under every model because three filings share a title and two are byte-identical — `max=1.000` separation under all four. That is #1219 data, not model behaviour.

### The stale-build trap

On 2026-09-14 this clone carried a `dist/` from **Sep 7**, predating the task-prefix support added to `OllamaEmbeddingProvider` for #1156. The harness accepted `--prefix`, wrote `"prefixed": true` into its results JSON, and embedded entirely unprefixed text. Prefixed and unprefixed runs came back **bit-identical** (cosine 1.000000) while the raw Ollama API showed the prefix moves an embedding a long way (cosine 0.763).

Nothing in the source was wrong. Nothing logged an error. The result file asserted a configuration the running code could not honour — which is the same defect this harness was built to catch, one level down: `retrieval-eval.ts` stopped reimplementing the provider so it would measure production, and then measured a four-day-old build of it.

`src/build-freshness.ts` now refuses to run any eval when a guarded package's source is newer than its build, and names the rebuild command. `EVAL_SKIP_BUILD_CHECK=1` bypasses it and says so loudly; do not set it for a run whose numbers you intend to quote.

## Generation leg (#1142)

```bash
PROMPT_SERVICE_URL=http://localhost:3210 PROMPT_SERVICE_API_KEY=<key> \
  pnpm --filter @opuspopuli/eval-harness eval:generation -- \
    --model qwen3.5:9b [--think] [--limit 3] [--contract quote-then-locate]
```

Runs the real `document-analysis-proposition-analysis` template through the real
`OllamaLLMProvider`, at production's settings — `maxTokens` 6000 (not 2000; see #1085),
`temperature` 0.2, and `think` **set explicitly per model**.

### Prerequisites that will look like bugs

**`PROMPT_SERVICE_URL` is required, and the eval refuses to run without it.** This is
deliberate, and stronger than the client's own behaviour. `getDocumentAnalysisPrompt`
asks for `document-analysis-proposition-analysis` with `document-analysis-generic` as
its fallback, and `getTemplateFromDb` substitutes that fallback **silently** when the
requested template is missing. The local `prompt_templates` table in `opuspopuli-db`
carries `document-analysis-proposition` (948 chars) but not
`document-analysis-proposition-analysis` (6,818 chars) — so an unguarded run scores
675 characters of generic instruction while recording a `promptHash` that makes the
result look attributed.

`src/prompt-attribution.ts` closes both doors: it requires the URL, and it fetches the
named template straight from prompt-service to check its hash against the one the
client returned. A mismatch means a fallback happened, and the run stops.

**A stale build is refused too** — see [The stale-build trap](#the-stale-build-trap).

### What it measures

| Metric | Meaning |
| --- | --- |
| **JSON validity** | Through production's own `extractJsonObjectSlice`. `empty-response` is a **separate verdict** from `no-json`: with reasoning left on, a capable model spends its whole budget thinking and returns nothing, which reads as a format failure and is one flag. |
| **Numeric grounding** | Every `$`, percentage and magnitude emitted must appear in the source, matched on **value** so "$1.2 million" is grounded by "$1,200,000". |
| **Abstention correctness** | An empty `fiscalImpact` on AG-filed text is the **right** answer. Fabricating and missing are reported separately, never netted. |
| **Claim-span anchoring** | Scored on **raw** offsets, never `normalizePayload`-clamped ones, and with a partitioning detector for the sequential-span tell. |

**Field completeness is never scored.** In #1142's first run a 3.4B model topped the
scoreboard at 16/18 fields *because it fabricated the fiscal impact*, while qwen scored
lower for correctly returning an empty `fiscalImpact`. All six models returned empty
`fiscalImpact` on all five measures — a property of the source data, which a
completeness metric misreads as a model failure.

### Baseline — qwen3.5:9b, 2026-09-14

10 measures, `document-analysis-proposition-analysis` v1 (`850bdd19629b`, 6,818 chars),
`think: false`, `maxTokens` 6000, offsets contract. M4 Pro, Q4_K_M.

| | |
| --- | --- |
| JSON valid | **10/10** |
| Claims anchored | **6/54 (11%)** |
| Fabricated figures | **0** |
| Fabricated fields | **0** |
| Abstention correctness | **100%** — empty `fiscalImpact` on all ten, which is correct |
| Median cited span | 185 chars |
| Wall clock | 855s total, 85s/measure, 6.8–23.3 tok/s |

This reproduces what #1142 reported from an uncommitted script, and sharpens one part of it.

**The anchoring failure is not out-of-range offsets.** Across 54 claims the verdicts are
**47 unsupported, 6 anchored, 1 out-of-range**. Ninety-eight percent of qwen's citations
point *inside* the document, at paragraph-sized spans (median 100–334 chars), and simply
do not contain the claim they are attached to.

That matters for #1212 and #1209. "Fabricated offsets" covers two different behaviours:

- **Out of range** — granite's `1240..5400` in a 2,799-char document. A bounds check
  catches it, and `normalizePayload`'s clamp currently hides it.
- **In range, unrelated** — qwen's dominant mode. A bounds check passes it. Clamping does
  nothing to it. Only comparing the span against the claim catches it at all.

A verify-or-snap gate built around range validation would therefore pass ~98% of qwen's
wrong citations. Sequential partitioning — each claim's span starting exactly where the
previous ended — was detected on 3 of 10 measures.

**Throughput varies enough to matter.** 6.83 tok/s on one measure against 23.28 on
another of similar size, same settings, same machine. Single-run numbers are directional
only; comparisons need repeats.

### Fixtures

`fixtures/fulltext-propositions.json` holds ten measures (2,799–13,541 chars), rebuilt
with:

```bash
pnpm --filter @opuspopuli/eval-harness fixtures:fulltext
```

That is a script rather than a psql command **because redaction must not be optional**.
`propositions.full_text` includes the proponent's transmittal letter, which carries a
named individual's postal address, personal email and phone number — nine of ten
measures contain at least one. `src/redaction.ts` strips them and the build fails if
anything survives.

> **Production sends this text unredacted.** The redaction changes the fixture, not the
> pipeline. That the proposition-analysis path puts proponent contact details into an
> LLM prompt is a finding about production, and this harness must not be read as
> evidence that it was fixed.

`fixtures/gold-proposition-analysis.json` carries the per-field `supportable`
judgements, authored by reading each measure. `fiscalImpact` is `supportable: false` on
all ten, each with its rationale — the "fiscal" strings that do appear are a filing
checklist item, "without regard to fiscal years" boilerplate, a "fiscal emergency"
condition, and "Fiscal committee: no" routing metadata. None is a fiscal analysis.

## Model provenance

Every run against a served model records what actually answered:

```json
"provenance": {
  "model": "qwen3.5:9b",
  "digest": "6488c96fa5faab64",
  "quantization": "Q4_K_M",
  "architecture": "qwen35",
  "parameterCount": 9653104368,
  "capabilities": ["completion", "vision", "tools", "thinking"],
  "runtime": { "name": "ollama", "version": "0.18.0" }
}
```

**A tag is not a pin.** `OllamaLLMProvider.getModelName()` returns `this.config.model` —
the bare tag — and `qwen3.5:9b` can be re-pulled and mean different bytes tomorrow. The
digest is the pin, and it goes on the result.

**Quantization is in the result filename**, so two quantizations of one model cannot
overwrite each other's results. `assertComparable()` refuses a q4-vs-q8 comparison outright:
R3 requires matched-quant comparison because Ollama serves q4 by default, and an OLMo-q4
against qwen-q4 is partly a comparison of two quantizations rather than two models.

Worth knowing from the current baselines: the LLMs are served at **Q4_K_M** while
`nomic-embed-text-v2-moe` is served at **F16**. Those are not the same kind of measurement,
and until now nothing recorded the difference.

**A reasoning-capable model must have its `think` setting stated.** `capabilities` reports
`thinking` for such checkpoints, and `assertThinkDecided()` refuses to start without an
explicit `--think` or `--no-think`:

```
qwen3.5:9b reports the "thinking" capability, and no explicit think setting was given.

Left to a default, a reasoning model can spend its whole token budget on hidden
reasoning and return an empty response — which scores as a format failure and reads
as model incompatibility. Pass --think (with a larger budget) or --no-think to state
the decision.
```

That is #1142's first "do not skip" requirement, enforced rather than documented. It is the
configuration error that invalidated the entire first run of this harness.

The in-process Xenova provider gets **no** provenance block: it is not a served model and has
no digest or quantization, and recording an empty record would imply a pin that does not
exist. Tesseract and the OCR replay backend are treated the same way.

## Adding items

Edit `fixtures/retrieval-propositions.json`. The schema is the durable asset — the count grows as the Seed pipeline feeds accepted corrections back in as gold cases.

```jsonc
{
  "id": "ret-en-015",
  "lang": "en",
  "query": "plain-language citizen phrasing",
  "gold": ["25-0001"], // a SET: any member ranking first is correct
  "difficulty": "direct | oblique | ambiguous | cross-lingual",
  "notes": "why these are the right answers, or why the item is hard",
}
```

Prefer **oblique** phrasings over title keywords. A query that restates the title measures string overlap, not retrieval.

## Honest limits

- **Query-authoring bias.** The queries and gold labels were authored by the session that first ran them. Absolute scores are soft. _Comparisons between models over the identical item set_ are the sound use, and `corpusSeparation` is query-independent, which is why the v1.5 verdict rests on it.
- **22 items is a seed, not a benchmark.** M4 targets ~50–100.
- **The corpus is still almost entirely title echo. R2 is NOT done.** Measured 2026-09-14 against the dev database: **53 of 65** `summary` values contain the title verbatim, and stripping the title and the scraper furniture leaves nothing on ~85% of rows. A representative `summary` is the title, then `Title and Summary Issued on <date>`, then the PDF link labels `Fiscal Impact Estimate Report` and `Proponent` — the AG circulating summary was never captured. Since `PropositionEmbeddingService.embeddingSource()` builds `title + "\n\n" + summary`, **production is embedding the title twice plus boilerplate**, and retrieval here is close to title matching.
  An earlier revision of this file claimed the caveat had been resolved by #1219. That was wrong: #1219 fixed a sync rollback on a missing summary, not summary capture, which is #1220 and still open. The bad reading came from a heuristic that tested whether the summary *starts with* the title — it does not, because the boilerplate comes first.
- **Retrieval only.** No generation, JSON-validity, claims-precision, hallucination, or partisan-symmetry metrics yet — those are the rest of M4 (#1142), planned in `docs/plans/1142-llm-eval-harness.md`.
- **The #1074 petition golden set is NOT replayable.** Its numbers are recorded in `docs/plans/1074-petition-retrieval-verification.md`, but scan images are never persisted (`location: 'not-stored'`, deliberate privacy architecture) and neither is their OCR text. Recalibrating `MIN_VERIFIED_SIMILARITY` under a new model (roadmap R5) therefore requires **re-photographing petitions** — the existing measurements cannot be re-derived. Discovered 2026-09-11; plan for it before R5, not during.

## Corpus fixture

`fixtures/corpus-propositions.json` is a snapshot of `title + "\n\n" + summary` for all 65 propositions — the exact string `PropositionEmbeddingService.embeddingSource()` builds, so the harness measures what production embeds.

The corpus is **pinned deliberately**: it is the measurement substrate, so it does not move under a comparison mid-flight. Refresh it when you want a new baseline, not to track the database:

```bash
docker exec opuspopuli-db psql -U postgres -d postgres -t -A -c \
  "select json_agg(j order by j->>'externalId') from (
     select json_build_object('externalId', external_id,
       'text', trim(title || chr(10) || chr(10) || coalesce(summary,''))) as j
     from propositions where title is not null) s" \
  | python3 -m json.tool --indent 2 --no-ensure-ascii \
  > packages/eval-harness/fixtures/corpus-propositions.json
```

Both flags matter as much as the `order by`: without `--indent 2` the file collapses to one line, and without `--no-ensure-ascii` every curly apostrophe in a measure title becomes a `\u2019` escape. Either one rewrites the whole file on a refresh that changed nothing.

**The `order by` is load-bearing.** Without it `json_agg` returns rows in whatever order the scan produced, so a refresh that changed nothing still rewrote most of the file — a 113-line diff for a one-row change, which no reviewer can read. With it, a refresh diff shows only what actually moved.
