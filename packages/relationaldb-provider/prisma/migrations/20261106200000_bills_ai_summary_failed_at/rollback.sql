-- Rollback for 20261106200000_bills_ai_summary_failed_at.
ALTER TABLE "bills" DROP COLUMN IF EXISTS "ai_summary_failed_at";
