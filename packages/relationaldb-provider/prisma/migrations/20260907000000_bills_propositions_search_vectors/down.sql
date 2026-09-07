-- Rollback for 20260907000000_bills_propositions_search_vectors.
-- Generated columns carry no independent data — dropping them loses nothing
-- that the base columns don't still hold, so this rollback is lossless.

DROP INDEX IF EXISTS "bills_bill_number_trgm_idx";
DROP INDEX IF EXISTS "propositions_search_vector_idx";
DROP INDEX IF EXISTS "bills_search_vector_idx";

ALTER TABLE "propositions" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "bills" DROP COLUMN IF EXISTS "search_vector";
