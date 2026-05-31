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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
});
