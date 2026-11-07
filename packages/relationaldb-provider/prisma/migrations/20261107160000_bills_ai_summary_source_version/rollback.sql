-- Rollback for 20261107160000_bills_ai_summary_source_version.
ALTER TABLE "bills" DROP COLUMN IF EXISTS "ai_summary_source_version";
