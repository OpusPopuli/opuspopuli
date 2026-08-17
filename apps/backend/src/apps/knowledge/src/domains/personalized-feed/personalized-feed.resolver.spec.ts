import { Test, TestingModule } from '@nestjs/testing';
import {
  LLM_RERANK_QUEUE,
  QueueService,
  TRIGGER_SOURCE,
} from '@opuspopuli/queue-provider';
import { PersonalizedFeedResolver } from './personalized-feed.resolver';
import {
  FEED_DEFAULT_LIMIT,
  PersonalizedFeedService,
} from './personalized-feed.service';
import { LlmRerankJobService } from './llm-rerank-job.service';
import type { GqlContext } from 'src/common/utils/graphql-context';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';

/**
 * Resolver-layer tests verify the auth-context routing and the
 * limit-default branch — i.e. the contract surface a future refactor
 * could quietly break. The service is fully mocked; its own logic is
 * exhaustively covered in personalized-feed.service.spec.
 */
describe('PersonalizedFeedResolver', () => {
  let resolver: PersonalizedFeedResolver;
  let feed: jest.Mocked<PersonalizedFeedService>;
  let queueService: jest.Mocked<QueueService>;
  let jobs: jest.Mocked<LlmRerankJobService>;

  const ctx = (userId: string): GqlContext =>
    ({ req: { user: { id: userId } } }) as unknown as GqlContext;

  const FLAGS_OFF: PersonalizationInputDto['flags'] = {
    isRenter: false,
    isHomeowner: false,
    isParent: false,
    isCaregiver: false,
    isStudent: false,
    isEducator: false,
    isWorker: false,
    isBusinessOwner: false,
    isUnionMember: false,
    isGigWorker: false,
    isTransitRider: false,
    isDriver: false,
    hasSpecialLicense: false,
    hasImmigrationConcern: false,
    hasHealthCondition: false,
    hasPublicHealthInsurance: false,
    isVeteran: false,
    hasJusticeInvolvement: false,
    isLowIncome: false,
    receivesPublicBenefits: false,
  };

  beforeEach(async () => {
    feed = {
      getFeedForUser: jest.fn(),
    } as unknown as jest.Mocked<PersonalizedFeedService>;
    queueService = {
      enqueue: jest.fn().mockResolvedValue('bullmq-jobid'),
    } as unknown as jest.Mocked<QueueService>;
    jobs = {
      create: jest.fn().mockResolvedValue({ id: 'job-row-1' }),
      findByIdForUser: jest.fn(),
      findRecentForUser: jest.fn(),
    } as unknown as jest.Mocked<LlmRerankJobService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalizedFeedResolver,
        { provide: PersonalizedFeedService, useValue: feed },
        { provide: QueueService, useValue: queueService },
        { provide: LlmRerankJobService, useValue: jobs },
      ],
    }).compile();
    resolver = module.get(PersonalizedFeedResolver);
  });

  it('forwards the authenticated userId, input, and limit to the service', async () => {
    feed.getFeedForUser.mockResolvedValue([] as never);

    const input = {
      interestTags: ['housing'],
      flags: { ...FLAGS_OFF, isRenter: true },
    };
    await resolver.getMyPersonalizedBillFeed(input, 10, ctx('u-1'));

    expect(feed.getFeedForUser).toHaveBeenCalledWith('u-1', input, 10);
  });

  it('applies FEED_DEFAULT_LIMIT when caller omits the limit arg', async () => {
    feed.getFeedForUser.mockResolvedValue([] as never);

    const input = { interestTags: [], flags: FLAGS_OFF };
    await resolver.getMyPersonalizedBillFeed(input, undefined, ctx('u-1'));

    expect(feed.getFeedForUser).toHaveBeenCalledWith(
      'u-1',
      input,
      FEED_DEFAULT_LIMIT,
    );
  });

  it('returns the service result unchanged', async () => {
    const result = [
      {
        billId: 'b-1',
        relevanceScore: 0.85,
        axisScores: {
          directMaterial: 0.6,
          valuesAlignment: 1.0,
          actionability: 0.5,
          indirectMaterial: 0,
          coalitionSignal: 0,
          counterfactual: 0,
          noveltyRepetition: 0,
        },
      },
    ];
    feed.getFeedForUser.mockResolvedValue(result as never);

    const out = await resolver.getMyPersonalizedBillFeed(
      { interestTags: [], flags: FLAGS_OFF },
      5,
      ctx('u-1'),
    );
    expect(out).toBe(result);
  });

  describe('triggerMyLlmRerank (#745)', () => {
    it('enqueues one job per entity type, so "rerank my stuff" means all of it', async () => {
      const input = {
        interestTags: ['housing'],
        flags: { ...FLAGS_OFF, isRenter: true },
      };

      const out = await resolver.triggerMyLlmRerank(input, 10, ctx('u-1'));

      // Bills, propositions, representatives, committees. This used to
      // enqueue ONE job with no entityType, which the processor defaulted to
      // 'bill' -- so a user who triggered a rerank got their bills refreshed
      // and the rest of their briefing stayed stale until the 03:00 cron,
      // with nothing to indicate the gap.
      expect(queueService.enqueue).toHaveBeenCalledTimes(4);
      expect(out).toHaveLength(4);
      expect(out.map((r) => r.entityType).sort()).toEqual([
        'bill',
        'committee',
        'proposition',
        'representative',
      ]);
      expect(out.every((r) => r.status === 'queued')).toBe(true);
    });

    it('gives each job a distinct bullmqJobId so they cannot dedup away', async () => {
      await resolver.triggerMyLlmRerank(
        { interestTags: ['housing'], flags: FLAGS_OFF },
        10,
        ctx('u-1'),
      );

      // BullMQ dedups on jobId. Without the entityType in the id, four jobs
      // enqueued in the same millisecond would collapse into one.
      const ids = jobs.create.mock.calls.map((c) => c[0].bullmqJobId);
      expect(new Set(ids).size).toBe(4);
      ids.forEach((id) =>
        expect(id).toMatch(
          /^manual-(bill|proposition|representative|committee)-u-1-\d+$/,
        ),
      );
    });

    it('carries the entityType into the job data', async () => {
      await resolver.triggerMyLlmRerank(
        { interestTags: ['housing'], flags: { ...FLAGS_OFF, isRenter: true } },
        10,
        ctx('u-1'),
      );

      const types = queueService.enqueue.mock.calls
        .map((c) => (c[1] as Record<string, unknown>).entityType)
        .sort();
      expect(types).toEqual([
        'bill',
        'committee',
        'proposition',
        'representative',
      ]);

      // Everything else is identical across the four.
      queueService.enqueue.mock.calls.forEach((c) => {
        expect(c[0]).toBe(LLM_RERANK_QUEUE);
        const data = c[1] as Record<string, unknown>;
        expect(data.triggerSource).toBe(TRIGGER_SOURCE.MANUAL);
        expect(data.userId).toBe('u-1');
        expect(data.rankingFlags).toEqual(['isRenter']);
        expect(data.interestTags).toEqual(['housing']);
        expect(data.candidateLimit).toBe(10);
      });
    });

    it('omits candidateLimit from the job data when the caller omits it (worker applies its own default)', async () => {
      await resolver.triggerMyLlmRerank(
        { interestTags: [], flags: FLAGS_OFF },
        undefined,
        ctx('u-2'),
      );

      expect(jobs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-2',
          candidateLimit: undefined,
        }),
      );
      const data = queueService.enqueue.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('candidateLimit');
      expect(data.rankingFlags).toEqual([]);
      expect(data.interestTags).toEqual([]);
    });
  });

  describe('myLlmRerankJob (#745)', () => {
    it('looks up the job by id scoped to the authenticated user', async () => {
      const row = { jobId: 'job-1' } as never;
      jobs.findByIdForUser.mockResolvedValue(row);

      const out = await resolver.myLlmRerankJob('job-1', ctx('u-1'));

      expect(jobs.findByIdForUser).toHaveBeenCalledWith('job-1', 'u-1');
      expect(out).toBe(row);
    });

    it('returns null when the row belongs to a different user', async () => {
      jobs.findByIdForUser.mockResolvedValue(null);

      const out = await resolver.myLlmRerankJob('job-999', ctx('u-1'));

      expect(jobs.findByIdForUser).toHaveBeenCalledWith('job-999', 'u-1');
      expect(out).toBeNull();
    });
  });

  describe('myRecentLlmRerankJobs (#745)', () => {
    it('forwards the authenticated userId and explicit limit', async () => {
      jobs.findRecentForUser.mockResolvedValue([]);

      await resolver.myRecentLlmRerankJobs(5, ctx('u-1'));

      expect(jobs.findRecentForUser).toHaveBeenCalledWith('u-1', 5);
    });

    it('applies the default limit when caller omits it', async () => {
      jobs.findRecentForUser.mockResolvedValue([]);

      await resolver.myRecentLlmRerankJobs(undefined, ctx('u-1'));

      expect(jobs.findRecentForUser).toHaveBeenCalledWith('u-1', 20);
    });

    it('clamps requests above the safety cap', async () => {
      jobs.findRecentForUser.mockResolvedValue([]);

      await resolver.myRecentLlmRerankJobs(500, ctx('u-1'));

      expect(jobs.findRecentForUser).toHaveBeenCalledWith('u-1', 100);
    });
  });
});
