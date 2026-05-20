/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { RegionSyncProcessor } from './region-sync.processor';
import { RegionDomainService } from 'src/apps/region/src/domains/region.service';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';
import { QUEUE_CONNECTION, createWorker } from '@opuspopuli/queue-provider';
import { DataType } from '@opuspopuli/region-provider';

jest.mock('@opuspopuli/queue-provider', () => ({
  ...jest.requireActual('@opuspopuli/queue-provider'),
  createWorker: jest.fn().mockReturnValue({
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  }),
}));

describe('RegionSyncProcessor', () => {
  let processor: RegionSyncProcessor;
  let regionService: jest.Mocked<RegionDomainService>;
  let pipelineJobService: jest.Mocked<PipelineJobService>;

  const mockSyncResults = [
    {
      regionId: 'california',
      dataType: DataType.PROPOSITIONS,
      itemsProcessed: 10,
      itemsCreated: 5,
      itemsUpdated: 5,
      itemsSkipped: 0,
      errors: [],
      syncedAt: new Date(),
    },
  ];

  function buildJob(overrides: Partial<Job> = {}): Job<any> {
    return {
      id: 'job-123',
      data: {
        pipelineJobId: 'pipeline-uuid-1',
        triggerSource: 'manual',
        regionId: undefined,
        dataTypes: undefined,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
      ...overrides,
    } as unknown as Job<any>;
  }

  beforeEach(async () => {
    const mockConnection = { quit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionSyncProcessor,
        {
          provide: RegionDomainService,
          useValue: createMock<RegionDomainService>(),
        },
        {
          provide: PipelineJobService,
          useValue: createMock<PipelineJobService>(),
        },
        { provide: QUEUE_CONNECTION, useValue: mockConnection },
        { provide: ConfigService, useValue: createMock<ConfigService>() },
      ],
    }).compile();

    processor = module.get<RegionSyncProcessor>(RegionSyncProcessor);
    regionService = module.get(RegionDomainService);
    pipelineJobService = module.get(PipelineJobService);

    regionService.syncAll.mockResolvedValue(mockSyncResults);
    pipelineJobService.markRunning.mockResolvedValue(undefined);
    pipelineJobService.markSucceeded.mockResolvedValue(undefined);
    pipelineJobService.markFailed.mockResolvedValue(undefined);
  });

  it('is defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process (via onApplicationBootstrap + private process)', () => {
    function getHandler() {
      return (createWorker as jest.Mock).mock.calls.at(-1)[2];
    }

    it('marks job running then succeeded on success', async () => {
      processor.onApplicationBootstrap();

      await getHandler()(buildJob());

      expect(pipelineJobService.markRunning).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        'job-123',
      );
      expect(pipelineJobService.markSucceeded).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        expect.any(Array),
      );
      expect(pipelineJobService.markFailed).not.toHaveBeenCalled();
    });

    it('marks job failed on final failure (retries exhausted)', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Scrape failed'));
      processor.onApplicationBootstrap();
      const job = buildJob({ attemptsMade: 2, opts: { attempts: 3 } } as any);

      await expect(getHandler()(job)).rejects.toThrow('Scrape failed');

      expect(pipelineJobService.markFailed).toHaveBeenCalledWith(
        'pipeline-uuid-1',
        'Scrape failed',
      );
    });

    it('does not mark failed on intermediate retry', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Transient'));
      processor.onApplicationBootstrap();
      const job = buildJob({ attemptsMade: 0, opts: { attempts: 3 } } as any);

      await expect(getHandler()(job)).rejects.toThrow('Transient');

      expect(pipelineJobService.markFailed).not.toHaveBeenCalled();
    });
  });
});
