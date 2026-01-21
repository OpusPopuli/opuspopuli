/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';

import { RegionDomainService } from './region.service';
import { DbService } from '@qckstrt/relationaldb-provider';
import { createMockDbService } from '@qckstrt/relationaldb-provider/testing';
import {
  RegionService as RegionProviderService,
  CivicDataType,
  PropositionStatus,
  Proposition,
} from '@qckstrt/region-provider';

/**
 * Tests for Region Domain Service
 *
 * PERFORMANCE: Tests updated for bulk upsert implementation
 */

describe('RegionDomainService', () => {
  let service: RegionDomainService;
  let regionProviderService: jest.Mocked<RegionProviderService>;
  let mockDb: ReturnType<typeof createMockDbService>;

  const mockRegionInfo = {
    id: 'test-region',
    name: 'Test Region',
    description: 'A test region for testing',
    timezone: 'America/Los_Angeles',
    dataSourceUrls: ['https://example.com'],
  };

  const mockPropositions = [
    {
      externalId: 'prop-1',
      title: 'Test Proposition 1',
      summary: 'Summary 1',
      fullText: 'Full text 1',
      status: 'pending',
      electionDate: new Date('2024-11-05'),
      sourceUrl: 'https://example.com/prop-1',
    },
  ];

  const mockMeetings = [
    {
      externalId: 'meeting-1',
      title: 'City Council Meeting',
      body: 'City Council',
      scheduledAt: new Date('2024-01-15T10:00:00Z'),
      location: 'City Hall',
      agendaUrl: 'https://example.com/agenda',
      videoUrl: 'https://example.com/video',
    },
  ];

  const mockRepresentatives = [
    {
      externalId: 'rep-1',
      name: 'John Doe',
      chamber: 'Senate',
      district: 'District 1',
      party: 'Independent',
      photoUrl: 'https://example.com/photo.jpg',
      contactInfo: { email: 'john@example.com' },
    },
  ];

  beforeEach(async () => {
    mockDb = createMockDbService();

    const mockRegionProvider = {
      getProviderName: jest.fn().mockReturnValue('test-provider'),
      getRegionInfo: jest.fn().mockReturnValue(mockRegionInfo),
      getSupportedDataTypes: jest
        .fn()
        .mockReturnValue([
          CivicDataType.PROPOSITIONS,
          CivicDataType.MEETINGS,
          CivicDataType.REPRESENTATIVES,
        ]),
      fetchPropositions: jest.fn().mockResolvedValue(mockPropositions),
      fetchMeetings: jest.fn().mockResolvedValue(mockMeetings),
      fetchRepresentatives: jest.fn().mockResolvedValue(mockRepresentatives),
    };

    // Set up default empty returns for findMany (no existing records)
    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);

    // Set up default $transaction mock
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: any[]) => {
        return Promise.all(operations);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        {
          provide: RegionProviderService,
          useValue: mockRegionProvider,
        },
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<RegionDomainService>(RegionDomainService);
    regionProviderService = module.get(RegionProviderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRegionInfo', () => {
    it('should return region info with supported data types', () => {
      const info = service.getRegionInfo();

      expect(info.id).toBe('test-region');
      expect(info.name).toBe('Test Region');
      expect(info.description).toBeDefined();
      expect(info.timezone).toBe('America/Los_Angeles');
      expect(info.supportedDataTypes).toHaveLength(3);
    });
  });

  describe('syncAll', () => {
    it('should sync all data types and return results', async () => {
      const results = await service.syncAll();

      expect(results).toHaveLength(3);
      expect(results[0].dataType).toBe(CivicDataType.PROPOSITIONS);
      expect(results[1].dataType).toBe(CivicDataType.MEETINGS);
      expect(results[2].dataType).toBe(CivicDataType.REPRESENTATIVES);
      expect(mockDb.$transaction).toHaveBeenCalledTimes(3);
    });

    it('should handle sync errors gracefully', async () => {
      regionProviderService.fetchPropositions.mockRejectedValue(
        new Error('Network error'),
      );

      const results = await service.syncAll();

      expect(results[0].errors).toContain('Network error');
      expect(results[0].itemsProcessed).toBe(0);
    });
  });

  describe('syncDataType - PROPOSITIONS', () => {
    it('should create new propositions using bulk upsert', async () => {
      // No existing records
      mockDb.proposition.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(CivicDataType.PROPOSITIONS);

      expect(result.itemsCreated).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(result.itemsProcessed).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should update existing propositions using bulk upsert', async () => {
      // Mock existing record found
      mockDb.proposition.findMany.mockResolvedValue([
        { externalId: 'prop-1' } as any,
      ]);

      const result = await service.syncDataType(CivicDataType.PROPOSITIONS);

      expect(result.itemsCreated).toBe(0);
      expect(result.itemsUpdated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should handle empty propositions list', async () => {
      regionProviderService.fetchPropositions.mockResolvedValue([]);

      const result = await service.syncDataType(CivicDataType.PROPOSITIONS);

      expect(result.itemsProcessed).toBe(0);
      expect(result.itemsCreated).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });
  });

  describe('syncDataType - MEETINGS', () => {
    it('should create new meetings using bulk upsert', async () => {
      mockDb.meeting.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(CivicDataType.MEETINGS);

      expect(result.itemsCreated).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should update existing meetings using bulk upsert', async () => {
      mockDb.meeting.findMany.mockResolvedValue([
        { externalId: 'meeting-1' } as any,
      ]);

      const result = await service.syncDataType(CivicDataType.MEETINGS);

      expect(result.itemsUpdated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });
  });

  describe('syncDataType - REPRESENTATIVES', () => {
    it('should create new representatives using bulk upsert', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(CivicDataType.REPRESENTATIVES);

      expect(result.itemsCreated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should update existing representatives using bulk upsert', async () => {
      mockDb.representative.findMany.mockResolvedValue([
        { externalId: 'rep-1' } as any,
      ]);

      const result = await service.syncDataType(CivicDataType.REPRESENTATIVES);

      expect(result.itemsUpdated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });
  });

  describe('bulk upsert performance', () => {
    it('should use only 2 queries per sync (SELECT existing + transaction)', async () => {
      mockDb.proposition.findMany.mockResolvedValue([]);

      await service.syncDataType(CivicDataType.PROPOSITIONS);

      // Should call findMany exactly once (for SELECT existing)
      expect(mockDb.proposition.findMany).toHaveBeenCalledTimes(1);
      // Should call $transaction exactly once (for bulk upsert)
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should handle large datasets (1000+ records) efficiently', async () => {
      // Generate 1000 propositions to test bulk performance
      const largeDataset: Proposition[] = Array.from(
        { length: 1000 },
        (_, i) => ({
          externalId: `prop-${i}`,
          title: `Proposition ${i}`,
          summary: `Summary for proposition ${i}`,
          fullText: `Full text for proposition ${i}`,
          status: PropositionStatus.PENDING,
          electionDate: new Date('2024-11-05'),
          sourceUrl: `https://example.com/prop-${i}`,
        }),
      );

      regionProviderService.fetchPropositions.mockResolvedValue(largeDataset);
      mockDb.proposition.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(CivicDataType.PROPOSITIONS);

      // Verify all 1000 items processed
      expect(result.itemsProcessed).toBe(1000);
      expect(result.itemsCreated).toBe(1000);

      // Verify only 2 database calls (not 2000)
      expect(mockDb.proposition.findMany).toHaveBeenCalledTimes(1);
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should correctly identify creates vs updates in mixed batch', async () => {
      // 500 new + 500 existing = 1000 total
      const mixedDataset: Proposition[] = Array.from(
        { length: 1000 },
        (_, i) => ({
          externalId: `prop-${i}`,
          title: `Proposition ${i}`,
          summary: `Summary ${i}`,
          fullText: undefined,
          status: PropositionStatus.PENDING,
          electionDate: new Date('2024-11-05'),
          sourceUrl: undefined,
        }),
      );

      regionProviderService.fetchPropositions.mockResolvedValue(mixedDataset);

      // Mock 500 existing records (prop-0 through prop-499)
      mockDb.proposition.findMany.mockResolvedValue(
        Array.from({ length: 500 }, (_, i) => ({
          externalId: `prop-${i}`,
        })) as any[],
      );

      const result = await service.syncDataType(CivicDataType.PROPOSITIONS);

      expect(result.itemsProcessed).toBe(1000);
      expect(result.itemsCreated).toBe(500); // prop-500 through prop-999
      expect(result.itemsUpdated).toBe(500); // prop-0 through prop-499
    });
  });

  describe('getPropositions', () => {
    it('should return paginated propositions', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'prop-1',
          title: 'Prop 1',
          summary: 'Summary',
          status: 'pending',
          fullText: null,
          electionDate: null,
          sourceUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockDb.proposition.findMany.mockResolvedValue(mockItems as any);
      mockDb.proposition.count.mockResolvedValue(1);

      const result = await service.getPropositions(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should indicate hasMore when more items exist', async () => {
      const mockItems = Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        externalId: `prop-${i}`,
        title: `Prop ${i}`,
        summary: 'Summary',
        status: 'pending',
        fullText: null,
        electionDate: null,
        sourceUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }));
      mockDb.proposition.findMany.mockResolvedValue(mockItems as any);
      mockDb.proposition.count.mockResolvedValue(15);

      const result = await service.getPropositions(0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getProposition', () => {
    it('should return a single proposition by ID', async () => {
      const mockProp = { id: '1', title: 'Test Prop' };
      mockDb.proposition.findUnique.mockResolvedValue(mockProp as any);

      const result = await service.getProposition('1');

      expect(result).toEqual(mockProp);
      expect(mockDb.proposition.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if proposition not found', async () => {
      mockDb.proposition.findUnique.mockResolvedValue(null);

      const result = await service.getProposition('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getMeetings', () => {
    it('should return paginated meetings', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'meeting-1',
          title: 'Meeting 1',
          body: 'Council',
          scheduledAt: new Date(),
          location: null,
          agendaUrl: null,
          videoUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockDb.meeting.findMany.mockResolvedValue(mockItems as any);
      mockDb.meeting.count.mockResolvedValue(1);

      const result = await service.getMeetings(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getMeeting', () => {
    it('should return a single meeting by ID', async () => {
      const mockMeeting = { id: '1', title: 'Test Meeting' };
      mockDb.meeting.findUnique.mockResolvedValue(mockMeeting as any);

      const result = await service.getMeeting('1');

      expect(result).toEqual(mockMeeting);
    });
  });

  describe('getRepresentatives', () => {
    it('should return paginated representatives', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'rep-1',
          name: 'John Doe',
          chamber: 'Senate',
          district: 'D1',
          party: 'Independent',
          photoUrl: null,
          contactInfo: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];

      mockDb.representative.findMany.mockResolvedValue(mockItems as any);
      mockDb.representative.count.mockResolvedValue(1);

      const result = await service.getRepresentatives(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by chamber when provided', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);
      mockDb.representative.count.mockResolvedValue(0);

      await service.getRepresentatives(0, 10, 'Senate');

      expect(mockDb.representative.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chamber: 'Senate' },
        }),
      );
    });
  });

  describe('getRepresentative', () => {
    it('should return a single representative by ID', async () => {
      const mockRep = { id: '1', name: 'John Doe' };
      mockDb.representative.findUnique.mockResolvedValue(mockRep as any);

      const result = await service.getRepresentative('1');

      expect(result).toEqual(mockRep);
    });
  });
});
