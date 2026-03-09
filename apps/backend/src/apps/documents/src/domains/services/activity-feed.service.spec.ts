import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';

import { ActivityFeedService } from './activity-feed.service';

describe('ActivityFeedService', () => {
  let service: ActivityFeedService;
  let db: {
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    db = {
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ActivityFeedService, { provide: DbService, useValue: db }],
    }).compile();

    service = module.get<ActivityFeedService>(ActivityFeedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPetitionActivityFeed', () => {
    it('should return activity feed with items and stats', async () => {
      db.$queryRaw.mockResolvedValue([
        {
          items: [
            {
              content_hash: 'hash-1',
              summary: 'Save the parks',
              document_type: 'petition',
              scan_count: 5,
              location_count: 3,
              latest_scan_at: '2024-06-15T10:00:00Z',
              earliest_scan_at: '2024-06-15T08:00:00Z',
            },
          ],
          hourly_trend: [
            { hour: '2024-06-15T08:00:00Z', scan_count: 3 },
            { hour: '2024-06-15T09:00:00Z', scan_count: 2 },
          ],
          total_scans: 10,
          active_petitions: 3,
        },
      ]);

      const result = await service.getPetitionActivityFeed();

      expect(result.items).toHaveLength(1);
      expect(result.items[0].contentHash).toBe('hash-1');
      expect(result.items[0].summary).toBe('Save the parks');
      expect(result.items[0].scanCount).toBe(5);
      expect(result.items[0].locationCount).toBe(3);
      expect(result.hourlyTrend).toHaveLength(2);
      expect(result.totalScansLast24h).toBe(10);
      expect(result.activePetitionsLast24h).toBe(3);
    });

    it('should handle empty results', async () => {
      db.$queryRaw.mockResolvedValue([
        {
          items: [],
          hourly_trend: [],
          total_scans: 0,
          active_petitions: 0,
        },
      ]);

      const result = await service.getPetitionActivityFeed();

      expect(result.items).toEqual([]);
      expect(result.hourlyTrend).toEqual([]);
      expect(result.totalScansLast24h).toBe(0);
      expect(result.activePetitionsLast24h).toBe(0);
    });

    it('should use fallback summary when null', async () => {
      db.$queryRaw.mockResolvedValue([
        {
          items: [
            {
              content_hash: 'hash-1',
              summary: null,
              document_type: null,
              scan_count: 3,
              location_count: 1,
              latest_scan_at: '2024-06-15T10:00:00Z',
              earliest_scan_at: '2024-06-15T10:00:00Z',
            },
          ],
          hourly_trend: [],
          total_scans: 3,
          active_petitions: 1,
        },
      ]);

      const result = await service.getPetitionActivityFeed();

      expect(result.items[0].summary).toBe('Petition scan recorded');
      expect(result.items[0].documentType).toBeUndefined();
    });

    it('should handle no rows returned', async () => {
      db.$queryRaw.mockResolvedValue([]);

      const result = await service.getPetitionActivityFeed();

      expect(result.items).toEqual([]);
      expect(result.hourlyTrend).toEqual([]);
      expect(result.totalScansLast24h).toBe(0);
      expect(result.activePetitionsLast24h).toBe(0);
    });
  });
});
