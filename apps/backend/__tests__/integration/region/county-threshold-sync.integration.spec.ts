/**
 * CountyThresholdSyncService integration tests (#1107).
 *
 * Against a real `postgres_test`, because the two claims that matter here are
 * SQL claims: that a second run writes no new rows, and that
 * `county_adjacency` is materialized correctly from PostGIS geometry. A mocked
 * Prisma would assert only that the service calls itself.
 *
 * The spreadsheet is the real published Statement of Vote, read from the
 * pipeline fixture. Fetch is stubbed so the suite makes no network call, but
 * the bytes are the Secretary of State's — the parse, the summing and the
 * reconciliation all run for real.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSourceConfig } from '@opuspopuli/common';
import { DbService } from '@opuspopuli/relationaldb-provider';
import { CountyThresholdSyncService } from '../../../src/apps/region/src/domains/county-threshold-sync.service';
import { cleanDatabase, disconnectDatabase, getDbService } from '../utils';

const FIXTURE = join(
  __dirname,
  '../../../../../packages/scraping-pipeline/__tests__/fixtures/statement-of-vote-sample.xlsx',
);

const VOTES_SOURCE = {
  url: 'https://elections.cdn.sos.ca.gov/sov/2022-general/sov/19-governor.xlsx',
  dataType: 'county_thresholds',
  contentGoal: 'Gubernatorial votes by county',
  sourceType: 'bulk_download',
  bulk: {
    format: 'xlsx',
    xlsx: {
      sheet: 1,
      labelColumn: 0,
      skipRowPattern: '^\\s*Percent',
      excludeLabels: ['State Totals'],
      sumAllValueColumns: true,
      electionYear: 2022,
    },
  },
} as unknown as DataSourceConfig;

/** The 58 county names the real file carries, so seeding matches the parse. */
function countyNamesFromFixture(
  svc: CountyThresholdSyncService,
): Promise<string[]> {
  return svc.readSheet(VOTES_SOURCE).then((facts) => facts.map((f) => f.label));
}

describe('CountyThresholdSyncService (#1107, real DB)', () => {
  let db: DbService;
  let svc: CountyThresholdSyncService;
  let names: string[];

  beforeAll(async () => {
    db = await getDbService();
    svc = new CountyThresholdSyncService(db);
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => readFileSync(FIXTURE),
    })) as unknown as typeof fetch;
    names = await countyNamesFromFixture(svc);
  });

  beforeEach(async () => {
    await cleanDatabase();
    // Seed all 58 counties. Each is a unit square laid end to end, so
    // consecutive counties share an edge and ST_Touches sees them as
    // neighbours — real geometry, without shipping a TIGER extract.
    for (const [i, name] of names.entries()) {
      const fips = `06${String(i * 2 + 1).padStart(3, '0')}`;
      await db.jurisdiction.create({
        data: {
          name: `${name} County`,
          type: 'COUNTY',
          level: 'COUNTY',
          stateCode: 'CA',
          fipsCode: fips,
        },
      });
      await db.$executeRawUnsafe(
        `UPDATE jurisdictions SET boundary = ST_Multi(ST_MakeEnvelope($1, 0, $2, 1, 4326))::geography WHERE fips_code = $3`,
        i,
        i + 1,
        fips,
      );
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('writes one row per county, each citing its source', async () => {
    const result = await svc.sync([VOTES_SOURCE], 'CA');

    expect(result.created).toBe(58);
    expect(result.updated).toBe(0);
    expect(await db.countyThreshold.count()).toBe(58);

    const rows = await db.countyThreshold.findMany({ take: 5 });
    for (const row of rows) {
      expect(row.sourceUrl).toContain('19-governor.xlsx');
      expect(row.retrievedAt).toBeInstanceOf(Date);
      expect(row.gubernatorialYear).toBe(2022);
      expect(row.gubernatorialVotes).toBeGreaterThan(0);
    }
  });

  it('produces the canonical Nevada County figure end to end', async () => {
    await svc.sync([VOTES_SOURCE], 'CA');

    const nevadaFips = `06${String(names.indexOf('Nevada') * 2 + 1).padStart(3, '0')}`;
    const row = await db.countyThreshold.findUnique({
      where: { fips: nevadaFips },
    });

    // 50,737 votes cast -> ceil(10%) = 5,074 signatures. NOT the 5,137 in the
    // county's own guide, which the 2022 Statement of Vote does not support.
    expect(row?.gubernatorialVotes).toBe(50737);
    expect(Math.ceil((row?.gubernatorialVotes ?? 0) * 0.1)).toBe(5074);
  });

  it('is idempotent — a second run creates nothing', async () => {
    const first = await svc.sync([VOTES_SOURCE], 'CA');
    const second = await svc.sync([VOTES_SOURCE], 'CA');

    expect(first.created).toBe(58);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(58);
    expect(await db.countyThreshold.count()).toBe(58);
  });

  it('materializes adjacency symmetrically from the county geometry', async () => {
    await svc.sync([VOTES_SOURCE], 'CA');

    const pairs = await db.countyAdjacency.findMany();
    // 58 squares in a row touch their immediate neighbours only: 57 pairs,
    // written in both directions.
    expect(pairs).toHaveLength(57 * 2);

    const set = new Set(pairs.map((p) => `${p.fips}|${p.neighbor}`));
    for (const p of pairs) {
      expect(set.has(`${p.neighbor}|${p.fips}`)).toBe(true);
    }
  });

  it('re-running adjacency does not duplicate pairs', async () => {
    await svc.sync([VOTES_SOURCE], 'CA');
    const after1 = await db.countyAdjacency.count();
    await svc.sync([VOTES_SOURCE], 'CA');

    expect(await db.countyAdjacency.count()).toBe(after1);
  });

  it('refuses to write anything when a county has no jurisdiction', async () => {
    // A county absent from the table renders as an unshaded polygon that reads
    // as data, so a partial write is worse than an obvious failure.
    await db.jurisdiction.deleteMany({ where: { name: 'Nevada County' } });

    await expect(svc.sync([VOTES_SOURCE], 'CA')).rejects.toThrow(
      /no jurisdiction matches/i,
    );
    expect(await db.countyThreshold.count()).toBe(0);
  });
});
