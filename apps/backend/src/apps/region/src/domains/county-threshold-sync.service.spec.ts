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
  parseDelimited,
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

describe('parseDelimited', () => {
  it('splits plain rows', () => {
    expect(parseDelimited('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a quoted comma inside its field', () => {
    // A naive split puts "Doña Ana" and " NM" in different columns, which
    // shifts every later value — a population landing on the wrong county.
    expect(parseDelimited('NAME,POP\n"Baltimore, city",585708\n')).toEqual([
      ['NAME', 'POP'],
      ['Baltimore, city', '585708'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseDelimited('a\n"say ""hi"""\n')).toEqual([['a'], ['say "hi"']]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
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

  describe('readDelimited — population (#1131)', () => {
    // A two-county slice, so the state row carries the slice's total rather
    // than California's real 39,431,263 — otherwise the reconciliation below
    // correctly refuses it, which is the point of having the check.
    const CENSUS_CSV = [
      'SUMLEV,STATE,COUNTY,STNAME,CTYNAME,POPESTIMATE2024',
      '040,06,000,California,California,103294',
      '050,06,057,California,Nevada County,102195',
      '050,06,003,California,Alpine County,1099',
      '050,36,061,New York,New York County,1597451',
    ].join('\n');

    const populationSource = {
      url: 'https://www2.census.gov/co-est2024-alldata.csv',
      dataType: DataType.COUNTY_THRESHOLDS,
      contentGoal: 'County population estimates',
      sourceType: 'bulk_download',
      bulk: {
        format: 'csv',
        csv: {
          field: 'population',
          fipsColumns: ['STATE', 'COUNTY'],
          nameColumn: 'CTYNAME',
          valueColumn: 'POPESTIMATE2024',
          rowFilter: { SUMLEV: '050', STATE: '06' },
          aggregateFilter: { SUMLEV: '040', STATE: '06' },
          asOf: '2024-07-01',
        },
      },
    } as unknown as DataSourceConfig;

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => CENSUS_CSV,
      }) as unknown as typeof fetch;
    });

    it('builds FIPS by concatenating the columns the source splits', async () => {
      // 06 + 057 = 06057. Matching on a code beats requiring two publishers to
      // spell every county name identically forever.
      const facts = await service.readDelimited(populationSource);

      const nevada = facts.find((f) => f.fips === '06057');
      expect(nevada?.value).toBe(102195);
    });

    it('excludes the state-level row', async () => {
      // SUMLEV 040 is California itself. Written as a county it would put the
      // state's population on a county page and look entirely plausible.
      const facts = await service.readDelimited(populationSource);

      expect(facts.map((f) => f.fips)).toEqual(['06057', '06003']);
      expect(facts.every((f) => f.value !== 103294)).toBe(true);
    });

    it('excludes other states', async () => {
      const facts = await service.readDelimited(populationSource);

      expect(facts.every((f) => f.fips?.startsWith('06'))).toBe(true);
      expect(facts).toHaveLength(2);
    });

    it('names the missing column when the file changes shape', async () => {
      // A renamed column has to fail loudly. Yielding zero rows would look
      // like "the Census has no counties" and write null for all 58.
      const renamed = {
        ...populationSource,
        bulk: {
          ...populationSource.bulk,
          csv: {
            ...populationSource.bulk!.csv!,
            valueColumn: 'POPESTIMATE2099',
          },
        },
      } as DataSourceConfig;

      await expect(service.readDelimited(renamed)).rejects.toThrow(
        /no column "POPESTIMATE2099"/,
      );
    });
  });

  describe('reconciliation on the delimited path (#1131)', () => {
    // The counties must add up to the state row the publisher states. That is
    // what proves rowFilter kept exactly the right rows — the same check that
    // caught the Report of Registration counting its own total as a county.
    const withTotals = [
      'SUMLEV,STATE,COUNTY,STNAME,CTYNAME,POPESTIMATE2024',
      '040,06,000,California,California,1200',
      '050,06,057,California,Nevada County,500',
      '050,06,003,California,Alpine County,700',
    ].join('\n');

    const brokenTotals = withTotals.replace(
      'California,1200',
      'California,9999',
    );

    const src = (csv: Record<string, unknown>) =>
      ({
        url: 'https://www2.census.gov/co-est.csv',
        dataType: DataType.COUNTY_THRESHOLDS,
        contentGoal: 'population',
        sourceType: 'bulk_download',
        bulk: { format: 'csv', csv },
      }) as unknown as DataSourceConfig;

    const layout = {
      field: 'population',
      fipsColumns: ['STATE', 'COUNTY'],
      nameColumn: 'CTYNAME',
      valueColumn: 'POPESTIMATE2024',
      rowFilter: { SUMLEV: '050', STATE: '06' },
      aggregateFilter: { SUMLEV: '040', STATE: '06' },
    };

    const serve = (body: string) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => body,
      }) as unknown as typeof fetch;
    };

    it('accepts a file whose counties sum to the state row', async () => {
      serve(withTotals);
      const facts = await service.readDelimited(src(layout));
      expect(facts).toHaveLength(2);
      expect(facts.reduce((a, f) => a + f.value, 0)).toBe(1200);
    });

    it('refuses a file whose counties do not sum to the state row', async () => {
      serve(brokenTotals);
      await expect(service.readDelimited(src(layout))).rejects.toThrow(
        /does not reconcile/,
      );
    });

    it('throws when the declared aggregate row is absent', async () => {
      // Declaring the check and silently not running it is how the
      // registration file went unverified for a whole release.
      serve(withTotals);
      const absent = { ...layout, aggregateFilter: { SUMLEV: '999' } };
      await expect(service.readDelimited(src(absent))).rejects.toThrow(
        /declares excludeLabels|never reconciled/,
      );
    });
  });
});
