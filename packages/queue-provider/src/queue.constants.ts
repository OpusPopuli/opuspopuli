export const REGION_SYNC_QUEUE = "region-sync";
export const STRUCTURAL_ANALYSIS_QUEUE = "pipeline-structural-analysis";
export const LLM_RERANK_QUEUE = "llm-rerank";
/** Per-minutes-row AI synopsis + claims generation (#813). */
export const MINUTES_SUMMARY_QUEUE = "minutes-summary";
/**
 * Per-page civics extraction (civics S3, `docs/plans/civics-phase-b.md` §3):
 * the civics sync fetches and archives each page, then queues its LLM
 * extraction here and waits for the outcome.
 */
export const CIVICS_EXTRACT_QUEUE = "civics-extract";
/**
 * Per-measure proposition analysis (propositions S4,
 * `docs/plans/propositions-phase-b.md` §3): the propositions sync queues each
 * stale measure's analysis here and waits for the outcome.
 */
export const PROPOSITION_ANALYSIS_QUEUE = "proposition-analysis";
/**
 * The CPU lane (S6, `docs/plans/propositions-phase-b.md`): one job per
 * archived PDF with no recorded parse under the requester's parser key. Its
 * consumer may run on another host (`WORKER_QUEUES`).
 */
export const PDF_PARSE_QUEUE = "pdf-parse";
/**
 * Representatives Phase B (`docs/plans/representatives-phase-b.md`): one
 * queue per generator, each in the GPU lane — the representatives sync
 * selects the stale outputs and queues one job per row.
 */
export const REPRESENTATIVE_BIO_QUEUE = "representative-bio";
export const COMMITTEE_SUMMARY_QUEUE = "committee-summary";
export const COMMITTEE_DESCRIPTION_QUEUE = "committee-description";
export const ACTIVITY_SUMMARY_QUEUE = "activity-summary";

/**
 * `BULLMQ_QUEUE_<NAME>_<SUFFIX>` — every per-queue knob's env name, in one
 * place (`pdf-parse` → `BULLMQ_QUEUE_PDF_PARSE_CONCURRENCY`).
 */
export function queueEnvKey(queueName: string, suffix: string): string {
  return `BULLMQ_QUEUE_${queueName.toUpperCase().replace(/-/g, "_")}_${suffix}`;
}

/**
 * A per-queue integer knob, or `fallback` when it is unset, not an integer,
 * or below `min`.
 */
export function queueEnvInt(
  queueName: string,
  suffix: string,
  fallback: number,
  min = 1,
): number {
  const raw = process.env[queueEnvKey(queueName, suffix)];
  const parsed = Number(raw);
  return raw?.trim() && Number.isSafeInteger(parsed) && parsed >= min
    ? parsed
    : fallback;
}

/**
 * Attempts per job where the default of 3 is wrong. A `pdf-parse` failure is
 * a thread timeout or a heap-cap death — deterministic for that PDF — and its
 * requester has fallen back by the time a retry would run, so a retry only
 * spends the CPU lane. `BULLMQ_QUEUE_<NAME>_ATTEMPTS` still overrides.
 */
export const DEFAULT_QUEUE_ATTEMPTS: Readonly<Record<string, number>> = {
  [PDF_PARSE_QUEUE]: 1,
};

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
