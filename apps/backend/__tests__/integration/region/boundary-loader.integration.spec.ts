/**
 * BoundaryLoaderService integration tests.
 *
 * These complement the unit tests at
 * apps/backend/src/apps/region/src/domains/boundary-loader.service.spec.ts —
 * the unit tests mock `DbService` so the actual SQL never executes, which
 * caused a real bug to slip past 32 green tests: the original `upsertBoundary`
 * `$executeRaw` cast `${id}` to `::uuid`, but Prisma stores
 * `String @id @default(uuid())` columns as `text` by default, so every
 * upsert at boot-time failed with `operator does not exist: text = uuid`.
 *
 * The cases below exercise the REAL Prisma raw query path against
 * `postgres_test` (gated by `assertTestDatabase()`). Any future change
 * that breaks the PostGIS upsert or the parameter cast surface will be
 * caught here before it ships.
 *
 * Fetcher behavior is still mocked (we don't want network IO during the
 * integration suite); the focus is the loader's persistence layer + the
 * orchestration over real DB state.
 *
 * See opuspopuli#804.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  PluginRegistryService,
  type IRegionPlugin,
  type BoundarySourcesConfig,
} from '@opuspopuli/region-provider';
import { BoundaryLoaderService } from '../../../src/apps/region/src/domains/boundary-loader.service';
import type { BoundaryRow } from '../../../src/apps/region/src/domains/boundary-loader.service';
import { TigerFetcher } from '../../../src/apps/region/src/domains/boundary-fetchers/tiger.fetcher';
import { GeoportalFetcher } from '../../../src/apps/region/src/domains/boundary-fetchers/geoportal.fetcher';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SAMPLE_GEOJSON = {
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
};

const MULTIPOLYGON_GEOJSON = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-122.3, 37.7],
        [-122.3, 37.8],
        [-122.2, 37.8],
        [-122.2, 37.7],
        [-122.3, 37.7],
      ],
    ],
    [
      [
        [-122.5, 37.6],
        [-122.5, 37.7],
        [-122.4, 37.7],
        [-122.4, 37.6],
        [-122.5, 37.6],
      ],
    ],
  ],
};

// SAMPLE_SOURCES MUST include at least one tigerLayer and one geoportalLayer
// — otherwise the loader's fetchAll() iterates over empty arrays and never
// dispatches to the mocked fetchers, and every test asserting upserted=1
// fails with upserted=0. The layer configs are only used by the loader to
// decide which fetcher to call; per-row content comes from the fetcher
// mocks each test sets up individually.
const SAMPLE_SOURCES: BoundarySourcesConfig = {
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
      url: 'https://example.gov/x/FeatureServer/0',
      outFields: 'OBJECTID,Name',
      jurisdictionType: 'FIRE_DISTRICT',
      level: 'DISTRICT',
      nameField: 'Name',
    },
  ],
};

function buildPlugin(
  boundarySources?: BoundarySourcesConfig,
): jest.Mocked<IRegionPlugin> {
  return {
    getName: jest.fn().mockReturnValue('california'),
    getVersion: jest.fn().mockReturnValue('1.0.0-declarative'),
    getRegionInfo: jest.fn().mockReturnValue({
      id: 'california',
      name: 'California',
      description: 'CA',
      timezone: 'America/Los_Angeles',
      fipsCode: '06',
      stateCode: 'CA',
    }),
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('BoundaryLoaderService — integration (#804)', () => {
  let service: BoundaryLoaderService;
  let db: DbService;
  let mockRegistry: { getActive: jest.Mock };
  let mockTigerFetcher: { fetch: jest.Mock };
  let mockGeoportalFetcher: { fetch: jest.Mock };

  beforeAll(async () => {
    db = await getDbService();
  });

  beforeEach(async () => {
    await cleanDatabase();

    mockRegistry = { getActive: jest.fn() };
    mockTigerFetcher = { fetch: jest.fn().mockResolvedValue([]) };
    mockGeoportalFetcher = { fetch: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BoundaryLoaderService,
        { provide: DbService, useValue: db },
        { provide: PluginRegistryService, useValue: mockRegistry },
        { provide: TigerFetcher, useValue: mockTigerFetcher },
        { provide: GeoportalFetcher, useValue: mockGeoportalFetcher },
      ],
    }).compile();

    service = module.get<BoundaryLoaderService>(BoundaryLoaderService);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  // ---------------------------------------------------------------------
  // Persistence: the SQL path that the mock-based unit tests can't reach.
  // ---------------------------------------------------------------------

  describe('upsertBoundary persistence', () => {
    function buildRow(overrides: Partial<BoundaryRow> = {}): BoundaryRow {
      return {
        name: 'Alameda County',
        type: 'COUNTY',
        level: 'COUNTY',
        stateCode: 'CA',
        fipsCode: '06001',
        ocdId: 'ocd-division/country:us/state:ca/county:alameda_county',
        geometryGeoJSON: SAMPLE_GEOJSON,
        ...overrides,
      };
    }

    it('writes a row and lands a PostGIS MultiPolygon geometry (catches ::uuid type-cast regression)', async () => {
      mockRegistry.getActive.mockReturnValue(buildPlugin(SAMPLE_SOURCES));
      mockTigerFetcher.fetch.mockResolvedValueOnce([buildRow()]);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(1);
      expect(result.counts.failed).toBe(0);
      expect(result.ok).toBe(true);

      const rows = await db.$queryRaw<
        { id: string; name: string; geom_type: string; srid: number }[]
      >`
        SELECT id, name,
               ST_GeometryType(boundary::geometry) AS geom_type,
               ST_SRID(boundary::geometry) AS srid
        FROM jurisdictions
        WHERE fips_code = ${'06001'}
      `;
      expect(rows).toHaveLength(1);
      // PostGIS reports the geometry type after ST_Multi wrapping. A
      // single-polygon GeoJSON should land as ST_MultiPolygon.
      expect(rows[0].geom_type).toBe('ST_MultiPolygon');
      // SRID 4326 (WGS84) is the column constraint; verifies the
      // ST_GeomFromGeoJSON → ::geography flow preserves the spatial ref.
      expect(Number(rows[0].srid)).toBe(4326);
      expect(rows[0].name).toBe('Alameda County');
    });

    it('upserts a MultiPolygon GeoJSON unchanged (ST_Multi is a no-op on already-multi geometries)', async () => {
      mockRegistry.getActive.mockReturnValue(buildPlugin(SAMPLE_SOURCES));
      mockTigerFetcher.fetch.mockResolvedValueOnce([
        buildRow({
          name: 'Catalina Island District',
          geometryGeoJSON: MULTIPOLYGON_GEOJSON,
        }),
      ]);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(1);
      const rows = await db.$queryRaw<{ num_geometries: number }[]>`
        SELECT ST_NumGeometries(boundary::geometry) AS num_geometries
        FROM jurisdictions
        WHERE name = ${'Catalina Island District'}
      `;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].num_geometries)).toBe(2);
    });

    it('is idempotent on the fipsCode key — second loadAll updates, never duplicates', async () => {
      mockRegistry.getActive.mockReturnValue(buildPlugin(SAMPLE_SOURCES));
      const row = buildRow();

      // First load — populates.
      mockTigerFetcher.fetch.mockResolvedValueOnce([row]);
      const first = await service.loadAll();
      expect(first.counts.upserted).toBe(1);

      // Second load with force=true and an updated name — should update,
      // not insert.
      mockTigerFetcher.fetch.mockResolvedValueOnce([
        { ...row, name: 'Alameda County (updated)' },
      ]);
      const second = await service.loadAll({ force: true });
      expect(second.counts.upserted).toBe(1);

      const all = await db.jurisdiction.findMany({
        where: { fipsCode: '06001' },
        select: { id: true, name: true },
      });
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Alameda County (updated)');
    });

    it('falls back to the ocdId unique key when fipsCode is omitted', async () => {
      mockRegistry.getActive.mockReturnValue(buildPlugin(SAMPLE_SOURCES));
      mockGeoportalFetcher.fetch.mockResolvedValueOnce([
        buildRow({
          fipsCode: undefined,
          name: 'Berkeley Fire Department',
          type: 'FIRE_DISTRICT',
          level: 'DISTRICT',
          ocdId:
            'ocd-division/country:us/state:ca/fire_district:berkeley_fire_department',
        }),
      ]);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(1);
      const row = await db.jurisdiction.findUnique({
        where: {
          ocdId:
            'ocd-division/country:us/state:ca/fire_district:berkeley_fire_department',
        },
      });
      expect(row).not.toBeNull();
      expect(row?.fipsCode).toBeNull();
      expect(row?.type).toBe('FIRE_DISTRICT');
    });

    it('counts missingKey rows (no fipsCode AND no ocdId) without an upsert attempt', async () => {
      mockRegistry.getActive.mockReturnValue(buildPlugin(SAMPLE_SOURCES));
      mockTigerFetcher.fetch.mockResolvedValueOnce([
        buildRow({ fipsCode: undefined, ocdId: undefined }),
      ]);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(0);
      expect(result.counts.missingKey).toBe(1);
      expect(result.counts.failed).toBe(0);
      const count = await db.jurisdiction.count();
      expect(count).toBe(0);
    });

    it('continues past per-row upsert failures and reports failed/ok correctly', async () => {
      mockRegistry.getActive.mockReturnValue(buildPlugin(SAMPLE_SOURCES));
      // Two rows. First has a deliberately malformed GeoJSON — ST_GeomFromGeoJSON
      // rejects it, the row counts as `failed`, and the second row still lands.
      // Each row needs a distinct ocdId — buildRow's default fills in
      // 'alameda_county', so without overriding, the Bad Row's failed-but-
      // committed Prisma upsert claims that ocd_id and the Good Row's upsert
      // hits a unique-constraint violation instead of succeeding.
      //
      // Production-level concern (follow-up, not this test's job): the
      // current loader inserts via Prisma BEFORE the $executeRaw geometry
      // write, so a geometry failure leaves a half-committed row in the DB.
      // The right fix is to wrap both writes in one transaction. Tracked as
      // a post-MVP follow-up.
      mockTigerFetcher.fetch.mockResolvedValueOnce([
        buildRow({
          name: 'Bad Row',
          fipsCode: '06099',
          ocdId: 'ocd-division/country:us/state:ca/county:bad_county',
          geometryGeoJSON: { type: 'NotARealType', coordinates: 'broken' },
        }),
        buildRow({
          name: 'Good Row',
          fipsCode: '06097',
          ocdId: 'ocd-division/country:us/state:ca/county:good_county',
        }),
      ]);

      const result = await service.loadAll();

      expect(result.counts.upserted).toBe(1);
      expect(result.counts.failed).toBe(1);
      // ok=false on any per-row failure — that's the operator-facing alarm
      // signal the GraphQL model surfaces (see model description).
      expect(result.ok).toBe(false);

      const good = await db.jurisdiction.findUnique({
        where: { fipsCode: '06097' },
      });
      expect(good).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Orchestration: skip paths against a real (empty / populated) DB.
  // ---------------------------------------------------------------------

  describe('loadAll() skip behavior against real DB', () => {
    it('skips with already-populated when jurisdictions already exist and force is unset', async () => {
      // Pre-seed one row so existing > 0.
      await db.jurisdiction.create({
        data: {
          name: 'Seeded County',
          type: 'COUNTY',
          level: 'COUNTY',
          stateCode: 'CA',
          fipsCode: '06099',
        },
      });
      mockRegistry.getActive.mockReturnValue(buildPlugin(SAMPLE_SOURCES));
      mockTigerFetcher.fetch.mockResolvedValueOnce([
        // Should never be reached — skip fires first.
        {
          name: 'Should Not Land',
          type: 'COUNTY',
          level: 'COUNTY',
          stateCode: 'CA',
          fipsCode: '06001',
          ocdId: 'ocd-division/country:us/state:ca/county:should_not_land',
          geometryGeoJSON: SAMPLE_GEOJSON,
        },
      ]);

      const result = await service.loadAll();

      expect(result.skipped).toBe('already-populated');
      expect(result.counts.existing).toBe(1);
      // Fetchers must not have been called — the skip short-circuits before
      // fetchAll().
      expect(mockTigerFetcher.fetch).not.toHaveBeenCalled();

      const finalCount = await db.jurisdiction.count();
      expect(finalCount).toBe(1);
    });
  });
});
