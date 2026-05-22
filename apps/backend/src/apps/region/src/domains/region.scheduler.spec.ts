import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';

import { RegionScheduler } from './region.scheduler';
import { RegionDomainService } from './region.service';
import { DataType } from '@opuspopuli/region-provider';

describe('RegionScheduler', () => {
  let scheduler: RegionScheduler;
  let regionService: jest.Mocked<RegionDomainService>;

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

  function buildModule(configOverrides: Record<string, unknown> = {}) {
    const mockRegionService = createMock<RegionDomainService>();
    mockRegionService.syncAll.mockResolvedValue(mockSyncResults);

    const mockConfigService = createMock<ConfigService>();
    mockConfigService.get.mockImplementation((key: string) => {
      const defaults: Record<string, unknown> = {
        'region.syncEnabled': true,
        'region.syncCronViaQueue': false,
        'region.syncRunOnStartup': false,
      };
      return configOverrides[key] ?? defaults[key] ?? undefined;
    });

    return Test.createTestingModule({
      providers: [
        RegionScheduler,
        { provide: RegionDomainService, useValue: mockRegionService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
  }

  beforeEach(async () => {
    const module: TestingModule = await buildModule();
    scheduler = module.get<RegionScheduler>(RegionScheduler);
    regionService = module.get(RegionDomainService);
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('does not sync by default (REGION_SYNC_RUN_ON_STARTUP defaults to false)', async () => {
      await scheduler.onModuleInit();
      expect(regionService.syncAll).not.toHaveBeenCalled();
    });

    it('syncs when REGION_SYNC_RUN_ON_STARTUP=true', async () => {
      const module = await buildModule({ 'region.syncRunOnStartup': true });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const rs = module.get(
        RegionDomainService,
      ) as jest.Mocked<RegionDomainService>;

      await s.onModuleInit();

      expect(rs.syncAll).toHaveBeenCalled();
    });

    it('handles errors gracefully on startup', async () => {
      const module = await buildModule({ 'region.syncRunOnStartup': true });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const rs = module.get(
        RegionDomainService,
      ) as jest.Mocked<RegionDomainService>;
      rs.syncAll.mockRejectedValue(new Error('Startup sync failed'));

      await expect(s.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('handleScheduledSync', () => {
    it('runs sync when syncEnabled=true and syncCronViaQueue=false', async () => {
      await scheduler.handleScheduledSync();
      expect(regionService.syncAll).toHaveBeenCalled();
    });

    it('skips when syncEnabled=false', async () => {
      const module = await buildModule({ 'region.syncEnabled': false });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const rs = module.get(
        RegionDomainService,
      ) as jest.Mocked<RegionDomainService>;

      await s.handleScheduledSync();

      expect(rs.syncAll).not.toHaveBeenCalled();
    });

    it('skips when REGION_SYNC_CRON_VIA_QUEUE=true (worker owns the schedule)', async () => {
      const module = await buildModule({ 'region.syncCronViaQueue': true });
      const s = module.get<RegionScheduler>(RegionScheduler);
      const rs = module.get(
        RegionDomainService,
      ) as jest.Mocked<RegionDomainService>;

      await s.handleScheduledSync();

      expect(rs.syncAll).not.toHaveBeenCalled();
    });

    it('handles sync errors gracefully', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Network error'));
      await expect(scheduler.handleScheduledSync()).resolves.not.toThrow();
    });
  });
});
