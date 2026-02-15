/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';

import { RegionDomainService } from './region.service';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { createMockDbService } from '@opuspopuli/relationaldb-provider/testing';
import {
  DataType,
  PropositionStatus,
  Proposition,
  PluginLoaderService,
  PluginRegistryService,
  type IRegionPlugin,
  type RegisteredPlugin,
} from '@opuspopuli/region-provider';

/**
 * Tests for Region Domain Service
 *
 * Updated for dual-plugin architecture: the service loads a federal plugin
 * (always) and a local region plugin (user-selected) during onModuleInit.
 */

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

function createMockPlugin(): jest.Mocked<IRegionPlugin> {
  return {
    getName: jest.fn().mockReturnValue('test-provider'),
    getVersion: jest.fn().mockReturnValue('1.0.0'),
    getRegionInfo: jest.fn().mockReturnValue(mockRegionInfo),
    getSupportedDataTypes: jest
      .fn()
      .mockReturnValue([
        DataType.PROPOSITIONS,
        DataType.MEETINGS,
        DataType.REPRESENTATIVES,
      ]),
    fetchPropositions: jest.fn().mockResolvedValue(mockPropositions),
    fetchMeetings: jest.fn().mockResolvedValue(mockMeetings),
    fetchRepresentatives: jest.fn().mockResolvedValue(mockRepresentatives),
    initialize: jest.fn().mockResolvedValue(undefined),
    healthCheck: jest.fn().mockResolvedValue({
      healthy: true,
      message: 'OK',
      lastCheck: new Date(),
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

describe('RegionDomainService', () => {
  let service: RegionDomainService;
  let mockDb: ReturnType<typeof createMockDbService>;
  let mockPlugin: jest.Mocked<IRegionPlugin>;
  let mockRegistry: any;

  beforeEach(async () => {
    mockDb = createMockDbService();
    mockPlugin = createMockPlugin();

    // The local registered plugin entry returned by getAll()
    const localRegistered: RegisteredPlugin = {
      name: 'test-provider',
      instance: mockPlugin,
      status: 'active',
      loadedAt: new Date(),
    };

    mockRegistry = {
      // Backward-compat aliases
      register: jest.fn().mockResolvedValue(undefined),
      unregister: jest.fn().mockResolvedValue(undefined),
      getActive: jest.fn().mockReturnValue(mockPlugin),
      // New dual-slot API
      registerLocal: jest.fn().mockResolvedValue(undefined),
      registerFederal: jest.fn().mockResolvedValue(undefined),
      getLocal: jest.fn().mockReturnValue(mockPlugin),
      getFederal: jest.fn().mockReturnValue(undefined),
      getAll: jest.fn().mockReturnValue([localRegistered]),
      getActiveName: jest.fn().mockReturnValue('test-provider'),
      hasActive: jest.fn().mockReturnValue(true),
      getHealth: jest.fn(),
      getStatus: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    const mockLoader: any = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn().mockResolvedValue(undefined),
    };

    // Mock DB regionPlugin: no federal config, no enabled local plugin
    // → service falls back to ExampleRegionProvider via registerLocal('example', ...)
    // But registry.getLocal() returns our mockPlugin regardless
    (mockDb as any).regionPlugin = {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    };

    // Set up default empty returns for findMany (no existing records)
    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);

    // Set up campaign finance DB mocks
    (mockDb as any).committee = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
    };
    (mockDb as any).contribution = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
    };
    (mockDb as any).expenditure = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
    };
    (mockDb as any).independentExpenditure = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue({}),
    };

    // Set up default $transaction mock
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: any[]) => {
        return Promise.all(operations);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<RegionDomainService>(RegionDomainService);

    // Trigger plugin loading (normally done by NestJS lifecycle)
    await service.onModuleInit();
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
    it('should sync all data types from all plugins and return results', async () => {
      const results = await service.syncAll();

      // getAll() returns only the local plugin (3 data types)
      expect(results).toHaveLength(3);
      expect(results[0].dataType).toBe(DataType.PROPOSITIONS);
      expect(results[1].dataType).toBe(DataType.MEETINGS);
      expect(results[2].dataType).toBe(DataType.REPRESENTATIVES);
      expect(mockDb.$transaction).toHaveBeenCalledTimes(3);
      expect(mockRegistry.getAll).toHaveBeenCalled();
    });

    it('should handle sync errors gracefully', async () => {
      mockPlugin.fetchPropositions.mockRejectedValue(
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

      const result = await service.syncDataType(DataType.PROPOSITIONS);

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

      const result = await service.syncDataType(DataType.PROPOSITIONS);

      expect(result.itemsCreated).toBe(0);
      expect(result.itemsUpdated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should handle empty propositions list', async () => {
      mockPlugin.fetchPropositions.mockResolvedValue([]);

      const result = await service.syncDataType(DataType.PROPOSITIONS);

      expect(result.itemsProcessed).toBe(0);
      expect(result.itemsCreated).toBe(0);
      expect(result.itemsUpdated).toBe(0);
    });
  });

  describe('syncDataType - MEETINGS', () => {
    it('should create new meetings using bulk upsert', async () => {
      mockDb.meeting.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(DataType.MEETINGS);

      expect(result.itemsCreated).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should update existing meetings using bulk upsert', async () => {
      mockDb.meeting.findMany.mockResolvedValue([
        { externalId: 'meeting-1' } as any,
      ]);

      const result = await service.syncDataType(DataType.MEETINGS);

      expect(result.itemsUpdated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });
  });

  describe('syncDataType - REPRESENTATIVES', () => {
    it('should create new representatives using bulk upsert', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(DataType.REPRESENTATIVES);

      expect(result.itemsCreated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should update existing representatives using bulk upsert', async () => {
      mockDb.representative.findMany.mockResolvedValue([
        { externalId: 'rep-1' } as any,
      ]);

      const result = await service.syncDataType(DataType.REPRESENTATIVES);

      expect(result.itemsUpdated).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });
  });

  describe('bulk upsert performance', () => {
    it('should use only 2 queries per sync (SELECT existing + transaction)', async () => {
      mockDb.proposition.findMany.mockResolvedValue([]);

      await service.syncDataType(DataType.PROPOSITIONS);

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

      mockPlugin.fetchPropositions.mockResolvedValue(largeDataset);
      mockDb.proposition.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(DataType.PROPOSITIONS);

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

      mockPlugin.fetchPropositions.mockResolvedValue(mixedDataset);

      // Mock 500 existing records (prop-0 through prop-499)
      mockDb.proposition.findMany.mockResolvedValue(
        Array.from({ length: 500 }, (_, i) => ({
          externalId: `prop-${i}`,
        })) as any[],
      );

      const result = await service.syncDataType(DataType.PROPOSITIONS);

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

  // ==========================================
  // CAMPAIGN FINANCE GETTER TESTS
  // ==========================================

  describe('getCommittees', () => {
    it('should return paginated committees', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'comm-1',
          name: 'Test Committee',
          type: 'pac',
          candidateName: null,
          candidateOffice: null,
          propositionId: null,
          party: null,
          status: 'active',
          sourceSystem: 'cal-access',
          sourceUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (mockDb as any).committee.findMany.mockResolvedValue(mockItems);
      (mockDb as any).committee.count.mockResolvedValue(1);

      const result = await service.getCommittees(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      // Null fields should be converted to undefined
      expect(result.items[0].candidateName).toBeUndefined();
      expect(result.items[0].sourceUrl).toBeUndefined();
    });

    it('should filter by sourceSystem when provided', async () => {
      (mockDb as any).committee.findMany.mockResolvedValue([]);
      (mockDb as any).committee.count.mockResolvedValue(0);

      await service.getCommittees(0, 10, 'cal-access');

      expect((mockDb as any).committee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sourceSystem: 'cal-access' },
        }),
      );
    });

    it('should indicate hasMore when more items exist', async () => {
      const mockItems = Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        externalId: `comm-${i}`,
        name: `Committee ${i}`,
        type: 'pac',
        candidateName: null,
        candidateOffice: null,
        propositionId: null,
        party: null,
        status: 'active',
        sourceSystem: 'cal-access',
        sourceUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      (mockDb as any).committee.findMany.mockResolvedValue(mockItems);
      (mockDb as any).committee.count.mockResolvedValue(15);

      const result = await service.getCommittees(0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getCommittee', () => {
    it('should return a single committee by ID', async () => {
      const mockComm = { id: '1', name: 'Test Committee' };
      (mockDb as any).committee.findUnique.mockResolvedValue(mockComm);

      const result = await service.getCommittee('1');

      expect(result).toEqual(mockComm);
      expect((mockDb as any).committee.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if committee not found', async () => {
      (mockDb as any).committee.findUnique.mockResolvedValue(null);

      const result = await service.getCommittee('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getContributions', () => {
    it('should return paginated contributions with Decimal-to-number conversion', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'contrib-1',
          committeeId: 'comm-1',
          donorName: 'Jane Smith',
          donorType: 'individual',
          donorEmployer: null,
          donorOccupation: null,
          donorCity: null,
          donorState: null,
          donorZip: null,
          amount: { toNumber: () => 500 } as any, // Prisma Decimal
          date: new Date(),
          electionType: null,
          contributionType: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (mockDb as any).contribution.findMany.mockResolvedValue(mockItems);
      (mockDb as any).contribution.count.mockResolvedValue(1);

      const result = await service.getContributions(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(typeof result.items[0].amount).toBe('number');
      // Null fields should be converted to undefined
      expect(result.items[0].donorEmployer).toBeUndefined();
      expect(result.items[0].electionType).toBeUndefined();
    });

    it('should filter by committeeId and sourceSystem', async () => {
      (mockDb as any).contribution.findMany.mockResolvedValue([]);
      (mockDb as any).contribution.count.mockResolvedValue(0);

      await service.getContributions(0, 10, 'comm-1', 'cal-access');

      expect((mockDb as any).contribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { committeeId: 'comm-1', sourceSystem: 'cal-access' },
        }),
      );
    });
  });

  describe('getContribution', () => {
    it('should return a single contribution by ID', async () => {
      const mockContrib = { id: '1', donorName: 'Jane Smith' };
      (mockDb as any).contribution.findUnique.mockResolvedValue(mockContrib);

      const result = await service.getContribution('1');

      expect(result).toEqual(mockContrib);
      expect((mockDb as any).contribution.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if contribution not found', async () => {
      (mockDb as any).contribution.findUnique.mockResolvedValue(null);

      const result = await service.getContribution('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getExpenditures', () => {
    it('should return paginated expenditures with Decimal-to-number conversion', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'exp-1',
          committeeId: 'comm-1',
          payeeName: 'Ad Agency Inc',
          amount: { toNumber: () => 1500 } as any, // Prisma Decimal
          date: new Date(),
          purposeDescription: null,
          expenditureCode: null,
          candidateName: null,
          propositionTitle: null,
          supportOrOppose: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (mockDb as any).expenditure.findMany.mockResolvedValue(mockItems);
      (mockDb as any).expenditure.count.mockResolvedValue(1);

      const result = await service.getExpenditures(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(typeof result.items[0].amount).toBe('number');
      // Null fields should be converted to undefined
      expect(result.items[0].purposeDescription).toBeUndefined();
      expect(result.items[0].supportOrOppose).toBeUndefined();
    });

    it('should filter by committeeId and sourceSystem', async () => {
      (mockDb as any).expenditure.findMany.mockResolvedValue([]);
      (mockDb as any).expenditure.count.mockResolvedValue(0);

      await service.getExpenditures(0, 10, 'comm-1', 'cal-access');

      expect((mockDb as any).expenditure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { committeeId: 'comm-1', sourceSystem: 'cal-access' },
        }),
      );
    });
  });

  describe('getExpenditure', () => {
    it('should return a single expenditure by ID', async () => {
      const mockExp = { id: '1', payeeName: 'Ad Agency Inc' };
      (mockDb as any).expenditure.findUnique.mockResolvedValue(mockExp);

      const result = await service.getExpenditure('1');

      expect(result).toEqual(mockExp);
      expect((mockDb as any).expenditure.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if expenditure not found', async () => {
      (mockDb as any).expenditure.findUnique.mockResolvedValue(null);

      const result = await service.getExpenditure('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getIndependentExpenditures', () => {
    it('should return paginated independent expenditures with Decimal-to-number conversion', async () => {
      const mockItems = [
        {
          id: '1',
          externalId: 'ie-1',
          committeeId: 'comm-1',
          committeeName: 'Test IE Committee',
          candidateName: null,
          propositionTitle: null,
          supportOrOppose: 'support',
          amount: { toNumber: () => 25000 } as any, // Prisma Decimal
          date: new Date(),
          electionDate: null,
          description: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (mockDb as any).independentExpenditure.findMany.mockResolvedValue(
        mockItems,
      );
      (mockDb as any).independentExpenditure.count.mockResolvedValue(1);

      const result = await service.getIndependentExpenditures(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(typeof result.items[0].amount).toBe('number');
      // Null fields should be converted to undefined
      expect(result.items[0].candidateName).toBeUndefined();
      expect(result.items[0].description).toBeUndefined();
      // Required field should remain
      expect(result.items[0].supportOrOppose).toBe('support');
    });

    it('should filter by committeeId, supportOrOppose, and sourceSystem', async () => {
      (mockDb as any).independentExpenditure.findMany.mockResolvedValue([]);
      (mockDb as any).independentExpenditure.count.mockResolvedValue(0);

      await service.getIndependentExpenditures(
        0,
        10,
        'comm-1',
        'support',
        'cal-access',
      );

      expect(
        (mockDb as any).independentExpenditure.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            committeeId: 'comm-1',
            supportOrOppose: 'support',
            sourceSystem: 'cal-access',
          },
        }),
      );
    });
  });

  describe('getIndependentExpenditure', () => {
    it('should return a single independent expenditure by ID', async () => {
      const mockIE = { id: '1', committeeName: 'Test IE Committee' };
      (mockDb as any).independentExpenditure.findUnique.mockResolvedValue(
        mockIE,
      );

      const result = await service.getIndependentExpenditure('1');

      expect(result).toEqual(mockIE);
      expect(
        (mockDb as any).independentExpenditure.findUnique,
      ).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if independent expenditure not found', async () => {
      (mockDb as any).independentExpenditure.findUnique.mockResolvedValue(null);

      const result = await service.getIndependentExpenditure('nonexistent');

      expect(result).toBeNull();
    });
  });
});

/**
 * Tests for federal config placeholder resolution.
 * These need different mock setup (local config with stateCode, federal config with placeholders).
 */
describe('RegionDomainService — federal placeholder resolution', () => {
  it('should resolve ${stateCode} in federal config when local config has stateCode', async () => {
    const mockDb = createMockDbService();
    const mockPlugin = createMockPlugin();

    const localRegistered: RegisteredPlugin = {
      name: 'test-provider',
      instance: mockPlugin,
      status: 'active',
      loadedAt: new Date(),
    };

    const mockRegistry: any = {
      register: jest.fn().mockResolvedValue(undefined),
      unregister: jest.fn().mockResolvedValue(undefined),
      getActive: jest.fn().mockReturnValue(mockPlugin),
      registerLocal: jest.fn().mockResolvedValue(undefined),
      registerFederal: jest.fn().mockResolvedValue(undefined),
      getLocal: jest.fn().mockReturnValue(mockPlugin),
      getFederal: jest.fn().mockReturnValue(mockPlugin),
      getAll: jest.fn().mockReturnValue([localRegistered]),
      getActiveName: jest.fn().mockReturnValue('test-provider'),
      hasActive: jest.fn().mockReturnValue(true),
      getHealth: jest.fn(),
      getStatus: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    const mockLoader: any = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn().mockResolvedValue(undefined),
    };

    // Local config with stateCode
    const localConfig = {
      name: 'california',
      enabled: true,
      config: {
        regionId: 'california',
        stateCode: 'CA',
        dataSources: [],
      },
    };

    // Federal config with ${stateCode} placeholders
    const federalConfig = {
      name: 'federal',
      config: {
        regionId: 'federal',
        dataSources: [
          {
            url: 'https://api.open.fec.gov/v1/schedules/schedule_a/',
            dataType: 'campaign_finance',
            sourceType: 'api',
            api: {
              queryParams: {
                contributor_state: '${stateCode}',
                sort: '-date',
              },
            },
          },
          {
            url: 'https://www.fec.gov/files/bulk-downloads/2026/indiv26.zip',
            dataType: 'campaign_finance',
            sourceType: 'bulk_download',
            bulk: {
              filters: { STATE: '${stateCode}' },
            },
          },
        ],
      },
    };

    (mockDb as any).regionPlugin = {
      findFirst: jest.fn().mockResolvedValue(localConfig),
      findUnique: jest.fn().mockResolvedValue(federalConfig),
      upsert: jest.fn().mockResolvedValue({}),
    };

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: any[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    const service = module.get<RegionDomainService>(RegionDomainService);
    await service.onModuleInit();

    // Verify loadFederalPlugin was called with resolved config
    expect(mockLoader.loadFederalPlugin).toHaveBeenCalledTimes(1);

    const resolvedConfig = mockLoader.loadFederalPlugin.mock.calls[0][0];
    const ds = resolvedConfig.dataSources;

    // ${stateCode} should be resolved to "CA"
    expect(ds[0].api.queryParams.contributor_state).toBe('CA');
    expect(ds[0].api.queryParams.sort).toBe('-date'); // unchanged
    expect(ds[1].bulk.filters.STATE).toBe('CA');
  });

  it('should warn and load unresolved federal config when no local config exists', async () => {
    const mockDb = createMockDbService();
    const mockPlugin = createMockPlugin();

    const localRegistered: RegisteredPlugin = {
      name: 'example',
      instance: mockPlugin,
      status: 'active',
      loadedAt: new Date(),
    };

    const mockRegistry: any = {
      register: jest.fn().mockResolvedValue(undefined),
      unregister: jest.fn().mockResolvedValue(undefined),
      getActive: jest.fn().mockReturnValue(mockPlugin),
      registerLocal: jest.fn().mockResolvedValue(undefined),
      registerFederal: jest.fn().mockResolvedValue(undefined),
      getLocal: jest.fn().mockReturnValue(mockPlugin),
      getFederal: jest.fn().mockReturnValue(mockPlugin),
      getAll: jest.fn().mockReturnValue([localRegistered]),
      getActiveName: jest.fn().mockReturnValue('example'),
      hasActive: jest.fn().mockReturnValue(true),
      getHealth: jest.fn(),
      getStatus: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    const mockLoader: any = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn().mockResolvedValue(undefined),
    };

    const federalConfig = {
      name: 'federal',
      config: {
        regionId: 'federal',
        dataSources: [
          {
            url: 'https://api.open.fec.gov/v1/',
            dataType: 'campaign_finance',
            sourceType: 'api',
            api: { queryParams: { contributor_state: '${stateCode}' } },
          },
        ],
      },
    };

    (mockDb as any).regionPlugin = {
      findFirst: jest.fn().mockResolvedValue(null), // no local config
      findUnique: jest.fn().mockResolvedValue(federalConfig),
      upsert: jest.fn().mockResolvedValue({}),
    };

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: any[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    const service = module.get<RegionDomainService>(RegionDomainService);
    await service.onModuleInit();

    // Federal config should be loaded with unresolved placeholders
    expect(mockLoader.loadFederalPlugin).toHaveBeenCalledTimes(1);
    const resolvedConfig = mockLoader.loadFederalPlugin.mock.calls[0][0];
    expect(
      resolvedConfig.dataSources[0].api.queryParams.contributor_state,
    ).toBe('${stateCode}');
  });
});

/**
 * Tests for campaign finance sync.
 * These need a mock plugin that supports fetchCampaignFinance().
 */
describe('RegionDomainService — campaign finance sync', () => {
  let service: RegionDomainService;
  let mockDb: ReturnType<typeof createMockDbService>;
  let mockPlugin: jest.Mocked<IRegionPlugin> & {
    fetchCampaignFinance: jest.Mock;
  };

  const mockCampaignFinanceResult = {
    committees: [],
    contributions: [
      {
        externalId: 'CONT-1',
        committeeId: 'C001',
        donorName: 'Jane Smith',
        donorType: 'individual',
        amount: 500,
        date: new Date('2026-01-15'),
        sourceSystem: 'fec',
      },
      {
        externalId: 'CONT-2',
        committeeId: 'C001',
        donorName: 'John Doe',
        donorType: 'individual',
        amount: 250,
        date: new Date('2026-02-01'),
        sourceSystem: 'fec',
      },
    ],
    expenditures: [
      {
        externalId: 'EXP-1',
        committeeId: 'C001',
        payeeName: 'Ad Agency LLC',
        amount: 10000,
        date: new Date('2026-03-01'),
        sourceSystem: 'fec',
      },
    ],
    independentExpenditures: [
      {
        externalId: 'IE-1',
        committeeId: 'C002',
        committeeName: 'Super PAC',
        supportOrOppose: 'support',
        amount: 50000,
        date: new Date('2026-06-01'),
        sourceSystem: 'fec',
      },
    ],
  };

  beforeEach(async () => {
    mockDb = createMockDbService();
    mockPlugin = {
      ...createMockPlugin(),
      fetchCampaignFinance: jest
        .fn()
        .mockResolvedValue(mockCampaignFinanceResult),
      getSupportedDataTypes: jest
        .fn()
        .mockReturnValue([
          DataType.PROPOSITIONS,
          DataType.MEETINGS,
          DataType.REPRESENTATIVES,
          DataType.CAMPAIGN_FINANCE,
        ]),
    };

    const localRegistered: RegisteredPlugin = {
      name: 'test-provider',
      instance: mockPlugin as unknown as IRegionPlugin,
      status: 'active',
      loadedAt: new Date(),
    };

    const mockRegistry: any = {
      register: jest.fn().mockResolvedValue(undefined),
      unregister: jest.fn().mockResolvedValue(undefined),
      getActive: jest.fn().mockReturnValue(mockPlugin),
      registerLocal: jest.fn().mockResolvedValue(undefined),
      registerFederal: jest.fn().mockResolvedValue(undefined),
      getLocal: jest.fn().mockReturnValue(mockPlugin),
      getFederal: jest.fn().mockReturnValue(undefined),
      getAll: jest.fn().mockReturnValue([localRegistered]),
      getActiveName: jest.fn().mockReturnValue('test-provider'),
      hasActive: jest.fn().mockReturnValue(true),
      getHealth: jest.fn(),
      getStatus: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    const mockLoader: any = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn().mockResolvedValue(undefined),
    };

    (mockDb as any).regionPlugin = {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    };

    // Set up campaign finance mocks
    (mockDb as any).contribution = {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    };
    (mockDb as any).expenditure = {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    };
    (mockDb as any).independentExpenditure = {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    };

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);

    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: any[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<RegionDomainService>(RegionDomainService);
    await service.onModuleInit();
  });

  it('should create contributions, expenditures, and independent expenditures via syncAll', async () => {
    // syncAll() passes plugin instances directly (not through RegionService wrapper)
    const results = await service.syncAll();

    // Find the campaign_finance result
    const cfResult = results.find(
      (r) => r.dataType === DataType.CAMPAIGN_FINANCE,
    );
    expect(cfResult).toBeDefined();
    expect(cfResult!.itemsProcessed).toBe(4); // 2 contributions + 1 expenditure + 1 IE
    expect(cfResult!.itemsCreated).toBe(4);
    expect(cfResult!.itemsUpdated).toBe(0);
  });

  it('should update existing records matched by externalId via syncAll', async () => {
    // Mock one existing contribution
    (mockDb as any).contribution.findMany.mockResolvedValue([
      { externalId: 'CONT-1' },
    ]);

    const results = await service.syncAll();

    const cfResult = results.find(
      (r) => r.dataType === DataType.CAMPAIGN_FINANCE,
    );
    expect(cfResult).toBeDefined();
    expect(cfResult!.itemsProcessed).toBe(4);
    expect(cfResult!.itemsCreated).toBe(3); // 1 new contribution + 1 expenditure + 1 IE
    expect(cfResult!.itemsUpdated).toBe(1); // 1 existing contribution
  });

  it('should handle provider without fetchCampaignFinance (returns 0 processed)', async () => {
    // syncDataType uses RegionService wrapper which doesn't have fetchCampaignFinance
    const result = await service.syncDataType(DataType.CAMPAIGN_FINANCE);

    expect(result.itemsProcessed).toBe(0);
    expect(result.itemsCreated).toBe(0);
    expect(result.itemsUpdated).toBe(0);
  });

  it('should handle empty campaign finance result via syncAll', async () => {
    mockPlugin.fetchCampaignFinance.mockResolvedValue({
      committees: [],
      contributions: [],
      expenditures: [],
      independentExpenditures: [],
    });

    const results = await service.syncAll();

    const cfResult = results.find(
      (r) => r.dataType === DataType.CAMPAIGN_FINANCE,
    );
    expect(cfResult).toBeDefined();
    expect(cfResult!.itemsProcessed).toBe(0);
    expect(cfResult!.itemsCreated).toBe(0);
  });
});
