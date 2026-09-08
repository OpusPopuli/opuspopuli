# #1164 — Sonoma propositions: hub → measures-leaf ingestion

| | |
|---|---|
| **Issue** | [#1164](https://github.com/OpusPopuli/opuspopuli/issues/1164) |
| **Date** | 2026-09-07 |
| **Author** | Claude (self-planned; countersign with the PR) |
| **Data classification** | Public ballot-measure records only. Profile: `us-state-privacy` + `soc2` — no CCPA personal information is collected, stored, logged, or sent to a model. Crawl restricted to registered HTTPS government hosts. Measure *argument* sub-pages (which can name private individuals) are deliberately not extracted. |
| **Branches** | `fix/sonoma-propositions-link-discovery-1164` (monorepo), `fix/propositions-link-discovery-1164` (opuspopuli-regions) |
| **Approach** | Option (a) — declarative `linkDiscovery` hub navigation. Chosen over (b) hard-coded leaf URL (re-breaks every cycle; all 58 CA county propositions sources share the hub disease) and (c) electionstats archive (Next.js SPA, 2009–2024 only, no API — can't satisfy the current-cycle criterion). |

## Problem

Sonoma `propositions` sync runs clean but persists 0 measures while the manifest
records `last_item_count = 3`. Two root causes, not one:

1. **The source is a 2-hop hub.** `/registrar-of-voters/elections` → election
   page (e.g. `/november-3-2026-general-election`) → "List of Local Measures
   That Have Been Filed" leaf. Verified live 2026-09-07: the leaf lists 11
   measures (letter, sponsoring jurisdiction, title, filing date; no outcomes —
   the election hasn't happened). The hub's 3 extracted "items" are election
   nav links.
2. **Even pointed at the right page, rows would die in mapping.** The config
   hints promise `jurisdiction`, `measureType`, `description`, `outcome` —
   names `PropositionSchema` (`domain-mapper.service.ts:580`) does not accept.
   The 3 nav links extracted fine, then failed `externalId: z.string().min(1)`
   in `parseOrCollect` (`domain-mapper.service.ts:143`) and were silently
   nulled. `last_item_count` counts extraction, not persistence — a "clean" run
   with 0 rows is exactly this signature. The CA OAG active-measures source
   already documents the same trap in its hints.

## Discoveries that shaped this plan

- Blind BFS was already rejected for this shape once: `BillDiscoveryConfig`
  exists because "the search results page lists hundreds of nav links at depth
  0" (`packages/common/src/providers/scraping-pipeline/types.ts:384`). It is
  the closest in-repo template: deterministic regex navigation that *replaces*
  `crawlDepth`, matching #1164's note that generic crawl doesn't find the leaf.
- `crawlDepth`/`crawlCivicsUrls` (`http-fetcher.service.ts:94`) is wired only
  into civics/bills sync, not the `html_scrape` pipeline; its host/prefix/HTTPS
  guards are the model for the new navigator's safety rails.
- Manifests are keyed `(regionId, sourceUrl, dataType)` — per-leaf extraction
  requires threading an *effective URL* into `getOrDeriveManifest`/the store.
  New leaf per election cycle ⇒ manifest cold-start ⇒ first sync yields 0 rows
  (`pendingManifestAnalysis: true`), second sync extracts. Existing async
  design (`docs/architecture/async-workers.md`), not a regression — document it.
- #1139 (jurisdiction) has not landed. `propositions` has no region column
  (`schema.prisma:1091`); `externalId` uniqueness is **global**, so county ids
  must be prefixed to avoid colliding with state measures.
  `propositions-sync.service.ts:259` already flags the region-scoping debt
  (#731). #1164's AC3 needs only #1139's AC1+2 (additive migration + sync
  write path).
- All 58 CA county `propositions` sources point at hub-ish pages (Calaveras
  hard-codes an election name in its URL path — option (b)'s failure mode
  already in the wild). `linkDiscovery` fixes the class; rollout beyond Sonoma
  is out of scope here.

## Subtasks

1. **`linkDiscovery` config — schema + types**
   (`opuspopuli-regions` + `packages/common`): optional `linkDiscovery` on
   `DataSourceConfig` — `steps: [{ textPattern, hrefPattern?, select:
   'first'|'all' }]` + `maxLeafPages` (default ~5), modeled on
   `BillDiscoveryConfig`. `pnpm generate:types` (drift gate), schema-validation
   tests; mirror type in
   `packages/common/src/providers/scraping-pipeline/types.ts`. No migration,
   no federation impact.
2. **Pipeline: link-discovery navigation** (`packages/scraping-pipeline`): new
   `crawling/link-discovery.service.ts` — deterministic (no LLM) step-walk
   from the seed with `crawlCivicsUrls`-style host/HTTPS guards; **a step
   matching 0 links across all pages is a loud pipeline error** (the AC2
   staleness alarm). `executeHtmlScrape` resolves leaves first when
   `linkDiscovery` is set, then runs manifest→extract→map per leaf URL
   (effective-URL manifest keying), aggregating items; sources without
   `linkDiscovery` keep the identical path. Tests: hub/election/leaf fixtures
   (incl. real Sonoma leaf snapshot), zero-match failure, per-leaf keying,
   no-`linkDiscovery` regression.
3. **Sonoma config rewrite** (`sonoma.json`): `linkDiscovery` steps —
   `"(Primary|General|Special) Election"` (`select: 'all'`) then `"Local
   Measures That Have Been Filed"` (`select: 'first'`, tolerant of election
   pages with no measures link yet). Hints rewritten to schema-accepted names:
   `externalId` = `california-sonoma-<election-date>-measure-<letter>`,
   `title`, `electionDate`, `summary` (fold sponsoring jurisdiction + measure
   type in), `status` with the explicit
   `pending|passed|failed|withdrawn`-or-dropped warning (OAG prior art). Bump
   config version (minor); after publish, bump `@opuspopuli/regions` in the
   monorepo + lockfile.
4. **Jurisdiction tagging — minimal #1139 slice** (`relationaldb-provider` +
   region service): **check #1139 status first to avoid a double migration.**
   If unlanded: additive `region_plugin_name TEXT` on `propositions`, backfill
   `'california'`, state + county sync write paths stamp their plugin name,
   scope `backfillStageIds`. GraphQL/UI/briefing stay in #1139. Tests:
   backfill + both write paths.
5. **Verification + docs**: `invalidateManifest('california-sonoma', <hub
   url>)`, real dev sync, verify ≥11 rows with prefixed externalIds,
   `electionDate = 2026-11-03`, `region_plugin_name = 'california-sonoma'`.
   Document `linkDiscovery` in `docs/guides/region-provider.md` and the
   regions repo's `creating-a-county-config.md` (cold-start + zero-match
   alarm). File follow-ups: historical outcomes (electionstats), other-county
   rollout.

## Deviation — composite field templates (approved 2026-09-07, mid-implementation)

UAT verification surfaced a gap this plan did not anticipate. Navigation worked
on the first real run, but extraction still yielded 0 rows for two reasons:

1. **No semantic classes on the leaf page.** It is a plain nested `<ul>`/`<li>`
   list with inline styles, so the LLM twice invented `.measure-item` inside
   `.tray` (which matches two elements, the first holding no measures) and the
   self-heal re-derived the same wrong guess.
2. **`externalId` was not expressible.** The election date appears once per
   page (in the `h1`), not per measure, and a `FieldMapping` is one selector
   plus one transform. Composition existed only for `bulk_download`
   (`compositeKey`); the HTML path had nothing. No manifest — AI-derived or
   static — could build `california-sonoma-2026-11-03-measure-e`.

A `staticManifest` is **not** the escape hatch here: it is declared once on the
hub source and shared by every leaf, so a baked-in election date would be wrong
for other cycles — and `executeStaticManifest` returns raw items without
running the domain mapper, so helper fields would reach Prisma unmapped.

Approved fix (option 2 + option 1): add `extractionMethod: "composite"` to the
HTML extractor — a `template` of `{field}` placeholders with
`:date|lower|upper|slug|trim` formatters, interpolating fields already
extracted for the same item, all-or-nothing so a missing placeholder never
emits a half-built upsert key. Layered with hints carrying the verified
selectors and the full `fieldMappings` block. Chosen over hint-only because
page-scoped discriminators recur across the other 57 county configs.

Two facts corrected: the page lists **12** measures, not 11, and identifiers
are not always single letters (**"Measure AB"**).

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| Effective-URL manifest keying regresses existing `html_scrape` sources | high × possible | `linkDiscovery`-gated branch; default path untouched; regression specs in `pipeline.spec.ts` |
| County text/structure change breaks step patterns silently | medium × likely (eventually) | Zero-match step = loud pipeline error in job diagnostics + unit test; documented one-line regex update path |
| Per-cycle leaf cold-start yields 0 rows on first sync | medium × likely | Existing async-analysis design; documented; daily cron self-resolves within one cycle |
| #1139 lands in parallel → conflicting migrations | medium × possible | Subtask 4 checks issue state first; migration additive-only either way |
| LLM manifest targets wrong container on leaf page | medium × possible | Precision hints (OAG prior art); `staticManifest` documented escape hatch |
| Global `externalId` collision between state and county measures | high × rare | County-prefixed externalId scheme; asserted in sync verification |
| Election page with no measures-filed link yet (early cycle) | low × likely | Step 2 tolerates 0 matches per election page; only all-pages-zero errors |
| AGPL-3.0 dependency constraint | — | No new dependencies (cheerio already in-tree) |
| Regulated-data exposure | — | None — public records; see data classification |
| LLM omits/garbles the composite mapping on a future re-analysis | medium × possible | Hints carry the exact verified `fieldMappings`; an unresolvable composite drops the field and raises a `schema_reject` diagnostic rather than writing a malformed key |
| Composite template emits a partial upsert key | high × rare | All-or-nothing by construction; covered by `composite-template.spec.ts` |

## Effort

~3–4 focused days across 5 sessions (subtask 2 dominates; subtask 4 shrinks to
near-zero if #1139 lands first). Cross-repo publish adds one coordination
round-trip.
