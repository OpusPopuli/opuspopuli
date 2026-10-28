-- Rollback for representatives Phase B skip columns. Drops only what was
-- added; every bio, summary and description is untouched.
ALTER TABLE "legislative_committees"
    DROP COLUMN IF EXISTS "activity_summary_config_hash",
    DROP COLUMN IF EXISTS "activity_summary_source_hash",
    DROP COLUMN IF EXISTS "description_generated_at",
    DROP COLUMN IF EXISTS "description_config_hash",
    DROP COLUMN IF EXISTS "description_source_hash";
ALTER TABLE "representatives"
    DROP CONSTRAINT IF EXISTS "representatives_source_version_id_fkey";
DROP INDEX IF EXISTS "representatives_source_version_id_idx";
ALTER TABLE "representatives"
    DROP COLUMN IF EXISTS "source_version_id",
    DROP COLUMN IF EXISTS "activity_summary_config_hash",
    DROP COLUMN IF EXISTS "activity_summary_source_hash",
    DROP COLUMN IF EXISTS "committees_summary_generated_at",
    DROP COLUMN IF EXISTS "committees_summary_config_hash",
    DROP COLUMN IF EXISTS "committees_summary_source_hash",
    DROP COLUMN IF EXISTS "bio_generated_at",
    DROP COLUMN IF EXISTS "bio_config_hash",
    DROP COLUMN IF EXISTS "bio_source_hash";
