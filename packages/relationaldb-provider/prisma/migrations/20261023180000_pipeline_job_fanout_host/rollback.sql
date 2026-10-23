-- Rollback for 20261023180000_pipeline_job_fanout_host. Deploy the pre-S2
-- application first: S2 code writes both columns.
DROP INDEX IF EXISTS "pipeline_jobs_parent_job_id_idx";
ALTER TABLE "pipeline_jobs" DROP CONSTRAINT IF EXISTS "pipeline_jobs_parent_job_id_fkey";
ALTER TABLE "pipeline_jobs" DROP COLUMN IF EXISTS "worker_host",
                            DROP COLUMN IF EXISTS "parent_job_id";
