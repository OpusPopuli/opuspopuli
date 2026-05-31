-- Async-job status table for the `llm-rerank` BullMQ queue
-- (opuspopuli#745). Mirrors the shape of `structural_analysis_jobs` —
-- one row per enqueue, queued → running → (succeeded | failed),
-- per-user telemetry on the result JSONB column.
--
-- Additive only — safe for prod per CLAUDE.md.

CREATE TABLE "llm_rerank_jobs" (
  "id"               TEXT         NOT NULL,
  "bullmq_job_id"    TEXT         NOT NULL,
  "status"           VARCHAR(20)  NOT NULL,
  "trigger_source"   VARCHAR(20)  NOT NULL,
  "user_id"          TEXT         NOT NULL,
  "candidate_limit"  INTEGER,
  "attempts"         INTEGER      NOT NULL DEFAULT 0,
  "enqueued_at"      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at"       TIMESTAMPTZ,
  "finished_at"      TIMESTAMPTZ,
  "error_message"    TEXT,
  "result"           JSONB,

  CONSTRAINT "llm_rerank_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "llm_rerank_jobs_status_enqueued_at_idx"
  ON "llm_rerank_jobs" ("status", "enqueued_at");

CREATE INDEX "llm_rerank_jobs_user_id_enqueued_at_idx"
  ON "llm_rerank_jobs" ("user_id", "enqueued_at" DESC);

CREATE INDEX "llm_rerank_jobs_bullmq_job_id_idx"
  ON "llm_rerank_jobs" ("bullmq_job_id");
