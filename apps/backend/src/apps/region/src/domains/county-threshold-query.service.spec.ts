import { Test } from '@nestjs/testing';
import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  createMockDbService,
  type MockDbClient,
} from '@opuspopuli/relationaldb-provider/testing';
import { CountyThresholdQueryService } from './county-threshold-query.service';

const row = (
  fips: string,
  name: string,
  votes: number,
  registered: number | null = 100000,
) => ({
  fips,
  name,
  gubernatorialVotes: votes,
  gubernatorialYear: 2022,
  registeredVoters: registered,
  population: null,
  sourceUrl: 'https://elections.example/sov.xlsx',
  retrievedAt: new Date('2026-09-03T00:00:00Z'),
});

describe('CountyThresholdQueryService', () => {
  let service: CountyThresholdQueryService;
  let db: MockDbClient;

  beforeEach(async () => {
    db = createMockDbService();
    db.countyAdjacency.findMany.mockResolvedValue([] as never);
    const ref = await Test.createTestingModule({
      providers: [
        CountyThresholdQueryService,
        { provide: DbService, useValue: db },
      ],
    }).compile();
    service = ref.get(CountyThresholdQueryService);
  });

  describe('signaturesFor', () => {
    it.each([
      [50737, 5074], // Nevada County: 5073.7 rounds UP
      [10, 1],
      [11, 2], // 1.1 -> 2, not 1
      [100, 10], // exact multiples do not gain a signature
      [619, 62], // Alpine County, the smallest in California
    ])('%i votes requires %i signatures', (votes, expected) => {
      // Rounded UP: a fractional signature is not a thing, and rounding down
      // would understate a legal requirement.
      expect(CountyThresholdQueryService.signaturesFor(votes)).toBe(expected);
    });
  });

  describe('findAll', () => {
    it('derives signaturesRequired and shareOfRegistered per county', async () => {
      db.$queryRaw.mockResolvedValue([row('06057', 'Nevada', 50737, 76423)]);

      const [county] = await service.findAll();

      expect(county.signaturesRequired).toBe(5074);
      expect(county.shareOfRegistered).toBeCloseTo(5074 / 76423, 10);
    });

    it('leaves shareOfRegistered null when registration is unknown', async () => {
      // Better an absent figure than a division that invents one.
      db.$queryRaw.mockResolvedValue([row('06057', 'Nevada', 50737, null)]);

      const [county] = await service.findAll();

      expect(county.shareOfRegistered).toBeNull();
      expect(county.signaturesRequired).toBe(5074);
    });

    it('ranks from 1, cheapest first', async () => {
      db.$queryRaw.mockResolvedValue([
        row('06003', 'Alpine', 619),
        row('06057', 'Nevada', 50737),
        row('06037', 'Los Angeles', 2389223),
      ]);

      const counties = await service.findAll();

      expect(counties.map((c) => c.rank)).toEqual([1, 2, 3]);
      // Rank 1 is the cheapest, not the largest — the page's question is
      // "where is this achievable".
      expect(counties[0].name).toBe('Alpine');
    });

    it('exposes provenance on every county', async () => {
      db.$queryRaw.mockResolvedValue([row('06057', 'Nevada', 50737)]);

      const [county] = await service.findAll();

      // Part of the contract, not decoration: a reader must be able to check
      // the figure against the record it came from.
      expect(county.sourceUrl).toContain('sov.xlsx');
      expect(county.retrievedAt).toBeInstanceOf(Date);
    });
  });

  describe('cheapestNeighbor', () => {
    it('picks the adjacent county needing the fewest signatures', async () => {
      db.$queryRaw.mockResolvedValue([
        row('06057', 'Nevada', 50737),
        row('06061', 'Placer', 200000),
        row('06091', 'Sierra', 2000),
      ]);
      db.countyAdjacency.findMany.mockResolvedValue([
        { fips: '06057', neighbor: '06061' },
        { fips: '06057', neighbor: '06091' },
      ] as never);

      const nevada = (await service.findAll()).find((c) => c.fips === '06057');

      expect(nevada?.cheapestNeighbor?.name).toBe('Sierra');
      expect(nevada?.cheapestNeighbor?.signaturesRequired).toBe(200);
    });

    it('is null for a county with no adjacency rows', async () => {
      db.$queryRaw.mockResolvedValue([row('06057', 'Nevada', 50737)]);

      const [county] = await service.findAll();

      expect(county.cheapestNeighbor).toBeNull();
    });

    it('skips an edge pointing at a county with no threshold row', async () => {
      // Adjacency is materialized from geometry, so it can name a county that
      // has no figures yet. Reporting it would mean naming a neighbour whose
      // requirement we cannot state.
      db.$queryRaw.mockResolvedValue([row('06057', 'Nevada', 50737)]);
      db.countyAdjacency.findMany.mockResolvedValue([
        { fips: '06057', neighbor: '06999' },
      ] as never);

      const [county] = await service.findAll();

      expect(county.cheapestNeighbor).toBeNull();
    });
  });
});
