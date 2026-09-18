-- Rollback for #1280.
--
-- Drops the provenance columns and everything that depends on them. Any
-- row-to-run links recorded since the migration are lost and cannot be
-- reconstructed: the pipeline_executions rows survive, but which row came
-- from which run does not exist anywhere else.
ALTER TABLE "contributions"
    DROP CONSTRAINT IF EXISTS "contributions_pipeline_execution_id_fkey",
    DROP CONSTRAINT IF EXISTS "contributions_manifest_id_fkey";
ALTER TABLE "bills"
    DROP CONSTRAINT IF EXISTS "bills_pipeline_execution_id_fkey",
    DROP CONSTRAINT IF EXISTS "bills_manifest_id_fkey";
ALTER TABLE "minutes"
    DROP CONSTRAINT IF EXISTS "minutes_pipeline_execution_id_fkey",
    DROP CONSTRAINT IF EXISTS "minutes_manifest_id_fkey";
ALTER TABLE "propositions"
    DROP CONSTRAINT IF EXISTS "propositions_pipeline_execution_id_fkey",
    DROP CONSTRAINT IF EXISTS "propositions_manifest_id_fkey";

DROP INDEX IF EXISTS "contributions_pipeline_execution_id_idx";
DROP INDEX IF EXISTS "bills_pipeline_execution_id_idx";
DROP INDEX IF EXISTS "minutes_pipeline_execution_id_idx";
DROP INDEX IF EXISTS "propositions_pipeline_execution_id_idx";

ALTER TABLE "contributions"
    DROP COLUMN IF EXISTS "pipeline_execution_id",
    DROP COLUMN IF EXISTS "manifest_id",
    DROP COLUMN IF EXISTS "manifest_version";
ALTER TABLE "bills"
    DROP COLUMN IF EXISTS "pipeline_execution_id",
    DROP COLUMN IF EXISTS "manifest_id",
    DROP COLUMN IF EXISTS "manifest_version";
ALTER TABLE "minutes"
    DROP COLUMN IF EXISTS "pipeline_execution_id",
    DROP COLUMN IF EXISTS "manifest_id",
    DROP COLUMN IF EXISTS "manifest_version";
ALTER TABLE "propositions"
    DROP COLUMN IF EXISTS "pipeline_execution_id",
    DROP COLUMN IF EXISTS "manifest_id",
    DROP COLUMN IF EXISTS "manifest_version";
