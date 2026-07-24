import { DbService } from '@opuspopuli/relationaldb-provider';
import { RepresentativeFundingService } from './representative-funding.service';

/** Minimal Prisma.Decimal stand-in — the service only calls `.toNumber()`. */
const dec = (n: number) => ({ toNumber: () => n });

interface GroupByArgs {
  by: string[];
}

function build(opts: {
  committees?: { id: string; name: string }[];
  contributionSum?: number;
  expenditureSum?: number;
  donorAgg?: {
    donorName: string;
    _sum: { amount: unknown };
    _count: { _all: number };
  }[];
  employerAgg?: {
    donorEmployer: string | null;
    _sum: { amount: unknown };
    _count: { _all: number };
  }[];
  donorCount?: number;
  perCommittee?: { committeeId: string; _sum: { amount: unknown } }[];
}) {
  const groupBy = jest.fn((args: GroupByArgs) => {
    if (args.by[0] === 'donorName') return Promise.resolve(opts.donorAgg ?? []);
    if (args.by[0] === 'donorEmployer')
      return Promise.resolve(opts.employerAgg ?? []);
    if (args.by[0] === 'committeeId')
      return Promise.resolve(opts.perCommittee ?? []);
    return Promise.resolve([]);
  });
  const db = {
    committee: {
      findMany: jest.fn().mockResolvedValue(opts.committees ?? []),
    },
    contribution: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: dec(opts.contributionSum ?? 0) },
      }),
      groupBy,
    },
    expenditure: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { amount: dec(opts.expenditureSum ?? 0) } }),
    },
    // $queryRaw is a tagged-template fn — return the DB-side distinct count.
    $queryRaw: jest.fn().mockResolvedValue([{ count: opts.donorCount ?? 0 }]),
  } as unknown as DbService;
  return new RepresentativeFundingService(db);
}

describe('RepresentativeFundingService (#943)', () => {
  it('returns an empty-shaped result when the rep has no linked committees', async () => {
    const svc = build({ committees: [] });
    const funding = await svc.getFunding('rep-1');
    expect(funding).toMatchObject({
      representativeId: 'rep-1',
      totalRaised: 0,
      totalSpent: 0,
      donorCount: 0,
      committeeCount: 0,
      topDonors: [],
      topEmployers: [],
      committees: [],
    });
  });

  it('aggregates totals, top donors, top employers, and per-committee raised', async () => {
    const svc = build({
      committees: [{ id: 'c1', name: 'Friends of Doe' }],
      contributionSum: 1000,
      expenditureSum: 250,
      donorAgg: [
        {
          donorName: 'ACME PAC',
          _sum: { amount: dec(600) },
          _count: { _all: 3 },
        },
      ],
      employerAgg: [
        {
          donorEmployer: 'Big Oil Co',
          _sum: { amount: dec(500) },
          _count: { _all: 2 },
        },
      ],
      donorCount: 2,
      perCommittee: [{ committeeId: 'c1', _sum: { amount: dec(1000) } }],
    });

    const f = await svc.getFunding('rep-1');
    expect(f.totalRaised).toBe(1000);
    expect(f.totalSpent).toBe(250);
    expect(f.donorCount).toBe(2);
    expect(f.committeeCount).toBe(1);
    expect(f.topDonors).toEqual([
      { donorName: 'ACME PAC', totalAmount: 600, contributionCount: 3 },
    ]);
    expect(f.topEmployers).toEqual([
      { employer: 'Big Oil Co', totalAmount: 500, contributionCount: 2 },
    ]);
    expect(f.committees).toEqual([
      { id: 'c1', name: 'Friends of Doe', totalRaised: 1000 },
    ]);
  });

  it('drops employer buckets with a null employer', async () => {
    const svc = build({
      committees: [{ id: 'c1', name: 'C1' }],
      employerAgg: [
        {
          donorEmployer: null,
          _sum: { amount: dec(999) },
          _count: { _all: 9 },
        },
        {
          donorEmployer: 'Real Employer',
          _sum: { amount: dec(100) },
          _count: { _all: 1 },
        },
      ],
    });
    const f = await svc.getFunding('rep-1');
    expect(f.topEmployers).toEqual([
      { employer: 'Real Employer', totalAmount: 100, contributionCount: 1 },
    ]);
  });

  it('is empty-shaped with no db wired', async () => {
    const svc = new RepresentativeFundingService();
    const f = await svc.getFunding('rep-1');
    expect(f.committeeCount).toBe(0);
    expect(f.topDonors).toEqual([]);
  });

  it('serves a cached result and revives the asOf Date without recomputing', async () => {
    const cached = {
      representativeId: 'rep-1',
      asOf: '2026-07-24T00:00:00.000Z',
      totalRaised: 500,
      totalSpent: 100,
      donorCount: 10,
      committeeCount: 1,
      topDonors: [],
      topEmployers: [],
      committees: [],
    };
    const committeeFindMany = jest.fn();
    const cache = {
      get: jest.fn().mockResolvedValue(JSON.stringify(cached)),
      set: jest.fn(),
    };
    const db = {
      committee: { findMany: committeeFindMany },
    } as unknown as DbService;
    const svc = new RepresentativeFundingService(db, cache as unknown as never);

    const f = await svc.getFunding('rep-1');
    expect(committeeFindMany).not.toHaveBeenCalled(); // cache hit → no compute
    expect(f.asOf).toBeInstanceOf(Date);
    expect(f.totalRaised).toBe(500);
  });

  it('does not cache an empty-shaped result (so a freshly-linked rep is not stuck empty)', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    };
    const db = {
      committee: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as DbService;
    const svc = new RepresentativeFundingService(db, cache as unknown as never);

    await svc.getFunding('rep-1');
    expect(cache.set).not.toHaveBeenCalled();
  });
});
