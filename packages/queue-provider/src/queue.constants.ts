export const REGION_SYNC_QUEUE = "region-sync";
export const STRUCTURAL_ANALYSIS_QUEUE = "pipeline-structural-analysis";
export const LLM_RERANK_QUEUE = "llm-rerank";
/** Per-minutes-row AI synopsis + claims generation (#813). */
export const MINUTES_SUMMARY_QUEUE = "minutes-summary";

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
  /**
   * Stopped on purpose by an operator — distinct from FAILED, which means the
   * run tried and could not. A dashboard that conflates the two cannot tell
   * "we stopped this" from "this broke".
   */
  CANCELLED: "cancelled",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/**
 * The Redis key namespace every queue lives under.
 *
 * ONE definition, because this string was written independently in nine
 * places — the provider, the config provider, two feature modules and five
 * worker processors — and a namespace that is defined nine times is a
 * namespace that can disagree with itself.
 *
 * It did. On 2026-09-22 the dev Redis held both `bullmq:region-sync:*` (what
 * the workers consume) and `bull:region-sync:*` (BullMQ's own library default,
 * left by an older image), with a job stranded in the second since 2026-09-11.
 * A producer and consumer that disagree here do not error: the enqueue
 * succeeds, and the job is simply never seen.
 *
 * Note this is NOT BullMQ's default of `bull`. Overriding it is deliberate —
 * it keeps our keys distinguishable from anything else sharing the Redis
 * instance — which is precisely why every call site has to agree on it.
 */
export const DEFAULT_QUEUE_PREFIX = "bullmq";

/**
 * Resolve the queue prefix from configuration, falling back to the shared
 * default.
 *
 * @param configured - Whatever `BULLMQ_PREFIX` resolved to, if anything
 */
export function resolveQueuePrefix(configured?: string | null): string {
  return configured?.trim() || DEFAULT_QUEUE_PREFIX;
}
