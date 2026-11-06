-- Rollback for campaign finance Phase B (D3, D5). The ledger and the row/run
-- and run/snapshot links recorded since are lost; finance rows are untouched.
-- After this, the next sync writes every row again (no completed imports).
ALTER TABLE "expenditures"             DROP CONSTRAINT IF EXISTS "expenditures_pipeline_execution_id_fkey";
ALTER TABLE "filing_summaries"         DROP CONSTRAINT IF EXISTS "filing_summaries_pipeline_execution_id_fkey";
ALTER TABLE "independent_expenditures" DROP CONSTRAINT IF EXISTS "independent_expenditures_pipeline_execution_id_fkey";
ALTER TABLE "cvr_filings"              DROP CONSTRAINT IF EXISTS "cvr_filings_pipeline_execution_id_fkey";
ALTER TABLE "cvr2_filings"             DROP CONSTRAINT IF EXISTS "cvr2_filings_pipeline_execution_id_fkey";
DROP INDEX IF EXISTS "expenditures_pipeline_execution_id_idx";
DROP INDEX IF EXISTS "filing_summaries_pipeline_execution_id_idx";
DROP INDEX IF EXISTS "independent_expenditures_pipeline_execution_id_idx";
DROP INDEX IF EXISTS "cvr_filings_pipeline_execution_id_idx";
DROP INDEX IF EXISTS "cvr2_filings_pipeline_execution_id_idx";
ALTER TABLE "expenditures"             DROP COLUMN IF EXISTS "pipeline_execution_id";
ALTER TABLE "filing_summaries"         DROP COLUMN IF EXISTS "pipeline_execution_id";
ALTER TABLE "independent_expenditures" DROP COLUMN IF EXISTS "pipeline_execution_id";
ALTER TABLE "cvr_filings"              DROP COLUMN IF EXISTS "pipeline_execution_id";
ALTER TABLE "cvr2_filings"             DROP COLUMN IF EXISTS "pipeline_execution_id";

ALTER TABLE "pipeline_executions" DROP CONSTRAINT IF EXISTS "pipeline_executions_bulk_snapshot_id_fkey";
DROP INDEX IF EXISTS "pipeline_executions_bulk_snapshot_id_idx";
ALTER TABLE "pipeline_executions" DROP COLUMN IF EXISTS "bulk_snapshot_id";

DROP TABLE IF EXISTS "bulk_imports";
