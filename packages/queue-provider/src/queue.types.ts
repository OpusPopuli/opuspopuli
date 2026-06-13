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
/**
 * Discriminator for the multi-entity rerank pipeline (opuspopuli#836).
 * 'bill' is the original #745 flow — kept as the default so existing
 * queued jobs (without an explicit `entityType` field) continue to be
 * processed as bill reranks. The other three are the new entity types.
 */
export type LlmRerankEntityType =
  | "bill"
  | "proposition"
  | "representative"
  | "committee";

/**
 * Committee rerank candidate carried on the job. The `membersOnUserSlate`
 * field is the privacy contract from prompt-service#81 — the enqueuing
 * path (scheduler) MUST intersect committee members with the user's
 * resolved rep slate and pass only the intersection (or `[]`). The
 * prompt-service cannot validate the claim; this is enforced by the
 * scheduler upstream of this serialization boundary.
 */
export interface LlmRerankCommitteeCandidate {
  legislativeCommitteeId: string;
  /** Intersection of committee members ∩ user's resolved rep slate. */
  membersOnUserSlate: string[];
}

export interface LlmRerankJobData {
  /** FK to the `llm_rerank_jobs` row this BullMQ job corresponds to. */
  rerankJobId: string;
  triggerSource: TriggerSource;
  userId: string;
  /** TRUE-only `RankingFlags` slugs — see opuspopuli#742. */
  rankingFlags: string[];
  /** User's declared interest tags (controlled-vocab slugs). */
  interestTags: string[];
  /**
   * Entity type for this rerank. Defaults to 'bill' when missing — this
   * lets in-flight jobs enqueued before opuspopuli#836 continue to
   * dispatch to the bill path. New code should always set this explicitly.
   */
  entityType?: LlmRerankEntityType;
  /**
   * Pre-resolved candidate IDs for proposition / representative reranks.
   * Required when `entityType` is 'proposition' or 'representative'.
   * Ignored for 'bill' (which uses PersonalizedFeedService internally)
   * and 'committee' (which uses `committeeCandidates`).
   */
  candidateIds?: string[];
  /**
   * Pre-resolved committee candidates with each one's
   * `membersOnUserSlate` intersection already computed. Required when
   * `entityType` is 'committee'. See LlmRerankCommitteeCandidate docblock
   * for the privacy contract.
   */
  committeeCandidates?: LlmRerankCommitteeCandidate[];
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
