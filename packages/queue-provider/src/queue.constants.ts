export const REGION_SYNC_QUEUE = "region-sync";
export const STRUCTURAL_ANALYSIS_QUEUE = "pipeline-structural-analysis";

export const ANALYSIS_REQUEST_SOURCE = {
  CACHE_MISS: "cache_miss",
  CACHE_STALE: "cache_stale",
  MANUAL: "manual",
} as const;

export type AnalysisRequestSource =
  (typeof ANALYSIS_REQUEST_SOURCE)[keyof typeof ANALYSIS_REQUEST_SOURCE];

export const QUEUE_CONNECTION = "QUEUE_CONNECTION";
export const QUEUE_MODULE_OPTIONS = "QUEUE_MODULE_OPTIONS";

export const TRIGGER_SOURCE = {
  MANUAL: "manual",
  CRON: "cron",
  STARTUP: "startup",
  MANIFEST_READY: "manifest_ready",
} as const;

export type TriggerSource =
  (typeof TRIGGER_SOURCE)[keyof typeof TRIGGER_SOURCE];

export const JOB_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
