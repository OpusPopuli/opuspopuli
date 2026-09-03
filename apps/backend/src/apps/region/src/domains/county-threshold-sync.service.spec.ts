import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import { DataType, type DataSourceConfig } from '@opuspopuli/common';
import {
  CountyThresholdSyncService,
  normalizeCountyName,
} from './county-threshold-sync.service';

/**
 * The fixture is California's Statement of Vote in full, byte-for-byte as
 * published, so these assertions run against the real layout: two header rows,
 * a `Percent` row after every county, one column per candidate, and the
 * `State Totals` row the reconciliation depends on.
 */
const FIXTURE = join(
  __dirname,
  '../../../../../../../packages/scraping-pipeline/__tests__/fixtures/statement-of-vote-sample.xlsx',
);

function votesSource(overrides = {}): DataSourceConfig {
  return {
    url: 'https://elections.example/sov/19-governor.xlsx',
    dataType: DataType.COUNTY_THRESHOLDS,
    contentGoal: 'Gubernatorial votes by county',
    sourceType: 'bulk_download',
    bulk: {
      format: 'xlsx',
      xlsx: {
        labelColumn: 0,
        skipRowPattern: '^\\s*Percent',
        excludeLabels: ['State Totals'],
        sumAllValueColumns: true,
        electionYear: 2022,
        ...overrides,
      },
    },
  } as DataSourceConfig;
}

function mockFetchWith(bytes: Buffer): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => bytes,
  }) as unknown as typeof fetch;
}

describe('normalizeCountyName', () => {
  it.each([
    ['Nevada County', 'nevada'],
    ['Nevada', 'nevada'],
    ['  Los  Angeles County ', 'los angeles'],
    ['San Francisco', 'san francisco'],
  ])('reduces %s to %s', (input, expected) => {
    // The jurisdictions table says "Nevada County"; the state's spreadsheet
    // says "Nevada". Both sides normalize or every county misses its FIPS.
    expect(normalizeCountyName(input)).toBe(expected);
  });
});

describe('CountyThresholdSyncService', () => {
  let service: CountyThresholdSyncService;
  let db: MockDbClient;

  beforeEach(async () => {
    db = createMockDbService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CountyThresholdSyncService,
        { provide: DbService, useValue: db },
      ],
    }).compile();
    service = moduleRef.get(CountyThresholdSyncService);
    mockFetchWith(readFileSync(FIXTURE));
  });

  describe('readSheet', () => {
    it('sums every candidate column rather than reading the winner', async () => {
      // §9118 counts votes for ALL candidates. Reading one column understates
      // every threshold — for Alameda by 100,923 signatures.
      const facts = await service.readSheet(votesSource());
      const alameda = facts.find((f) => f.label === 'Alameda');
      expect(alameda?.value).toBe(487969); // 387,046 + 100,923
    });

    it('drops the interleaved Percent rows', async () => {
      const facts = await service.readSheet(votesSource());
      expect(facts.some((f) => f.label.trim() === 'Percent')).toBe(false);
    });

    it('rejects a row whose cells are not all numeric', async () => {
      // A Percent row reaching rowValue() must not be summed as votes. With
      // the skip pattern removed it is still refused, so the numeric check is
      // load-bearing on its own rather than relying on the pattern.
      const facts = await service.readSheet(
        votesSource({ skipRowPattern: undefined }),
      );
      expect(facts.some((f) => f.label.trim() === 'Percent')).toBe(false);
    });
  });

  describe('reconciliation against the file total', () => {
    it('throws when a declared aggregate label matches no row', async () => {
      // California's two spreadsheets disagree: the Statement of Vote says
      // "State Totals", the Report of Registration says "State Total". A
      // config carrying the plural for both left registration unverified while
      // looking healthy, and counted its total row as a 59th county. Warning
      // was not enough — the check you declared has to run or fail.
      await expect(
        service.readSheet(votesSource({ excludeLabels: ['Statewide Total'] })),
      ).rejects.toThrow(/declares excludeLabels.*never reconciled/s);
    });

    it('throws when the members do not sum to the aggregate row', async () => {
      // This is the check that proves the parse read every candidate column.
      // The fixture is a slice, so its members cannot equal the full state
      // total — exactly the mismatch a wrong-column parse would produce.
      await expect(
        service.readSheet(votesSource({ excludeLabels: ['Alameda'] })),
      ).rejects.toThrow(/does not reconcile/);
    });
  });

  describe('sync', () => {
    it('refuses to write when a county has no matching jurisdiction', async () => {
      // A county absent from the table renders as an unshaded polygon that
      // reads as data. Aborting is the lesser failure.
      db.jurisdiction.findMany.mockResolvedValue([
        { name: 'Alameda County', fipsCode: '06001' },
      ] as never);

      await expect(service.sync([votesSource()], 'CA')).rejects.toThrow(
        /no jurisdiction matches/i,
      );
      expect(db.countyThreshold.create).not.toHaveBeenCalled();
    });

    it('throws when no source supplies the §9118 denominator', async () => {
      await expect(service.sync([], 'CA')).rejects.toThrow(
        /sumAllValueColumns/,
      );
    });

    it('throws when the votes source does not say which cycle it describes', async () => {
      db.jurisdiction.findMany.mockResolvedValue([] as never);
      await expect(
        service.sync([votesSource({ electionYear: undefined })], 'CA'),
      ).rejects.toThrow(/electionYear/);
    });
  });
});
