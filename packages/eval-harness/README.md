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
- **Re-baselined against post-#1219 summaries on 2026-09-14.** The old caveat (52 of 64 summaries were title echo plus scraper furniture) no longer holds for the corpus as a whole, but title echo is not extinct: `ACA 7` entered the corpus as `"Government preferences\n\nGovernment preferences"` — 46 characters, summary identical to title. New rows still arrive in the defect state, so the R2 lint is not done.
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
