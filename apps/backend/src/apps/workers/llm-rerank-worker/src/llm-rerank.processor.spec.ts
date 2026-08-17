/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { LlmRerankProcessor } from './llm-rerank.processor';
import { LlmRerankService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank.service';
import { LlmRerankJobService } from 'src/apps/knowledge/src/domains/personalized-feed/llm-rerank-job.service';
import {
  QUEUE_CONNECTION,
  createWorker,
  TRIGGER_SOURCE,
} from '@opuspopuli/queue-provider';
import { RerankCandidatesService } from './rerank-candidates.service';

jest.mock('@opuspopuli/queue-provider', () => ({
  ...jest.requireActual('@opuspopuli/queue-provider'),
  createWorker: jest.fn().mockReturnValue({
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  }),
}));

describe('LlmRerankProcessor', () => {
  let processor: LlmRerankProcessor;
  let rerank: jest.Mocked<LlmRerankService>;
  let jobs: jest.Mocked<LlmRerankJobService>;

  const sampleSummary = {
    userId: 'u-1',
    candidatesConsidered: 5,
    cacheWritesWithExplanation: 4,
    cacheWritesWithoutExplanation: 1,
    llmFailures: 0,
    validatorRejections: 0,
    budgetExhausted: false,
    totalTokens: 320,
  };

  // Shared so individual tests can set return values; reset in beforeEach.
  const candidatesMock = {
    fetchPropositionCandidateIds: jest.fn(),
    fetchRepresentativeCandidateIds: jest.fn(),
    fetchCommitteeCandidates: jest.fn(),
  };

  /** Job data with an entityType, for the non-bill paths. */
  function jobFor(entityType: string, extra: Record<string, unknown> = {}) {
    return buildJob({
      data: {
        rerankJobId: 'row-1',
        triggerSource: TRIGGER_SOURCE.MANUAL,
        userId: 'u-1',
        rankingFlags: ['isRenter', 'isWorker'],
        interestTags: ['housing'],
        entityType,
        ...extra,
      },
    } as unknown as Partial<Job>);
  }

  function buildJob(overrides: Partial<Job> = {}): Job<any> {
    return {
      id: 'bullmq-1',
      data: {
        rerankJobId: 'row-1',
        triggerSource: TRIGGER_SOURCE.MANUAL,
        userId: 'u-1',
        rankingFlags: ['isRenter', 'isWorker'],
        interestTags: ['housing'],
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
      ...overrides,
    } as unknown as Job<any>;
  }

  beforeEach(async () => {
    Object.values(candidatesMock).forEach((m) => m.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          // Candidate resolution is exercised in rerank-candidates.service
          // and in the "resolves candidates" cases below; here it only has
          // to satisfy the constructor.
          provide: RerankCandidatesService,
          useValue: candidatesMock,
        },
        LlmRerankProcessor,
        { provide: LlmRerankService, useValue: createMock<LlmRerankService>() },
        {
          provide: LlmRerankJobService,
          useValue: createMock<LlmRerankJobService>(),
        },
        { provide: QUEUE_CONNECTION, useValue: { quit: jest.fn() } },
        { provide: ConfigService, useValue: createMock<ConfigService>() },
      ],
    }).compile();

    processor = module.get(LlmRerankProcessor);
    rerank = module.get(LlmRerankService);
    jobs = module.get(LlmRerankJobService);

    rerank.rerankForUser.mockResolvedValue(sampleSummary);
    jobs.markRunning.mockResolvedValue(undefined);
    jobs.markSucceeded.mockResolvedValue(undefined);
    jobs.markFailed.mockResolvedValue(undefined);
    jobs.sweepStaleRunning.mockResolvedValue(0);

    const configMock = module.get<jest.Mocked<ConfigService>>(ConfigService);
    configMock.get.mockReturnValue('600000');
  });

  function getHandler() {
    return (createWorker as jest.Mock).mock.calls.at(-1)[2];
  }

  it('sweeps stale RUNNING rows + starts the BullMQ worker on bootstrap', async () => {
    jobs.sweepStaleRunning.mockResolvedValue(2);

    await processor.onApplicationBootstrap();

    expect(jobs.sweepStaleRunning).toHaveBeenCalledWith(600_000);
    expect(createWorker).toHaveBeenCalled();
  });

  it('on success: marks running, calls rerank, marks succeeded with the summary', async () => {
    await processor.onApplicationBootstrap();
    const result = await getHandler()(buildJob());

    expect(jobs.markRunning).toHaveBeenCalledWith('row-1', 'bullmq-1');
    expect(rerank.rerankForUser).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ interestTags: ['housing'] }),
      expect.any(Object),
    );
    expect(jobs.markSucceeded).toHaveBeenCalledWith(
      'row-1',
      expect.objectContaining({ totalTokens: 320 }),
    );
    expect(result).toMatchObject({ totalTokens: 320 });
  });

  it('inflates the TRUE-only rankingFlags array back into the full 20-boolean DTO', async () => {
    await processor.onApplicationBootstrap();
    await getHandler()(buildJob());

    const callArgs = rerank.rerankForUser.mock.calls[0][1];
    expect(callArgs.flags.isRenter).toBe(true);
    expect(callArgs.flags.isWorker).toBe(true);
    expect(callArgs.flags.isHomeowner).toBe(false);
    expect(callArgs.flags.isVeteran).toBe(false);
    // Every key in the 20-flag taxonomy must be present so downstream
    // strict-typed reads don't blow up on missing properties.
    expect(Object.keys(callArgs.flags).length).toBeGreaterThanOrEqual(20);
  });

  it('B1 regression: on a NON-last failed attempt, does NOT mark the row FAILED', async () => {
    rerank.rerankForUser.mockRejectedValueOnce(new Error('transient'));

    await processor.onApplicationBootstrap();
    await expect(
      getHandler()(buildJob({ attemptsMade: 0, opts: { attempts: 3 } } as any)),
    ).rejects.toThrow('transient');

    expect(jobs.markFailed).not.toHaveBeenCalled();
  });

  it('on a final-attempt failure, marks the row FAILED with the error message', async () => {
    rerank.rerankForUser.mockRejectedValueOnce(new Error('permanent'));

    await processor.onApplicationBootstrap();
    await expect(
      getHandler()(buildJob({ attemptsMade: 2, opts: { attempts: 3 } } as any)),
    ).rejects.toThrow('permanent');

    expect(jobs.markFailed).toHaveBeenCalledWith('row-1', 'permanent');
  });

  it('closes the worker on module destroy', async () => {
    await processor.onApplicationBootstrap();
    await processor.onModuleDestroy();

    const workerInstance = (createWorker as jest.Mock).mock.results.at(
      -1,
    )?.value;
    expect(workerInstance.close).toHaveBeenCalled();
  });
  describe('a run where every candidate failed is not a success', () => {
    /*
     * markSucceeded used to be unconditional. While prompt-service was
     * unreachable the 03:00 cron recorded `llmFailures: 85,
     * candidatesConsidered: 85, cacheWritesWithExplanation: 0` and finished as
     * `succeeded` — every night for ten days. Nothing alerted, nothing
     * retried, and the first symptom anyone saw was a briefing section
     * rendering zero items.
     */
    const totalFailure = {
      ...sampleSummary,
      candidatesConsidered: 85,
      cacheWritesWithExplanation: 0,
      cacheWritesWithoutExplanation: 85,
      llmFailures: 85,
      totalTokens: 0,
    };

    it('fails the job instead of recording success', async () => {
      rerank.rerankForUser.mockResolvedValue(totalFailure);
      await processor.onApplicationBootstrap();

      await expect(getHandler()(buildJob())).rejects.toThrow(
        /produced no explanations/,
      );
      expect(jobs.markSucceeded).not.toHaveBeenCalled();
    });

    it('names prompt-service in the error, since that is the usual cause', async () => {
      rerank.rerankForUser.mockResolvedValue(totalFailure);
      await processor.onApplicationBootstrap();

      await expect(getHandler()(buildJob())).rejects.toThrow(
        /PROMPT_SERVICE_URL/,
      );
    });

    it('still succeeds on PARTIAL success', async () => {
      // One explanation out of many is a working pipeline, not an outage.
      rerank.rerankForUser.mockResolvedValue({
        ...totalFailure,
        cacheWritesWithExplanation: 1,
        llmFailures: 84,
      });
      await processor.onApplicationBootstrap();

      await getHandler()(buildJob());
      expect(jobs.markSucceeded).toHaveBeenCalled();
    });

    it('still succeeds when there was nothing to consider', async () => {
      rerank.rerankForUser.mockResolvedValue({
        ...sampleSummary,
        candidatesConsidered: 0,
        cacheWritesWithExplanation: 0,
        cacheWritesWithoutExplanation: 0,
        llmFailures: 0,
      });
      await processor.onApplicationBootstrap();

      await getHandler()(buildJob());
      expect(jobs.markSucceeded).toHaveBeenCalled();
    });

    it('still succeeds when the budget was deliberately exhausted', async () => {
      // A deliberate stop must not look like an infrastructure failure.
      rerank.rerankForUser.mockResolvedValue({
        ...totalFailure,
        budgetExhausted: true,
      });
      await processor.onApplicationBootstrap();

      await getHandler()(buildJob());
      expect(jobs.markSucceeded).toHaveBeenCalled();
    });
  });
  describe('resolves candidates the enqueuer did not supply', () => {
    /*
     * The nightly cron resolves candidates up front and fans them out, so its
     * jobs carry a payload. The manual trigger cannot -- representative and
     * legislativeCommittee are region-owned tables the knowledge service must
     * not read -- so it enqueues without one and the worker fills it in here.
     *
     * Before this, a job arriving without candidates reranked against an
     * EMPTY set, silently doing nothing. That is why triggering a rerank
     * refreshed bills (the one type that resolves its own candidates) and
     * left committees, propositions and representatives stale until 03:00.
     */
    beforeEach(() => {
      candidatesMock.fetchPropositionCandidateIds.mockResolvedValue([
        'p-1',
        'p-2',
      ]);
      candidatesMock.fetchRepresentativeCandidateIds.mockResolvedValue(['r-1']);
      candidatesMock.fetchCommitteeCandidates.mockResolvedValue([
        { legislativeCommitteeId: 'c-1', membersOnUserSlate: [] },
      ]);
      // The service is auto-mocked, so the non-bill methods return mock
      // objects unless told otherwise — and the processor reads numbers off
      // the summary to decide whether the run failed.
      rerank.rerankPropositionsForUser.mockResolvedValue(sampleSummary);
      rerank.rerankRepresentativesForUser.mockResolvedValue(sampleSummary);
      rerank.rerankCommitteesForUser.mockResolvedValue(sampleSummary);
    });

    it('fetches proposition candidates when none were supplied', async () => {
      await processor.onApplicationBootstrap();
      await getHandler()(jobFor('proposition'));

      expect(candidatesMock.fetchPropositionCandidateIds).toHaveBeenCalled();
      expect(rerank.rerankPropositionsForUser).toHaveBeenCalledWith(
        'u-1',
        expect.any(Object),
        ['p-1', 'p-2'],
        expect.any(Object),
      );
    });

    it('fetches committee candidates when none were supplied', async () => {
      await processor.onApplicationBootstrap();
      await getHandler()(jobFor('committee'));

      expect(candidatesMock.fetchCommitteeCandidates).toHaveBeenCalled();
    });

    it('does NOT override candidates the cron supplied', async () => {
      await processor.onApplicationBootstrap();
      await getHandler()(jobFor('proposition', { candidateIds: ['from-cron'] }));

      // A supplied payload wins, including a deliberately empty one -- the
      // cron skips fan-out when a set is empty, so anything it sends is the
      // answer, not a gap to fill.
      expect(candidatesMock.fetchPropositionCandidateIds).not.toHaveBeenCalled();
      expect(rerank.rerankPropositionsForUser).toHaveBeenCalledWith(
        'u-1',
        expect.any(Object),
        ['from-cron'],
        expect.any(Object),
      );
    });

    it('does not fetch anything for bills, which resolve their own', async () => {
      await processor.onApplicationBootstrap();
      await getHandler()(buildJob());

      expect(candidatesMock.fetchPropositionCandidateIds).not.toHaveBeenCalled();
      expect(
        candidatesMock.fetchRepresentativeCandidateIds,
      ).not.toHaveBeenCalled();
      expect(candidatesMock.fetchCommitteeCandidates).not.toHaveBeenCalled();
    });
  });
});
