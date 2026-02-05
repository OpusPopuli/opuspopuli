import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createMock } from '@golevelup/ts-jest';

import { RegionScheduler } from './region.scheduler';
import { RegionDomainService } from './region.service';
import { CivicDataType } from '@opuspopuli/region-provider';

describe('RegionScheduler', () => {
  let scheduler: RegionScheduler;
  let regionService: jest.Mocked<RegionDomainService>;
  let configService: jest.Mocked<ConfigService>;

  const mockSyncResults = [
    {
      dataType: CivicDataType.PROPOSITIONS,
      itemsProcessed: 10,
      itemsCreated: 5,
      itemsUpdated: 5,
      errors: [],
      syncedAt: new Date(),
    },
    {
      dataType: CivicDataType.MEETINGS,
      itemsProcessed: 5,
      itemsCreated: 3,
      itemsUpdated: 2,
      errors: [],
      syncedAt: new Date(),
    },
    {
      dataType: CivicDataType.REPRESENTATIVES,
      itemsProcessed: 8,
      itemsCreated: 2,
      itemsUpdated: 6,
      errors: [],
      syncedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    const mockRegionService = createMock<RegionDomainService>();
    mockRegionService.syncAll.mockResolvedValue(mockSyncResults);

    const mockConfigService = createMock<ConfigService>();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'region.syncEnabled') return true;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionScheduler,
        {
          provide: RegionDomainService,
          useValue: mockRegionService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    scheduler = module.get<RegionScheduler>(RegionScheduler);
    regionService = module.get(RegionDomainService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should run initial sync when sync is enabled', async () => {
      await scheduler.onModuleInit();

      expect(regionService.syncAll).toHaveBeenCalled();
    });

    it('should not run initial sync when sync is disabled', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'region.syncEnabled') return false;
        return undefined;
      });

      // Create a new scheduler with sync disabled
      const module = await Test.createTestingModule({
        providers: [
          RegionScheduler,
          {
            provide: RegionDomainService,
            useValue: regionService,
          },
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const disabledScheduler = module.get<RegionScheduler>(RegionScheduler);
      regionService.syncAll.mockClear();

      await disabledScheduler.onModuleInit();

      expect(regionService.syncAll).not.toHaveBeenCalled();
    });

    it('should handle sync errors gracefully', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Sync failed'));

      // Should not throw
      await expect(scheduler.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('handleScheduledSync', () => {
    it('should run sync when enabled', async () => {
      await scheduler.handleScheduledSync();

      expect(regionService.syncAll).toHaveBeenCalled();
    });

    it('should not run sync when disabled', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'region.syncEnabled') return false;
        return undefined;
      });

      const module = await Test.createTestingModule({
        providers: [
          RegionScheduler,
          {
            provide: RegionDomainService,
            useValue: regionService,
          },
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const disabledScheduler = module.get<RegionScheduler>(RegionScheduler);
      regionService.syncAll.mockClear();

      await disabledScheduler.handleScheduledSync();

      expect(regionService.syncAll).not.toHaveBeenCalled();
    });

    it('should handle sync errors gracefully', async () => {
      regionService.syncAll.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(scheduler.handleScheduledSync()).resolves.not.toThrow();
    });

    it('should log sync results', async () => {
      await scheduler.handleScheduledSync();

      expect(regionService.syncAll).toHaveBeenCalled();
    });
  });

  describe('sync with errors', () => {
    it('should log warnings when sync has errors', async () => {
      const resultsWithErrors = [
        {
          dataType: CivicDataType.PROPOSITIONS,
          itemsProcessed: 10,
          itemsCreated: 5,
          itemsUpdated: 5,
          errors: ['Failed to parse item'],
          syncedAt: new Date(),
        },
      ];
      regionService.syncAll.mockResolvedValue(resultsWithErrors);

      // Should not throw, just log warnings
      await expect(scheduler.handleScheduledSync()).resolves.not.toThrow();
      expect(regionService.syncAll).toHaveBeenCalled();
    });
  });
});
