/**
 * The anonymous district lookup against a real `postgres_test` (#1456).
 *
 * The point query is raw PostGIS with a geography bounding-box prefilter, so
 * the planner can use `jurisdictions_boundary_gist_idx`. A mocked Prisma would prove the code
 * runs, not that a point resolves to the districts around it, nor that the
 * index is actually used.
 */
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import {
  jurisdictionIdsAtPoint,
  jurisdictionsAtPointSql,
} from '../../../src/common/geocoding/jurisdictions-at-point';
import type { GeocodingService } from '../../../src/common/geocoding/geocoding.service';
import { PublicJurisdictionService } from '../../../src/apps/region/src/domains/public-jurisdiction.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

/** A 1° square, west -122..-121, south 38..39: around Sacramento. */
const COUNTY_WKT =
  'SRID=4326;MULTIPOLYGON(((-122 38, -121 38, -121 39, -122 39, -122 38)))';
/** A smaller square inside it. */
const DISTRICT_WKT =
  'SRID=4326;MULTIPOLYGON(((-121.6 38.4, -121.4 38.4, -121.4 38.6, -121.6 38.6, -121.6 38.4)))';

describe('Public jurisdiction lookup (#1456, real DB)', () => {
  let db: DbService;
  let service: PublicJurisdictionService;
  let ids: { state: string; county: string; district: string };

  beforeAll(async () => {
    db = await getDbService();
    service = new PublicJurisdictionService(db, {
      geocode: jest.fn(),
    } as unknown as GeocodingService);
  });

  beforeEach(async () => {
    await cleanDatabase();
    const state = await db.jurisdiction.create({
      data: {
        name: 'California',
        type: 'STATE',
        level: 'STATE',
        stateCode: 'CA',
      },
    });
    const county = await db.jurisdiction.create({
      data: {
        name: 'Sacramento',
        type: 'COUNTY',
        level: 'COUNTY',
        stateCode: 'CA',
        parentId: state.id,
      },
    });
    const district = await db.jurisdiction.create({
      data: {
        name: 'Assembly District 7',
        type: 'STATE_ASSEMBLY_DISTRICT',
        level: 'STATE',
        stateCode: 'CA',
        parentId: state.id,
      },
    });
    await db.$executeRaw`UPDATE jurisdictions SET boundary = ST_GeogFromText(${COUNTY_WKT}) WHERE id = ${county.id}`;
    await db.$executeRaw`UPDATE jurisdictions SET boundary = ST_GeogFromText(${DISTRICT_WKT}) WHERE id = ${district.id}`;
    ids = { state: state.id, county: county.id, district: district.id };
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('finds every district containing a point, with each parent', async () => {
    const rows = await service.locate(
      { point: { lat: 38.5, lng: -121.5 } },
      '198.51.100.1',
    );
    expect(rows.map((row) => row.id).sort()).toEqual(
      [ids.county, ids.district].sort(),
    );
    for (const row of rows) expect(row.parent?.id).toBe(ids.state);
  });

  it('finds only the districts that contain it', async () => {
    await expect(jurisdictionIdsAtPoint(db, 38.9, -121.9)).resolves.toEqual([
      ids.county,
    ]);
  });

  it('finds nothing outside every boundary, and skips rows without one', async () => {
    // The state row has no boundary; a point in Nevada is outside both squares.
    await expect(jurisdictionIdsAtPoint(db, 39.5, -119.8)).resolves.toEqual([]);
  });

  it('restores saved ids, dropping any that no longer exist', async () => {
    const rows = await service.byIds([
      ids.district,
      '00000000-0000-0000-0000-000000000000',
    ]);
    expect(rows.map((row) => row.id)).toEqual([ids.district]);
    expect(rows[0].parent?.name).toBe('California');
  });

  it('uses the boundary index, not a scan of every polygon', async () => {
    // EXPLAIN the exact SQL the code sends, inside one transaction so that
    // SET LOCAL reaches the same connection and ends with it.
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>(
        Prisma.sql`EXPLAIN ${jurisdictionsAtPointSql(38.5, -121.5)}`,
      );
    });
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');
    expect(text).toContain('jurisdictions_boundary_gist_idx');
    // Used as a condition, not just walked end to end: with sequential scans
    // priced out, Postgres will read a whole index as a substitute scan, and
    // that plan names the index too.
    expect(text).toMatch(/Index Cond: \(boundary &&/);
  });
});
