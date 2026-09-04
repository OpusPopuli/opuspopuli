/**
 * CountyThresholdQueryService integration tests (#1108).
 *
 * Against a real `postgres_test`, because the read path is raw SQL joining
 * `county_thresholds` to `jurisdictions` and then to `county_adjacency`. A
 * mocked Prisma would prove the mapping code runs, not that the query returns
 * the right counties in the right order.
 */

import { DbService } from '@opuspopuli/relationaldb-provider';
import { CountyThresholdQueryService } from '../../../src/apps/region/src/domains/county-threshold-query.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

/** Three counties in a row: Alpine — Nevada — Placer. */
const COUNTIES = [
  { fips: '06003', name: 'Alpine County', votes: 619, registered: 800 },
  { fips: '06057', name: 'Nevada County', votes: 50737, registered: 76423 },
  { fips: '06061', name: 'Placer County', votes: 200000, registered: 280000 },
];

describe('CountyThresholdQueryService (#1108, real DB)', () => {
  let db: DbService;
  let svc: CountyThresholdQueryService;

  beforeAll(async () => {
    db = await getDbService();
    svc = new CountyThresholdQueryService(db);
  });

  beforeEach(async () => {
    await cleanDatabase();
    for (const c of COUNTIES) {
      await db.jurisdiction.create({
        data: {
          name: c.name,
          type: 'COUNTY',
          level: 'COUNTY',
          stateCode: 'CA',
          fipsCode: c.fips,
        },
      });
      await db.countyThreshold.create({
        data: {
          fips: c.fips,
          gubernatorialVotes: c.votes,
          gubernatorialYear: 2022,
          registeredVoters: c.registered,
          sourceUrl:
            'https://elections.cdn.sos.ca.gov/sov/2022-general/sov/19-governor.xlsx',
          retrievedAt: new Date('2026-09-03T00:00:00Z'),
        },
      });
    }
    // Alpine <-> Nevada <-> Placer, both directions as the loader writes them.
    for (const [a, b] of [
      ['06003', '06057'],
      ['06057', '06061'],
    ]) {
      await db.countyAdjacency.createMany({
        data: [
          { fips: a, neighbor: b },
          { fips: b, neighbor: a },
        ],
      });
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('returns every county with its derived figures', async () => {
    const counties = await svc.findAll();

    expect(counties).toHaveLength(3);
    const nevada = counties.find((c) => c.fips === '06057');
    expect(nevada?.name).toBe('Nevada County');
    expect(nevada?.gubernatorialVotes).toBe(50737);
    expect(nevada?.signaturesRequired).toBe(5074);
    expect(nevada?.shareOfRegistered).toBeCloseTo(5074 / 76423, 10);
    expect(nevada?.gubernatorialYear).toBe(2022);
  });

  it('orders cheapest first and ranks from 1', async () => {
    const counties = await svc.findAll();

    expect(counties.map((c) => c.name)).toEqual([
      'Alpine County',
      'Nevada County',
      'Placer County',
    ]);
    expect(counties.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it('resolves cheapest neighbour through county_adjacency', async () => {
    const counties = await svc.findAll();

    // Nevada touches Alpine (62) and Placer (20,000) — Alpine wins.
    const nevada = counties.find((c) => c.fips === '06057');
    expect(nevada?.cheapestNeighbor?.name).toBe('Alpine County');
    expect(nevada?.cheapestNeighbor?.signaturesRequired).toBe(62);

    // Placer touches only Nevada, so its cheapest neighbour is Nevada even
    // though Nevada is not the cheapest county overall.
    const placer = counties.find((c) => c.fips === '06061');
    expect(placer?.cheapestNeighbor?.name).toBe('Nevada County');
  });

  it('exposes provenance on every row', async () => {
    const counties = await svc.findAll();

    for (const c of counties) {
      expect(c.sourceUrl).toContain('19-governor.xlsx');
      expect(c.retrievedAt).toBeInstanceOf(Date);
    }
  });

  it('returns an empty list rather than throwing when nothing is loaded', async () => {
    await cleanDatabase();
    await expect(svc.findAll()).resolves.toEqual([]);
  });
});
