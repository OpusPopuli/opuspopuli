import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  QUEUE_CONNECTION,
  LLM_RERANK_QUEUE,
  createWorker,
  type LlmRerankJobData,
  type LlmRerankJobResult,
} from '@opuspopuli/queue-provider';
import { LlmRerankService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank.service';
import { LlmRerankJobService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank-job.service';
import type { PersonalizationInputDto } from 'src/apps/knowledge/src/domains/personalized-feed/dto/personalization-input.dto';

/**
 * BullMQ consumer for the `llm-rerank` queue (#745). One job per user.
 *
 * The cron scheduler + the knowledge-service mutation are both enqueue
 * paths; this is the single consume path. Per-bill LLM calls + cache
 * writes happen inside `LlmRerankService.rerankForUser`; this processor
 * just orchestrates the job-status lifecycle (queued → running →
 * succeeded/failed) on `llm_rerank_jobs` and lets BullMQ handle retry/
 * backoff.
 *
 * Startup sweep: same pattern as `RegionSyncProcessor` (opuspopuli#730)
 * — recover rows stuck in RUNNING from a worker crash so they don't
 * sit forever holding state. Threshold matches BullMQ lock-renewal plus
 * a safety margin.
 */
@Injectable()
export class LlmRerankProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LlmRerankProcessor.name, {
    timestamp: true,
  });
  private worker?: Worker<LlmRerankJobData>;

  constructor(
    private readonly rerank: LlmRerankService,
    private readonly jobs: LlmRerankJobService,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const prefix = this.config.get<string>('BULLMQ_PREFIX') ?? 'bullmq';

    const DEFAULT_STALE_AGE_MS = 600_000;
    const rawStaleAge = this.config.get<string>('LLM_RERANK_JOB_STALE_AGE_MS');
    const parsedStaleAge = rawStaleAge
      ? Number.parseInt(rawStaleAge, 10)
      : DEFAULT_STALE_AGE_MS;
    const staleAgeMs =
      Number.isFinite(parsedStaleAge) && parsedStaleAge > 0
        ? parsedStaleAge
        : DEFAULT_STALE_AGE_MS;
    try {
      const swept = await this.jobs.sweepStaleRunning(staleAgeMs);
      if (swept > 0) {
        this.logger.warn(
          `Swept ${swept} stale RUNNING llm_rerank_jobs row(s) older than ${staleAgeMs}ms on startup`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Stale-row sweep failed (non-fatal): ${(err as Error).message}`,
      );
    }

    this.worker = createWorker<LlmRerankJobData>(
      LLM_RERANK_QUEUE,
      this.connection,
      (job) => this.process(job),
      { prefix },
    );

    this.logger.log('LlmRerankProcessor worker started');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('LlmRerankProcessor worker closed');
    }
  }

  private async process(
    job: Job<LlmRerankJobData>,
  ): Promise<LlmRerankJobResult> {
    const {
      rerankJobId,
      userId,
      rankingFlags,
      interestTags,
      candidateLimit,
      ttlMs,
    } = job.data;

    await this.jobs.markRunning(rerankJobId, job.id ?? '');

    try {
      const input: PersonalizationInputDto = {
        interestTags,
        flags: this.inflateFlags(rankingFlags),
      };
      const summary = await this.rerank.rerankForUser(userId, input, {
        candidateLimit,
        ttlMs,
      });
      const result: LlmRerankJobResult = {
        userId: summary.userId,
        candidatesConsidered: summary.candidatesConsidered,
        cacheWritesWithExplanation: summary.cacheWritesWithExplanation,
        cacheWritesWithoutExplanation: summary.cacheWritesWithoutExplanation,
        llmFailures: summary.llmFailures,
        validatorRejections: summary.validatorRejections,
        budgetExhausted: summary.budgetExhausted,
        totalTokens: summary.totalTokens,
      };
      await this.jobs.markSucceeded(rerankJobId, result);
      return result;
    } catch (err) {
      // Only mark the lifecycle row FAILED on the LAST attempt — BullMQ
      // will retry transient failures, and flipping the row to FAILED
      // mid-retry causes polling clients to briefly see a FAILED state
      // for a job that ultimately succeeds. Matches RegionSyncProcessor
      // and StructuralAnalysisProcessor.
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (isLastAttempt) {
        await this.jobs.markFailed(rerankJobId, (err as Error).message);
      }
      this.logger.error(
        {
          queue: LLM_RERANK_QUEUE,
          jobId: job.id,
          rerankJobId,
          attempt: job.attemptsMade + 1,
          isLastAttempt,
        },
        `LLM-rerank job failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Convert the TRUE-only flag-name list (carried on the job) back into
   * the full 20-boolean `RankingFlagsInputDto` the scoring + LLM
   * pipeline expects. Missing flags default to false — matches the
   * default-deny posture in `RankingFlagsService.getFlagsForUser`.
   */
  private inflateFlags(trueOnly: string[]): PersonalizationInputDto['flags'] {
    const trueSet = new Set(trueOnly);
    return {
      isRenter: trueSet.has('isRenter'),
      isHomeowner: trueSet.has('isHomeowner'),
      isParent: trueSet.has('isParent'),
      isCaregiver: trueSet.has('isCaregiver'),
      isStudent: trueSet.has('isStudent'),
      isEducator: trueSet.has('isEducator'),
      isWorker: trueSet.has('isWorker'),
      isBusinessOwner: trueSet.has('isBusinessOwner'),
      isUnionMember: trueSet.has('isUnionMember'),
      isGigWorker: trueSet.has('isGigWorker'),
      isTransitRider: trueSet.has('isTransitRider'),
      isDriver: trueSet.has('isDriver'),
      hasSpecialLicense: trueSet.has('hasSpecialLicense'),
      hasImmigrationConcern: trueSet.has('hasImmigrationConcern'),
      hasHealthCondition: trueSet.has('hasHealthCondition'),
      hasPublicHealthInsurance: trueSet.has('hasPublicHealthInsurance'),
      isVeteran: trueSet.has('isVeteran'),
      hasJusticeInvolvement: trueSet.has('hasJusticeInvolvement'),
      isLowIncome: trueSet.has('isLowIncome'),
      receivesPublicBenefits: trueSet.has('receivesPublicBenefits'),
    };
  }
}
