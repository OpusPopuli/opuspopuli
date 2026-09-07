# Plan: bills & propositions search

| | |
|---|---|
| **Epic** | [#1152](https://github.com/OpusPopuli/opuspopuli/issues/1152) |
| **Stories** | [#1153](https://github.com/OpusPopuli/opuspopuli/issues/1153) FTS migration + search API · [#1154](https://github.com/OpusPopuli/opuspopuli/issues/1154) typeahead + results page · [#1155](https://github.com/OpusPopuli/opuspopuli/issues/1155) list-page search · [#1156](https://github.com/OpusPopuli/opuspopuli/issues/1156) 768 embeddings + backfill · [#1157](https://github.com/OpusPopuli/opuspopuli/issues/1157) RRF fusion + golden set |
| **Follow-ups** | [#1158](https://github.com/OpusPopuli/opuspopuli/issues/1158) consolidate `searchPropositions` · [#1159](https://github.com/OpusPopuli/opuspopuli/issues/1159) stale `knowledge.ts` · [#1160](https://github.com/OpusPopuli/opuspopuli/issues/1160) region i18n backfill |
| **Date** | 2026-09-06 |
| **Author** | Rodney Gagnon (spec assembled with Claude Code; full-repo search-surface survey) |
| **Status** | Approved (owner, 2026-09-06) — semantic leg pulled into scope; work starts after county boundaries + sync are squared away in production |
| **Origin** | User request: search capabilities on bills and propositions |
| **Mockup** | https://claude.ai/code/artifact/484b92a5-a578-4769-9a54-3e5c1b1d6455 — three artboards (header typeahead, unified results page, bills list with search), pixel-matched to the shipped design system. A comp, not code to port. |
| **Data classification** | **None.** Bills and propositions are public filed records. Search queries are NOT persisted (see Non-goals) — no new personal-data surface. |
| **Migrations** | Two, additive: (1) generated `tsvector` columns + GIN indexes on `bills` and `propositions`, trigram index on identifiers; (2) 768-dim search embedding columns + HNSW + model-identity staleness columns. No drops, no renames. |
| **Federation** | Yes — new queries on the **region** subgraph only. No `@key` changes (that is #761's scope). |
| **Dependencies** | None new. Postgres FTS + the already-installed `pg_trgm` + pgvector; embeddings via the existing `OllamaEmbeddingsProvider`. No search engine, no AGPL/GPL concern. |
| **Alignment** | `docs/plans/ai-architecture-gap-analysis.md` layers 5–7 — lexical = greenfield ("Postgres FTS covers the lexical leg without new dependencies"); the decided nomic-embed-text-v2-moe @ 768 execution is **pulled forward** here (owner, 2026-09-06) for the new bills corpus, consistent with that plan's "cheapest re-embed is the next one" rule. `docs/architecture/ai-ml-pipeline.md` hybrid-retrieval diagram: lexical ⬜→✅, fusion ⬜→✅. |

## One line

Give citizens hybrid search over bills and propositions — lexical Postgres FTS
shipping first, the semantic leg on the decided nomic @ 768 model fusing in
behind the same query once a measured golden set says it helps — building M5's
retrieval infrastructure while it delivers user value now.

## Why lexical ships first, and why no new infrastructure

The gap analysis is explicit: lexical retrieval is **absent** (zero `tsvector`
anywhere; `pg_trgm` installed in the baseline migration for "trigram ILIKE
indexes" that were never created). Users asking for search want exact things
first: a bill number, a phrase from a title, a statutory term. That is
precisely what embeddings blur and FTS nails. The lexical leg:

- needs **no new dependency** (license-clean, node-deployable, no new container),
- is the fallback ordering the semantic leg degrades to (a vector-leg failure
  must never blank search),
- and fixes the worst current behavior: every text match in the repo today is
  an unindexed `ILIKE '%…%'` sequential scan.

A dedicated engine (Meilisearch/Typesense) is rejected: new infra on a
single-node deployment, a second index to keep consistent with Postgres, and
nothing the corpus size (thousands of bills, ~52 propositions) remotely needs.

## Why the semantic leg is in scope (owner decision, 2026-09-06)

The first draft deferred semantic search to M5 behind the eval harness. The
owner pulled it in: it brings concept-level search and Spanish-query parity to
users now, and it builds infrastructure M5 needs anyway. The re-sequencing is
consistent with the gap analysis's own logic, not an exception to it:

- **Bills have no embeddings today.** This work creates the bills vector
  corpus from scratch. "The cheapest re-embed is the next one": embedding
  thousands of bills in MiniLM-384 only to re-embed them at M5 on the
  already-decided model would be the wasteful ordering. So the new corpus is
  born on **nomic-embed-text-v2-moe @ 768** — the M5 execution comes forward
  with it.
- **The eval gate's substance is kept, scoped down.** What the gate protects
  against is shipping unmeasured retrieval. That protection survives as the
  golden-query flip-on condition (below), the #1074 calibration precedent
  applied in-feature — not as a milestone dependency.
- **What stays gated**: the cross-encoder reranker (needs the real harness
  plus its own provenance scrutiny) and the retirement/recalibration of the
  existing MiniLM paths (M5 proper).

## Current state (surveyed 2026-09-06)

- **Bills** (`schema.prisma:1515`): `title` (Text), `subject` (VarChar 500),
  `lastAction`, `aiSummary` JSONB (`plainEnglishSummary`, `topics[]`). **No
  full text in the DB** — `fullTextUrl` only. No embedding column. Existing
  `bills` query filters by equality only (type/session/author/committee/
  lifecycle); no search arg.
- **Propositions** (`schema.prisma:1094`): `title`, `summary`, `fullText`
  (Text, nullable), `embedding vector(384)` with a correct HNSW index.
  `propositions` GraphQL query takes skip/take only — **no filters at all**,
  and (bug) does not filter `deletedAt: null`
  (`region-query.service.ts:546-578`; the documents-side vector query at
  `retrieval.service.ts:178` does filter it).
- **Only shipped text-search precedent**: `legislativeCommittees(nameFilter:)`
  — Prisma `contains`/insensitive, and its frontend page has the interaction
  pattern to reuse (150 ms debounce, sr-only label, "N matches" line, distinct
  no-results state).
- **A proposition title search already exists in the wrong place**:
  `searchPropositions` on the **documents** subgraph
  (`linking.service.ts:226-236`), built for petition→ballot linking, reading
  region's table across the bounded context. Follow-up below.
- **Frontend**: bills page has selects + lifecycle radiogroup, no text input;
  propositions page has nothing; header has no search entry point. Region
  pages are hardcoded English (no `region` i18n namespace yet).

## Design

### Migration (additive, `/op-migration`)

```sql
-- bills: weighted document vector, computed by trigger-free generated column
ALTER TABLE bills ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(bill_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(subject, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(ai_summary->>'plainEnglishSummary', '')), 'C') ||
    setweight(to_tsvector('english', coalesce(last_action, '')), 'D')
  ) STORED;
CREATE INDEX bills_search_vector_idx ON bills USING gin (search_vector);

-- propositions: fullText participates at low weight
ALTER TABLE propositions ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(external_id, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(full_text, ''), 262144)), 'D')
  ) STORED;
CREATE INDEX propositions_search_vector_idx ON propositions USING gin (search_vector);

-- identifier fuzz: "AB1236" / "ab 1236" / partial numbers
CREATE INDEX bills_bill_number_trgm_idx ON bills USING gin (bill_number gin_trgm_ops);
```

Notes: `full_text` is capped in the expression (1 MB tsvector limit; Minutes
already truncates rawText at 256 kB — same discipline). Generated columns keep
the vector consistent through the sync pipeline's upserts with zero service
code. In Prisma both columns are `Unsupported("tsvector")?` (the
`propositions.embedding` pattern). Rollback: drop indexes + columns.

### GraphQL (region subgraph)

1. **`bills(search: String, …)`** — add one optional arg to the existing
   query; all current filters and `lifecycle` compose with it. When `search`
   is present, order by `ts_rank_cd(search_vector, query) DESC,
   last_action_date DESC` instead of the default.
2. **`propositions(search: String, status: String, electionYear: Int, …)`** —
   add search plus the two filters the page never had. **Fix `deletedAt:
   null` here** regardless of search.
3. **`regionSearch(query: String!, type: SearchResultType, skip, take): PaginatedRegionSearch`**
   — the unified results page. Returns
   `{ items: [RegionSearchItem], total, hasMore, billCount, propositionCount }`
   where each item wraps a union `Bill | Proposition` plus `snippet: String`
   (`ts_headline` output with plain-text markers; renderers must treat it as
   text nodes, never innerHTML) and `rank: Float`. `@Public()`; complexity is
   **priced, not flat**: `take × (childComplexity + 5)`, so aliasing cannot
   multiply full-corpus rank sorts under the 1000 cap. Deep paging is bounded
   by `MAX_SEARCH_WINDOW = 1000` (totals stay real; pages beyond the window
   are empty), and each UNION arm is top-N-limited to the window before the
   merge.
4. **`regionSearchSuggest(query: String!, take: Int = 8): [SearchSuggestion]`**
   — typeahead. Thin projection (id, kind, label, sublabel), no snippets,
   complexity `10 + take`, take clamped to [1, 10]. A **measure-number-shaped**
   query (1–4 letters + number; the shape is validated by the `bill_number`
   prefix lookup itself rather than a hardcoded prefix list — deliberate
   deviation from an earlier draft that read prefixes from civics config)
   returns direct bill rows first as `kind: DIRECT` — the mockup's "jump to
   bill" row. Proposition slots are reserved in the fill so the much larger
   bill corpus can't crowd propositions out of the dropdown.

Query parsing: `websearch_to_tsquery('english', $q)` — tolerates free syntax,
never throws on user input. Input rejected over 200 chars **at the GraphQL
edge** (`@MaxLength` in an `@ArgsType`, so oversized payloads never reach the
audit interceptor) and belt-and-suspenders truncated in the service.
Empty/stopword-only tsquery returns an empty result, not a full scan. Raw SQL
goes through the existing `$queryRaw` parameterized paths (the
`proposition-embedding.service` precedent); `ts_headline` runs **only on the
returned page** (take ≤ 100), with fixed `StartSel/StopSel` markers that the
frontend maps to `<mark>` — never raw HTML pass-through. **Audit posture:**
`query`/`search` are in the PII masker's redaction set, so search text is
`[REDACTED]` in audit logs — the "no stored civic queries" non-goal holds
against the interceptor, not just this feature's own tables.

**Not federated wider on purpose**: results are full region entities, so no
`@key`/`@ResolveReference` work is needed (shape matches
`legislativeCommittees`). If #761 lands entity keys later, nothing here changes.

**Caching**: search queries bypass `RegionCacheService` — its cache has no TTL
and purges by prefix, so an unbounded per-query keyspace would never evict.
GIN + rate limiting (existing gateway throttle) carry the load.

### Semantic leg (Phase 3 — same API, new ordering)

1. **Search-scoped embedding columns, additive**:
   `bills.search_embedding vector(768)` and
   `propositions.search_embedding vector(768)`, HNSW from empty (the
   propositions-migration discipline, never IVFFlat), each with
   `search_embedding_model` + `search_embedding_source_hash` columns — the M1
   "model identity + dimensions in the staleness key" requirement, landed
   early, so any future swap is flip-env + backfill and mixed-state is
   detectable. **The existing 384-dim MiniLM columns
   (`propositions.embedding`, `documents.embedding`) and the petition
   verification path calibrated against them (`MIN_VERIFIED_SIMILARITY =
   0.50`) are untouched.** Two model spaces coexist; they are never compared
   in any query; M5 retires the old space and recalibrates petition
   thresholds as already planned.
2. **`BillEmbeddingService`** mirrors `PropositionEmbeddingService`
   (hash-gated idempotency, startup dimension assertion, raw-SQL
   `writeVector`): embeds `billNumber + title + subject +
   aiSummary.plainEnglishSummary`. A parallel proposition path embeds
   `title + summary` into the new 768 column. Backfill runs as a
   region-worker job, batched off-peak — it shares Ollama with the nightly
   cron, but an embedding model is small next to qwen3.5; thousands of rows
   is minutes, not hours. New/updated rows embed during normal sync (the
   `embeddingSourceHash` pattern).
3. **Fusion**: `regionSearch` runs both legs and merges by **reciprocal rank
   fusion** (k = 60; no cross-space score normalization, no tuned weights to
   start). A vector-leg error degrades to lexical-only, *labeled* in the
   response (`degraded: true`) — never silently empty, never a blank search.
4. **Measured before default-on** — the eval gate's substance, kept: a golden
   query set of ~30–50 queries (EN **and ES**) against known-relevant bills
   and propositions, committed as fixtures, run by an integration test that
   reports rank quality for lexical vs. hybrid. Fusion becomes the default
   ordering only when hybrid ≥ lexical on that set; until then the vector leg
   ships dark behind the same resolver. The fixtures seed the #1142 harness
   (M4) — same item shape, contributed not competed with.

### Frontend

Per the mockup's three artboards:

- **Header search** (all authed pages): `/` focuses it; 150 ms debounce into
  `regionSearchSuggest`; WAI-ARIA combobox pattern (`role="combobox"`,
  `aria-expanded`, `aria-activedescendant`, listbox options); Enter on the
  input routes to `/region/search?q=…`; Enter on a row navigates to the
  entity. Escape dismisses. Sections: direct match → Bills → Propositions →
  "see all results".
- **`/region/search`** — new route. Query in the URL (`?q=&type=`) so results
  are shareable/back-button-safe. Type segmented control with live counts
  (`billCount`/`propositionCount`), existing measure-type/session selects,
  sort (Relevance | Most recent). Result cards reuse `BillCard` anatomy plus
  the snippet line; highlights render via the sanitized marker mapping.
  Distinct empty state ("No results for X — try fewer words or a bill
  number") vs. error state (a failed search must say so, not render "no
  results" — the knowledge-service swallow-to-empty mistake, gap analysis §4.5).
- **Bills page** — search input above the existing filter bar (committees
  pattern verbatim: sr-only label, match-count line); composes with all
  current filters and deep-link params. Propositions page gets the same input
  plus its new status/election filters.
- **i18n**: introduce the `region` namespace (en + es) for all NEW strings.
  Backfilling the existing hardcoded region strings is a separate chore —
  flag it, don't absorb it.
- **a11y**: `pnpm test:a11y` gates the combobox and results page (WCAG 2.2 AA).
- **E2E**: Playwright specs with mocked GraphQL (the
  `petition-ballot-link.spec.ts:377` search-dropdown test is the template).

### Spanish queries — honest scoping

FTS runs on the `'english'` config because the corpus (bill titles, summaries,
legislative text) is English; do not add a `'spanish'` tsvector column for an
English corpus — it would double index size to match nothing. A
Spanish-language *query* ("vivienda") matching "housing" is a semantic
capability, and it is exactly what nomic-embed-text-v2-moe was chosen for (ES
parity is its stated decision ground) — so it arrives with Phase 3, gated on
the ES half of the golden query set, not asserted. Between Phase 2 shipping
and Phase 3 flipping on, the es-locale empty state carries a one-line "search
works best in English for now" note; remove it when the ES golden queries
pass.

## What this deliberately does NOT do

- **No cross-encoder reranker** — eval-harness-gated (M4) with its own
  provenance scrutiny, and the name collision warning stands
  (`llm-rerank-worker` is not a retrieval reranker). RRF fusion does not need
  one.
- **No touching the shipped MiniLM-384 paths** — `propositions.embedding`,
  `documents.embedding`, and petition verification's calibrated thresholds
  stay exactly as they are until M5's measured recalibration.
- **No bill full-text ingestion** — bills carry `fullTextUrl` only; storing
  bill text belongs to the M1 `SourceVersion` tier, not to a search feature.
- **No stored search queries / search analytics** — civic queries are
  sensitive by nature (gap analysis layer 13 flags 90-day identity-linked
  query retention as a posture problem; don't create a second copy). If demand
  data is ever wanted, that is its own decision with its own privacy review.
- **No representative/committee/meeting search in `regionSearch` v1** —
  committees already have `nameFilter`; widening the union is a clean
  follow-up once the pattern proves out.

## Follow-ups this creates (file as issues alongside the epic)

1. **Consolidate `searchPropositions`** (documents subgraph,
   `linking.service.ts:226`) onto region's search once shipped — removes one
   documented bounded-context violation and gives the ballot-link picker
   FTS-quality matching.
2. **`apps/frontend/lib/graphql/knowledge.ts` is stale** (flat args vs.
   `input:` — its operations would fail against the current gateway; nothing
   imports them). Delete or fix; found during the survey, not touched here.
3. **Region i18n backfill** — existing region pages are hardcoded English.

## Risk register

| Risk | Rating | Mitigation |
|---|---|---|
| `ts_headline` cost on hot queries | low × possible | headline only the returned page (≤100 rows); 200-char cap enforced at the GraphQL edge; per-`take` complexity pricing; gateway throttle |
| Rank sort cannot use the GIN index (every match scored per request) | medium × certain | per-arm top-N `LIMIT MAX_SEARCH_WINDOW` (heapsort, not full materialized sort); deep-paging window cap; complexity priced by `take` × child selection so aliasing can't multiply sorts |
| GIN write amplification slows the ~48 h bills sync | low × possible | GIN fastupdate default on; sync is already batch/off-peak; measure sync duration before/after on UAT |
| Generated column migration rewrites large tables on deploy | medium × certain (one-time) | additive `ADD COLUMN … STORED` takes a table rewrite for `propositions.full_text` (52 rows — trivial) and `bills` (thousands — seconds); run in the normal migration window |
| Search resolver bypassing cache exposes DB to burst load | low × possible | per-`take`-and-child complexity pricing (collapses the alias trick) + gateway per-IP throttle; match-set scans bounded by the per-arm window LIMIT |
| ES users conclude search is broken | medium × possible | localized empty-state note (above); Phase 3's ES golden queries close it for real |
| Unmeasured relevance regression from fusion | medium × possible | fusion is default-on only after the golden set shows hybrid ≥ lexical; lexical remains the fallback ordering and the degraded mode |
| Bills embedding backfill competes for Ollama with sync/cron | low × likely | off-peak batched worker job with throttle; embedding model is small next to qwen3.5 |
| Two embedding model spaces get compared accidentally | low × possible | per-column `search_embedding_model` + startup dimension assertion; the spaces never meet in SQL; M5 retires the old space |
| Union type churn at the gateway | low × rare | additive schema; gateway is IntrospectAndCompose (no static supergraph to update) — validate on UAT stack per CLAUDE.md federation rule |
| `deletedAt` fix surfaces as a propositions-list count change | low × certain | it removes soft-deleted rows that should never have rendered; call it out in the PR |

## Phasing

| Phase | Content | Est. |
|---|---|---|
| **1 — Data + API (lexical)** | FTS migration; `search` args on `bills`/`propositions` (+ `deletedAt` fix + prop filters); `regionSearch` + `regionSearchSuggest`; unit + integration tests (real `postgres_test` DB, per #796 rules) | 2–3 d |
| **2 — Frontend** | Header combobox + `/` shortcut; `/region/search` page; list-page search inputs; `region` i18n namespace (en+es); a11y + e2e | 3–4 d |
| **3 — Semantic leg** | Embeddings migration (768 cols + HNSW + model-identity staleness); `BillEmbeddingService` + proposition 768 path + backfill job; RRF fusion in `regionSearch` with labeled lexical degradation; EN/ES golden query fixtures + measured flip-on; drop the es empty-state note | 4–5 d |
| **Deferred to M4/M5** | Cross-encoder reranker; MiniLM path retirement + petition threshold recalibration; unification of the remaining vector paths | — |

Phases ship in order and each is independently releasable: 2 needs 1's schema
on UAT; 3 changes only ordering behind the Phase 1 API and ships dark until
the golden set passes. Nothing blocks on M0–M4; Phase 3's fixtures feed M4.
