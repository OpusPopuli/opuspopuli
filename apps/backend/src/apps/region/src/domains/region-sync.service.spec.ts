import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { RegionSyncService } from './region-sync.service';
import { RegionCacheService } from './region-cache.service';
import { REGION_CACHE } from './region.tokens';
import { PropositionAnalysisService } from './proposition-analysis.service';
import { PropositionFinanceLinkerService } from './proposition-finance-linker.service';
import { DbService } from '@opuspopuli/relationaldb-provider';
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

// ─── Core RegionSyncService tests ─────────────────────────────────────────────

describe('RegionSyncService', () => {
  let service: RegionSyncService;
  let mockDb: MockDbClient;
  let mockPlugin: jest.Mocked<IRegionPlugin>;
  let mockRegistry: MockPluginRegistry;
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

    mockRegistry = {
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

    mockDb.regionPlugin.findMany.mockResolvedValue([]);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.proposition.updateMany.mockResolvedValue({ count: 0 } as never);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.civicsBlock.findMany.mockResolvedValue([]);

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

    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => {
        return Promise.all(operations);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: REGION_CACHE, useValue: mockCache },
        RegionCacheService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        RegionSyncService,
      ],
    }).compile();

    service = module.get<RegionSyncService>(RegionSyncService);
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

  describe('active-plugin hot-swap (#796)', () => {
    it('re-queries region_plugins and swaps the active local plugin on refresh', async () => {
      mockDb.regionPlugin.findMany.mockClear();
      mockRegistry.unregister.mockClear();

      await service.refreshActiveLocalPlugin();

      // Re-reads the enabled rows
      expect(mockDb.regionPlugin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, name: { not: 'federal' } },
        }),
      );
      // Tears the slot down before re-init
      expect(mockRegistry.unregister).toHaveBeenCalled();
    });

    it('setRegionPluginEnabled triggers a hot-swap after the DB update', async () => {
      mockDb.regionPlugin.update.mockResolvedValue({
        name: 'california',
        displayName: 'California',
        description: null,
        version: '1.0.0',
        enabled: true,
        parentRegionId: null,
        fipsCode: '06',
      } as never);
      mockDb.regionPlugin.findMany.mockClear();

      await service.setRegionPluginEnabled('california', true);

      // The findMany after the update is the refresh — proves the in-memory
      // pointer hot-swaps without a service restart.
      expect(mockDb.regionPlugin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, name: { not: 'federal' } },
        }),
      );
    });

    it('throws when no local plugin is available after refresh', async () => {
      mockRegistry.getLocal.mockReturnValueOnce(undefined);

      await expect(service.refreshActiveLocalPlugin()).rejects.toThrow(
        /No local region plugin available/,
      );
    });

    it('setRegionPluginEnabled triggers a hot-swap when disabling a plugin', async () => {
      // Same shape as the enable test — proves the refresh fires regardless
      // of direction, not just when enabled flips true.
      mockDb.regionPlugin.update.mockResolvedValue({
        name: 'california',
        displayName: 'California',
        description: null,
        version: '1.0.0',
        enabled: false,
        parentRegionId: null,
        fipsCode: '06',
      } as never);
      mockDb.regionPlugin.findMany.mockClear();
      mockRegistry.unregister.mockClear();

      await service.setRegionPluginEnabled('california', false);

      expect(mockRegistry.unregister).toHaveBeenCalled();
      expect(mockDb.regionPlugin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, name: { not: 'federal' } },
        }),
      );
    });

    it('syncAll() re-reads enabled plugins before dispatch — closes worker-process drift', async () => {
      // The region-worker is a separate Nest instance with its own in-memory
      // PluginRegistry. When an admin enables a plugin via the region
      // service's mutation, the worker's registry doesn't see it until the
      // next process restart — silently producing "Processed 0 data type(s)"
      // syncs. Guard: every syncAll() must re-read the DB before dispatch.
      mockDb.regionPlugin.findMany.mockClear();

      await service.syncAll();

      expect(mockDb.regionPlugin.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true, name: { not: 'federal' } },
        }),
      );
    });

    it('back-to-back toggles end in the state of the last call', async () => {
      // Two rapid awaits — the in-memory state after the second resolve
      // should reflect the second call's enabled value, not the first. This
      // smoke-tests that the refresh doesn't have an order-of-operations
      // bug where the first refresh's tail races with the second's head.
      mockDb.regionPlugin.update.mockResolvedValue({
        name: 'california',
        displayName: 'California',
        description: null,
        version: '1.0.0',
        enabled: true,
        parentRegionId: null,
        fipsCode: '06',
      } as never);
      // Clear the boot-time refresh that beforeEach() already triggered.
      mockRegistry.unregister.mockClear();
      mockDb.regionPlugin.findMany.mockClear();

      await service.setRegionPluginEnabled('california', false);
      await service.setRegionPluginEnabled('california', true);

      // Two toggles → two unregister + two findMany cycles.
      expect(mockRegistry.unregister).toHaveBeenCalledTimes(2);
      expect(mockDb.regionPlugin.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('syncAll', () => {
    it('should sync all data types from all plugins and return results', async () => {
      const results = await service.syncAll();

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
      mockDb.proposition.findMany.mockResolvedValue([]);

      const result = await service.syncDataType(DataType.PROPOSITIONS);

      expect(result.itemsCreated).toBe(1);
      expect(result.itemsUpdated).toBe(0);
      expect(result.itemsProcessed).toBe(1);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it('should update existing propositions using bulk upsert', async () => {
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

  describe('phase observability', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      // The orchestrator constructs its own Logger instance internally —
      // intercept the prototype so each per-phase tracker call gets
      // captured no matter which Logger instance lives in which method.
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
        /* swallow — test asserts via spy, not real stdout */
      });
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    // Concatenate every captured log call into a single haystack so
    // tests can assert "did phase X complete before phase Y started?"
    // ordering without per-call indexing fragility.
    const logTranscript = (): string =>
      logSpy.mock.calls.map((c) => String(c[0])).join('\n');

    it('emits all 3 propositions phases in order: discover → extract_and_upsert → analysis', async () => {
      mockDb.proposition.findMany.mockResolvedValue([]);

      await service.syncDataType(DataType.PROPOSITIONS);

      const transcript = logTranscript();
      const phase1Start = transcript.indexOf(
        '[PropositionSync] Phase 1/3 (discover) starting',
      );
      const phase1Complete = transcript.indexOf(
        '[PropositionSync] Phase 1/3 (discover) complete',
      );
      const phase2Start = transcript.indexOf(
        '[PropositionSync] Phase 2/3 (extract_and_upsert) starting',
      );
      const phase2Complete = transcript.indexOf(
        '[PropositionSync] Phase 2/3 (extract_and_upsert) complete',
      );
      const phase3Start = transcript.indexOf(
        '[PropositionSync] Phase 3/3 (analysis) starting',
      );

      // Every phase fires.
      expect(phase1Start).toBeGreaterThanOrEqual(0);
      expect(phase1Complete).toBeGreaterThanOrEqual(0);
      expect(phase2Start).toBeGreaterThanOrEqual(0);
      expect(phase2Complete).toBeGreaterThanOrEqual(0);
      expect(phase3Start).toBeGreaterThanOrEqual(0);

      // Phase ordering is strict — no overlap. The campaign-finance
      // blocker that triggered this test was specifically a phase-2
      // start landing before phase-1 complete.
      expect(phase1Complete).toBeGreaterThan(phase1Start);
      expect(phase2Start).toBeGreaterThan(phase1Complete);
      expect(phase2Complete).toBeGreaterThan(phase2Start);
      expect(phase3Start).toBeGreaterThan(phase2Complete);
    });

    it('per-item line distinguishes created vs updated when the row exists', async () => {
      // First call (existence check pre-fetch) → row exists.
      // Second call (upsertByExternalId's own check) → also exists.
      // Both must return the externalId so the orchestrator marks it
      // as 'updated' not 'created'.
      mockDb.proposition.findMany.mockResolvedValue([
        { externalId: 'prop-1' } as never,
      ]);

      await service.syncDataType(DataType.PROPOSITIONS);

      const transcript = logTranscript();
      // The per-item line must report "updated" because the row
      // already existed. Pre-fix this would have logged "queued for
      // upsert" with a fictional 'updated' outcome.
      expect(transcript).toMatch(
        /\[PropositionSync\] Phase 2\/3 \[1\/1\].*: updated/,
      );
      expect(transcript).not.toMatch(
        /\[PropositionSync\] Phase 2\/3 \[1\/1\].*: created/,
      );
    });

    it('per-item line reports created when the row is new', async () => {
      mockDb.proposition.findMany.mockResolvedValue([]); // no existing rows

      await service.syncDataType(DataType.PROPOSITIONS);

      const transcript = logTranscript();
      expect(transcript).toMatch(
        /\[PropositionSync\] Phase 2\/3 \[1\/1\].*: created/,
      );
      expect(transcript).not.toMatch(
        /\[PropositionSync\] Phase 2\/3 \[1\/1\].*: updated/,
      );
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
    it('should use only 2 SELECT queries + transaction(s) per sync', async () => {
      mockDb.proposition.findMany.mockResolvedValue([]);

      await service.syncDataType(DataType.PROPOSITIONS);

      // 1st findMany: pre-fetch existing externalIds for the per-item
      // observability log to report accurate created-vs-updated.
      // 2nd findMany: upsertByExternalId's internal existence check.
      // The double query is the cost of accurate per-item observability;
      // each is a bounded single bulk SELECT, no N+1.
      expect(mockDb.proposition.findMany).toHaveBeenCalledTimes(2);
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should handle large datasets (1000+ records) efficiently', async () => {
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

      expect(result.itemsProcessed).toBe(1000);
      expect(result.itemsCreated).toBe(1000);

      // Two findMany at 1000 rows scales identically — no N+1 even at
      // bulk scale. The observability pre-fetch is a single SELECT.
      expect(mockDb.proposition.findMany).toHaveBeenCalledTimes(2);
      // 1000 items / 500 chunk size = 2 batched transactions (#476)
      expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
    });

    it('should correctly identify creates vs updates in mixed batch', async () => {
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

      mockDb.proposition.findMany.mockResolvedValue(
        Array.from({ length: 500 }, (_, i) => ({
          externalId: `prop-${i}`,
        })) as never,
      );

      const result = await service.syncDataType(DataType.PROPOSITIONS);

      expect(result.itemsProcessed).toBe(1000);
      expect(result.itemsCreated).toBe(500);
      expect(result.itemsUpdated).toBe(500);
    });
  });

  describe('upsertByExternalId helper (via syncDataType)', () => {
    it('invalidates cache after upsert', async () => {
      mockCache.keys.mockResolvedValue([
        'propositions:all',
        'propositions:page-1',
        'other:key',
      ]);
      mockDb.proposition.findMany.mockResolvedValue([]);

      await service.syncDataType(DataType.PROPOSITIONS);

      expect(mockCache.keys).toHaveBeenCalled();
      expect(mockCache.delete).toHaveBeenCalledTimes(2);
      expect(mockCache.delete).toHaveBeenCalledWith('propositions:all');
      expect(mockCache.delete).toHaveBeenCalledWith('propositions:page-1');
      expect(mockCache.delete).not.toHaveBeenCalledWith('other:key');
    });

    it('skips upsert and cache invalidation when provider returns no items', async () => {
      mockPlugin.fetchPropositions.mockResolvedValue([]);

      await service.syncDataType(DataType.PROPOSITIONS);

      expect(mockDb.proposition.findMany).not.toHaveBeenCalled();
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockCache.keys).not.toHaveBeenCalled();
    });

    it('falls through to syncMeetingMinutes when meetings list is empty', async () => {
      mockPlugin.fetchMeetings.mockResolvedValue([]);
      const result = await service.syncDataType(DataType.MEETINGS);

      expect(mockDb.meeting.findMany).not.toHaveBeenCalled();
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(result.itemsProcessed).toBe(0);
    });

    it('sums meeting + minutes counts when both are non-empty', async () => {
      mockDb.meeting.findMany.mockResolvedValue([]);
      const result = await service.syncDataType(DataType.MEETINGS);

      expect(result.itemsCreated).toBe(1);
      expect(result.itemsProcessed).toBe(1);
    });
  });

  describe('extractBillStatusFields — status-only re-check parser (#689)', () => {
    // Synthetic snippet mirroring leginfo billStatusClient.xhtml structure:
    // <span id="lastAction">M/D/YY</span> + first action-history row.
    const sampleHtml = `
      <div>
        <span id="lastAction" class="statusLabel">10/09/25</span>
      </div>
      <table>
        <tbody>
          <tr>
            <td scope="row">10/09/25</td>
            <td>Chaptered by Secretary of State - Chapter 472, Statutes of 2025.</td>
          </tr>
          <tr>
            <td scope="row">10/09/25</td>
            <td>Approved by the Governor.</td>
          </tr>
        </tbody>
      </table>
    `;

    it('extracts lastAction (first history row) + lastActionDate (M/D/YY → UTC)', () => {
      const result = (
        service as unknown as {
          extractBillStatusFields: (h: string) => {
            lastAction: string | null;
            lastActionDate: Date | null;
          };
        }
      ).extractBillStatusFields(sampleHtml);
      expect(result.lastAction).toBe(
        'Chaptered by Secretary of State - Chapter 472, Statutes of 2025.',
      );
      expect(result.lastActionDate?.toISOString()).toBe(
        '2025-10-09T00:00:00.000Z',
      );
    });

    it('returns nulls when the page structure does not match (caller falls through to LLM)', () => {
      const result = (
        service as unknown as {
          extractBillStatusFields: (h: string) => {
            lastAction: string | null;
            lastActionDate: Date | null;
          };
        }
      ).extractBillStatusFields(
        '<html><body>nothing useful here</body></html>',
      );
      expect(result.lastAction).toBeNull();
      expect(result.lastActionDate).toBeNull();
    });
  });

  describe('tryStatusOnlyRecheck — status-only re-check gate (#689)', () => {
    // Sample real-leginfo-shaped HTML; the parser path is covered by the
    // extractBillStatusFields tests above. These tests focus on the gate
    // logic: when to read, when to fetch, when to clear the flag.
    const matchingHtml = `
      <span id="lastAction" class="statusLabel">10/09/25</span>
      <table><tbody>
        <tr><td scope="row">10/09/25</td><td>Chaptered by Secretary of State - Chapter 472, Statutes of 2025.</td></tr>
      </tbody></table>
    `;

    type Recheck = (
      url: string,
      force: boolean,
      existing:
        | {
            id: string;
            externalId: string;
            sourcePublishedAt: Date | null;
            lastAction: string | null;
            lastActionDate: Date | null;
            needsStatusRecheck: boolean;
          }
        | undefined,
    ) => Promise<'unchanged' | 'no-recheck-needed' | 'fall-through'>;
    const callRecheck = (svc: RegionSyncService) =>
      (
        svc as unknown as { tryStatusOnlyRecheck: Recheck }
      ).tryStatusOnlyRecheck.bind(svc);

    const mkExisting = (
      overrides: Partial<{
        lastAction: string | null;
        lastActionDate: Date | null;
        needsStatusRecheck: boolean;
      }> = {},
    ) => ({
      id: 'bill-uuid',
      externalId: '202520260AB1',
      sourcePublishedAt: null,
      lastAction:
        'Chaptered by Secretary of State - Chapter 472, Statutes of 2025.',
      lastActionDate: new Date(Date.UTC(2025, 9, 9)),
      needsStatusRecheck: false,
      ...overrides,
    });

    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest
        .spyOn(
          service as unknown as {
            fetchUrlText: (u: string) => Promise<string>;
          },
          'fetchUrlText',
        )
        .mockResolvedValue(matchingHtml);
    });

    afterEach(() => fetchSpy.mockRestore());

    it('returns "fall-through" when bill is not in the DB map', async () => {
      const recheck = callRecheck(service);
      const result = await recheck(
        'https://x/billStatusClient.xhtml?bill_id=AB1',
        false,
        undefined,
      );
      expect(result).toBe('fall-through');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns "no-recheck-needed" when flag is false and force is false (no fetch)', async () => {
      const recheck = callRecheck(service);
      const result = await recheck('https://x/x.xhtml', false, mkExisting());
      expect(result).toBe('no-recheck-needed');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fetches when forceStatusRecheck=true even if the flag is false', async () => {
      const recheck = callRecheck(service);
      await recheck('https://x/x.xhtml', true, mkExisting());
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('fetches when the flag is true even if force is false', async () => {
      const recheck = callRecheck(service);
      await recheck(
        'https://x/x.xhtml',
        false,
        mkExisting({ needsStatusRecheck: true }),
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns "fall-through" when fetch throws', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('503'));
      const recheck = callRecheck(service);
      const result = await recheck('https://x/x.xhtml', true, mkExisting());
      expect(result).toBe('fall-through');
    });

    it('returns "fall-through" when the regex cannot parse the page', async () => {
      fetchSpy.mockResolvedValueOnce(
        '<html><body>no useful markup</body></html>',
      );
      const recheck = callRecheck(service);
      const result = await recheck('https://x/x.xhtml', true, mkExisting());
      expect(result).toBe('fall-through');
    });

    it('returns "unchanged" and clears the flag when page matches stored values', async () => {
      const updateMock = jest.fn().mockResolvedValue({});
      (service as unknown as { db: { bill: { update: jest.Mock } } }).db = {
        bill: { update: updateMock },
      };
      const recheck = callRecheck(service);
      const result = await recheck(
        'https://x/x.xhtml',
        true,
        mkExisting({ needsStatusRecheck: true }),
      );
      expect(result).toBe('unchanged');
      expect(updateMock).toHaveBeenCalledWith({
        where: { id: 'bill-uuid' },
        data: { needsStatusRecheck: false },
      });
    });

    it('returns "fall-through" when lastAction text differs from stored', async () => {
      const recheck = callRecheck(service);
      const result = await recheck(
        'https://x/x.xhtml',
        true,
        mkExisting({ lastAction: 'Different action' }),
      );
      expect(result).toBe('fall-through');
    });

    it('returns "fall-through" when lastActionDate differs from stored', async () => {
      const recheck = callRecheck(service);
      const result = await recheck(
        'https://x/x.xhtml',
        true,
        mkExisting({ lastActionDate: new Date(Date.UTC(2024, 0, 1)) }),
      );
      expect(result).toBe('fall-through');
    });

    it('returns "fall-through" when stored lastActionDate is null (treated as changed)', async () => {
      const recheck = callRecheck(service);
      const result = await recheck(
        'https://x/x.xhtml',
        true,
        mkExisting({ lastActionDate: null }),
      );
      expect(result).toBe('fall-through');
    });
  });
});

// ─── Federal placeholder resolution ───────────────────────────────────────────

describe('RegionSyncService — federal placeholder resolution', () => {
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

    const localConfig = {
      name: 'california',
      enabled: true,
      config: {
        regionId: 'california',
        stateCode: 'CA',
        dataSources: [],
      },
    };

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

    mockDb.regionPlugin.findMany.mockResolvedValue([localConfig] as never);
    mockDb.regionPlugin.findUnique.mockResolvedValue(federalConfig as never);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.proposition.updateMany.mockResolvedValue({ count: 0 } as never);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.civicsBlock.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        { provide: REGION_CACHE, useValue: createMockCache() },
        RegionCacheService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        RegionSyncService,
      ],
    }).compile();

    const service = module.get<RegionSyncService>(RegionSyncService);
    await service.onModuleInit();

    expect(mockLoader.loadFederalPlugin).toHaveBeenCalledTimes(1);

    const resolvedConfig = mockLoader.loadFederalPlugin.mock.calls[0][0];
    const ds = resolvedConfig.dataSources;

    expect(ds[0].api.queryParams.contributor_state).toBe('CA');
    expect(ds[0].api.queryParams.sort).toBe('-date');
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

    mockDb.regionPlugin.findMany.mockResolvedValue([]);
    mockDb.regionPlugin.findUnique.mockResolvedValue(federalConfig as never);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.proposition.updateMany.mockResolvedValue({ count: 0 } as never);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.civicsBlock.findMany.mockResolvedValue([]);
    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        { provide: REGION_CACHE, useValue: createMockCache() },
        RegionCacheService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        RegionSyncService,
      ],
    }).compile();

    const service = module.get<RegionSyncService>(RegionSyncService);
    await service.onModuleInit();

    expect(mockLoader.loadFederalPlugin).toHaveBeenCalledTimes(1);
    const resolvedConfig = mockLoader.loadFederalPlugin.mock.calls[0][0];
    expect(
      resolvedConfig.dataSources[0].api.queryParams.contributor_state,
    ).toBe('${stateCode}');
  });
});

// ─── Campaign finance sync ─────────────────────────────────────────────────────

describe('RegionSyncService — campaign finance sync', () => {
  let service: RegionSyncService;
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

    mockDb.regionPlugin.findMany.mockResolvedValue([]);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

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
    mockDb.proposition.updateMany.mockResolvedValue({ count: 0 } as never);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.civicsBlock.findMany.mockResolvedValue([]);

    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );

    const module = await Test.createTestingModule({
      providers: [
        { provide: REGION_CACHE, useValue: createMockCache() },
        RegionCacheService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        RegionSyncService,
      ],
    }).compile();

    service = module.get<RegionSyncService>(RegionSyncService);
    await service.onModuleInit();
  });

  it('should create contributions, expenditures, and independent expenditures via syncAll', async () => {
    const results = await service.syncAll();

    const cfResult = results.find(
      (r) => r.dataType === DataType.CAMPAIGN_FINANCE,
    );
    expect(cfResult).toBeDefined();
    expect(cfResult!.itemsProcessed).toBe(4);
    expect(cfResult!.itemsCreated).toBe(4);
    expect(cfResult!.itemsUpdated).toBe(0);
  });

  it('should update existing records matched by externalId via syncAll', async () => {
    mockDb.contribution.findMany.mockResolvedValue([
      { externalId: 'CONT-1' } as never,
    ]);

    const results = await service.syncAll();

    const cfResult = results.find(
      (r) => r.dataType === DataType.CAMPAIGN_FINANCE,
    );
    expect(cfResult).toBeDefined();
    expect(cfResult!.itemsProcessed).toBe(4);
    expect(cfResult!.itemsCreated).toBe(3);
    expect(cfResult!.itemsUpdated).toBe(1);
  });

  it('should handle provider without fetchCampaignFinance (returns 0 processed)', async () => {
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

// ─── Cache invalidation and batch transactions ─────────────────────────────────

describe('RegionSyncService — cache invalidation and batch transactions', () => {
  let service: RegionSyncService;
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

    mockDb.regionPlugin.findMany.mockResolvedValue([]);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.proposition.count.mockResolvedValue(0);
    mockDb.proposition.updateMany.mockResolvedValue({ count: 0 } as never);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.meeting.count.mockResolvedValue(0);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.representative.count.mockResolvedValue(0);
    mockDb.civicsBlock.findMany.mockResolvedValue([]);

    (mockDb.$transaction as jest.Mock).mockImplementation(
      async (operations: Promise<unknown>[]) => {
        return Promise.all(operations);
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: REGION_CACHE, useValue: mockCache },
        RegionCacheService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        RegionSyncService,
      ],
    }).compile();

    service = module.get<RegionSyncService>(RegionSyncService);
    await service.onModuleInit();
  });

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

// ─── Vault API key resolution ──────────────────────────────────────────────────

describe('RegionSyncService — Vault API key resolution', () => {
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
        RegionCacheService,
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
        { provide: 'SECRETS_PROVIDER', useValue: mockSecretsProvider },
        RegionSyncService,
      ],
    }).compile();

    const syncSvc = module.get<RegionSyncService>(RegionSyncService);
    await (syncSvc as unknown as Record<string, () => Promise<void>>)[
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
        RegionCacheService,
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
        { provide: 'SECRETS_PROVIDER', useValue: mockSecretsProvider },
        RegionSyncService,
      ],
    }).compile();

    const syncSvc = module.get<RegionSyncService>(RegionSyncService);
    await (syncSvc as unknown as Record<string, () => Promise<void>>)[
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
        RegionCacheService,
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
        { provide: 'SECRETS_PROVIDER', useValue: mockSecretsProvider },
        RegionSyncService,
      ],
    }).compile();

    const syncSvc = module.get<RegionSyncService>(RegionSyncService);
    await expect(
      (syncSvc as unknown as Record<string, () => Promise<void>>)[
        'resolveApiKeysFromVault'
      ](),
    ).resolves.not.toThrow();
    expect(process.env.FEC_API_KEY).toBeUndefined();

    if (originalKey) process.env.FEC_API_KEY = originalKey;
    else delete process.env.FEC_API_KEY;
  });
});

// ─── Proposition analysis wiring ──────────────────────────────────────────────

describe('RegionSyncService — proposition analysis wiring', () => {
  async function buildService(
    opts: {
      analyzer?: Partial<jest.Mocked<PropositionAnalysisService>>;
    } = {},
  ) {
    const mockDb = createMockDbService();
    mockDb.regionPlugin.findMany.mockResolvedValue([]);
    mockDb.regionPlugin.findUnique.mockResolvedValue(null);
    mockDb.regionPlugin.upsert.mockResolvedValue({} as never);
    mockDb.proposition.findMany.mockResolvedValue([]);
    mockDb.proposition.updateMany.mockResolvedValue({ count: 0 } as never);
    mockDb.meeting.findMany.mockResolvedValue([]);
    mockDb.representative.findMany.mockResolvedValue([]);
    mockDb.civicsBlock.findMany.mockResolvedValue([]);
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
        { provide: REGION_CACHE, useValue: mockCache },
        RegionCacheService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: PropositionAnalysisService, useValue: analyzer },
        RegionSyncService,
      ],
    }).compile();

    const svc = module.get<RegionSyncService>(RegionSyncService);
    await svc.onModuleInit();
    return { service: svc, analyzer, mockPlugin, mockDb, mockCache };
  }

  describe('regeneratePropositionAnalysis', () => {
    it('forwards to the analyzer with force=true and invalidates cache on success', async () => {
      const { service, analyzer, mockCache } = await buildService();
      mockCache.keys.mockResolvedValue(['propositions:all', 'meetings:all']);
      analyzer.generate.mockResolvedValue(true);

      const result = await service.regeneratePropositionAnalysis('prop-1');

      expect(result).toBe(true);
      expect(analyzer.generate).toHaveBeenCalledWith('prop-1', true);
      expect(mockCache.delete).toHaveBeenCalledWith('propositions:all');
      expect(mockCache.delete).not.toHaveBeenCalledWith('meetings:all');
    });

    it('does not invalidate cache when the analyzer reports no work was done', async () => {
      const { service, analyzer, mockCache } = await buildService();
      analyzer.generate.mockResolvedValue(false);

      const result = await service.regeneratePropositionAnalysis('prop-1');

      expect(result).toBe(false);
      expect(mockCache.delete).not.toHaveBeenCalled();
    });
  });

  describe('regeneratePropositionAnalysis when analyzer is not provided', () => {
    it('returns false when the optional dependency is absent', async () => {
      const mockDb = createMockDbService();
      mockDb.regionPlugin.findMany.mockResolvedValue([]);
      mockDb.regionPlugin.findUnique.mockResolvedValue(null);
      mockDb.regionPlugin.upsert.mockResolvedValue({} as never);

      const mockPlugin = {
        getName: jest.fn().mockReturnValue('test-provider'),
        getRegionInfo: jest.fn().mockReturnValue({
          id: 'r',
          name: 'R',
          description: 'd',
          timezone: 'UTC',
        }),
        getSupportedDataTypes: jest
          .fn()
          .mockReturnValue([DataType.PROPOSITIONS]),
        getProviderName: jest.fn().mockReturnValue('test-provider'),
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

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          { provide: REGION_CACHE, useValue: mockCache },
          RegionCacheService,
          { provide: PluginLoaderService, useValue: mockLoader },
          { provide: PluginRegistryService, useValue: mockRegistry },
          { provide: DbService, useValue: mockDb },
          RegionSyncService,
        ],
      }).compile();

      const svc = module.get<RegionSyncService>(RegionSyncService);
      await svc.onModuleInit();

      const result = await svc.regeneratePropositionAnalysis('prop-1');
      expect(result).toBe(false);
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
});

// ─── Proposition finance wiring ────────────────────────────────────────────────

describe('RegionSyncService — proposition finance wiring', () => {
  async function buildService(
    opts: {
      linker?: { linkAll: jest.Mock };
    } = {},
  ) {
    const mockDb = createMockDbService();
    mockDb.regionPlugin.findMany.mockResolvedValue([]);
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
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
        RegionCacheService,
        { provide: PluginLoaderService, useValue: mockLoader },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: DbService, useValue: mockDb },
        { provide: PropositionFinanceLinkerService, useValue: linker },
        RegionSyncService,
      ],
    }).compile();

    const svc = module.get<RegionSyncService>(RegionSyncService);
    await svc.onModuleInit();
    return { service: svc, linker, fetchCampaignFinance };
  }

  describe('post-sync linker hook', () => {
    it('runs the linker after a campaign-finance sync', async () => {
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
});
