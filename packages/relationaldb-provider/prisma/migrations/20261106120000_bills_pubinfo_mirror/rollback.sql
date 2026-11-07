-- Rollback for 20261106120000_bills_pubinfo_mirror. Drops the mirrors (they
-- are rebuilt by the next pubinfo import) and the two bills columns.
DROP TABLE IF EXISTS "pubinfo_location_codes";
DROP TABLE IF EXISTS "pubinfo_legislators";
DROP TABLE IF EXISTS "pubinfo_bill_motions";
DROP TABLE IF EXISTS "pubinfo_bill_detail_votes";
DROP TABLE IF EXISTS "pubinfo_bill_summary_votes";
DROP TABLE IF EXISTS "pubinfo_bill_history";
DROP TABLE IF EXISTS "pubinfo_bill_version_authors";
DROP TABLE IF EXISTS "pubinfo_bill_versions";
DROP TABLE IF EXISTS "pubinfo_bills";
ALTER TABLE "bills" DROP COLUMN IF EXISTS "ai_summary_llm_digest";
ALTER TABLE "bills" DROP COLUMN IF EXISTS "status_source";
