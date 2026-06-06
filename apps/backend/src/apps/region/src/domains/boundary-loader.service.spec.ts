import { Test, TestingModule } from '@nestjs/testing';
import { BoundaryLoaderService, BoundaryRow } from './boundary-loader.service';
import {
  DbService,
  Jurisdiction,
  JurisdictionType,
  JurisdictionLevel,
} from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import {
  PluginRegistryService,
  type IRegionPlugin,
  type BoundarySourcesConfig,
} from '@opuspopuli/region-provider';
import { TigerFetcher } from './boundary-fetchers/tiger.fetcher';
import { GeoportalFetcher } from './boundary-fetchers/geoportal.fetcher';

interface MockPluginRegistry {
  getActive: jest.Mock;
}

function createMockRegistry(): MockPluginRegistry {
  return { getActive: jest.fn() };
}

function createMockPlugin(
  boundarySources?: BoundarySourcesConfig,
  regionInfoOverride?: Partial<{
    fipsCode: string | undefined;
    stateCode: string | undefined;
  }>,
): jest.Mocked<IRegionPlugin> {
  // Spread (not `??`) so callers can explicitly set fipsCode/stateCode to
  // undefined to exercise the missing-context skip path.
  const regionInfo = {
    id: 'california',
    name: 'California',
    description: 'CA',
    timezone: 'America/Los_Angeles',
    fipsCode: '06' as string | undefined,
    stateCode: 'CA' as string | undefined,
    ...regionInfoOverride,
  };
  return {
    getName: jest.fn().mockReturnValue('california'),
    getVersion: jest.fn().mockReturnValue('1.0.0-declarative'),
    getRegionInfo: jest.fn().mockReturnValue(regionInfo),
    getSupportedDataTypes: jest.fn().mockReturnValue([]),
    fetchPropositions: jest.fn(),
    fetchMeetings: jest.fn(),
    fetchRepresentatives: jest.fn(),
    initialize: jest.fn(),
    healthCheck: jest.fn(),
    destroy: jest.fn(),
    getBoundarySources: jest.fn().mockReturnValue(boundarySources),
  } as unknown as jest.Mocked<IRegionPlugin>;
}

const SAMPLE_SOURCES: BoundarySourcesConfig = {
  ocdIdPrefix: 'ocd-division/country:us/state:ca',
  tigerLayers: [
    {
      layer: 'State_County/MapServer/1',
      outFields: 'GEOID,NAME',
      jurisdictionType: 'COUNTY',
      level: 'COUNTY',
      nameField: 'NAME',
      ocdIdSegment: '/county:${name}',
    },
  ],
};

const SAMPLE_ROW: BoundaryRow = {
  name: 'Alameda County',
  type: 'COUNTY' as JurisdictionType,
  level: 'COUNTY' as JurisdictionLevel,
  stateCode: 'CA',
  fipsCode: '06001',
  ocdId: 'ocd-division/country:us/state:ca/county:alameda_county',
  geometryGeoJSON: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.3, 37.7],
        [-122.3, 37.8],
        [-122.2, 37.8],
        [-122.2, 37.7],
        [-122.3, 37.7],
      ],
    ],
  },
};

describe('BoundaryLoaderService', () => {
  let service: BoundaryLoaderService;
  let mockDb: MockDbClient;
  let mockRegistry: MockPluginRegistry;
  let mockTigerFetcher: { fetch: jest.Mock };
  let mockGeoportalFetcher: { fetch: jest.Mock };

  beforeEach(async () => {
    mockDb = createMockDbService();
    mockRegistry = createMockRegistry();
    // Fetcher behavior is exercised in their own specs. The loader's tests
    // verify orchestration: how it composes fetcher results into upserts.
    mockTigerFetcher = { fetch: jest.fn().mockResolvedValue([]) };
    mockGeoportalFetcher = { fetch: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BoundaryLoaderService,
        { provide: DbService, useValue: mockDb },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: TigerFetcher, useValue: mockTigerFetcher },
        { provide: GeoportalFetcher, useValue: mockGeoportalFetcher },
      ],
    }).compile();

    service = module.get<BoundaryLoaderService>(BoundaryLoaderService);
  });

  describe('loadAll() skip paths', () => {
    it('returns no-active-plugin when the registry has no plugin', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      mockRegistry.getActive.mockReturnValue(undefined);

      const result = await service.loadAll();

      expect(result.skipped).toBe('no-active-plugin');
      expect(result.counts.existing).toBe(0);
      expect(mockDb.jurisdiction.upsert).not.toHaveBeenCalled();
    });

    it('returns no-boundary-sources when the plugin returns undefined', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      mockRegistry.getActive.mockReturnValue(createMockPlugin(undefined));

      const result = await service.loadAll();

      expect(result.skipped).toBe('no-boundary-sources');
      expect(mockDb.jurisdiction.upsert).not.toHaveBeenCalled();
    });

    it('returns already-populated when jurisdictions already exist and force is not set', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(7000);
      mockRegistry.getActive.mockReturnValue(createMockPlugin(SAMPLE_SOURCES));

      const result = await service.loadAll();

      expect(result.skipped).toBe('already-populated');
      expect(result.counts.existing).toBe(7000);
      expect(mockDb.jurisdiction.upsert).not.toHaveBeenCalled();
    });

    it('does NOT return already-populated when force=true', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(7000);
      mockRegistry.getActive.mockReturnValue(createMockPlugin(SAMPLE_SOURCES));

      const result = await service.loadAll({ force: true });

      // With mocked fetchers returning [], the load completes a no-op happy
      // path: existing=7000, upserted=0. The assertion that matters:
      // skipped is NOT set on force=true.
      expect(result.skipped).toBeUndefined();
      expect(result.counts.existing).toBe(7000);
    });

    it('returns no-boundary-sources when the plugin declared sources but the regionInfo is missing fipsCode/stateCode', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      // Federal-like plugin: boundarySources present but no fipsCode set.
      mockRegistry.getActive.mockReturnValue(
        createMockPlugin(SAMPLE_SOURCES, {
          fipsCode: undefined as unknown as string,
        }),
      );

      const result = await service.loadAll();

      expect(result.skipped).toBe('no-boundary-sources');
      expect(mockTigerFetcher.fetch).not.toHaveBeenCalled();
      expect(mockGeoportalFetcher.fetch).not.toHaveBeenCalled();
    });
  });

  describe('onApplicationBootstrap()', () => {
    afterEach(() => {
      delete process.env.FORCE_RELOAD_BOUNDARIES;
    });

    it('detaches loadAll() in the background and returns synchronously', async () => {
      // The boot hook MUST return synchronously so Nest's bootstrap
      // sequence isn't held open by a 1-5 minute boundary fetch.
      // Mock loadAll so we can observe it was triggered without awaiting.
      const loadAllSpy = jest.spyOn(service, 'loadAll').mockResolvedValue({
        ok: true,
        counts: { existing: 0, upserted: 0, failed: 0, missingKey: 0 },
      });

      service.onApplicationBootstrap();

      // Synchronous return = no `await` needed; the call is queued.
      expect(loadAllSpy).toHaveBeenCalledTimes(1);
      expect(loadAllSpy).toHaveBeenCalledWith();
      // Yield so the detached promise resolves before the test ends —
      // otherwise jest's open-handles detector complains.
      await Promise.resolve();
    });

    it('catches errors so a thrown loadAll() never crashes Nest bootstrap', async () => {
      const loggerErrorSpy = jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});
      jest
        .spyOn(service, 'loadAll')
        .mockRejectedValue(new Error('catastrophic'));

      service.onApplicationBootstrap();

      // Yield so the rejection lands in our catch handler.
      await new Promise((r) => setImmediate(r));
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('catastrophic'),
      );
    });

    it('respects FORCE_RELOAD_BOUNDARIES=skip-boot — does not call loadAll', () => {
      process.env.FORCE_RELOAD_BOUNDARIES = 'skip-boot';
      const loadAllSpy = jest.spyOn(service, 'loadAll');

      service.onApplicationBootstrap();

      expect(loadAllSpy).not.toHaveBeenCalled();
    });
  });

  describe('fetcher dispatch', () => {
    it('calls TigerFetcher.fetch once per tigerLayer, GeoportalFetcher.fetch once per geoportalLayer', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      const sources: BoundarySourcesConfig = {
        ocdIdPrefix: 'ocd-division/country:us/state:ca',
        tigerLayers: [
          {
            layer: 'State_County/MapServer/1',
            outFields: 'GEOID,NAME',
            jurisdictionType: 'COUNTY',
            level: 'COUNTY',
            nameField: 'NAME',
          },
          {
            layer: 'Legislative/MapServer/1',
            outFields: 'GEOID,SLDUST',
            jurisdictionType: 'STATE_SENATE_DISTRICT',
            level: 'STATE',
            nameField: 'SLDUST',
          },
        ],
        geoportalLayers: [
          {
            url: 'https://example.gov/fire/FeatureServer/0',
            outFields: 'OBJECTID,AGENCY',
            jurisdictionType: 'FIRE_DISTRICT',
            level: 'DISTRICT',
            nameField: 'AGENCY',
          },
        ],
      };
      mockRegistry.getActive.mockReturnValue(createMockPlugin(sources));

      await service.loadAll();

      expect(mockTigerFetcher.fetch).toHaveBeenCalledTimes(2);
      expect(mockGeoportalFetcher.fetch).toHaveBeenCalledTimes(1);
      // Verify the ocdIdPrefix is threaded through to each fetcher call.
      expect(mockTigerFetcher.fetch).toHaveBeenCalledWith(
        expect.any(Object),
        { fipsCode: '06', stateCode: 'CA' },
        'ocd-division/country:us/state:ca',
      );
      expect(mockGeoportalFetcher.fetch).toHaveBeenCalledWith(
        expect.any(Object),
        { fipsCode: '06', stateCode: 'CA' },
        'ocd-division/country:us/state:ca',
      );
    });

    it('aggregates rows from both fetchers and upserts the union', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      const sources: BoundarySourcesConfig = {
        ocdIdPrefix: 'ocd-division/country:us/state:ca',
        tigerLayers: [
          {
            layer: 'State_County/MapServer/1',
            outFields: 'GEOID,NAME',
            jurisdictionType: 'COUNTY',
            level: 'COUNTY',
            nameField: 'NAME',
          },
        ],
        geoportalLayers: [
          {
            url: 'https://example.gov/fire/FeatureServer/0',
            outFields: 'OBJECTID,AGENCY',
            jurisdictionType: 'FIRE_DISTRICT',
            level: 'DISTRICT',
            nameField: 'AGENCY',
          },
        ],
      };
      mockRegistry.getActive.mockReturnValue(createMockPlugin(sources));
      mockTigerFetcher.fetch.mockResolvedValueOnce([SAMPLE_ROW]);
      mockGeoportalFetcher.fetch.mockResolvedValueOnce([
        { ...SAMPLE_ROW, fipsCode: 'ca-fire-42', name: 'Berkeley FD' },
      ]);
      mockDb.jurisdiction.upsert.mockResolvedValue({
        id: 'jur-x',
      } as Jurisdiction);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(2);
    });
  });

  describe('upsertBoundary()', () => {
    // Exercise the upsert path directly via a runtime spy on fetchAll. The
    // fetchers come online in subtask 5; until then loadAll() always gets
    // an empty list. Patching the private fetchAll() lets us verify the
    // persistence layer in isolation.

    function patchFetchAll(rows: BoundaryRow[]): void {
      jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(service as any, 'fetchAll')
        .mockResolvedValue(rows);
    }

    it('upserts via fipsCode key when fipsCode is present, then writes the boundary via $executeRaw', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      mockRegistry.getActive.mockReturnValue(createMockPlugin(SAMPLE_SOURCES));
      patchFetchAll([SAMPLE_ROW]);
      mockDb.jurisdiction.upsert.mockResolvedValue({
        id: 'jur-1',
      } as Jurisdiction);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(1);
      expect(result.counts.failed).toBe(0);
      expect(mockDb.jurisdiction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fipsCode: '06001' },
          create: expect.objectContaining({
            fipsCode: '06001',
            ocdId: SAMPLE_ROW.ocdId,
            name: 'Alameda County',
            type: 'COUNTY',
          }),
        }),
      );
      expect(mockDb.$executeRaw).toHaveBeenCalled();
    });

    it('falls back to ocdId upsert when fipsCode is absent', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      mockRegistry.getActive.mockReturnValue(createMockPlugin(SAMPLE_SOURCES));
      patchFetchAll([{ ...SAMPLE_ROW, fipsCode: undefined }]);
      mockDb.jurisdiction.upsert.mockResolvedValue({
        id: 'jur-2',
      } as Jurisdiction);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(1);
      expect(mockDb.jurisdiction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ocdId: SAMPLE_ROW.ocdId },
        }),
      );
    });

    it('counts rows missing both fipsCode AND ocdId without throwing', async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      mockRegistry.getActive.mockReturnValue(createMockPlugin(SAMPLE_SOURCES));
      patchFetchAll([{ ...SAMPLE_ROW, fipsCode: undefined, ocdId: undefined }]);

      const result = await service.loadAll();

      expect(result.counts.missingKey).toBe(1);
      expect(result.counts.upserted).toBe(0);
      expect(result.counts.failed).toBe(0);
      expect(mockDb.jurisdiction.upsert).not.toHaveBeenCalled();
    });

    it("catches per-row upsert failures so one bad row doesn't abort the rest", async () => {
      mockDb.jurisdiction.count.mockResolvedValue(0);
      mockRegistry.getActive.mockReturnValue(createMockPlugin(SAMPLE_SOURCES));
      patchFetchAll([
        SAMPLE_ROW,
        { ...SAMPLE_ROW, fipsCode: '06013', name: 'Contra Costa County' },
      ]);
      mockDb.jurisdiction.upsert
        .mockRejectedValueOnce(new Error('boom: prisma race'))
        .mockResolvedValueOnce({ id: 'jur-3' } as Jurisdiction);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(1);
      expect(result.counts.failed).toBe(1);
    });
  });
});
