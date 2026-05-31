-- Promote the existing non-unique index on `llm_rerank_jobs.bullmq_job_id`
-- to a UNIQUE constraint. The scheduler's deterministic jobId
-- (`cron-${userId}-${yyyymmdd}` for the nightly fan-out, `manual-...`
-- for on-demand triggers) is the deduplication contract — without the
-- DB-level unique, two replicas that fan out the same nightly cron
-- could both insert a row before BullMQ.enqueue dedupes at the queue
-- layer, leaving orphan QUEUED rows that no worker ever picks up.
--
-- Additive only — at deploy time there should be no duplicate
-- bullmq_job_id values (the prior index was created in the previous
-- migration). The CREATE UNIQUE INDEX will fail loudly if there are.

DROP INDEX IF EXISTS "llm_rerank_jobs_bullmq_job_id_idx";

CREATE UNIQUE INDEX "llm_rerank_jobs_bullmq_job_id_key"
  ON "llm_rerank_jobs" ("bullmq_job_id");
