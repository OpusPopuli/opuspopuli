-- Rollback for #1277.
--
-- Drops the snapshot table and the per-record hashes. The snapshot PAYLOADS in
-- object storage are NOT removed by this — the rows that name them are, so the
-- objects become unreferenced. Take an inventory before rolling back if you
-- intend to reclaim that space.
DROP TABLE IF EXISTS "bulk_snapshots";

ALTER TABLE "filing_summaries" DROP COLUMN IF EXISTS "source_record_hash";
ALTER TABLE "cvr_filings" DROP COLUMN IF EXISTS "source_record_hash";
ALTER TABLE "cvr2_filings" DROP COLUMN IF EXISTS "source_record_hash";
ALTER TABLE "independent_expenditures" DROP COLUMN IF EXISTS "source_record_hash";
ALTER TABLE "expenditures" DROP COLUMN IF EXISTS "source_record_hash";
ALTER TABLE "contributions" DROP COLUMN IF EXISTS "source_record_hash";
