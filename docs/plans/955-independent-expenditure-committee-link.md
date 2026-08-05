# Plan of record: fix independent-expenditure committee join (#955)

| | |
|---|---|
| **Issue** | [OpusPopuli/opuspopuli#955](https://github.com/OpusPopuli/opuspopuli/issues/955) (part of epic #936, supersedes the S496 note in #950) |
| **Date** | 2026-08-05 |
| **Author** | Rodney Gagnon (AI-assisted; plan approved in-session) |
| **Data classification** | None — operates on **public CAL-ACCESS campaign-finance data** (committee/candidate/measure names, expenditure amounts). No PHI/PII, nothing sent to a model, no end-user data. |
| **Branch (monorepo)** | `fix/independent-expenditure-committee-link-955` |
| **Branch (regions)** | `feat/ie-cover-pages-955` (separate `opuspopuli-regions` repo, merges to `main`) |

## Root cause (confirmed against production, 2026-08-05)

`independent_expenditures = 0` on prod while `expenditures = 286,630` and `committees = 77,328` are fully populated — so this is precisely the S496 validation-drop, not a sync failure.

- `S496_CD.TSV` (Form 496 line-item detail) carries **no committee id**; the IE mapper's `committeeId: z.string().min(1)` (`packages/scraping-pipeline/src/mapping/domain-mapper.service.ts:806`) rejects every row.
- The filer committee + IE target (candidate/measure, support/oppose) live on the **F496 cover page** (`CVR_CAMPAIGN_DISCLOSURE_CD`, `FORM_TYPE=F496`), joined to S496 only by `FILING_ID`.
- The declarative `BulkDownloadConfig` is single-file/single-row (**no join primitive**), and cover-page `FILING_ID` is currently discarded (the roster dedups to committees by `FILER_ID`). So no persisted `FILING_ID → committee` map exists — the join must be **code**, mirroring `PropositionFinanceLinkerService`.

## Design — self-staging + post-sync linker

Persist F496 cover-page filings, ingest S496 with a **nullable** committee, then a post-sync linker resolves committee + target by `FILING_ID`. Consistent with the model's existing nullable-then-linked `propositionId`; avoids a second staging table.

## Subtasks

1. **Config — `@opuspopuli/regions` (separate repo, version bump).** In `regions/california/california.json`: add `FILING_ID → filingId` to the **S496_CD** source; add a new **"CAL-ACCESS IE Cover Pages"** source (`CVR_CAMPAIGN_DISCLOSURE_CD`, `filters: {FORM_TYPE: F496}`) mapping `FILING_ID→filingId, FILER_ID→filerId, CAND_NAML→candidateName, OFFICE_CD→candidateOffice, BAL_NAME→propositionTitle, SUP_OPP_CD→supportOrOppose`. Bump version, publish, bump the dep in the monorepo. *Cross-repo — the config half can't ship from this repo alone.*
2. **Prisma + migrations (`packages/relationaldb-provider`).** New model `CvrFiling` `@@map("cvr_filings")` (`filingId` indexed, `filerId`, `candidateName?`, `candidateOffice?`, `propositionTitle?`, `supportOrOppose?`, `sourceSystem`; `externalId` unique = filingId). Alter `independent_expenditures`: `committee_id` **DROP NOT NULL**, add `filing_id` + `@@index([filingId])`. Both additive/widening — no drops/renames. Generate via `/op-migration`.
3. **Domain mapper (`domain-mapper.service.ts`).** Relax `IndependentExpenditureSchema.committeeId` → optional (`:806`), add `filingId?`; add `CvrFilingSchema` + `mapCvrFiling`, route the new category in `mapCampaignFinanceItem` (`:99–117`). Tests: add a regression fixture of a **real S496 row without committeeId** (existing specs at `:1043–1129` cheat with `committeeId:"C001"`); add CvrFiling mapping test.
4. **Sync service (`campaign-finance-sync.service.ts`).** New `sortItems` bucket + `upsertBatch` for `cvr_filings` (mirror cvr2 `:381–392`); guard the IE committeeId externalId→UUID rewrite when absent (`:215–217, 265–267`); persist IE rows with nullable committeeId + filingId (`:365–380`).
5. **New `IndependentExpenditureLinkerService.linkAll()`** (region domains). Build `filingId → committee` from `cvr_filings` (`filerId → committees.external_id → committee.id`); for each null-committee IE, stamp `committeeId`, `committeeName`, `candidateName`/`propositionTitle`, `supportOrOppose`; resolve `propositionId` for measures. Idempotent + reconcile (mirror candidate/proposition linkers). Wire post-sync (`:168–176`); add `run-independent-expenditure-linker.ts` one-off script. Co-located spec (resolve / unmatched / idempotent / ambiguous).
6. **GraphQL/federation.** IE is exposed on the region subgraph money-trail. `committeeId` becoming nullable means the resolver must **filter unresolved (null-committee) IEs** to preserve the non-null contract — verify the IE type field and validate at the API gateway.
7. **Deploy + verify (prod).** Requires a **full campaign-finance re-sync** (S496 isn't persisted today — must re-download + re-parse `dbwebexport.zip` with the new mappings), then run the IE linker. Verify `0 → N` and spot-check FILING_ID joins + support/oppose on ~10 IEs.

## Risk register (severity × likelihood → mitigation)

1. Cross-repo `@opuspopuli/regions` bump — **medium × likely** → publish + version bump + dep update before the code half is testable end-to-end.
2. Full prod finance re-sync required (heavy, re-download ~286k+ rows) — **medium × likely** → run off-peak; the linker itself is cheap to re-run after.
3. `committee_id` → nullable migration — **low × possible** → widening ALTER (additive-safe, 0 existing rows); no drop/rename; verify GraphQL non-null contract + resolver filter.
4. FILING_ID key-space mismatch (the existing `extractFilingId` prefix trick in the proposition linker is fragile) — **medium × possible** → use the explicit mapped `filingId` column, not the prefix hack; validate join hit-rate on a prod S496 sample first.
5. Mis-join S496 → wrong cover page — **low × rare** → FILING_ID is a strong 1:1 key; spot-check support/oppose + target on ~10 linked IEs.
6. Unresolved IEs linger (null committee) — **low × possible** → idempotent linker + reconcile; filter from GraphQL; log unresolved count.
7. FEC IEs out of scope (blocked by federal-sync #630/#631) — noted, not addressed here.
8. AGPL / deps — **low × rare** → no new dependencies.

## Effort

~2–3 focused sessions (config + 2 migrations + mapper + sync + new linker + tests) — heavier than #953 — plus a full prod finance re-sync at deploy (ops).

## Design alternative considered

Issue's option 1 (two staging tables: separate S496 staging + cover-page map). Rejected in favor of self-staging (nullable committee on the IE table, matching the existing nullable `propositionId`) to avoid a second table. Revisit if we decide IEs should never exist without a committee.
