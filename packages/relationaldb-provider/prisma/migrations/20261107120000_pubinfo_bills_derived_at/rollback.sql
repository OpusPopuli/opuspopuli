-- Rollback for 20261107120000_pubinfo_bills_derived_at.
DROP INDEX IF EXISTS "pubinfo_bill_detail_votes_motion_id_idx";
ALTER TABLE "pubinfo_bills" DROP COLUMN IF EXISTS "derived_at";
