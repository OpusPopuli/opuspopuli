-- Campaign finance Phase B, F8 (docs/plans/campaign-finance-phase-b.md,
-- opuspopuli-regions#97).
--
-- S496 (independent_expenditures) and CVR2 (cvr2_filings) were keyed on a bare
-- TRAN_ID, which is unique only within one filing's amendment, so lines from
-- other filings and amendments overwrote each other's row. regions#97 keys them
-- FILING_ID:LINE_ITEM:TRAN_ID and maps AMEND_ID, as for RCPT/EXPN, and
-- amendment supersession then removes the older versions. It needs amend_id.

-- Additive: nullable, no default, no backfill. The next sync writes it.
ALTER TABLE "independent_expenditures" ADD COLUMN "amend_id" INTEGER;
ALTER TABLE "cvr2_filings" ADD COLUMN "amend_id" INTEGER;

-- Serves supersession's per-filing max() and the sync's per-batch read (F7),
-- as on contributions and expenditures.
CREATE INDEX "independent_expenditures_filing_id_amend_id_idx"
  ON "independent_expenditures"("filing_id", "amend_id");
CREATE INDEX "cvr2_filings_filing_id_amend_id_idx"
  ON "cvr2_filings"("filing_id", "amend_id");

-- Rows stored under the old bare-TRAN_ID key. The composite key never matches
-- them, and with amend_id NULL supersession never deletes them, so left in
-- place every one would count twice beside its rebuilt row. No foreign key
-- references either table.
--
-- Both tables are empty of CAL-ACCESS rows until the next campaign_finance
-- sync, which writes both sources in full because their import key changed
-- with the config. Run one right after deploying this.
DELETE FROM "independent_expenditures"
 WHERE "source_system" = 'cal_access'
   AND "external_id" NOT LIKE '%:%';
DELETE FROM "cvr2_filings"
 WHERE "source_system" = 'cal_access'
   AND "external_id" NOT LIKE '%:%';
