import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { RegionSyncScheduler } from './region-sync.scheduler';
import { QueueService } from '@opuspopuli/queue-provider';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';

describe('RegionSyncScheduler', () => {
  let scheduler: RegionSyncScheduler;
  let queueService: jest.Mocked<QueueService>;

  function buildModule(env: Record<string, string> = {}) {
    Object.assign(process.env, env);

    const mockQueue = createMock<QueueService>();
    const mockJobs = createMock<PipelineJobService>();

    mockQueue.upsertScheduler.mockResolvedValue(undefined);
    mockQueue.enqueue.mockResolvedValue('bullmq-job-1');
    mockJobs.create.mockResolvedValue({ id: 'job-uuid' });

    return Test.createTestingModule({
      providers: [
        RegionSyncScheduler,
        { provide: QueueService, useValue: mockQueue },
        { provide: PipelineJobService, useValue: mockJobs },
      ],
    }).compile();
  }

  beforeEach(async () => {
    delete process.env.REGION_SYNC_CRON_ENABLED;
    delete process.env.REGION_SYNC_RUN_ON_STARTUP;

    const module: TestingModule = await buildModule();
    scheduler = module.get<RegionSyncScheduler>(RegionSyncScheduler);
    queueService = module.get(QueueService);
  });

  afterEach(() => {
    delete process.env.REGION_SYNC_CRON_ENABLED;
    delete process.env.REGION_SYNC_RUN_ON_STARTUP;
  });

  it('is defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('onApplicationBootstrap', () => {
    it('upserts the daily-cron scheduler when REGION_SYNC_CRON_ENABLED=true', async () => {
      await scheduler.onApplicationBootstrap();

      expect(queueService.upsertScheduler).toHaveBeenCalledWith(
        'region-sync',
        'daily-cron',
        '0 2 * * *',
        expect.objectContaining({ triggerSource: 'cron' }),
      );
    });

    it('skips scheduler registration when REGION_SYNC_CRON_ENABLED=false', async () => {
      const module = await buildModule({ REGION_SYNC_CRON_ENABLED: 'false' });
      const s = module.get<RegionSyncScheduler>(RegionSyncScheduler);
      const qs = module.get(QueueService) as jest.Mocked<QueueService>;

      await s.onApplicationBootstrap();

      expect(qs.upsertScheduler).not.toHaveBeenCalled();
    });

    it('enqueues a startup job when REGION_SYNC_RUN_ON_STARTUP=true', async () => {
      const module = await buildModule({ REGION_SYNC_RUN_ON_STARTUP: 'true' });
      const s = module.get<RegionSyncScheduler>(RegionSyncScheduler);
      const qs = module.get(QueueService) as jest.Mocked<QueueService>;
      const pj = module.get(
        PipelineJobService,
      ) as jest.Mocked<PipelineJobService>;

      await s.onApplicationBootstrap();

      expect(pj.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerSource: 'startup' }),
      );
      expect(qs.enqueue).toHaveBeenCalledWith(
        'region-sync',
        expect.objectContaining({ triggerSource: 'startup' }),
        expect.objectContaining({
          jobId: expect.stringMatching(/^startup-\d{8}$/),
        }),
      );
    });

    it('does not enqueue startup job when REGION_SYNC_RUN_ON_STARTUP=false', async () => {
      await scheduler.onApplicationBootstrap();
      expect(queueService.enqueue).not.toHaveBeenCalled();
    });
  });
});
