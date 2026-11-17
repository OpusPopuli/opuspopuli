# Plan: show each AI output's receipt — source, model, prompt, date (#1450)

| | |
|---|---|
| **Issue** | [OpusPopuli/opuspopuli#1450](https://github.com/OpusPopuli/opuspopuli/issues/1450) |
| **Date** | 2026-11-17 |
| **Author** | Rodney Gagnon (plan drafted with Claude Code) |
| **Status** | Approved 2026-11-17 — implementation not started |
| **Branches** | `feat/ai-output-receipts-1450` (opuspopuli); a prompt-service branch for subtask 1 |
| **Data classification** | Provenance metadata only. No CCPA personal information (profile: `us-state-privacy`, `soc2`) |
| **Effort** | ~6–7 focused days |

## Why

Every AI-written civic output records its provenance — prompt hash and version, model and digest,
source hash, generation time — but readers almost never see it. Only petition-scan results show a
model and prompt hash. The system card (`app/transparency/system-card/page.tsx:108-110`) states
"Model provider and version are disclosed with every analysis result"; on civic surfaces that is
currently false. This plan closes the last mile: API exposure plus a shared receipt on every page.

## Owner decisions (2026-11-17)

1. **Prompt link resolution: a manifest published in the prompt-service repo.** Not a public lookup
   endpoint — the runtime service stays private, per #1143.
2. **Civics and glossary are in scope** (subtask 6), not a follow-up.
3. **The minutes migration is approved to proceed**, with the SQL shown to the owner via
   `/op-migration` before it is written.

## Findings that shaped the plan

- **Unlabelled AI text beyond the issue:**
  - Bill summaries have no AI label at all.
  - Committee descriptions are AI-generated and fully tracked, but unlabelled on both the detail and list pages.
  - Civics and glossary text has no label anywhere.
- **"AI-generated" is not always true:**
  - A representative's `committeesSummary` can be deterministic, with a null prompt and model (`committee-summary-generator.service.ts:199-209`), yet the page always shows the AI pill.
  - Proposition `analysisSource` can be `manual`.
  - Scraped bios have no prompt.
  - So the receipt needs four kinds: **AI**, **DETERMINISTIC**, **MANUAL**, **SCRAPED**.
- **Missing dates:**
  - `minutes` has no generated-at column.
  - AI-written bios never set `bio_generated_at` (0 of 107 on UAT, 2026-11-16).
  - Scraped bios keep a stale `bioGeneratedAt` and `bioSourceHash` (`representatives-sync.service.ts:115-145`).
- **Bills:** 4,239 of 4,456 bill summaries on UAT predate provenance recording and will show "not recorded" until regenerated.
- **The stored `promptHash` is publicly checkable.** It is sha256 of the bare template text (`packages/prompt-client/src/prompt-client.service.ts`, `this.hash(template.templateText)`), the same value prompt-service stores as `templateHash` (`prisma/seed.ts:3450`). Nothing yet maps a hash back to a published version; subtask 1 adds that.
- **Civics data is merged across rows** (`region-query.service.ts:344+`), so one block's provenance does not map onto the merged model. The `glossary_entries` table, which carries per-entry provenance, is never read by GraphQL; it is only written (`civics-sync.service.ts:1449`).

## Changes from the plan, found while building (2026-11-17)

- **Kinds.** `UNKNOWN` was added. `analysisSource` and `bioSource` are read through an allowlist (`declaredOrigin`): a value outside it counts as AI only if a prompt hash is recorded, and is UNKNOWN otherwise. No such row exists on UAT or prod today.
- **A receipt names only what this output read.** The plan's single `sourceAsOf` field became `sourceUrl`, `sourceRef`, `sourceFetchedAt` and `sourcePublishedAt`, each set only where it can be shown true of this output:

  | Surface | What its receipt names |
  |---|---|
  | Proposition | The archived source and fetch date, only when `analysisSourceTextHash` = `fullTextHash`; nothing otherwise. Never the listing-page `sourceUrl`. List and detail use the same rule. |
  | Official bill | `sourceRef` = the export's bill version id. The summary is written from `pubinfo_bill_versions.bill_xml`, never from a page. |
  | Page-sourced bill | `fullTextUrl` |
  | Minutes | The row's own document URL, no fetch date. A summary survives failed re-summaries, so the latest fetch may not be the one it read. |
  | Scraped bio | The page URL, no fetch date |
  | AI bio | No source. It is written from our record of the member (`formatRepData`), not from a document. |
  | Representative summaries | No source; written from our own records |
  | Committee activity summary | No source; written from our own records |

- **Committee descriptions are written from the chamber and the committee's name only** (`formatCommitteeData`). The model supplies what a committee does from general knowledge, so the receipt names no source. This falls short of the grounded-output standard: #1451.
- **Representative receipts are set on `representative(id)` only.** The list and district queries read narrowed rows.
- **Minutes `summaryGeneratedAt`** was added by migration `20261117120000_minutes_summary_generated_at`, approved by the owner on 2026-11-17. The writer sets it from now on; existing summaries keep NULL ("not recorded") until they are next regenerated.
- **AI bios with no generated date are not a writer bug.** `bioGeneratedAt` and its writer arrived together on 2026-10-27 (reps Phase B, `7cb45517`), and the 107 UAT bios were generated before that, then judged current and never rewritten. They show "not recorded" until regenerated; back-filling a guessed date would be worse.
- **Civics and glossary (subtask 6) use one receipt per source page, not a per-term receipt and not the `glossary_entries` table.**
  - `CivicsBlock.sources` lists a receipt for each `civics_blocks` row. Every merged item already names its page in `sourceUrl`, which is how a reader matches a term to its receipt.
  - Switching the glossary to `glossary_entries` would change what readers see, while the receipts could not differ: the same extraction call writes both, and UAT shows the same prompt hashes in each.
  - The how-it-works page shows the list under "Where this comes from". Per-term receipts were not built; 224 collapsed receipts on one page would not help a reader.
- **The committee list badge is fixed to AI.** The list query loads no provenance, and every description is model-written today (#1451). If a description could ever be hand-written, add `descriptionProvenance { kind }` to the list query.
- **Bill summaries are polled** (`GET_BILL_SUMMARY_STATUS`) and normalised onto the same `Bill`. That query carries the receipt too, so new text never shows under the previous run's receipt (found in frontend review).
- **Source links are offered only for http(s) URLs.** Anything else reads "Not recorded".
- **Not changed, pre-existing:** proposition analysis runs do not invalidate the cached `propositions:` list, so a list can show an older receipt until the cache expires.

## Subtasks

### 1. Prompt manifest (prompt-service repo, separate PR)
- **Script:** `scripts/prompt-manifest.ts` emits a committed `prompts.manifest.json`, mapping each `templateHash` to its name, version, commit, release tag, and a link to the file and line in `prisma/seed.ts`.
- **Backfill:** a one-time pass over every commit that touched `prisma/seed.ts`, so hashes from older outputs resolve. Append-only: an entry is never removed.
- **CI:** regenerates the manifest and fails if the committed copy is stale.
- **Tests:** a fixture template's manifest hash equals prompt-client's hash of the same text.
- **Federation / migration:** none.

### 2. API: one provenance type (region subgraph)
- **New type** `AiProvenanceModel`:
  - `kind` (AI | DETERMINISTIC | MANUAL | SCRAPED), derived from the stored data, never from the surface;
  - `promptHash`, `promptVersion`, `llmModel`, `llmDigest`, `generatedAt`, `sourceUrl`, `sourceAsOf` — all nullable.
- **One table-driven builder** keyed on the column prefix (SonarCloud's duplication and complexity gates).
- **Fields and their mappings:**

  | Field | Mapping to change |
  |---|---|
  | `Proposition.analysisProvenance` | Both row types (`region.service.ts:282`, `region-query.service.ts:167`) and `mapPropositionRecord` |
  | `Bill.aiSummaryProvenance` | The `mapBillRecord` param type and return (`region-query.service.ts:1757-1830`) |
  | `Representative.{bio,committeesSummary,activitySummary}Provenance` | Rows are spread; widen `RepresentativeRecord` (`region.service.ts:264`) |
  | `LegislativeCommittee.{description,activitySummary}Provenance` | Service projection (`legislative-committee.service.ts:36-51, 187-202`), list select (`99-109`), resolver re-map (`region.resolver.ts:862-892`) |
  | `Minutes.summaryProvenance` | `MINUTES_SELECT`, `MinutesRecord` and `toMinutesModel` (`region-query.service.ts:115-165`) |

- **Federation:** additive only. Regenerate `apps/backend/region-schema.gql` and confirm the gateway composes it.
- **Tests:** the builder in every kind, including nulls; one resolver test per surface.

### 3. Fill in the missing dates
- **Migration** (`/op-migration`, SQL to the owner first): a nullable `minutes.summary_generated_at`. Additive; existing rows stay NULL and render "not recorded". No backfill from `updated_at`, which moves on unrelated writes.
- **Minutes writer:** `minutes-summary.service.ts:442-456` sets the new column.
- **AI bio writer:** find and fix why `bio_generated_at` is never set.
- **Scraped bios:** `clearedAiAttribution` also clears `bioGeneratedAt` and `bioSourceHash`.
- **Tests:** a regression test per writer, mutation-checked by reintroducing each bug.

### 4. Shared components (frontend)
- **`AiGeneratedBadge`** replaces the four copy-pasted pills:
  - `ActivitySummary.tsx:40-56`;
  - `MinutesSynopsis.tsx:26-42`;
  - the representative page at 172–190 and 253–269.
- **`AiReceipt`**, titled "How this was made", is a collapsed `<details>` showing:
  - **Source:** link and as-of date;
  - **Model:** readable name, exact digest on expand;
  - **Prompt:** version and short hash, linking to `/transparency/prompts/<hash>`;
  - **Generated:** date.
- **Missing fields render "not recorded" and are never hidden.**
- **Wording by kind:**
  - DETERMINISTIC: "No model used".
  - MANUAL: "Written by hand".
  - SCRAPED: "From the official source".
- **i18n:** all strings in English and Spanish. Touched components with hardcoded English (`ActivitySummary`, the representative page pills, the bill summary block) move onto i18n.
- **Tests:** unit tests for every kind and every missing field; an axe test in `__tests__/accessibility/`.

### 5. Wire every page (frontend)
- **Pages:**

  | Page | File | What changes |
  |---|---|---|
  | Proposition | `app/region/propositions/[id]/page.tsx` | Receipt added (`analysisGeneratedAt` and `analysisSource` are already fetched, never shown) |
  | Bill | `app/region/bills/[id]/page.tsx:205-228` | Receipt added, plus the missing AI label |
  | Representative | `app/region/representatives/[id]/page.tsx` | Receipts on bio, committee summary and activity summary |
  | Legislative committee | `app/region/legislative-committees/[id]/page.tsx`, list page | Receipt and label on the description (detail and list) and the activity summary |
  | Minutes | `components/region/MinutesSynopsis.tsx`, `GET_MINUTES` | Receipt added; the query also fetches `sourceUrl` |

- **Queries:** update in `lib/graphql/region.ts`.
- **Schema snapshot:** run `pnpm --filter frontend schema:refresh`, or CI's `--check` fails (`ci.yml:512`).
- **Tests:** update the existing page tests and the a11y tests (for example `bill-summary-section.a11y.test.tsx`).

### 6. Civics and glossary (backend and frontend)
- **Civics:**
  - API: `CivicsModel.sources: [AiProvenanceModel]`, one entry per contributing `civics_blocks` row, carrying its `sourceUrl`, model, prompt and `extractedAt`.
  - Page: `/region/how-it-works` shows one receipt that lists every source page.
- **Glossary:**
  - API: read `glossary_entries` (with `GlossaryEntrySource`) so each term carries its own provenance, instead of the merged `civics_blocks.glossary` JSON. Add `GlossaryEntryModel.provenance`.
  - Pages: `GlossaryList` shows a per-term receipt; `CivicTerm` tooltips link to it.
- **Labels:** AI labels on civics surfaces that render AI-extracted text (`HowABillBecomesLaw`, `MeasureTypeTable`, `LifecycleProgressBar`, `CitizenActionCallout`).
- **Federation:** additive.
- **Tests:**
  - Resolver: sources ordering and dedupe.
  - Parity: the glossary read returns the same terms as the merged JSON, so switching sources drops nothing.
  - a11y on the how-it-works page.

### 7. Make the transparency claims true (frontend)
- **New page `/transparency/prompts/[hash]`:** resolves the hash against the prompt-service manifest and shows:
  - the prompt's name and version;
  - a link to the exact commit and line;
  - how to recompute the hash yourself.
  - An unknown hash says plainly "not in the public record".
- **Manifest delivery:** read at build time or with daily revalidation from the public repo. A failed fetch shows "could not check right now", never a false "not found".
- **System card:** correct the copy (`system-card/page.tsx:101-110`; it cites "Ollama (llama3.2)") to the real models and to what is now disclosed.
- **Shared constant:** `PROMPT_SERVICE_REPO_URL` replaces the hardcoded links (`prompt-charter/page.tsx:124-129`, `ai-commitments/page.tsx:38`).

### 8. Verify on UAT (`/op-verify`)
- Open every surface and expand every receipt.
- Follow a prompt link and recompute one hash by hand.
- Check each kind renders correctly:
  - a scraped bio;
  - a deterministic committee summary;
  - a bill summary with no recorded provenance;
  - a civics page with several sources.
- Check prod's distinct served prompt hashes against the manifest before launch.

## Release order (deploy coupling)

The frontend queries new fields, so **the backend `v*` tag ships first, then `frontend-v*`**. The
reverse order breaks those pages. The prompt-service manifest must be merged before the frontend
links to it. Bill-summary regeneration is a separate operations task, run after the backend ships
so the receipts fill in. Do it before the public announcement.

## Data classification

- **What the change carries:** provenance metadata only — hashes, prompt versions, model names and digests, timestamps, public source URLs.
- **CCPA personal information:** none.
- **Public figures:** representatives are public figures (see `feedback_public_figure_pii_not_redacted`).
- **Out of scope:** `PersonalizedImpactCache`, which is per-user.
- **Logs, prompts, fixtures, third parties:** nothing new is logged or sent to a model. Fixtures use synthetic hashes and model names.

## Risk register

| Risk | Severity × likelihood | Mitigation |
|---|---|---|
| The frontend deploys before the backend; queries ask for missing fields and pages fail | high × possible | Release order above; stated in the PR and the release runbook |
| A hash doesn't resolve (an A/B variant, or a prompt edited and never committed) | medium × possible | The page says "not in the public record" plainly. Check prod's served hashes against the manifest before launch |
| Mostly "not recorded" receipts on bills at launch | medium × likely | Regenerate bill summaries before the announcement |
| A receipt says "AI" where no model was used | medium × possible | `kind` derived from stored data; unit tests for DETERMINISTIC, MANUAL and SCRAPED |
| The glossary source switch drops or changes terms | medium × possible | Parity test against the merged JSON before switching |
| The manifest fetch fails at runtime | low × possible | "Could not check right now", never "not found"; build-time or cached read |
| Minutes migration | low × rare | Additive nullable column; owner approves the SQL first |
| Exposing model digests reveals infrastructure detail | low × rare | Content hashes, not hostnames. Model names are already public in the system card |
| AGPL / GPL dependencies | low × rare | No new dependencies |
| Cognitive complexity or duplication gates | low × possible | Table-driven builder; one shared component |
