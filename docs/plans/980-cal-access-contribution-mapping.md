# Plan: CAL-ACCESS contribution column mapping (#980)

| | |
|---|---|
| **Issue** | [#980](https://github.com/OpusPopuli/opuspopuli/issues/980) |
| **Related** | [#979](https://github.com/OpusPopuli/opuspopuli/issues/979) (linker attribution), [#962](https://github.com/OpusPopuli/opuspopuli/issues/962) (P0 false-attribution liability), [#954](https://github.com/OpusPopuli/opuspopuli/issues/954) (donor-name fragmentation, closed) |
| **Date** | 2026-08-08 |
| **Author** | Rodney Gagnon |
| **Data classification** | **PII — no PHI.** Individual donor name, employer, occupation, city, state, ZIP+4. Public record under CA law. Volume increases materially if this lands. |
| **Branch** | `fix/980-cal-access-contribution-mapping` (+ matching branch in `opuspopuli-regions`) |
| **Effort** | 3–5 focused sessions |
| **Status** | Approved. Defect A confirmed empirically 2026-08-08; subtask 1 narrowed to fix-design details |

## Problem restatement

The issue was filed as "itemization is shallow." Investigation indicates that is a *symptom* of two
defects in the `RCPT_CD.TSV` column mapping in
`opuspopuli-regions/regions/california/california.json` (`config.dataSources[7]`).

### Defect A — `CMTE_ID` is the wrong source column for `committeeId` ✅ confirmed

In CAL-ACCESS, `FILER_ID` identifies the committee that filed the report — the one **receiving** the
contribution. `CMTE_ID` is populated on the **contributor** side when a committee gives to another
committee.

`ContributionSchema` in `packages/scraping-pipeline/src/mapping/domain-mapper.service.ts` requires
`committeeId: z.string().min(1)`, so every row with a blank `CMTE_ID` is dropped silently by the
mapper. Live data matches that prediction:

```
committee  151,986   ← CMTE_ID populated, survives
individual  29,809   ← CMTE_ID mostly blank, dropped
party       12,492
other        9,658
```

Individual donors outnumbering committees ~5:1 is the real-world shape; the stored data is the
inverse. This also explains the Mia Bonta page anomaly, where "Top donors" mirrored the committee
list with near-identical amounts — `donorName` and `committeeId` were describing the *same*
contributing committee.

Contribution attribution is therefore **semantically inverted**: money the committee paid *out* is
being counted as money it *raised*.

#### Confirmation (2026-08-08)

Tested directly against the us-ca node. If `committee_id` were the *recipient*, a committee-type
donor's name would essentially never equal the name of the committee the row points at. Result:

```
committee-donor rows           151,986
exact name match                40,003   (26.3%)
normalized (alnum-only) match            (28.8%)
```

40,003 exact self-matches refutes the recipient reading outright. The remaining ~71% are the *same
entities under different spellings* — #954 donor-name fragmentation defeating the string comparison,
not a different relationship:

| `committees.name` (via `committee_id`) | `contributions.donor_name` |
|---|---|
| RAYTHEON CALIFORNIA POLITICAL ACTION COMMITTEE | Raytheon California PAC |
| Orange County Employees Association Political Action Committee | Orange County Employees Assoc. |
| Turkish Coalition California PAC (TC-CAL PAC) | Turkish Coalition California PAC |
| Howard F. Ahmanson/Fieldstead & Company | Fieldstead & Company |

Defect A is confirmed. No bulk download was required to establish it.

### Defect B — `TRAN_ID` is not a globally unique key

`TRAN_ID` is unique within a filing, not across filings. `CampaignFinanceSyncService` upserts on
`externalId`, so rows sharing a `TRAN_ID` overwrite each other. The real key is
`FILING_ID + AMEND_ID + LINE_ITEM + TRAN_ID`.

`EXPN_CD.TSV` (`dataSources[8]`) carries the identical `CMTE_ID`/`TRAN_ID` pattern, which is the
likely reason `totalSpent` exceeds `totalRaised` for some representatives — the two joins have
different coverage of the same defect.

### Adjacent defects — split out, not in scope here

Two further problems surfaced while sampling committee-donor rows. Both are independent of the
column mapping and are tracked separately so #980 can close cleanly:

- **[#982](https://github.com/OpusPopuli/opuspopuli/issues/982)** — committee rows whose `name` is a
  bare numeric filer ID (`1318941`, `1363306`), rendering as a bare number on the public money-trail
  lists.
- **[#983](https://github.com/OpusPopuli/opuspopuli/issues/983)** — refunds filed as negative
  receipts net against `totalRaised` with no sign handling, while still incrementing
  `contributionCount` and donor buckets.

#983 has no ingestion dependency and can land well before this work.

## Subtasks

### 1. Spike — raw source details ⚠️ gates the mapping change

Defect A no longer depends on this (confirmed above), but the *fix* does. Pull `RCPT_CD.TSV` from
`dbwebexport.zip` and confirm:

- The actual column list, so the replacement column is one we have seen rather than one inferred
  from CAL-ACCESS convention. `FILER_ID` is the expected recipient column — verify before mapping to it.
- `TRAN_ID` collision rate across filings — sizes Defect B.
- Whether `EXPN_CD.TSV` and `S496_CD.TSV` need the mirror-image fix.

Header and a few sample rows are sufficient; the ~1GB TSV need not be extracted:

```bash
curl -o /tmp/dbwebexport.zip https://campaignfinance.cdn.sos.ca.gov/dbwebexport.zip
unzip -l /tmp/dbwebexport.zip | grep -iE 'RCPT_CD|EXPN_CD|S496_CD'
unzip -p /tmp/dbwebexport.zip 'CAL-ACCESS/DATA/RCPT_CD.TSV' | head -3
```

### 2. Composite `externalId` support

- **Where:** `packages/scraping-pipeline` — `handlers/bulk-download.handler.ts`, `BulkDownloadConfig`
- **Also:** `opuspopuli-regions/schema/region-plugin.schema.json`
- Config can currently map only one column to `externalId`. Add a `compositeKey: string[]` that joins
  source columns with a stable separator.
- **Tests:** composite key construction, collision behavior, back-compat when `compositeKey` is absent.
- No migration. No GraphQL change.

### 3. Correct the column mappings

- **Where:** `opuspopuli-regions` (separate repo — merges direct to `main`, publishes `@opuspopuli/regions`)
- `RCPT_CD.TSV` and `EXPN_CD.TSV`: `committeeId` ← correct filer column; `externalId` ← composite key.
- Version bump, publish, consume in the monorepo.
- **Tests:** schema validation in the regions repo.

### 4. Re-ingest

- **Where:** `apps/backend` region-worker
- Existing rows carry both a wrong `committee_id` and an unstable `externalId`, so upsert **will not
  converge** — a scoped delete of `source_system='cal_access'` contributions and expenditures is
  required before re-ingest.
- Snapshot the production DB first. Scope the delete by `source_system`; never run against the dev
  `postgres` database (#796 discipline).
- **Acceptance gate:** `/op-data-scan` pass on the resulting data.

### 5. Verify and re-check aggregation semantics

- **Where:** `apps/backend/src/apps/region/src/domains/representative-funding.service.ts`
- Confirm `totalRaised` now means raised rather than contributed-out, and that
  `totalSpent <= totalRaised` holds for a sample.
- Cross-check 5–10 representatives against official CAL-ACCESS filings before it reaches production.

### 6. Revisit #980 labeling

- **Where:** `apps/frontend/components/region/RepresentativeFundingPanel.tsx`, `locales/{en,es}/civics.json`
- The interim "Identified donors" wording (shipped in the #979 PR) may revert to plain "Donors" once
  counts are real. Re-run `pnpm test:a11y`.

**Ordering:** 2 and 3 may run in parallel after 1. 4 blocks on both. 5 and 6 follow 4.
[#982](https://github.com/OpusPopuli/opuspopuli/issues/982) and
[#983](https://github.com/OpusPopuli/opuspopuli/issues/983) are independent and can be scheduled
separately.

## Data classification

**PII, no PHI.** Individual contributor rows carry name, employer, occupation, city, state, and ZIP+4.
All of it is published public record under California law, so ingestion is lawful — but volume changes
the risk profile. Today ~29,809 individual rows survive; correcting the mapping could bring in
millions.

Required considerations before subtask 4 lands:

- **ZIP+4 minimization.** Name + employer + ZIP+4 approaches individually identifying. Decide whether
  ZIP+4 is needed or ZIP5 suffices.
- **No model exposure.** Confirm contributor rows never reach prompts, embeddings, or the RAG index.
  The knowledge service must not be indexing donor PII.
- **Log masking.** Verify donor fields are in the audit-log masked set.
- **Retention.** Campaign finance has no equivalent of the 90-day audit-log expiry. Needs an explicit
  decision.

## Risk register

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Re-ingest requires deleting existing cal_access rows | high | likely | Scope delete by `source_system`; verify counts before/after; DB snapshot first; never target dev `postgres` (#796) |
| Public-facing dollar figures change substantially | high | likely | Expected and correct, but re-verify a sample against official filings before production — same false-attribution exposure as #979 / #962 |
| `FILER_ID` is not the correct replacement column | medium | possible | Defect A itself is confirmed; subtask 1 verifies the column name against the raw file before any mapping is written |
| Refund handling (#983) changes published totals again | medium | possible | Land #983 deliberately with a matching UI label rather than as a silent numeric shift |
| PII volume increase (29k → millions of individual rows) | medium | likely | See data classification; `/op-data-scan` as acceptance gate on subtask 4 |
| Row-count growth degrades query performance | medium | likely | Verify index coverage on `contributions(committee_id)`; funding aggregation already caps its donor scan at 1000 |
| Region config lives in a separate repo/package | low | likely | Coordinate `@opuspopuli/regions` publish before the monorepo consumes it |
| Breaking change to `BulkDownloadConfig` | low | possible | `compositeKey` is additive and optional; existing configs unaffected |
| AGPL-3.0 dependency constraint | low | rare | No new dependencies anticipated |

## Open questions

1. Should this block launch? It is arguably a sibling of #979 rather than a follow-up — if the spike
   confirms Defect A, every representative's dollar figures are currently measuring the wrong thing.
2. Does the same `CMTE_ID` assumption affect `S496_CD.TSV` (independent expenditures), recently
   reworked in #955?
3. ~~Are Defects C and D in scope for #980?~~ Resolved — split into
   [#982](https://github.com/OpusPopuli/opuspopuli/issues/982) and
   [#983](https://github.com/OpusPopuli/opuspopuli/issues/983).
