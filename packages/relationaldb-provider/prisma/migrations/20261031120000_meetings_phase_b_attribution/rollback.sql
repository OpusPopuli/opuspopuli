-- Rollback for meetings Phase B step 3. Row-to-run links and summary skip keys
-- recorded since the migration are lost; summaries themselves are untouched.
ALTER TABLE "meetings"
    DROP CONSTRAINT IF EXISTS "meetings_pipeline_execution_id_fkey",
    DROP CONSTRAINT IF EXISTS "meetings_manifest_id_fkey";
DROP INDEX IF EXISTS "meetings_pipeline_execution_id_idx";
ALTER TABLE "meetings"
    DROP COLUMN IF EXISTS "source_url",
    DROP COLUMN IF EXISTS "pipeline_execution_id",
    DROP COLUMN IF EXISTS "manifest_id",
    DROP COLUMN IF EXISTS "manifest_version";
ALTER TABLE "minutes"
    DROP COLUMN IF EXISTS "summary_source_hash",
    DROP COLUMN IF EXISTS "summary_config_hash";
