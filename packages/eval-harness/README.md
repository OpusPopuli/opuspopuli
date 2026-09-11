# `@opuspopuli/eval-harness`

The measurement instrument for AI-architecture changes. Roadmap **R3**, milestone **M4** (`docs/plans/ai-architecture-roadmap.md`).

## Why this exists

Several confident claims about retrieval in this project turned out to be wrong when measured:

- that a 768-dim multilingual model must beat a 384-dim MiniLM — **it does not, on English**
- that Metal-backed inference would be faster — **~73× slower per query**
- that nomic v1.5 was a reasonable fallback — **0/14 on this corpus**

Each was plausible. Each was stated with confidence. Each was overturned by ten minutes of measurement. The harness exists so that retrieval changes can say what they did to a number, instead of what they ought to have done.

## Quick start

```bash
# Baseline: what production runs today
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

## Baselines — 2026-09-11

64 propositions, 22 items (14 EN + 8 ES), pre-#1219 summaries.

|                          | MiniLM-384 (production)              | nomic v2-moe-768 (prefixed)          |
| ------------------------ | ------------------------------------ | ------------------------------------ |
| Overall                  | 18/22 · MRR 0.865 · margin 0.137     | **21/22 · MRR 0.977 · margin 0.179** |
| EN                       | 13/14 · MRR 0.952 · margin **0.194** | 13/14 · MRR 0.964 · margin 0.154     |
| ES                       | 5/8 · MRR 0.712 · margin **0.036**   | **8/8 · MRR 1.000 · margin 0.223**   |
| Corpus separation (mean) | 0.380                                | 0.471                                |

**Read the ES margin, not the ES hit rate.** MiniLM's Spanish successes clear the next-best answer by 0.036 — it is nearly guessing. nomic's clear it by 0.223.

**English is a slight regression**, and that is recorded rather than buried: MiniLM holds a better EN margin (0.194 vs 0.154). The nomic decision (#1156) rests on Spanish parity and provenance, not on a general English gain.

**Both models miss `ret-en-008`** because the corpus cannot support it: three filings share a title and two are byte-identical (`max=1.000` separation under both). That is a data defect (#1219), not a model defect.

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
- **Authored against pre-#1219 summaries**, where 52 of 64 are title echo plus scraper furniture. The ceiling here is set by the corpus. Re-baseline after #1219 lands.
- **Retrieval only.** No generation, JSON-validity, claims-precision, hallucination, or partisan-symmetry metrics yet — those are the rest of M4 (#1142).
- **The #1074 petition golden set is NOT replayable.** Its numbers are recorded in `docs/plans/1074-petition-retrieval-verification.md`, but scan images are never persisted (`location: 'not-stored'`, deliberate privacy architecture) and neither is their OCR text. Recalibrating `MIN_VERIFIED_SIMILARITY` under a new model (roadmap R5) therefore requires **re-photographing petitions** — the existing measurements cannot be re-derived. Discovered 2026-09-11; plan for it before R5, not during.

## Corpus fixture

`fixtures/corpus-propositions.json` is a snapshot of `title + "\n\n" + summary` for all 64 propositions — the exact string `PropositionEmbeddingService.embeddingSource()` builds, so the harness measures what production embeds.

Refresh it after #1219:

```bash
docker exec opuspopuli-db psql -U postgres -d postgres -t -A -c \
  "select json_agg(json_build_object('externalId', external_id,
     'text', trim(title || chr(10) || chr(10) || coalesce(summary,''))))
   from propositions where title is not null" \
  > packages/eval-harness/fixtures/corpus-propositions.json
```
