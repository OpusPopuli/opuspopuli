# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-08-10

Headline: **CAL-ACCESS campaign finance was attributed backwards.** Every representative
page summed the money a committee *paid out* as money it *raised*. The code fix ships
here; the figures do not change until the data rebuild runs (see Deployment below).

### Added

- **Cover-page attribution for contributions and expenditures** (#980). `RCPT_CD` and
  `EXPN_CD` carry no `FILER_ID`, and their `CMTE_ID` names the *counterparty* — the
  contributor on a receipt, the payee on an expenditure. `CoverPageLinkerService` resolves
  the committee that actually filed, by joining `filing_id → cvr_filings → committees`.
  Set-based (`UPDATE … FROM`, batched at 50k) rather than row-by-row, because this table
  reaches ~17M rows.
- **`compositeKey` for bulk sources** (#980). Builds `externalId` from several columns for
  feeds where no single column identifies a row. `TRAN_ID` repeats across CAL-ACCESS
  filings, so using it alone collapsed distinct line items onto one row. A key column
  missing from the file's headers now fails the parse rather than silently shortening the
  key for every row.
- Partial indexes on the rows the linker actually scans, and a `UNIQUE` constraint on
  `cvr_filings.filing_id` — the join assumes one cover page per filing, which until now
  held only by convention across two repositories.

### Changed

- **Donor employer, occupation and ZIP+4 are no longer exposed over GraphQL** (#980).
  Still ingested and stored; withheld from the API via an allowlist projection. Name +
  employer + occupation + ZIP+4 together approach an individually identifying record, and
  the rebuild takes this table from ~204k rows to ~17M. No feature is lost: the
  contributions page never selected them, and the single-contribution query that did had
  no consumer.
- Donor fields added to the audit-log mask as **fully redacted**. Partial masking preserves
  the last four characters — for a ZIP+4 those four *are* the +4.
- Unattributed rows are withheld from GraphQL rather than surfaced as partial records,
  matching how #955 treats unresolved S496 line items.

### Fixed

- **Resume-session identity is unique per source, not per file** (#985). A broadened
  cover-page source could otherwise collide with a sibling over the same file.
- **Same-surname relatives no longer match in the candidate-committee linker** (#981).
- Body font restored and semantic colour tokens adopted across the frontend (#978).
- Pinned `js-yaml` and `nanoid` overrides to clear a HIGH CVE gate.

### Migrations

Two, both additive. `prisma migrate deploy` runs them at deploy time.

| Migration | Effect |
|---|---|
| `20260809000000_contribution_expenditure_cover_page_join` | nullable `filing_id` + index on `contributions`/`expenditures`; relaxes `committee_id` to nullable. FKs pinned `ON DELETE RESTRICT` — Prisma defaults an optional relation to `SetNull`, which would have turned a committee delete into silent orphaning. |
| `20260809120000_cvr_filing_unique_and_pending_link_index` | `UNIQUE` on `cvr_filings.filing_id`; partial `pending_link` indexes. |

Both are catalog-only on the ALTERs; index builds hold a brief lock. Verified against
current production shape: `cvr_filings.external_id` already equals `filing_id` and is
unique, so the new constraint cannot fail on existing rows.

### Breaking

`ContributionModel` loses three nullable fields — `donorEmployer`, `donorOccupation`,
`donorZip`. Any GraphQL client selecting them will error. The only consumer in this
repository is updated in the same release.

Released as a **minor**: the removed fields had no consumer, the change is
privacy-motivated, and this is pre-launch. Treating the federated schema as a public
contract would make it `2.0.0` instead — a defensible reading if the API is considered
external.

### ⚠️ Deployment — this release does not fix the figures on its own

Merging builds and publishes images. Pulling them on the Studio activates the new region
config (`@opuspopuli/regions@1.0.78`), and **the next sync then writes correctly-keyed rows
alongside the existing incorrect ones**:

- existing rows keep a `committee_id` pointing at the counterparty and have no `filing_id`,
  so the linker cannot reach them and the GraphQL filter cannot exclude them
- new rows arrive under the composite key, get attributed correctly, and are counted *as
  well as* the old ones

The result is double counting layered on top of the original defect. The dataset must be
rebuilt in the same maintenance window:

1. snapshot the finance tables
2. truncate `committee_measure_positions`, `contributions`, `expenditures`,
   `independent_expenditures`, `committees` (FK order), scoped to `source_system='cal_access'`
3. re-sync from the region worker
4. re-run the candidate-committee and proposition linkers — `committees.representative_id`
   is derived
5. `/op-data-scan`, then verify a sample against official CAL-ACCESS filings

Deploying without step 2 is worse than not deploying. **Rebuild duration is unmeasured** —
measure before scheduling the window.

### Notes

- #980 stays **open** deliberately. The code is complete; the issue closes when the rebuild
  has run and the figures are verified.
- Retention for ~17M donor rows is still undecided — no equivalent of the 90-day audit-log
  expiry exists for this data.
- Public access to the finance queries is unchanged by decision, to revisit post-launch.

[1.4.0]: https://github.com/OpusPopuli/opuspopuli/compare/v1.3.0...v1.4.0
