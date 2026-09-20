-- Reverse of the temporal-validity columns. Lossy: superseded generations
-- become indistinguishable from current ones, so drop the superseded rows
-- rather than leave several "current" claim sets for one subject.
DELETE FROM "claims" WHERE "valid_until" IS NOT NULL;

DROP INDEX IF EXISTS "claims_current_by_subject_type_idx";
DROP INDEX IF EXISTS "claims_subject_type_subject_id_valid_until_idx";
ALTER TABLE "claims" DROP COLUMN IF EXISTS "valid_until";
ALTER TABLE "claims" DROP COLUMN IF EXISTS "valid_from";
