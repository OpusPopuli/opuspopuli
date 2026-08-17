import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
  Field,
  ID,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import {
  QueueService,
  LLM_RERANK_QUEUE,
  TRIGGER_SOURCE,
  type LlmRerankJobData,
} from '@opuspopuli/queue-provider';
import {
  type GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { PersonalizationInputDto } from './dto/personalization-input.dto';
import { PersonalizedBillResultModel } from './models/personalized-bill-result.model';
import { LlmRerankJobModel } from './models/llm-rerank-job.model';
import {
  FEED_DEFAULT_LIMIT,
  PersonalizedFeedService,
} from './personalized-feed.service';
import { LlmRerankJobService } from './llm-rerank-job.service';
import { toTrueFlagNames } from './personalized-feed.utils';

/** Cap on `myRecentLlmRerankJobs` to prevent unbounded scans. */
const RECENT_JOBS_DEFAULT = 20;
const RECENT_JOBS_MAX = 100;

/**
 * Receipt returned from `triggerMyLlmRerank` — the mutation enqueues a
 * BullMQ job for the `llm-rerank-worker` to process; the worker writes
 * progress + the per-user summary onto the `llm_rerank_jobs` row keyed
 * by `jobId`. Use `myLlmRerankJob(jobId)` or `myRecentLlmRerankJobs` to
 * poll status.
 */
@ObjectType('LlmRerankEnqueueReceipt')
class LlmRerankEnqueueReceiptModel {
  @Field(() => ID)
  jobId!: string;
  @Field()
  status!: string;
  /** Which entity this job reranks — bill | proposition | representative | committee. */
  @Field()
  entityType!: string;
}

/**
 * Every entity type a rerank covers.
 *
 * Ordered with `bill` first only so the fastest-resolving job starts first;
 * they run independently.
 */
const RERANK_ENTITY_TYPES = [
  'bill',
  'proposition',
  'representative',
  'committee',
] as const;

/**
 * v1.0 personalized bill feed. Frontend pre-fetches
 * `myRankingFlags` + `mySignalProfile { interestTags }` from the users
 * service in one query, then passes them as input here. See planning
 * doc §6.3 for why the boundary is shaped this way.
 *
 * `limit` defaults to 5 (the planning-doc / civic-engagement-research
 * sweet spot for sustained attention) and is hard-capped at 20 — beyond
 * that this stops being a "personalized briefing" and becomes a list.
 *
 * Issues #743, #745.
 */
@Resolver()
@UseGuards(AuthGuard)
export class PersonalizedFeedResolver {
  constructor(
    private readonly feed: PersonalizedFeedService,
    private readonly queueService: QueueService,
    private readonly jobs: LlmRerankJobService,
  ) {}

  @Query(() => [PersonalizedBillResultModel], {
    name: 'myPersonalizedBillFeed',
  })
  async getMyPersonalizedBillFeed(
    @Args('input') input: PersonalizationInputDto,
    @Args('limit', { type: () => Int, nullable: true })
    limit: number | undefined,
    @Context() context: GqlContext,
  ): Promise<PersonalizedBillResultModel[]> {
    const user = getUserFromContext(context);
    return this.feed.getFeedForUser(
      user.id,
      input,
      limit ?? FEED_DEFAULT_LIMIT,
    );
  }

  /**
   * On-demand re-rank for the authenticated user (#745). Enqueues one
   * `llm-rerank` BullMQ job per entity type — bills, propositions,
   * representatives and committees — and returns a receipt for each.
   * Poll any of them with `myLlmRerankJob(jobId)`.
   *
   * Synchronous trigger pattern was a v0 sketch — moved off the
   * GraphQL request thread per the worker architecture (CLAUDE.md
   * `apps/backend/src/apps/workers/`).
   *
   * Users can only enqueue jobs for their own feed (the auth guard
   * resolves `user.id` from the request context).
   */
  @Mutation(() => [LlmRerankEnqueueReceiptModel], {
    name: 'triggerMyLlmRerank',
  })
  async triggerMyLlmRerank(
    @Args('input') input: PersonalizationInputDto,
    @Args('candidateLimit', { type: () => Int, nullable: true })
    candidateLimit: number | undefined,
    @Context() context: GqlContext,
  ): Promise<LlmRerankEnqueueReceiptModel[]> {
    const user = getUserFromContext(context);

    const trueFlags = toTrueFlagNames(input.flags);
    const enqueuedAt = Date.now();

    // One job per entity type, because "rerank my stuff" should mean all of
    // it. This used to enqueue a single job with no entityType, which the
    // processor defaulted to 'bill' — so a user who triggered a rerank got
    // their bills refreshed and nothing else, and the committees,
    // propositions and representatives on their briefing stayed stale until
    // the 03:00 cron. There was no error and no indication of the gap.
    //
    // Candidates are deliberately NOT resolved here: representative and
    // legislativeCommittee are region-owned tables, and this service reaching
    // into them would cross a bounded context (CLAUDE.md, Architecture
    // rules). The worker resolves them on arrival instead.
    const receipts = await Promise.all(
      RERANK_ENTITY_TYPES.map(async (entityType) => {
        // Entity type is part of the id so the four jobs cannot collide in
        // BullMQ's dedup, which keys on jobId.
        const bullmqJobId = `manual-${entityType}-${user.id}-${enqueuedAt}`;
        const row = await this.jobs.create({
          bullmqJobId,
          triggerSource: TRIGGER_SOURCE.MANUAL,
          userId: user.id,
          candidateLimit,
        });

        const data: LlmRerankJobData = {
          rerankJobId: row.id,
          triggerSource: TRIGGER_SOURCE.MANUAL,
          userId: user.id,
          rankingFlags: trueFlags,
          interestTags: [...input.interestTags],
          entityType,
          ...(candidateLimit !== undefined ? { candidateLimit } : {}),
        };
        await this.queueService.enqueue<LlmRerankJobData>(
          LLM_RERANK_QUEUE,
          data,
          { jobId: bullmqJobId },
        );

        return { jobId: row.id, status: 'queued', entityType };
      }),
    );

    return receipts;
  }

  /**
   * Poll a specific rerank-job lifecycle row by id. Scoped to the
   * authenticated user — returns null if the row exists but was
   * enqueued for someone else, so an unauthorized client can't probe
   * the UUID space to learn other users' job ids.
   */
  @Query(() => LlmRerankJobModel, {
    name: 'myLlmRerankJob',
    nullable: true,
  })
  async myLlmRerankJob(
    @Args('jobId', { type: () => ID }) jobId: string,
    @Context() context: GqlContext,
  ): Promise<LlmRerankJobModel | null> {
    const user = getUserFromContext(context);
    return this.jobs.findByIdForUser(jobId, user.id);
  }

  /**
   * List the authenticated user's most-recent rerank jobs. Backs the
   * citizen-facing "what's been recomputed for me?" surface; admin
   * cross-user observability is a follow-up.
   */
  @Query(() => [LlmRerankJobModel], { name: 'myRecentLlmRerankJobs' })
  async myRecentLlmRerankJobs(
    @Args('limit', { type: () => Int, nullable: true })
    limit: number | undefined,
    @Context() context: GqlContext,
  ): Promise<LlmRerankJobModel[]> {
    const user = getUserFromContext(context);
    const safeLimit = Math.min(limit ?? RECENT_JOBS_DEFAULT, RECENT_JOBS_MAX);
    return this.jobs.findRecentForUser(user.id, safeLimit);
  }
}
