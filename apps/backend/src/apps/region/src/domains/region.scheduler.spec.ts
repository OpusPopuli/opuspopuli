import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';

import { RegionScheduler } from './region.scheduler';
import { PipelineJobService } from './pipeline-job.service';
import { QueueService, TRIGGER_SOURCE } from '@opuspopuli/queue-provider';

describe('RegionScheduler', () => {
  let scheduler: RegionScheduler;
  let queueService: jest.Mocked<QueueService>;
  let pipelineJobService: jest.Mocked<PipelineJobService>;

  const defaultEnv: Record<string, string> = {
    REGION_SYNC_ENABLED: 'true',
    REGION_SYNC_CRON_VIA_QUEUE: 'false',
    REGION_SYNC_RUN_ON_STARTUP: 'false',
  };

  function buildModule(envOverrides: Record<string, string> = {}) {
    const env = { ...defaultEnv, ...envOverrides };

    const mockQueueService = createMock<QueueService>();
    mockQueueService.enqueue.mockResolvedValue('mock-bullmq-id');

    const mockPipelineJobService = createMock<PipelineJobService>();
    mockPipelineJobService.create.mockResolvedValue({ id: 'mock-job-id' });

    const mockConfigService = createMock<ConfigService>();
    mockConfigService.get.mockImplementation((key: string) => env[key]);

    return Test.createTestingModule({
      providers: [
        RegionScheduler,
        { provide: QueueService, useValue: mockQueueService },
        { provide: PipelineJobService, useValue: mockPipelineJobService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
  }

  beforeEach(async () => {
    const module: TestingModule = await buildModule();
    scheduler = module.get<RegionScheduler>(RegionScheduler);
    queueService = module.get(QueueService);
    pipelineJobService = module.get(PipelineJobService);
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('does not enqueue by default (REGION_SYNC_RUN_ON_STARTUP defaults to false)', async () => {
      await scheduler.onModuleInit();
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues a startup job when REGION_SYNC_RUN_ON_STARTUP=true', async () => {
      const module = await buildModule({ REGION_SYNC_RUN_ON_STARTUP: 'true' });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const q = module.get(QueueService) as jest.Mocked<QueueService>;
      const p = module.get(
        PipelineJobService,
      ) as jest.Mocked<PipelineJobService>;

      await s.onModuleInit();

      expect(p.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerSource: TRIGGER_SOURCE.STARTUP }),
      );
      expect(q.enqueue).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ triggerSource: TRIGGER_SOURCE.STARTUP }),
        expect.any(Object),
      );
    });

    it('skips when syncCronViaQueue=true (worker owns startup)', async () => {
      const module = await buildModule({
        REGION_SYNC_RUN_ON_STARTUP: 'true',
        REGION_SYNC_CRON_VIA_QUEUE: 'true',
      });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const q = module.get(QueueService) as jest.Mocked<QueueService>;

      await s.onModuleInit();

      expect(q.enqueue).not.toHaveBeenCalled();
    });

    it('creates the DB record before enqueuing', async () => {
      const callOrder: string[] = [];
      const module = await buildModule({ REGION_SYNC_RUN_ON_STARTUP: 'true' });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const q = module.get(QueueService) as jest.Mocked<QueueService>;
      const p = module.get(
        PipelineJobService,
      ) as jest.Mocked<PipelineJobService>;

      p.create.mockImplementation(async (_input) => {
        callOrder.push('create');
        return { id: 'job-id' };
      });
      q.enqueue.mockImplementation(async () => {
        callOrder.push('enqueue');
        return 'bullmq-id';
      });

      await s.onModuleInit();

      expect(callOrder).toEqual(['create', 'enqueue']);
    });

    it('handles create failure gracefully on startup', async () => {
      const module = await buildModule({ REGION_SYNC_RUN_ON_STARTUP: 'true' });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const p = module.get(
        PipelineJobService,
      ) as jest.Mocked<PipelineJobService>;
      p.create.mockRejectedValue(new Error('DB unavailable'));

      await expect(s.onModuleInit()).resolves.not.toThrow();
    });

    it('handles enqueue errors gracefully on startup', async () => {
      const module = await buildModule({ REGION_SYNC_RUN_ON_STARTUP: 'true' });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const q = module.get(QueueService) as jest.Mocked<QueueService>;
      q.enqueue.mockRejectedValue(new Error('Redis unavailable'));

      await expect(s.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('handleScheduledSync', () => {
    it('enqueues a cron job when syncEnabled=true and syncCronViaQueue=false', async () => {
      await scheduler.handleScheduledSync();

      expect(pipelineJobService.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerSource: TRIGGER_SOURCE.CRON }),
      );
      expect(queueService.enqueue).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ triggerSource: TRIGGER_SOURCE.CRON }),
        expect.any(Object),
      );
    });

    it('skips when syncEnabled=false', async () => {
      const module = await buildModule({ REGION_SYNC_ENABLED: 'false' });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const q = module.get(QueueService) as jest.Mocked<QueueService>;

      await s.handleScheduledSync();

      expect(q.enqueue).not.toHaveBeenCalled();
    });

    it('skips when syncCronViaQueue=true (worker owns the schedule)', async () => {
      const module = await buildModule({ REGION_SYNC_CRON_VIA_QUEUE: 'true' });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const q = module.get(QueueService) as jest.Mocked<QueueService>;

      await s.handleScheduledSync();

      expect(q.enqueue).not.toHaveBeenCalled();
    });

    it('handles enqueue errors gracefully', async () => {
      queueService.enqueue.mockRejectedValue(new Error('Redis unavailable'));
      await expect(scheduler.handleScheduledSync()).resolves.not.toThrow();
    });
  });
});
