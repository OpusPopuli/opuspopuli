-- Migration: pipeline_jobs
-- Async job status table for the region-sync BullMQ queue.
-- This is the v1 instance of the status-table substrate; future job families
-- (bill-watch-notifications, etc.) add peer tables following this template.

CREATE TABLE public.pipeline_jobs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  bullmq_job_id   TEXT        NOT NULL,
  trigger_source  TEXT        NOT NULL CHECK (trigger_source IN ('manual', 'cron', 'startup')),
  region_id       TEXT,
  data_types      TEXT[]      NOT NULL DEFAULT '{}',
  depth           TEXT,
  max_reps        INT,
  max_bills       INT,
  status          TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts        INT         NOT NULL DEFAULT 0,
  enqueued_by     TEXT,
  enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error_message   TEXT,
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX pipeline_jobs_status_idx    ON public.pipeline_jobs (status, enqueued_at);
CREATE INDEX pipeline_jobs_region_idx    ON public.pipeline_jobs (region_id, enqueued_at DESC);
CREATE INDEX pipeline_jobs_bullmq_idx    ON public.pipeline_jobs (bullmq_job_id);
CREATE INDEX pipeline_jobs_trigger_idx   ON public.pipeline_jobs (trigger_source, enqueued_at DESC);

-- Link pipeline executions (per-source rows) back to their parent job.
ALTER TABLE public.pipeline_executions
  ADD COLUMN pipeline_job_id UUID REFERENCES public.pipeline_jobs(id) ON DELETE SET NULL;

CREATE INDEX pipeline_executions_job_idx ON public.pipeline_executions (pipeline_job_id);
