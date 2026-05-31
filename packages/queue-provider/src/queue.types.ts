import { AnalysisRequestSource, TriggerSource } from "./queue.constants";

export interface RegionSyncJobData {
  pipelineJobId?: string;
  triggerSource: TriggerSource;
  regionId?: string;
  dataTypes?: string[];
  depth?: string;
  maxReps?: number;
  maxBills?: number;
  /**
   * When true, the bills sync re-fetches each bill's status page and updates
   * status/lastAction/lastActionDate without LLM extraction, bypassing both
   * the sourcePublishedAt skip and the needsStatusRecheck flag. Used by the
   * weekly backstop scheduler to catch governor actions and off-session
   * changes the journal linker can't see. See #689.
   */
  forceStatusRecheck?: boolean;
}

export interface RegionSyncJobResult {
  regionId: string;
  dataType: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  errors: string[];
  syncedAt: string;
}

export interface StructuralAnalysisJobData {
  structuralAnalysisJobId: string;
  regionId: string;
  sourceUrl: string;
  dataType: string;
  contentGoal?: string;
  category?: string;
  hints?: string[];
  requestedBy: AnalysisRequestSource;
}

export interface StructuralAnalysisJobResult {
  manifestId: string;
  manifestVersion: number;
  analysisTimeMs: number;
}

/**
 * Personalized bill feed LLM re-rank job (opuspopuli#745).
 *
 * One job per user. Carries the user's `RankingFlags` and `interestTags`
 * by VALUE so the worker doesn't have to cross the federation boundary
 * to refetch them — the enqueuing path (the GraphQL mutation OR the
 * nightly scheduler) is responsible for fetching the user's declared
 * signals and putting them on the job. Privacy boundary: only declared
 * signals — never raw T3 data — cross this serialization boundary
 * (planning doc §10 commitment 7).
 */
export interface LlmRerankJobData {
  /** FK to the `llm_rerank_jobs` row this BullMQ job corresponds to. */
  rerankJobId: string;
  triggerSource: TriggerSource;
  userId: string;
  /** TRUE-only `RankingFlags` slugs — see opuspopuli#742. */
  rankingFlags: string[];
  /** User's declared interest tags (controlled-vocab slugs). */
  interestTags: string[];
  /** Hard cap on candidates re-ranked per call. Worker defaults to 20. */
  candidateLimit?: number;
  /** Cache TTL override in ms. Worker defaults to 7 days. */
  ttlMs?: number;
}

export interface LlmRerankJobResult {
  userId: string;
  candidatesConsidered: number;
  cacheWritesWithExplanation: number;
  cacheWritesWithoutExplanation: number;
  llmFailures: number;
  validatorRejections: number;
  budgetExhausted: boolean;
  totalTokens: number;
}

export interface QueueModuleOptions {
  url: string;
  prefix?: string;
}

export interface QueueModuleAsyncOptions {
  inject?: unknown[];
  useFactory: (
    ...args: unknown[]
  ) => QueueModuleOptions | Promise<QueueModuleOptions>;
  imports?: unknown[];
}

export interface EnqueueOptions {
  jobId?: string;
  delay?: number;
  priority?: number;
}

export interface QueueJobInfo {
  id: string;
  state: string;
  progress: number;
  failedReason?: string;
}

export interface SchedulerInfo {
  id: string;
  pattern: string;
  next: number | null;
}
