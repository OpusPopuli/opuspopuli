-- Rollback for 20261107140000_pubinfo_bills_derived_links_hash.
ALTER TABLE "pubinfo_bills" DROP COLUMN IF EXISTS "derived_links_hash";
