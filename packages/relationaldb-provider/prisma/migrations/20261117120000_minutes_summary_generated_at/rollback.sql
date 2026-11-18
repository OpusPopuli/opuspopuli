-- Rollback for 20261117120000_minutes_summary_generated_at.
ALTER TABLE "minutes" DROP COLUMN IF EXISTS "summary_generated_at";
