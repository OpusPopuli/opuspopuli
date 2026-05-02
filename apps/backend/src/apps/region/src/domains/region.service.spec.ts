import { Test, TestingModule } from '@nestjs/testing';

import {
  extractLastName,
  mapPropositionRecord,
  RegionDomainService,
} from './region.service';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import { PropositionFundingService } from './proposition-funding.service';
import { REGION_CACHE } from './region.tokens';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import {
  DataType,
  PropositionStatus,
  Proposition,
  PluginLoaderService,
  PluginRegistryService,
  type IRegionPlugin,
  type RegisteredPlugin,
} from '@opuspopuli/region-provider';

/** Minimal mock for PluginRegistryService used across test suites. */
interface MockPluginRegistry {
  register: jest.Mock;
  unregister: jest.Mock;
  getActive: jest.Mock;
  registerLocal: jest.Mock;
  registerFederal: jest.Mock;
  getLocal: jest.Mock;
  getFederal: jest.Mock;
  getAll: jest.Mock;
  getActiveName: jest.Mock;
  hasActive: jest.Mock;
  getHealth: jest.Mock;
  getStatus: jest.Mock;
  onModuleDestroy: jest.Mock;
}

/** Minimal mock for PluginLoaderService used across test suites. */
interface MockPluginLoader {
  loadPlugin: jest.Mock;
  loadFederalPlugin: jest.Mock;
  unloadPlugin: jest.Mock;
}

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

function createMockCache() {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    has: jest.fn().mockResolvedValue(false),
    delete: jest.fn().mockResolvedValue(true),
    clear: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn().mockResolvedValue([]),
    size: 0,
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

describe('extractLastName', () => {
  it('extracts last word from "First Last"', () => {
    expect(extractLastName('Juan Alanis')).toBe('Alanis');
  });

  it('extracts last word from "First Middle Last"', () => {
    expect(extractLastName('Cecilia M. Aguiar-Curry')).toBe('Aguiar-Curry');
  });

  it('strips Jr/Sr/III suffixes', () => {
    expect(extractLastName('Patrick J. Ahrens Jr.')).toBe('Ahrens');
    expect(extractLastName('John Doe Sr')).toBe('Doe');
    expect(extractLastName('Frank Smith III')).toBe('Smith');
  });

  it('falls back to trimmed input when no spaces', () => {
    expect(extractLastName('Madonna')).toBe('Madonna');
  });

  it('returns empty for empty input', () => {
    expect(extractLastName('')).toBe('');
    expect(extractLastName('   ')).toBe('');
  });
});

describe('RegionDomainService', () => {
  let service: RegionDomainService;
  let mockDb: MockDbClient;
  let mockPlugin: jest.Mocked<IRegionPlugin>;
  let mockRegistry: MockPluginRegistry;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockDb = createMockDbService();
    mockPlugin = createMockPlugin();
    mockCache = createMockCache();

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

    const mockLoader: MockPluginLoader = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn().mockResolvedValue(undefined),
    };

    // Mock DB regionPlugin: no federal config, no enabled local plugin
    // -> service falls back to ExampleRegionProvider via registerLocal('example', ...)
    // But registry.getLocal() returns our mockPlugin regardless
    mockDb.regionPlugin.findFirst.mockResolvedValue(null);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    // Set up default empty returns for findMany (no existing records)
    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);

    // Set up campaign finance DB mocks
    mockDb.committee.findMany.mockResolvedValue([]);
    mockDb.committee.findUnique.mockResolvedValue(null);
    mockDb.committee.count.mockResolvedValue(0);
    mockDb.committee.upsert.mockResolvedValue({} as never);
    mockDb.committee.create.mockResolvedValue({} as never);

    mockDb.contribution.findMany.mockResolvedValue([]);
    mockDb.contribution.findUnique.mockResolvedValue(null);
    mockDb.contribution.count.mockResolvedValue(0);
    mockDb.contribution.upsert.mockResolvedValue({} as never);

    mockDb.expenditure.findMany.mockResolvedValue([]);
    mockDb.expenditure.findUnique.mockResolvedValue(null);
    mockDb.expenditure.count.mockResolvedValue(0);
    mockDb.expenditure.upsert.mockResolvedValue({} as never);

    mockDb.independentExpenditure.findMany.mockResolvedValue([]);
    mockDb.independentExpenditure.findUnique.mockResolvedValue(null);
    mockDb.independentExpenditure.count.mockResolvedValue(0);
    mockDb.independentExpenditure.upsert.mockResolvedValue({} as never);

    // Set up default $transaction mock
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => {
        return Promise.all(operations);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: REGION_CACHE, useValue: mockCache },
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

    it('should only sync specified data types when filter is provided', async () => {
      const results = await service.syncAll([DataType.PROPOSITIONS]);

      expect(results).toHaveLength(1);
      expect(results[0].dataType).toBe(DataType.PROPOSITIONS);
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should sync multiple specified data types', async () => {
      const results = await service.syncAll([
        DataType.PROPOSITIONS,
        DataType.MEETINGS,
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].dataType).toBe(DataType.PROPOSITIONS);
      expect(results[1].dataType).toBe(DataType.MEETINGS);
      expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should return empty results when filter matches no supported types', async () => {
      const results = await service.syncAll(['nonexistent_type']);

      expect(results).toHaveLength(0);
      expect(mockDb.$transaction).not.toHaveBeenCalled();
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
        { externalId: 'prop-1' } as never,
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
        { externalId: 'meeting-1' } as never,
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
        { externalId: 'rep-1' } as never,
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

      // Verify efficient batching (not 2000 individual calls)
      expect(mockDb.proposition.findMany).toHaveBeenCalledTimes(1);
      // 1000 items / 500 chunk size = 2 batched transactions (#476)
      expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
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
        })) as never,
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
      mockDb.proposition.findMany.mockResolvedValue(mockItems as never);
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
      mockDb.proposition.findMany.mockResolvedValue(mockItems as never);
      mockDb.proposition.count.mockResolvedValue(15);

      const result = await service.getPropositions(0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getProposition', () => {
    it('should return a single proposition by ID', async () => {
      const mockProp = { id: '1', title: 'Test Prop' };
      mockDb.proposition.findUnique.mockResolvedValue(mockProp as never);

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
      mockDb.meeting.findMany.mockResolvedValue(mockItems as never);
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
      mockDb.meeting.findUnique.mockResolvedValue(mockMeeting as never);

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

      mockDb.representative.findMany.mockResolvedValue(mockItems as never);
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
      mockDb.representative.findUnique.mockResolvedValue(mockRep as never);

      const result = await service.getRepresentative('1');

      expect(result).toEqual(mockRep);
    });
  });

  describe('getRepresentativesByDistricts', () => {
    it('should return empty array when no districts provided', async () => {
      // Reset call tracking so we only see calls from our method
      mockDb.representative.findMany.mockClear();

      const result = await service.getRepresentativesByDistricts();

      expect(result).toEqual([]);
      // Should not have called findMany at all (early return)
      expect(mockDb.representative.findMany).not.toHaveBeenCalled();
    });

    it('matches BOTH padded and unpadded district forms for both chambers', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      await service.getRepresentativesByDistricts(
        undefined,
        'State Senate District 5',
        'Assembly District 12',
      );

      // Assembly stores unpadded ("12"), Senate stores padded ("05") — but a
      // future scrape drift in either direction must not silently miss matches.
      expect(mockDb.representative.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { chamber: 'Assembly', district: '12' },
            { chamber: 'Assembly', district: '12' },
            { chamber: 'Senate', district: '05' },
            { chamber: 'Senate', district: '5' },
          ],
        },
        orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
      });
    });

    it('emits both "02" and "2" for a single-digit Senate district', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      await service.getRepresentativesByDistricts(
        undefined,
        'State Senate District 2',
        undefined,
      );

      expect(mockDb.representative.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { chamber: 'Senate', district: '02' },
            { chamber: 'Senate', district: '2' },
          ],
        },
        orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
      });
    });

    it('emits unpadded "12" for an Assembly two-digit district', async () => {
      mockDb.representative.findMany.mockResolvedValue([]);

      await service.getRepresentativesByDistricts(
        undefined,
        undefined,
        'Assembly District 12',
      );

      expect(mockDb.representative.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { chamber: 'Assembly', district: '12' },
            { chamber: 'Assembly', district: '12' },
          ],
        },
        orderBy: [{ chamber: 'asc' }, { lastName: 'asc' }],
      });
    });

    it('should return matching representatives from db', async () => {
      const mockReps = [
        {
          id: '1',
          externalId: 'rep-1',
          name: 'Jane Senator',
          chamber: 'Senate',
          district: '05',
          party: 'Democratic',
          photoUrl: null,
          contactInfo: null,
          bio: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      mockDb.representative.findMany.mockResolvedValue(mockReps as never);

      const result = await service.getRepresentativesByDistricts(
        undefined,
        'State Senate District 5',
        undefined,
      );

      expect(result).toEqual(mockReps);
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
          deletedAt: null,
        },
      ];
      mockDb.committee.findMany.mockResolvedValue(mockItems);
      mockDb.committee.count.mockResolvedValue(1);

      const result = await service.getCommittees(0, 10);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      // Null fields should be converted to undefined
      expect(result.items[0].candidateName).toBeUndefined();
      expect(result.items[0].sourceUrl).toBeUndefined();
    });

    it('should filter by sourceSystem when provided', async () => {
      mockDb.committee.findMany.mockResolvedValue([]);
      mockDb.committee.count.mockResolvedValue(0);

      await service.getCommittees(0, 10, 'cal-access');

      expect(mockDb.committee.findMany).toHaveBeenCalledWith(
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
        deletedAt: null,
      }));
      mockDb.committee.findMany.mockResolvedValue(mockItems);
      mockDb.committee.count.mockResolvedValue(15);

      const result = await service.getCommittees(0, 10);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getCommittee', () => {
    it('should return a single committee by ID', async () => {
      const mockComm = { id: '1', name: 'Test Committee' };
      mockDb.committee.findUnique.mockResolvedValue(mockComm as never);

      const result = await service.getCommittee('1');

      expect(result).toEqual(mockComm);
      expect(mockDb.committee.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if committee not found', async () => {
      mockDb.committee.findUnique.mockResolvedValue(null);

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
          amount: { toNumber: () => 500 } as unknown as Prisma.Decimal, // Prisma Decimal
          date: new Date(),
          electionType: null,
          contributionType: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.contribution.findMany.mockResolvedValue(mockItems as never);
      mockDb.contribution.count.mockResolvedValue(1);

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
      mockDb.contribution.findMany.mockResolvedValue([]);
      mockDb.contribution.count.mockResolvedValue(0);

      await service.getContributions(0, 10, 'comm-1', 'cal-access');

      expect(mockDb.contribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { committeeId: 'comm-1', sourceSystem: 'cal-access' },
        }),
      );
    });
  });

  describe('getContribution', () => {
    it('should return a single contribution by ID', async () => {
      const mockContrib = { id: '1', donorName: 'Jane Smith' };
      mockDb.contribution.findUnique.mockResolvedValue(mockContrib as never);

      const result = await service.getContribution('1');

      expect(result).toEqual(mockContrib);
      expect(mockDb.contribution.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if contribution not found', async () => {
      mockDb.contribution.findUnique.mockResolvedValue(null);

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
          amount: { toNumber: () => 1500 } as unknown as Prisma.Decimal, // Prisma Decimal
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
      mockDb.expenditure.findMany.mockResolvedValue(mockItems as never);
      mockDb.expenditure.count.mockResolvedValue(1);

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
      mockDb.expenditure.findMany.mockResolvedValue([]);
      mockDb.expenditure.count.mockResolvedValue(0);

      await service.getExpenditures(0, 10, 'comm-1', 'cal-access');

      expect(mockDb.expenditure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { committeeId: 'comm-1', sourceSystem: 'cal-access' },
        }),
      );
    });
  });

  describe('getExpenditure', () => {
    it('should return a single expenditure by ID', async () => {
      const mockExp = { id: '1', payeeName: 'Ad Agency Inc' };
      mockDb.expenditure.findUnique.mockResolvedValue(mockExp as never);

      const result = await service.getExpenditure('1');

      expect(result).toEqual(mockExp);
      expect(mockDb.expenditure.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if expenditure not found', async () => {
      mockDb.expenditure.findUnique.mockResolvedValue(null);

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
          amount: { toNumber: () => 25000 } as unknown as Prisma.Decimal, // Prisma Decimal
          date: new Date(),
          electionDate: null,
          description: null,
          sourceSystem: 'cal-access',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.independentExpenditure.findMany.mockResolvedValue(
        mockItems as never,
      );
      mockDb.independentExpenditure.count.mockResolvedValue(1);

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
      mockDb.independentExpenditure.findMany.mockResolvedValue([]);
      mockDb.independentExpenditure.count.mockResolvedValue(0);

      await service.getIndependentExpenditures(
        0,
        10,
        'comm-1',
        'support',
        'cal-access',
      );

      expect(mockDb.independentExpenditure.findMany).toHaveBeenCalledWith(
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
      mockDb.independentExpenditure.findUnique.mockResolvedValue(
        mockIE as never,
      );

      const result = await service.getIndependentExpenditure('1');

      expect(result).toEqual(mockIE);
      expect(mockDb.independentExpenditure.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should return null if independent expenditure not found', async () => {
      mockDb.independentExpenditure.findUnique.mockResolvedValue(null);

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

    const mockRegistry: MockPluginRegistry = {
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

    const mockLoader: MockPluginLoader = {
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

    mockDb.regionPlugin.findFirst.mockResolvedValue(localConfig as never);
    mockDb.regionPlugin.findUnique.mockResolvedValue(federalConfig as never);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: REGION_CACHE, useValue: createMockCache() },
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

    const mockRegistry: MockPluginRegistry = {
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

    const mockLoader: MockPluginLoader = {
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

    mockDb.regionPlugin.findFirst.mockResolvedValue(null); // no local config
    mockDb.regionPlugin.findUnique.mockResolvedValue(federalConfig as never);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: REGION_CACHE, useValue: createMockCache() },
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
  let mockDb: MockDbClient;
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
    committeeMeasureFilings: [],
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

    const mockRegistry: MockPluginRegistry = {
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

    const mockLoader: MockPluginLoader = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn().mockResolvedValue(undefined),
    };

    mockDb.regionPlugin.findFirst.mockResolvedValue(null);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    // Set up campaign finance mocks
    // Committee stubs: first findMany returns empty (no existing), second returns created stubs
    let committeeCallCount = 0;
    mockDb.committee.findMany.mockImplementation((() => {
      committeeCallCount++;
      if (committeeCallCount <= 1) return Promise.resolve([]);
      return Promise.resolve([
        { externalId: 'C001', id: 'uuid-c001' },
        { externalId: 'C002', id: 'uuid-c002' },
      ]);
    }) as never);
    mockDb.committee.create.mockResolvedValue({} as never);

    mockDb.contribution.findMany.mockResolvedValue([]);
    mockDb.contribution.upsert.mockResolvedValue({} as never);

    mockDb.expenditure.findMany.mockResolvedValue([]);
    mockDb.expenditure.upsert.mockResolvedValue({} as never);

    mockDb.independentExpenditure.findMany.mockResolvedValue([]);
    mockDb.independentExpenditure.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);

    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: REGION_CACHE, useValue: createMockCache() },
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
    mockDb.contribution.findMany.mockResolvedValue([
      { externalId: 'CONT-1' } as never,
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
      committeeMeasureFilings: [],
    });

    const results = await service.syncAll();

    const cfResult = results.find(
      (r) => r.dataType === DataType.CAMPAIGN_FINANCE,
    );
    expect(cfResult).toBeDefined();
    expect(cfResult!.itemsProcessed).toBe(0);
    expect(cfResult!.itemsCreated).toBe(0);
  });

  it('creates committee stubs with the sourceSystem of the referencing record (#634)', async () => {
    // Mix one cal_access contribution and one fec IE — each references a
    // distinct committee that doesn't exist yet. The bug being regressed:
    // the committee referenced by the cal_access contribution used to get
    // sourceSystem='fec' on the auto-created stub.
    mockPlugin.fetchCampaignFinance.mockResolvedValue({
      committees: [],
      contributions: [
        {
          externalId: 'CONT-CAL-1',
          committeeId: 'CAL-COMMITTEE-1',
          donorName: 'Jane Donor',
          donorType: 'individual',
          amount: 100,
          date: new Date('2026-01-15'),
          sourceSystem: 'cal_access',
        },
      ],
      expenditures: [],
      independentExpenditures: [
        {
          externalId: 'IE-FEC-1',
          committeeId: 'FEC-COMMITTEE-1',
          committeeName: 'Some PAC',
          supportOrOppose: 'support',
          amount: 5000,
          date: new Date('2026-02-15'),
          sourceSystem: 'fec',
        },
      ],
      committeeMeasureFilings: [],
    });

    await service.syncAll();

    // Two stubs created — one per missing committee. Each tagged with the
    // sourceSystem of the record that referenced it.
    const stubCreations = mockDb.committee.create.mock.calls.map(
      ([args]) => args.data,
    );
    const calAccessStub = stubCreations.find(
      (d: { externalId: string }) => d.externalId === 'CAL-COMMITTEE-1',
    );
    const fecStub = stubCreations.find(
      (d: { externalId: string }) => d.externalId === 'FEC-COMMITTEE-1',
    );
    expect(calAccessStub).toBeDefined();
    expect(calAccessStub!.sourceSystem).toBe('cal_access');
    expect(fecStub).toBeDefined();
    expect(fecStub!.sourceSystem).toBe('fec');
  });
});

/**
 * Tests for Redis caching (#459) and batch transactions (#476).
 * Uses the main test setup with mockCache injected.
 */
describe('RegionDomainService — caching and batch transactions', () => {
  let service: RegionDomainService;
  let mockDb: MockDbClient;
  let mockPlugin: jest.Mocked<IRegionPlugin>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockDb = createMockDbService();
    mockPlugin = createMockPlugin();
    mockCache = createMockCache();

    const localRegistered: RegisteredPlugin = {
      name: 'test-provider',
      instance: mockPlugin,
      status: 'active',
      loadedAt: new Date(),
    };

    const mockRegistry: MockPluginRegistry = {
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

    const mockLoader: MockPluginLoader = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn().mockResolvedValue(undefined),
    };

    mockDb.regionPlugin.findFirst.mockResolvedValue(null);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.proposition.count.mockResolvedValue(0);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.meeting.count.mockResolvedValue(0);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.representative.count.mockResolvedValue(0);

    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => {
        return Promise.all(operations);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: REGION_CACHE, useValue: mockCache },
      ],
    }).compile();

    service = module.get<RegionDomainService>(RegionDomainService);
    await service.onModuleInit();
  });

  // ==========================================
  // CACHING TESTS (#459)
  // ==========================================

  describe('caching', () => {
    it('should return cached propositions on cache hit', async () => {
      const cachedData = {
        items: [{ id: 'cached-1', title: 'Cached Prop' }],
        total: 1,
        hasMore: false,
      };
      mockCache.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await service.getPropositions(0, 10);

      expect(result).toEqual(cachedData);
      expect(mockDb.proposition.findMany).not.toHaveBeenCalled();
      expect(mockDb.proposition.count).not.toHaveBeenCalled();
    });

    it('should cache propositions on cache miss', async () => {
      mockDb.proposition.findMany.mockResolvedValueOnce([
        {
          id: 'prop-1',
          externalId: 'ext-1',
          title: 'Prop 1',
          summary: 'Sum',
          fullText: null,
          status: 'pending',
          electionDate: null,
          sourceUrl: null,
          // Analysis columns added by add_proposition_analysis migration —
          // null on rows that haven't been analyzed yet.
          analysisSummary: null,
          keyProvisions: null,
          fiscalImpact: null,
          yesOutcome: null,
          noOutcome: null,
          existingVsProposed: null,
          analysisSections: null,
          analysisClaims: null,
          analysisSource: null,
          analysisPromptHash: null,
          analysisGeneratedAt: null,
          deletedAt: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ]);
      mockDb.proposition.count.mockResolvedValueOnce(1);

      await service.getPropositions(0, 10);

      expect(mockCache.set).toHaveBeenCalledWith(
        'propositions:0:10',
        expect.any(String),
      );
    });

    it('should return cached meetings on cache hit', async () => {
      const cachedData = {
        items: [{ id: 'cached-m1', title: 'Cached Meeting' }],
        total: 1,
        hasMore: false,
      };
      mockCache.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await service.getMeetings(0, 10);

      expect(result).toEqual(cachedData);
      expect(mockDb.meeting.findMany).not.toHaveBeenCalled();
    });

    it('should return cached representatives on cache hit', async () => {
      const cachedData = {
        items: [{ id: 'cached-r1', name: 'Cached Rep' }],
        total: 1,
        hasMore: false,
      };
      mockCache.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await service.getRepresentatives(0, 10);

      expect(result).toEqual(cachedData);
      expect(mockDb.representative.findMany).not.toHaveBeenCalled();
    });

    it('should include chamber in representatives cache key', async () => {
      mockCache.get.mockResolvedValueOnce(undefined);
      mockDb.representative.findMany.mockResolvedValueOnce([]);
      mockDb.representative.count.mockResolvedValueOnce(0);

      await service.getRepresentatives(0, 10, 'Senate');

      expect(mockCache.set).toHaveBeenCalledWith(
        'representatives:0:10:Senate',
        expect.any(String),
      );
    });
  });

  // ==========================================
  // CACHE INVALIDATION TESTS (#459)
  // ==========================================

  describe('cache invalidation', () => {
    it('should invalidate proposition cache after syncPropositions', async () => {
      mockCache.keys.mockResolvedValueOnce([
        'propositions:0:10',
        'propositions:10:10',
      ]);

      await service.syncDataType(DataType.PROPOSITIONS);

      expect(mockCache.keys).toHaveBeenCalled();
      expect(mockCache.delete).toHaveBeenCalledWith('propositions:0:10');
      expect(mockCache.delete).toHaveBeenCalledWith('propositions:10:10');
    });

    it('should invalidate meeting cache after syncMeetings', async () => {
      mockCache.keys.mockResolvedValueOnce(['meetings:0:10']);

      await service.syncDataType(DataType.MEETINGS);

      expect(mockCache.delete).toHaveBeenCalledWith('meetings:0:10');
    });

    it('should invalidate representative cache after syncRepresentatives', async () => {
      mockCache.keys.mockResolvedValueOnce(['representatives:0:10:all']);

      await service.syncDataType(DataType.REPRESENTATIVES);

      expect(mockCache.delete).toHaveBeenCalledWith('representatives:0:10:all');
    });
  });

  // ==========================================
  // BATCH TRANSACTION TESTS (#476)
  // ==========================================

  describe('batch transactions', () => {
    it('should chunk large datasets into multiple transactions', async () => {
      const manyPropositions = Array.from({ length: 1200 }, (_, i) => ({
        externalId: `prop-${i}`,
        title: `Proposition ${i}`,
        summary: `Summary ${i}`,
        fullText: undefined,
        status: PropositionStatus.PENDING,
        electionDate: undefined,
        sourceUrl: undefined,
      }));
      mockPlugin.fetchPropositions.mockResolvedValueOnce(manyPropositions);

      await service.syncDataType(DataType.PROPOSITIONS);

      // 1200 items / 500 chunk size = 3 transaction calls
      expect(mockDb.$transaction).toHaveBeenCalledTimes(3);
    });

    it('should use single transaction for small datasets', async () => {
      await service.syncDataType(DataType.PROPOSITIONS);

      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});

describe('RegionDomainService — Vault API key resolution', () => {
  // Test the resolveApiKeysFromVault logic by accessing the private method
  // through the service instance. This avoids the complex onModuleInit flow.
  it('should resolve API key from secrets provider when env var is not set', async () => {
    const originalKey = process.env.FEC_API_KEY;
    delete process.env.FEC_API_KEY;

    const mockSecretsProvider = {
      getSecret: jest.fn().mockResolvedValue('vault-fec-key'),
      getSecrets: jest.fn(),
      getName: jest.fn().mockReturnValue('MockSecretsProvider'),
    };

    const mockDb = createMockDbService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        {
          provide: PluginLoaderService,
          useValue: {
            loadPlugin: jest.fn(),
            loadFederalPlugin: jest.fn(),
            unloadPlugin: jest.fn(),
          },
        },
        {
          provide: PluginRegistryService,
          useValue: {
            register: jest.fn(),
            unregister: jest.fn(),
            getActive: jest.fn(),
            registerLocal: jest.fn(),
            registerFederal: jest.fn(),
            getLocal: jest.fn(),
            getFederal: jest.fn(),
            getAll: jest.fn().mockReturnValue([]),
            getActiveName: jest.fn(),
            hasActive: jest.fn(),
            getHealth: jest.fn(),
            getStatus: jest.fn(),
            onModuleDestroy: jest.fn(),
          },
        },
        { provide: DbService, useValue: mockDb },
        {
          provide: REGION_CACHE,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            destroy: jest.fn(),
            keys: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: 'SECRETS_PROVIDER', useValue: mockSecretsProvider },
      ],
    }).compile();

    const service = module.get<RegionDomainService>(RegionDomainService);
    // Call the private method directly
    await (service as unknown as Record<string, () => Promise<void>>)[
      'resolveApiKeysFromVault'
    ]();

    expect(mockSecretsProvider.getSecret).toHaveBeenCalledWith('FEC_API_KEY');
    expect(process.env.FEC_API_KEY).toBe('vault-fec-key');

    if (originalKey) process.env.FEC_API_KEY = originalKey;
    else delete process.env.FEC_API_KEY;
  });

  it('should skip vault resolution when env var is already set', async () => {
    const originalKey = process.env.FEC_API_KEY;
    process.env.FEC_API_KEY = 'existing-key';

    const mockSecretsProvider = {
      getSecret: jest.fn(),
      getSecrets: jest.fn(),
      getName: jest.fn().mockReturnValue('MockSecretsProvider'),
    };

    const mockDb = createMockDbService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        {
          provide: PluginLoaderService,
          useValue: {
            loadPlugin: jest.fn(),
            loadFederalPlugin: jest.fn(),
            unloadPlugin: jest.fn(),
          },
        },
        {
          provide: PluginRegistryService,
          useValue: {
            register: jest.fn(),
            unregister: jest.fn(),
            getActive: jest.fn(),
            registerLocal: jest.fn(),
            registerFederal: jest.fn(),
            getLocal: jest.fn(),
            getFederal: jest.fn(),
            getAll: jest.fn().mockReturnValue([]),
            getActiveName: jest.fn(),
            hasActive: jest.fn(),
            getHealth: jest.fn(),
            getStatus: jest.fn(),
            onModuleDestroy: jest.fn(),
          },
        },
        { provide: DbService, useValue: mockDb },
        {
          provide: REGION_CACHE,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            destroy: jest.fn(),
            keys: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: 'SECRETS_PROVIDER', useValue: mockSecretsProvider },
      ],
    }).compile();

    const service = module.get<RegionDomainService>(RegionDomainService);
    await (service as unknown as Record<string, () => Promise<void>>)[
      'resolveApiKeysFromVault'
    ]();

    expect(mockSecretsProvider.getSecret).not.toHaveBeenCalled();
    expect(process.env.FEC_API_KEY).toBe('existing-key');

    if (originalKey) process.env.FEC_API_KEY = originalKey;
    else delete process.env.FEC_API_KEY;
  });

  it('should handle vault errors gracefully', async () => {
    const originalKey = process.env.FEC_API_KEY;
    delete process.env.FEC_API_KEY;

    const mockSecretsProvider = {
      getSecret: jest.fn().mockRejectedValue(new Error('Vault unavailable')),
      getSecrets: jest.fn(),
      getName: jest.fn().mockReturnValue('MockSecretsProvider'),
    };

    const mockDb = createMockDbService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        {
          provide: PluginLoaderService,
          useValue: {
            loadPlugin: jest.fn(),
            loadFederalPlugin: jest.fn(),
            unloadPlugin: jest.fn(),
          },
        },
        {
          provide: PluginRegistryService,
          useValue: {
            register: jest.fn(),
            unregister: jest.fn(),
            getActive: jest.fn(),
            registerLocal: jest.fn(),
            registerFederal: jest.fn(),
            getLocal: jest.fn(),
            getFederal: jest.fn(),
            getAll: jest.fn().mockReturnValue([]),
            getActiveName: jest.fn(),
            hasActive: jest.fn(),
            getHealth: jest.fn(),
            getStatus: jest.fn(),
            onModuleDestroy: jest.fn(),
          },
        },
        { provide: DbService, useValue: mockDb },
        {
          provide: REGION_CACHE,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            destroy: jest.fn(),
            keys: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: 'SECRETS_PROVIDER', useValue: mockSecretsProvider },
      ],
    }).compile();

    const service = module.get<RegionDomainService>(RegionDomainService);
    // Should NOT throw
    await expect(
      (service as unknown as Record<string, () => Promise<void>>)[
        'resolveApiKeysFromVault'
      ](),
    ).resolves.not.toThrow();
    expect(process.env.FEC_API_KEY).toBeUndefined();

    if (originalKey) process.env.FEC_API_KEY = originalKey;
    else delete process.env.FEC_API_KEY;
  });
});

describe('mapPropositionRecord', () => {
  // Build a Prisma-shaped proposition row with all 11 analysis columns.
  // mapPropositionRecord must coerce SQL nulls to GraphQL undefined and
  // unpack the JSONB columns that Prisma surfaces as `unknown`.
  function row(
    overrides: Partial<Parameters<typeof mapPropositionRecord>[0]> = {},
  ) {
    const now = new Date('2026-04-25T00:00:00Z');
    return {
      id: 'prop-1',
      externalId: 'SCA 1',
      title: 'Test',
      summary: 'A measure.',
      fullText: null,
      status: 'pending',
      electionDate: null,
      sourceUrl: null,
      analysisSummary: null,
      keyProvisions: null,
      fiscalImpact: null,
      yesOutcome: null,
      noOutcome: null,
      existingVsProposed: null,
      analysisSections: null,
      analysisClaims: null,
      analysisSource: null,
      analysisPromptHash: null,
      analysisGeneratedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as Parameters<typeof mapPropositionRecord>[0];
  }

  it('converts every db null to GraphQL undefined', () => {
    const out = mapPropositionRecord(row());
    expect(out.fullText).toBeUndefined();
    expect(out.electionDate).toBeUndefined();
    expect(out.sourceUrl).toBeUndefined();
    expect(out.analysisSummary).toBeUndefined();
    expect(out.keyProvisions).toBeUndefined();
    expect(out.fiscalImpact).toBeUndefined();
    expect(out.yesOutcome).toBeUndefined();
    expect(out.noOutcome).toBeUndefined();
    expect(out.existingVsProposed).toBeUndefined();
    expect(out.analysisSections).toBeUndefined();
    expect(out.analysisClaims).toBeUndefined();
    expect(out.analysisSource).toBeUndefined();
    expect(out.analysisGeneratedAt).toBeUndefined();
  });

  it('unpacks JSONB array columns when populated', () => {
    const out = mapPropositionRecord(
      row({
        keyProvisions: ['Provision A', 'Provision B'],
        analysisSections: [
          { heading: 'Findings', startOffset: 0, endOffset: 50 },
        ],
        analysisClaims: [
          {
            claim: 'X',
            field: 'keyProvisions',
            sourceStart: 0,
            sourceEnd: 5,
            confidence: 'high',
          },
        ],
      }),
    );
    expect(out.keyProvisions).toEqual(['Provision A', 'Provision B']);
    expect(out.analysisSections).toHaveLength(1);
    expect(out.analysisClaims).toHaveLength(1);
  });

  it('emits existingVsProposed only when the JSONB blob has the expected shape', () => {
    const ok = mapPropositionRecord(
      row({
        existingVsProposed: { current: 'Today', proposed: 'Tomorrow' },
      }),
    );
    expect(ok.existingVsProposed).toEqual({
      current: 'Today',
      proposed: 'Tomorrow',
    });

    const malformed = mapPropositionRecord(
      row({ existingVsProposed: { only: 'wrong shape' } }),
    );
    expect(malformed.existingVsProposed).toBeUndefined();
  });

  it('drops jsonb columns that arrive in unexpected shapes', () => {
    const out = mapPropositionRecord(
      row({
        // Not arrays — defensive code should drop these.
        keyProvisions: { not: 'array' },
        analysisSections: 'not array either',
        analysisClaims: 42,
      }),
    );
    expect(out.keyProvisions).toBeUndefined();
    expect(out.analysisSections).toBeUndefined();
    expect(out.analysisClaims).toBeUndefined();
  });
});

describe('RegionDomainService — proposition analysis wiring', () => {
  /**
   * Builds a service instance that has the optional PropositionAnalysisService
   * dependency wired up so we can verify the post-sync hook invokes the
   * analyzer and the regenerate path forwards through cleanly. The default
   * spec setup leaves propositionAnalysis undefined; here we explicitly
   * inject a mock for the wiring tests.
   */
  async function buildService(
    opts: {
      analyzer?: Partial<jest.Mocked<PropositionAnalysisService>>;
    } = {},
  ) {
    const mockDb = createMockDbService();
    mockDb.regionPlugin.findFirst.mockResolvedValue(null);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);
    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const mockPlugin = {
      getName: jest.fn().mockReturnValue('test-provider'),
      getRegionInfo: jest.fn().mockReturnValue({
        id: 'r',
        name: 'R',
        description: 'd',
        timezone: 'America/Los_Angeles',
      }),
      getSupportedDataTypes: jest.fn().mockReturnValue([DataType.PROPOSITIONS]),
      getProviderName: jest.fn().mockReturnValue('test-provider'),
      getVersion: jest.fn().mockReturnValue('1.0.0'),
      initialize: jest.fn(),
      destroy: jest.fn(),
      healthCheck: jest.fn(),
      fetchPropositions: jest.fn().mockResolvedValue([]),
      fetchMeetings: jest.fn().mockResolvedValue([]),
      fetchRepresentatives: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IRegionPlugin>;

    const localRegistered: RegisteredPlugin = {
      name: 'test-provider',
      instance: mockPlugin,
      status: 'active',
      loadedAt: new Date(),
    };

    const mockRegistry = {
      register: jest.fn(),
      unregister: jest.fn(),
      getActive: jest.fn().mockReturnValue(mockPlugin),
      registerLocal: jest.fn(),
      registerFederal: jest.fn(),
      getLocal: jest.fn().mockReturnValue(mockPlugin),
      getFederal: jest.fn().mockReturnValue(undefined),
      getAll: jest.fn().mockReturnValue([localRegistered]),
      getActiveName: jest.fn().mockReturnValue('test-provider'),
      hasActive: jest.fn().mockReturnValue(true),
      getHealth: jest.fn(),
      getStatus: jest.fn(),
      onModuleDestroy: jest.fn(),
    };
    const mockLoader = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn(),
    };
    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      destroy: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
    };

    const analyzer = {
      generate: jest.fn().mockResolvedValue(true),
      generateMissing: jest.fn().mockResolvedValue(undefined),
      ...opts.analyzer,
    } as unknown as jest.Mocked<PropositionAnalysisService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: REGION_CACHE, useValue: mockCache },
        { provide: PropositionAnalysisService, useValue: analyzer },
      ],
    }).compile();

    const svc = module.get<RegionDomainService>(RegionDomainService);
    await svc.onModuleInit();
    return { service: svc, analyzer, mockPlugin, mockDb, mockCache };
  }

  describe('regeneratePropositionAnalysis', () => {
    it('forwards to the analyzer with force=true and invalidates cache on success', async () => {
      const { service, analyzer, mockCache } = await buildService();

      await expect(
        service.regeneratePropositionAnalysis('prop-1'),
      ).resolves.toBe(true);

      expect(analyzer.generate).toHaveBeenCalledWith('prop-1', true);
      // Cache invalidation runs through keys() → delete(); we just need
      // to verify the cache was probed for matching keys.
      expect(mockCache.keys).toHaveBeenCalled();
    });

    it('does not invalidate cache when the analyzer reports no work was done', async () => {
      const { service, analyzer, mockCache } = await buildService({
        analyzer: { generate: jest.fn().mockResolvedValue(false) },
      });

      await expect(
        service.regeneratePropositionAnalysis('prop-1'),
      ).resolves.toBe(false);

      expect(analyzer.generate).toHaveBeenCalledWith('prop-1', true);
      expect(mockCache.keys).not.toHaveBeenCalled();
    });
  });

  describe('post-sync analyzer hook', () => {
    it('calls generateMissing after a propositions sync', async () => {
      const { service, analyzer, mockPlugin } = await buildService();
      mockPlugin.fetchPropositions.mockResolvedValueOnce([
        {
          externalId: 'SCA 1',
          title: 'Test',
          summary: 'sum',
          status: PropositionStatus.PENDING,
        } as Proposition,
      ]);

      await service.syncDataType(DataType.PROPOSITIONS);

      expect(analyzer.generateMissing).toHaveBeenCalledTimes(1);
    });

    it('keeps the sync result successful when the analyzer hook throws', async () => {
      const { service, analyzer, mockPlugin } = await buildService({
        analyzer: {
          generateMissing: jest
            .fn()
            .mockRejectedValue(new Error('analyzer down')),
        },
      });
      mockPlugin.fetchPropositions.mockResolvedValueOnce([
        {
          externalId: 'SCA 1',
          title: 'Test',
          summary: 'sum',
          status: PropositionStatus.PENDING,
        } as Proposition,
      ]);

      const result = await service.syncDataType(DataType.PROPOSITIONS);

      expect(result.errors).toEqual([]);
      expect(analyzer.generateMissing).toHaveBeenCalled();
    });
  });

  describe('regeneratePropositionAnalysis when analyzer is not provided', () => {
    it('returns false when the optional dependency is absent', async () => {
      // Build a service without the PropositionAnalysisService provider so
      // the constructor leaves it undefined.
      const mockDb = createMockDbService();
      mockDb.regionPlugin.findFirst.mockResolvedValue(null);
      mockDb.regionPlugin.findUnique.mockResolvedValue(null);
      mockDb.regionPlugin.upsert.mockResolvedValue({} as never);
      mockDb.proposition.findMany.mockResolvedValue([]);
      const mockPlugin = {
        getName: jest.fn().mockReturnValue('test'),
        getRegionInfo: jest.fn().mockReturnValue({
          id: 'r',
          name: 'R',
          description: 'd',
          timezone: 'America/Los_Angeles',
        }),
        getSupportedDataTypes: jest.fn().mockReturnValue([]),
        getProviderName: jest.fn().mockReturnValue('test'),
        fetchPropositions: jest.fn().mockResolvedValue([]),
        fetchMeetings: jest.fn().mockResolvedValue([]),
        fetchRepresentatives: jest.fn().mockResolvedValue([]),
      } as unknown as jest.Mocked<IRegionPlugin>;
      const mockRegistry = {
        register: jest.fn(),
        unregister: jest.fn(),
        getActive: jest.fn().mockReturnValue(mockPlugin),
        registerLocal: jest.fn(),
        registerFederal: jest.fn(),
        getLocal: jest.fn().mockReturnValue(mockPlugin),
        getFederal: jest.fn().mockReturnValue(undefined),
        getAll: jest.fn().mockReturnValue([]),
        getActiveName: jest.fn().mockReturnValue('test'),
        hasActive: jest.fn().mockReturnValue(true),
        getHealth: jest.fn(),
        getStatus: jest.fn(),
        onModuleDestroy: jest.fn(),
      };
      const mockLoader = {
        loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
        loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
        unloadPlugin: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RegionDomainService,
          { provide: PluginLoaderService, useValue: mockLoader },
          { provide: PluginRegistryService, useValue: mockRegistry },
          { provide: DbService, useValue: mockDb },
          {
            provide: REGION_CACHE,
            useValue: {
              get: jest.fn(),
              set: jest.fn(),
              delete: jest.fn(),
              destroy: jest.fn(),
              keys: jest.fn().mockResolvedValue([]),
            },
          },
        ],
      }).compile();
      const svc = module.get<RegionDomainService>(RegionDomainService);
      await svc.onModuleInit();

      await expect(svc.regeneratePropositionAnalysis('prop-1')).resolves.toBe(
        false,
      );
    });
  });
});

describe('RegionDomainService — proposition finance wiring', () => {
  /**
   * Build a service with PropositionFinanceLinkerService + PropositionFundingService
   * mocks injected. Mirrors the proposition-analysis-wiring helper above so
   * the linker hook + funding getter both have a clean test surface.
   */
  async function buildService(
    opts: {
      linker?: { linkAll: jest.Mock };
      funding?: { getFunding: jest.Mock };
    } = {},
  ) {
    const mockDb = createMockDbService();
    mockDb.regionPlugin.findFirst.mockResolvedValue(null);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);
    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.committee.findMany.mockResolvedValue([]);
    mockDb.contribution.findMany.mockResolvedValue([]);
    mockDb.expenditure.findMany.mockResolvedValue([]);
    mockDb.independentExpenditure.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const fetchCampaignFinance = jest.fn().mockResolvedValue({
      committees: [],
      contributions: [],
      expenditures: [],
      independentExpenditures: [],
      committeeMeasureFilings: [],
    });

    const mockPlugin = {
      getName: jest.fn().mockReturnValue('test'),
      getRegionInfo: jest.fn().mockReturnValue({
        id: 'r',
        name: 'R',
        description: 'd',
        timezone: 'America/Los_Angeles',
      }),
      getSupportedDataTypes: jest
        .fn()
        .mockReturnValue([DataType.CAMPAIGN_FINANCE]),
      getProviderName: jest.fn().mockReturnValue('test'),
      fetchPropositions: jest.fn().mockResolvedValue([]),
      fetchMeetings: jest.fn().mockResolvedValue([]),
      fetchRepresentatives: jest.fn().mockResolvedValue([]),
      fetchCampaignFinance,
    } as unknown as jest.Mocked<IRegionPlugin> & {
      fetchCampaignFinance: jest.Mock;
    };

    const localRegistered: RegisteredPlugin = {
      name: 'test',
      instance: mockPlugin,
      status: 'active',
      loadedAt: new Date(),
    };

    const mockRegistry = {
      register: jest.fn(),
      unregister: jest.fn(),
      getActive: jest.fn().mockReturnValue(mockPlugin),
      registerLocal: jest.fn(),
      registerFederal: jest.fn(),
      getLocal: jest.fn().mockReturnValue(mockPlugin),
      getFederal: jest.fn().mockReturnValue(undefined),
      getAll: jest.fn().mockReturnValue([localRegistered]),
      getActiveName: jest.fn().mockReturnValue('test'),
      hasActive: jest.fn().mockReturnValue(true),
      getHealth: jest.fn(),
      getStatus: jest.fn(),
      onModuleDestroy: jest.fn(),
    };
    const mockLoader = {
      loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
      loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
      unloadPlugin: jest.fn(),
    };

    const linker = {
      linkAll: jest.fn().mockResolvedValue({
        cvr2Resolved: 0,
        cvr2Skipped: 0,
        expenditureLinked: 0,
        independentExpenditureLinked: 0,
        inferredPositions: 0,
      }),
      ...opts.linker,
    };
    const funding = {
      getFunding: jest.fn().mockResolvedValue({
        propositionId: 'prop-1',
        asOf: new Date(),
        support: {
          totalRaised: 0,
          totalSpent: 0,
          donorCount: 0,
          committeeCount: 0,
          topDonors: [],
          primaryCommittees: [],
        },
        oppose: {
          totalRaised: 0,
          totalSpent: 0,
          donorCount: 0,
          committeeCount: 0,
          topDonors: [],
          primaryCommittees: [],
        },
      }),
      ...opts.funding,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegionDomainService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        {
          provide: REGION_CACHE,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            delete: jest.fn(),
            destroy: jest.fn(),
            keys: jest.fn().mockResolvedValue([]),
          },
        },
        // The new optional deps under test:
        { provide: PropositionFinanceLinkerService, useValue: linker },
        { provide: PropositionFundingService, useValue: funding },
      ],
    }).compile();

    const svc = module.get<RegionDomainService>(RegionDomainService);
    await svc.onModuleInit();
    return { service: svc, linker, funding, fetchCampaignFinance };
  }

  describe('post-sync linker hook', () => {
    it('runs the linker after a campaign-finance sync', async () => {
      // syncAll uses the plugin instance directly (which has
      // fetchCampaignFinance), unlike syncDataType which goes through the
      // RegionProviderService wrapper that doesn't forward that method.
      const { service, linker } = await buildService();
      await service.syncAll([DataType.CAMPAIGN_FINANCE]);
      expect(linker.linkAll).toHaveBeenCalledTimes(1);
    });

    it('keeps the sync result successful when the linker throws', async () => {
      const { service, linker } = await buildService({
        linker: {
          linkAll: jest.fn().mockRejectedValue(new Error('linker boom')),
        },
      });

      const results = await service.syncAll([DataType.CAMPAIGN_FINANCE]);
      const cf = results.find((r) => r.dataType === DataType.CAMPAIGN_FINANCE);
      expect(cf?.errors).toEqual([]);
      expect(linker.linkAll).toHaveBeenCalled();
    });
  });

  describe('getPropositionFunding', () => {
    it('delegates to the funding service when available', async () => {
      const { service, funding } = await buildService();
      const out = await service.getPropositionFunding('prop-1');
      expect(funding.getFunding).toHaveBeenCalledWith('prop-1');
      expect(out).not.toBeNull();
    });
  });

  describe('getPropositionFunding when funding service is absent', () => {
    it('returns null', async () => {
      // Build a bare-bones service without the funding provider.
      const mockDb = createMockDbService();
      mockDb.regionPlugin.findFirst.mockResolvedValue(null);
      mockDb.regionPlugin.findUnique.mockResolvedValue(null);
      mockDb.regionPlugin.upsert.mockResolvedValue({} as never);
      mockDb.proposition.findMany.mockResolvedValue([]);
      const mockPlugin = {
        getName: jest.fn().mockReturnValue('t'),
        getRegionInfo: jest.fn().mockReturnValue({
          id: 'r',
          name: 'R',
          description: 'd',
          timezone: 'America/Los_Angeles',
        }),
        getSupportedDataTypes: jest.fn().mockReturnValue([]),
        getProviderName: jest.fn().mockReturnValue('t'),
        fetchPropositions: jest.fn().mockResolvedValue([]),
        fetchMeetings: jest.fn().mockResolvedValue([]),
        fetchRepresentatives: jest.fn().mockResolvedValue([]),
      } as unknown as jest.Mocked<IRegionPlugin>;
      const mockRegistry = {
        register: jest.fn(),
        unregister: jest.fn(),
        getActive: jest.fn().mockReturnValue(mockPlugin),
        registerLocal: jest.fn(),
        registerFederal: jest.fn(),
        getLocal: jest.fn().mockReturnValue(mockPlugin),
        getFederal: jest.fn().mockReturnValue(undefined),
        getAll: jest.fn().mockReturnValue([]),
        getActiveName: jest.fn().mockReturnValue('t'),
        hasActive: jest.fn().mockReturnValue(true),
        getHealth: jest.fn(),
        getStatus: jest.fn(),
        onModuleDestroy: jest.fn(),
      };
      const mockLoader = {
        loadPlugin: jest.fn().mockResolvedValue(mockPlugin),
        loadFederalPlugin: jest.fn().mockResolvedValue(mockPlugin),
        unloadPlugin: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RegionDomainService,
          { provide: PluginLoaderService, useValue: mockLoader },
          { provide: PluginRegistryService, useValue: mockRegistry },
          { provide: DbService, useValue: mockDb },
          {
            provide: REGION_CACHE,
            useValue: {
              get: jest.fn(),
              set: jest.fn(),
              delete: jest.fn(),
              destroy: jest.fn(),
              keys: jest.fn().mockResolvedValue([]),
            },
          },
        ],
      }).compile();
      const svc = module.get<RegionDomainService>(RegionDomainService);
      await svc.onModuleInit();

      await expect(svc.getPropositionFunding('prop-1')).resolves.toBeNull();
    });
  });
});
