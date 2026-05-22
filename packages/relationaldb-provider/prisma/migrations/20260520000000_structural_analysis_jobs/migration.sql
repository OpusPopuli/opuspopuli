-- Migration: structural_analysis_jobs
-- Async job status table for the pipeline:structural-analysis BullMQ queue.
-- Tracks LLM manifest-derivation jobs initiated on cache miss, cache stale,
-- or via the warmManifest admin mutation.

CREATE TABLE public.structural_analysis_jobs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  bullmq_job_id   TEXT        NOT NULL,
  status          VARCHAR(20) NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  region_id       VARCHAR(100) NOT NULL,
  source_url      VARCHAR(1000) NOT NULL,
  data_type       VARCHAR(50) NOT NULL,
  requested_by    VARCHAR(20) NOT NULL CHECK (requested_by IN ('cache_miss', 'cache_stale', 'manual')),
  manifest_id     UUID,
  attempts        INT         NOT NULL DEFAULT 0,
  enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  error_message   TEXT
);

CREATE INDEX structural_analysis_jobs_status_idx
  ON public.structural_analysis_jobs (status, enqueued_at);

CREATE INDEX structural_analysis_jobs_source_idx
  ON public.structural_analysis_jobs (region_id, source_url, data_type, enqueued_at DESC);

CREATE INDEX structural_analysis_jobs_bullmq_idx
  ON public.structural_analysis_jobs (bullmq_job_id);
