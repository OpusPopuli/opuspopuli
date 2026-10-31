import { AnalysisRequestSource, TriggerSource } from "./queue.constants";

export interface RegionSyncJobData {
  pipelineJobId?: string;
  /**
   * Set on a child of a fanned-out request (S2): the parent's
   * `pipeline_jobs` id, which the child settles when it finishes.
   */
  parentJobId?: string;
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
  /**
   * Per-run override for the meetings `pdf_archive` walk (daily-journals /
   * weekly-histories): number of archive documents to ingest this run,
   * overriding the region config's `pdfArchive.maxNew`. Operator-facing
   * backfill control from the `syncRegionData` mutation.
   */
  maxDocuments?: number;
  /**
   * When true, the meetings `pdf_archive` walk ignores the stored ingestion
   * watermark for this run and re-processes from the top (bounded by
   * `maxDocuments`), enabling an on-demand historical backfill.
   */
  resetWatermark?: boolean;
  /**
   * Boundary-refresh force flag. Set only by the `refreshBoundaries`
   * mutation, which enqueues a `dataTypes: ["boundaries"]` job on this
   * queue (OpusPopuli/opuspopuli#1122). Passed straight through to
   * `BoundaryLoaderService.loadAll({ force })` — `true` re-fetches even
   * when jurisdictions are already populated (redistricting / new TIGER
   * vintage). Ignored for civic data-type syncs.
   */
  force?: boolean;
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

/** Job data for the minutes-summary queue — one job per minutes row (#813). */
export interface MinutesSummaryJobData {
  minutesId: string;
  /** External id, for log correlation. */
  externalId?: string;
  /** When true, re-summarize even if a summary already exists (operator backfill). */
  force?: boolean;
}

/**
 * Job data for the civics-extract queue — one job per changed civics page
 * (civics S3). The page itself is NOT in the payload: the worker reloads the
 * archived bytes by `sourceVersionId`, so Redis carries ids, not page text.
 */
export interface CivicsExtractJobData {
  regionId: string;
  sourceUrl: string;
  /** The `source_versions` row holding the page as fetched. */
  sourceVersionId: string;
  /** The data-source fields the extraction reads (prompt inputs + limits). */
  source: {
    url: string;
    contentGoal: string;
    category?: string;
    hints?: string[];
    llmMaxTokens?: number;
    llmRequestTimeoutMs?: number;
  };
  /** Extract even when the page's skip key matches its last record. */
  reextract?: boolean;
}

/**
 * Job data for the proposition-analysis queue — one job per stale measure
 * (propositions S4). Only the id: the worker reloads the row and re-checks
 * it on every axis of the analysis key before generating.
 */
export interface PropositionAnalysisJobData {
  propositionId: string;
}

/**
 * Job data for the pdf-parse queue (S6). Ids only: the consumer loads the
 * archived bytes and records the parse in the source store, so neither the
 * bytes nor the text travel through Redis.
 */
export interface PdfParseJobData {
  sourceVersionId: string;
  /** The requester's parser key; the consumer records only under its own. */
  parserKey: string;
}

/** A representative's bio (`representative-bio`). Ids only. */
export interface RepresentativeBioJobData {
  representativeId: string;
  /** The sync's region display name — part of the prompt's jurisdiction. */
  regionName?: string;
}

/** A representative's committee summary (`committee-summary`). */
export interface CommitteeSummaryJobData {
  representativeId: string;
}

/** A legislative committee's description (`committee-description`). */
export interface CommitteeDescriptionJobData {
  committeeId: string;
}

/** An entity's activity summary (`activity-summary`). */
export interface ActivitySummaryJobData {
  entityType: "representative" | "committee";
  entityId: string;
}

export interface StructuralAnalysisJobData {
  structuralAnalysisJobId: string;
  regionId: string;
  sourceUrl: string;
  /** Fetch from here rather than `sourceUrl` (a resolved `dateQueryParams` window). */
  fetchUrl?: string;
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
  /** Candidates skipped because a fresh explanation was already cached. */
  skippedFresh?: number;
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
  /**
   * Drop the job from Redis as soon as it finishes, instead of the queue's
   * retention. Needed where a deterministic jobId must collapse only onto
   * work still in flight: BullMQ treats an add whose id matches a RETAINED
   * finished job as a no-op.
   */
  removeOnFinish?: boolean;
}

export interface QueueJobInfo {
  id: string;
  state: string;
  progress: number;
  failedReason?: string;
}

/** {@link QueueService.getDepth}. `waiting` includes prioritized jobs. */
export interface QueueDepth {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingSeconds: number;
}

export interface SchedulerInfo {
  id: string;
  pattern: string;
  next: number | null;
}
