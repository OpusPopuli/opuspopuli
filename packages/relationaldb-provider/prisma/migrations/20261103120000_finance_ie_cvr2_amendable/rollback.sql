-- Rollback for campaign finance Phase B, F8 (opuspopuli-regions#97).
--
-- Deleted rows are not restored here: they were the collapsed bare-TRAN_ID
-- rows. A campaign_finance sync on the previous regions config rebuilds them.
--
-- The rows written on the composite key (FILING_ID:LINE_ITEM:TRAN_ID) are
-- deleted, the mirror of the up migration. The previous code supersedes
-- neither table and the previous config writes bare-TRAN_ID rows, so left in
-- place they would sit beside the rebuilt rows and count every line twice.
-- Both tables have no CAL-ACCESS rows until that sync: run one right after.
DELETE FROM "independent_expenditures"
 WHERE "source_system" = 'cal_access' AND "external_id" LIKE '%:%';
DELETE FROM "cvr2_filings"
 WHERE "source_system" = 'cal_access' AND "external_id" LIKE '%:%';
DROP INDEX IF EXISTS "independent_expenditures_filing_id_amend_id_idx";
DROP INDEX IF EXISTS "cvr2_filings_filing_id_amend_id_idx";
ALTER TABLE "independent_expenditures" DROP COLUMN IF EXISTS "amend_id";
ALTER TABLE "cvr2_filings" DROP COLUMN IF EXISTS "amend_id";
