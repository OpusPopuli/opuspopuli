-- S2 (docs/plans/S2-per-type-sync-jobs.md): one region-sync job per data type.
--
-- parent_job_id: a startup or multi-type request becomes a parent row whose
-- children are one job per data type. The parent's status and results roll
-- up from its children. ON DELETE CASCADE so the children go with their
-- parent; pipeline_jobs is never deleted from today, so this governs only
-- manual cleanup.
--
-- worker_host: which host ran the job, so a worker's startup sweep fails only
-- its own abandoned rows, not every RUNNING row in the table (§7 H1).
--
-- Both nullable and additive: every existing row is top-level, and a NULL
-- host keeps the pre-S2 sweep behaviour for rows written before this.
-- TEXT, to match pipeline_jobs.id.

ALTER TABLE "pipeline_jobs"
  ADD COLUMN "parent_job_id" TEXT,
  ADD COLUMN "worker_host" TEXT;

ALTER TABLE "pipeline_jobs"
  ADD CONSTRAINT "pipeline_jobs_parent_job_id_fkey"
  FOREIGN KEY ("parent_job_id") REFERENCES "pipeline_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Settling a parent and fanning out a cancel both read children by parent.
CREATE INDEX "pipeline_jobs_parent_job_id_idx" ON "pipeline_jobs"("parent_job_id");
