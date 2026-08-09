# Plan: RCPT contributions cover-page join (#980)

| | |
|---|---|
| **Issue** | [#980](https://github.com/OpusPopuli/opuspopuli/issues/980) |
| **Blocked by** | [#984](https://github.com/OpusPopuli/opuspopuli/issues/984) — cover-page source silently skipped |
| **Precedent** | [#955](https://github.com/OpusPopuli/opuspopuli/issues/955) — the same join, already solved for S496 |
| **Related** | [#979](https://github.com/OpusPopuli/opuspopuli/issues/979), [#962](https://github.com/OpusPopuli/opuspopuli/issues/962), [#982](https://github.com/OpusPopuli/opuspopuli/issues/982), [#983](https://github.com/OpusPopuli/opuspopuli/issues/983), [#954](https://github.com/OpusPopuli/opuspopuli/issues/954) |
| **Date** | 2026-08-08 (rewritten after raw-file verification) |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** Individual donor name, employer, occupation, city, state, ZIP+4. Public record under CA law. Volume increases ~6x if this lands. |
| **Branch** | `fix/980-cal-access-contribution-mapping` (+ `opuspopuli-regions`, + migration) |
| **Effort** | 4–6 focused sessions |
| **Status** | Plan rewritten. Subtask 1 (spike) complete — findings below. |

## Problem

`RCPT_CD.TSV` maps `CMTE_ID → committeeId`. `CMTE_ID` is the **contributing** committee. `RCPT_CD`
contains no recipient column, so the recipient is only reachable by joining `FILING_ID` to the
`CVR_CAMPAIGN_DISCLOSURE_CD` cover page.

Because `ContributionSchema` requires `committeeId: z.string().min(1)`, every row with a blank
`CMTE_ID` — every individual donor — is dropped by the mapper. What survives is committee-to-committee
transfers, attributed backwards: `totalRaised` sums money each committee **paid out**.

This is [#955](https://github.com/OpusPopuli/opuspopuli/issues/955)'s defect in the contributions
table. That issue's title was almost verbatim the same problem for S496.

## Subtask 1 — spike ✅ complete (2026-08-08)

Verified against the 2026-08-08 bulk export (1.58 GB zip; `RCPT_CD.TSV` is 3.8 GB uncompressed,
under the handler's 10 GB `MAX_UNCOMPRESSED_SIZE`). Archive paths are `CalAccess/DATA/…`, not
`CAL-ACCESS/DATA/…`.

**`RCPT_CD` has 63 columns and no `FILER_ID`.** The originally-planned "map `FILER_ID` instead of
`CMTE_ID`" fix is impossible. Relevant columns:

| # | Column | Role |
|---|---|---|
| 1 | `FILING_ID` | joins to the cover page → recipient |
| 2 | `AMEND_ID` | composite key component |
| 3 | `LINE_ITEM` | composite key component |
| 6 | `TRAN_ID` | composite key component (not unique alone) |
| 25 | `CMTE_ID` | **contributor's** committee — sits inside the `CTRIB_*` block |

**`CVR_CAMPAIGN_DISCLOSURE_CD` supplies the recipient:** `FILING_ID` (1), `FILER_ID` (5),
`FILER_NAML` (7).

**The data arrives; we lose it.** `pipeline_executions`, us-ca node:

```
RCPT_CD.TSV   2026-08-05   items_extracted: 1,210,475   items_failed: 0
contributions (source_system='cal_access'):                203,945
```

~1M rows dropped after the extraction counter — schema rejects and `TRAN_ID` upsert collapse both
happen downstream of it, which is why nothing surfaced as a failure.

**Defect A confirmed empirically.** Of 151,986 committee-donor rows, 40,003 have a `donor_name`
exactly equal to the name of the committee their `committee_id` points at; the remainder are the
same entities under different spellings (#954). A recipient does not donate to itself 40,003 times.

**Secondary — `TRAN_ID` is not unique** across filings, but the sync upserts on `externalId`. Real
key is `FILING_ID + AMEND_ID + LINE_ITEM + TRAN_ID`. `EXPN_CD` shares the pattern.

## What already exists

- `committees.external_id` **is** `FILER_ID` (via `dataSources[12]`)
- `cvr_filings` already stores `filing_id → filer_id` (via `dataSources[10]`, built for #955)
- `IndependentExpenditureLinkerService` is a working reference implementation of this join

Two gaps: `contributions` has no `filing_id` column and `RCPT` never extracts `FILING_ID`; and
`cvr_filings` covers only F496 IE cover pages (31,418 rows) — contributions need F460 too, which is
blocked by #984.

## Subtasks

### 0. Unblock — #984 ⚠️ blocks everything

Two sources over `CVR_CAMPAIGN_DISCLOSURE_CD.TSV` collide on one resume session, so one silently
ingests nothing. The F460 cover-page map cannot be populated until this is fixed. Not part of this
branch — see #984.

### 2. Composite `externalId`

- **Where:** `packages/scraping-pipeline/src/handlers/bulk-download.handler.ts`, `BulkDownloadConfig`;
  `opuspopuli-regions/schema/region-plugin.schema.json`
- Add optional `compositeKey: string[]` joining source columns with a stable separator.
- **Tests:** key construction, collision behavior, back-compat when absent.

### 3. `filing_id` on contributions and expenditures

- **Where:** `supabase/migrations/` (use `/op-migration`), `packages/relationaldb-provider/prisma/schema.prisma`
- Additive only: nullable `filing_id` + index. No drops, no renames.
- **Tests:** integration test against the real test DB (never mock the DB layer).

### 4. Cover-page-join resolution

- **Where:** `apps/backend/src/apps/region/src/domains/` — new linker or extension of `CampaignFinanceSyncService`
- Resolve `contributions.filing_id → cvr_filings.filer_id → committees.external_id`.
- Follow `IndependentExpenditureLinkerService` (#955) — same shape, already reviewed.
- **Tests:** unit tests for resolution + reconcile; integration test for the full join.

### 5. Column mappings

- **Where:** `opuspopuli-regions` (merges to `main`, publishes `@opuspopuli/regions`)
- `RCPT_CD` / `EXPN_CD`: add `FILING_ID → filingId`; `externalId` ← composite key; drop or repurpose
  the `CMTE_ID → committeeId` mapping.
- Broaden cover-page ingestion to F460 (depends on #984).
- Version bump, publish, consume in the monorepo.

### 6. Re-ingest

- **Where:** region-worker
- Existing rows carry a wrong `committee_id` and an unstable `externalId`, so upsert **will not
  converge** — scoped delete of `source_system='cal_access'` contributions and expenditures first.
- DB snapshot beforehand. Scope by `source_system`. Never target the dev `postgres` DB (#796).
- **Acceptance gate:** `/op-data-scan`.

### 7. Verify aggregation semantics

- **Where:** `representative-funding.service.ts`
- Confirm `totalRaised` means raised, and `totalSpent <= totalRaised` for a sample.
- Cross-check 5–10 representatives against official CAL-ACCESS filings before production.

### 8. Revisit labeling

- **Where:** `RepresentativeFundingPanel.tsx`, `locales/{en,es}/civics.json`
- The interim "Identified donors" wording may revert to "Donors" once counts are real. Re-run
  `pnpm test:a11y`.

**Ordering:** #984 first. Then 2, 3, 5 in parallel; 4 after 3; 6 after all; 7–8 after 6.

## Adjacent defects — split out

- [#982](https://github.com/OpusPopuli/opuspopuli/issues/982) — committee rows whose `name` is a bare
  numeric filer ID
- [#983](https://github.com/OpusPopuli/opuspopuli/issues/983) — refunds netting against totals with no
  sign handling (no ingestion dependency; can land any time)

## Data classification

**PII, no PHI.** Individual contributor rows carry name, employer, occupation, city, state, ZIP+4 —
published public record under CA law, so ingestion is lawful, but volume changes the risk profile.
Today ~29,809 individual rows survive; the fix brings the stored total from 203,945 toward the
1.21M extracted.

Required before subtask 6 lands:

- **ZIP+4 minimization.** Name + employer + ZIP+4 approaches individually identifying. Decide whether
  ZIP+4 is needed or ZIP5 suffices.
- **No model exposure.** Confirm contributor rows never reach prompts, embeddings, or the RAG index.
- **Log masking.** Verify donor fields are in the audit-log masked set.
- **Retention.** No equivalent of the 90-day audit-log expiry exists here. Needs an explicit decision.

## Risk register

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Blocked by #984; F460 cover pages cannot populate | high | certain | Fix #984 first; do not start subtask 5 before it lands |
| Re-ingest requires deleting existing cal_access rows | high | likely | Scope by `source_system`; verify counts before/after; snapshot first; never target dev `postgres` (#796) |
| Public dollar figures change substantially | high | likely | Expected and correct, but re-verify a sample against official filings before production — same exposure as #979 / #962 |
| Row count grows 203,945 → ~1.2M | medium | likely | Verify index coverage on `contributions(committee_id, filing_id)`; donor scan already capped at 1000 |
| PII volume increase (~6x) | medium | likely | See data classification; `/op-data-scan` gate on subtask 6 |
| Migration on a large existing table | medium | possible | Additive nullable column + concurrent index; no backfill in the migration itself |
| Region config in a separate repo | low | likely | Publish `@opuspopuli/regions` before the monorepo consumes it |
| AGPL-3.0 dependency constraint | low | rare | No new dependencies anticipated |

## Open questions

1. Should this block launch? Every representative's dollar figures currently measure money paid out
   rather than raised, over a ~17% sample. That is arguably a sibling of #979, not a follow-up.
2. ~~Does `EXPN_CD` need the same cover-page join?~~ **Yes — verified.** `EXPN_CD` also has no
   `FILER_ID`, carries the same `FILING_ID`/`AMEND_ID`/`LINE_ITEM`/`TRAN_ID` key columns, and its
   `CMTE_ID` (col 26) sits in the payee block — so it identifies the *payee's* committee, not the
   spender. `totalSpent` is inverted the same way `totalRaised` is.
3. Should `cvr_filings` broaden to all form types, or gain a sibling table for F460?
