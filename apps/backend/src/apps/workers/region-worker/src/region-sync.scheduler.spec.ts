import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';

import { RegionSyncScheduler } from './region-sync.scheduler';
import { QueueService } from '@opuspopuli/queue-provider';
import { PipelineJobService } from 'src/apps/region/src/domains/pipeline-job.service';
import { RegionDomainService } from 'src/apps/region/src/domains/region.service';
import { staggeredCron } from './cadence.utils';

describe('RegionSyncScheduler', () => {
  let scheduler: RegionSyncScheduler;
  let queueService: jest.Mocked<QueueService>;
  let regionService: jest.Mocked<RegionDomainService>;

  function buildModule(env: Record<string, string> = {}) {
    Object.assign(process.env, env);

    const mockQueue = createMock<QueueService>();
    const mockJobs = createMock<PipelineJobService>();
    const mockRegion = createMock<RegionDomainService>();

    mockQueue.upsertScheduler.mockResolvedValue(undefined);
    mockQueue.enqueue.mockResolvedValue('bullmq-job-1');
    mockQueue.listSchedulers.mockResolvedValue([]);
    mockQueue.removeScheduler.mockResolvedValue(undefined);
    mockJobs.create.mockResolvedValue({ id: 'job-uuid' });
    mockRegion.getPluginDataSourceConfigs.mockResolvedValue([]);

    return Test.createTestingModule({
      providers: [
        RegionSyncScheduler,
        { provide: QueueService, useValue: mockQueue },
        { provide: PipelineJobService, useValue: mockJobs },
        { provide: RegionDomainService, useValue: mockRegion },
      ],
    }).compile();
  }

  beforeEach(async () => {
    delete process.env.REGION_SYNC_CRON_ENABLED;
    delete process.env.REGION_SYNC_RUN_ON_STARTUP;

    const module: TestingModule = await buildModule();
    scheduler = module.get<RegionSyncScheduler>(RegionSyncScheduler);
    queueService = module.get(QueueService);
    regionService = module.get(RegionDomainService);
  });

  afterEach(() => {
    delete process.env.REGION_SYNC_CRON_ENABLED;
    delete process.env.REGION_SYNC_RUN_ON_STARTUP;
  });

  it('is defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('onApplicationBootstrap', () => {
    it('falls back to daily-cron when no sources have syncCadence', async () => {
      await scheduler.onApplicationBootstrap();

      expect(queueService.upsertScheduler).toHaveBeenCalledWith(
        'region-sync',
        'daily-cron',
        '0 2 * * *',
        expect.objectContaining({ triggerSource: 'cron' }),
      );
    });

    it('registers per-source schedulers when syncCadence is configured', async () => {
      regionService.getPluginDataSourceConfigs.mockResolvedValueOnce([
        {
          regionId: 'california',
          sources: [
            {
              url: 'https://example.com',
              dataType: 'meetings' as never,
              contentGoal: 'meetings',
              syncCadence: '0 2 * * *',
            },
            {
              url: 'https://example.com/props',
              dataType: 'propositions' as never,
              contentGoal: 'props',
              syncCadence: '0 2 * * 0',
            },
          ],
        },
      ]);

      await scheduler.onApplicationBootstrap();

      const meetingsCron = staggeredCron('0 2 * * *', 'california-meetings');
      const propsCron = staggeredCron('0 2 * * 0', 'california-propositions');

      expect(queueService.upsertScheduler).toHaveBeenCalledWith(
        'region-sync',
        'california-meetings-cron',
        meetingsCron,
        expect.objectContaining({
          triggerSource: 'cron',
          regionId: 'california',
          dataTypes: ['meetings'],
        }),
      );
      expect(queueService.upsertScheduler).toHaveBeenCalledWith(
        'region-sync',
        'california-propositions-cron',
        propsCron,
        expect.objectContaining({
          triggerSource: 'cron',
          regionId: 'california',
          dataTypes: ['propositions'],
        }),
      );
    });

    it('skips sources without syncCadence', async () => {
      regionService.getPluginDataSourceConfigs.mockResolvedValueOnce([
        {
          regionId: 'california',
          sources: [
            {
              url: 'https://example.com',
              dataType: 'meetings' as never,
              contentGoal: 'meetings',
              syncCadence: '0 2 * * *',
            },
            {
              url: 'https://example.com/props',
              dataType: 'propositions' as never,
              contentGoal: 'props',
              // no syncCadence
            },
          ],
        },
      ]);

      await scheduler.onApplicationBootstrap();

      expect(queueService.upsertScheduler).toHaveBeenCalledTimes(1);
      expect(queueService.upsertScheduler).toHaveBeenCalledWith(
        'region-sync',
        'california-meetings-cron',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('continues registering remaining sources when one upsert fails', async () => {
      regionService.getPluginDataSourceConfigs.mockResolvedValueOnce([
        {
          regionId: 'california',
          sources: [
            {
              url: 'https://example.com/meetings',
              dataType: 'meetings' as never,
              contentGoal: 'meetings',
              syncCadence: '0 2 * * *',
            },
            {
              url: 'https://example.com/props',
              dataType: 'propositions' as never,
              contentGoal: 'props',
              syncCadence: '0 2 * * 0',
            },
          ],
        },
      ]);

      queueService.upsertScheduler
        .mockRejectedValueOnce(new Error('Redis unavailable'))
        .mockResolvedValue(undefined);

      await expect(scheduler.onApplicationBootstrap()).resolves.not.toThrow();
      expect(queueService.upsertScheduler).toHaveBeenCalledTimes(2);
    });

    it('removes stale scheduler keys not in the active config', async () => {
      regionService.getPluginDataSourceConfigs.mockResolvedValueOnce([
        {
          regionId: 'california',
          sources: [
            {
              url: 'https://example.com',
              dataType: 'meetings' as never,
              contentGoal: 'meetings',
              syncCadence: '0 2 * * *',
            },
          ],
        },
      ]);

      queueService.listSchedulers.mockResolvedValueOnce([
        { id: 'california-meetings-cron', pattern: '33 2 * * *', next: null },
        { id: 'california-old-data-cron', pattern: '0 3 * * *', next: null },
      ]);

      await scheduler.onApplicationBootstrap();

      expect(queueService.removeScheduler).toHaveBeenCalledWith(
        'region-sync',
        'california-old-data-cron',
      );
      expect(queueService.removeScheduler).not.toHaveBeenCalledWith(
        'region-sync',
        'california-meetings-cron',
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

describe('staggeredCron', () => {
  it('replaces the minute field with a deterministic offset', () => {
    const result = staggeredCron('0 2 * * *', 'california-meetings');
    const parts = result.split(' ');
    expect(parts).toHaveLength(5);
    expect(parts[1]).toBe('2');
    expect(Number(parts[0])).toBeGreaterThanOrEqual(0);
    expect(Number(parts[0])).toBeLessThan(60);
  });

  it('produces the same result for the same seed', () => {
    expect(staggeredCron('0 2 * * *', 'test-seed')).toBe(
      staggeredCron('0 2 * * *', 'test-seed'),
    );
  });

  it('produces different results for different seeds', () => {
    expect(staggeredCron('0 2 * * *', 'region-a-meetings')).not.toBe(
      staggeredCron('0 2 * * *', 'region-b-meetings'),
    );
  });

  it('preserves all non-minute fields of the base cron', () => {
    const result = staggeredCron('0 3 1 6 5', 'seed');
    const parts = result.split(' ');
    expect(parts[1]).toBe('3');
    expect(parts[2]).toBe('1');
    expect(parts[3]).toBe('6');
    expect(parts[4]).toBe('5');
  });
});
