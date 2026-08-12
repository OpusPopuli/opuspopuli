-- #992 (subtask 4a): record which schedule each finance detail row came from.
--
-- RCPT_CD is not Schedule A. It is every receipt schedule in one file, and its
-- FORM_TYPE column — the schedule letter — was never mapped, so `contributions`
-- is an undifferentiated mix. Measured on the 2026-04-05 export:
--
--   A       18,205,803 rows  $28.70B   Form 460 line 1  (monetary contributions)
--   C          313,633 rows   $1.74B   Form 460 line 4  (nonmonetary)
--   I          197,921 rows   $1.54B   Form 460 line 14 (misc increases to cash)
--   F496P3     237,731 rows   $1.87B   not a Form 460 at all
--   F401A      146,291 rows   $0.37B   not a Form 460 at all
--
-- Reconciliation compares against line 1, which is Schedule A alone, so summing
-- the table as it stands compares a mixture against one of its parts. Across all
-- 122,033 F460 filings at their surviving amendment, Schedule A alone yields 374
-- filings (0.31%) where our detail exceeds the committee's own reported total;
-- summing every row yields 35,712 (29.3%), of which 35,339 are false. Without
-- this column the check fires on nearly a third of all filings and is worthless.
--
-- EXPN_CD carries the same mixing plus a trap: Schedule D (4,826,727 rows) is a
-- MEMO schedule restating payments already counted in Schedule E (7,824,338), so
-- summing D with E double-counts. That is the lever #991 needs for line 6.
--
-- VARCHAR(20), not a narrower type or an enum: the observed values include
-- 'F496P3' and 'F461P5' alongside single letters, and CAL-ACCESS adds form codes
-- without notice. A CHECK constraint would reject rows the source considers
-- valid and drop real money on a future export.
--
-- Additive: two nullable columns, two indexes. No drops, no renames, no table
-- rewrite (ADD COLUMN with no default is catalog-only, so it does not touch the
-- 20M/15M existing rows).
--
-- Existing rows get NULL. That is correct rather than a gap to backfill: the
-- schedule is not derivable from what is stored, and per open question 1 these
-- tables are re-synced rather than backfilled. Reconciliation treats a NULL
-- schedule as "unknown" and declines to reconcile that filing instead of
-- guessing — see FilingReconciliationService.
--
-- Data classification: PII, no PHI, and no NEW PII. The schedule letter is a
-- form-structure code, not donor detail. No RLS on any finance table (none
-- exists anywhere in this schema); access is mediated by the region service.

ALTER TABLE "contributions" ADD COLUMN "schedule_code" VARCHAR(20);
ALTER TABLE "expenditures"  ADD COLUMN "schedule_code" VARCHAR(20);

-- Reconciliation aggregates one filing's rows for one schedule, so the index
-- leads on filing_id with schedule_code second — the same shape, and the same
-- reasoning, as contributions_filing_amend_idx above it.
CREATE INDEX "contributions_filing_schedule_idx"
    ON "contributions"("filing_id", "schedule_code");
CREATE INDEX "expenditures_filing_schedule_idx"
    ON "expenditures"("filing_id", "schedule_code");
