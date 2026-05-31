import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { JOB_STATUS, TRIGGER_SOURCE } from '@opuspopuli/queue-provider';
import { LlmRerankJobService } from './llm-rerank-job.service';
import {
  LlmRerankJobStatus,
  LlmRerankTriggerSource,
} from './models/llm-rerank-job.model';

/**
 * Direct unit coverage for LlmRerankJobService. The resolver spec mocks
 * this service, so without this file the lifecycle invariants the worker
 * relies on (idempotent create, SUCCEEDED-state guards, stale-row sweep,
 * user-scoped reads) have no dedicated regression net.
 */
describe('LlmRerankJobService', () => {
  let service: LlmRerankJobService;
  let prisma: {
    llmRerankJob: {
      upsert: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      llmRerankJob: {
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmRerankJobService,
        { provide: DbService, useValue: prisma },
      ],
    }).compile();
    service = module.get(LlmRerankJobService);
  });

  describe('create (idempotent on bullmqJobId)', () => {
    it('upserts on the unique bullmqJobId so concurrent replicas converge on one row', async () => {
      prisma.llmRerankJob.upsert.mockResolvedValue({ id: 'row-1' });

      const out = await service.create({
        bullmqJobId: 'cron-u-1-20260530',
        triggerSource: TRIGGER_SOURCE.CRON,
        userId: 'u-1',
      });

      expect(prisma.llmRerankJob.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { bullmqJobId: 'cron-u-1-20260530' },
          update: {},
          create: expect.objectContaining({
            bullmqJobId: 'cron-u-1-20260530',
            triggerSource: TRIGGER_SOURCE.CRON,
            userId: 'u-1',
            status: JOB_STATUS.QUEUED,
            candidateLimit: null,
          }),
          select: { id: true },
        }),
      );
      expect(out).toEqual({ id: 'row-1' });
    });

    it('persists candidateLimit when provided', async () => {
      prisma.llmRerankJob.upsert.mockResolvedValue({ id: 'row-2' });

      await service.create({
        bullmqJobId: 'manual-u-2-1',
        triggerSource: TRIGGER_SOURCE.MANUAL,
        userId: 'u-2',
        candidateLimit: 5,
      });

      const args = prisma.llmRerankJob.upsert.mock.calls[0][0];
      expect(args.create.candidateLimit).toBe(5);
    });
  });

  describe('markRunning', () => {
    it('skips the update when the row is already SUCCEEDED', async () => {
      await service.markRunning('row-1', 'bullmq-1');

      const args = prisma.llmRerankJob.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({
        id: 'row-1',
        status: { not: JOB_STATUS.SUCCEEDED },
      });
      expect(args.data.status).toBe(JOB_STATUS.RUNNING);
      expect(args.data.attempts).toEqual({ increment: 1 });
    });
  });

  describe('markSucceeded — symmetric SUCCEEDED guard', () => {
    it('does not resurrect a SUCCEEDED row written by an earlier attempt', async () => {
      await service.markSucceeded('row-1', {
        userId: 'u-1',
        candidatesConsidered: 1,
        cacheWritesWithExplanation: 1,
        cacheWritesWithoutExplanation: 0,
        llmFailures: 0,
        validatorRejections: 0,
        budgetExhausted: false,
        totalTokens: 100,
      });

      const args = prisma.llmRerankJob.updateMany.mock.calls[0][0];
      expect(args.where.id).toBe('row-1');
      expect(args.where.status).toEqual({ not: JOB_STATUS.SUCCEEDED });
      expect(args.data.status).toBe(JOB_STATUS.SUCCEEDED);
      expect(args.data.finishedAt).toBeInstanceOf(Date);
    });
  });

  describe('markFailed — symmetric SUCCEEDED guard', () => {
    it('refuses to flip a SUCCEEDED row to FAILED on a slow retry', async () => {
      await service.markFailed('row-1', 'timeout');

      const args = prisma.llmRerankJob.updateMany.mock.calls[0][0];
      expect(args.where.id).toBe('row-1');
      expect(args.where.status).toEqual({ not: JOB_STATUS.SUCCEEDED });
      expect(args.data.status).toBe(JOB_STATUS.FAILED);
      expect(args.data.errorMessage).toBe('timeout');
    });
  });

  describe('sweepStaleRunning', () => {
    it('marks rows stuck in RUNNING older than maxAgeMs as FAILED and returns the count', async () => {
      prisma.llmRerankJob.updateMany.mockResolvedValue({ count: 3 });

      const swept = await service.sweepStaleRunning(60_000);

      const args = prisma.llmRerankJob.updateMany.mock.calls[0][0];
      expect(args.where.status).toBe(JOB_STATUS.RUNNING);
      expect(args.where.startedAt.lt).toBeInstanceOf(Date);
      expect(args.data.status).toBe(JOB_STATUS.FAILED);
      expect(args.data.errorMessage).toMatch(/Abandoned/i);
      expect(swept).toBe(3);
    });
  });

  describe('findByIdForUser — user-scoped read', () => {
    it('filters by userId so a foreign job id returns null', async () => {
      prisma.llmRerankJob.findFirst.mockResolvedValue(null);

      const out = await service.findByIdForUser('foreign-id', 'u-1');

      expect(prisma.llmRerankJob.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-id', userId: 'u-1' },
      });
      expect(out).toBeNull();
    });

    it('maps a found row into the GraphQL model with elapsedMs computed', async () => {
      const started = new Date('2026-05-30T12:00:00Z');
      const finished = new Date('2026-05-30T12:00:42Z');
      prisma.llmRerankJob.findFirst.mockResolvedValue({
        id: 'row-1',
        status: 'succeeded',
        triggerSource: 'manual',
        candidateLimit: 5,
        attempts: 1,
        enqueuedAt: started,
        startedAt: started,
        finishedAt: finished,
        errorMessage: null,
        result: {
          candidatesConsidered: 5,
          cacheWritesWithExplanation: 5,
          cacheWritesWithoutExplanation: 0,
          llmFailures: 0,
          validatorRejections: 0,
          budgetExhausted: false,
          totalTokens: 393,
        },
      });

      const out = await service.findByIdForUser('row-1', 'u-1');

      expect(out).not.toBeNull();
      expect(out!.jobId).toBe('row-1');
      expect(out!.status).toBe(LlmRerankJobStatus.SUCCEEDED);
      expect(out!.triggerSource).toBe(LlmRerankTriggerSource.MANUAL);
      expect(out!.candidateLimit).toBe(5);
      expect(out!.attempts).toBe(1);
      expect(out!.elapsedMs).toBe(42_000);
      expect(out!.result?.cacheWritesWithExplanation).toBe(5);
      expect(out!.result?.totalTokens).toBe(393);
    });
  });

  describe('findRecentForUser', () => {
    it('orders by enqueuedAt desc and applies the explicit limit', async () => {
      prisma.llmRerankJob.findMany.mockResolvedValue([]);

      await service.findRecentForUser('u-1', 7);

      expect(prisma.llmRerankJob.findMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        orderBy: { enqueuedAt: 'desc' },
        take: 7,
      });
    });
  });
});
