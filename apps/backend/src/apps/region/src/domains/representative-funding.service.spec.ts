import { DbService } from '@opuspopuli/relationaldb-provider';
import {
  RepresentativeFundingService,
  canonicalizeDonorName,
} from './representative-funding.service';

/** Minimal Prisma.Decimal stand-in — the service only calls `.toNumber()`. */
const dec = (n: number) => ({ toNumber: () => n });

interface GroupByArgs {
  by: string[];
}

type DonorRow = {
  donorName: string;
  _sum: { amount: unknown };
  _count: { _all: number };
};
type EmployerRow = {
  donorEmployer: string | null;
  _sum: { amount: unknown };
  _count: { _all: number };
};

function build(opts: {
  committees?: { id: string; name: string }[];
  contributionSum?: number;
  expenditureSum?: number;
  donorAgg?: DonorRow[];
  employerAgg?: EmployerRow[];
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
  } as unknown as DbService;
  return new RepresentativeFundingService(db);
}

/** Build a donor group row for the mocked groupBy. */
const donor = (name: string, amount: number, count = 1): DonorRow => ({
  donorName: name,
  _sum: { amount: dec(amount) },
  _count: { _all: count },
});

describe('canonicalizeDonorName (#954)', () => {
  it('collapses case, punctuation, and whitespace variants', () => {
    expect(canonicalizeDonorName('ACME Widgets')).toBe(
      canonicalizeDonorName('acme,  widgets.'),
    );
  });

  it('is word-order independent', () => {
    expect(canonicalizeDonorName('Jones Smith')).toBe(
      canonicalizeDonorName('Smith Jones'),
    );
  });

  it('expands "&" to "and" so both spellings match', () => {
    expect(canonicalizeDonorName('Smith & Jones')).toBe(
      canonicalizeDonorName('Smith and Jones'),
    );
  });

  it('drops boilerplate tokens (PAC / Inc / Committee / trailing suffix)', () => {
    expect(canonicalizeDonorName('Realtors PAC')).toBe(
      canonicalizeDonorName('Realtors'),
    );
    expect(canonicalizeDonorName('Widgets Inc')).toBe(
      canonicalizeDonorName('Widgets'),
    );
  });

  it('returns "" for a boilerplate-only name (callers must not merge these)', () => {
    expect(canonicalizeDonorName('PAC')).toBe('');
    expect(canonicalizeDonorName('The Committee')).toBe('');
  });

  it('keeps substantive words that distinguish donors — no over-merge', () => {
    // "Council on Political Education" carries substantive tokens; two counties
    // must stay distinct.
    expect(
      canonicalizeDonorName(
        'Los Angeles County Council on Political Education',
      ),
    ).not.toBe(
      canonicalizeDonorName('San Diego County Council on Political Education'),
    );
  });
});

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
      donorAgg: [donor('ACME PAC', 600, 3)],
      employerAgg: [
        {
          donorEmployer: 'Big Oil Co',
          _sum: { amount: dec(500) },
          _count: { _all: 2 },
        },
      ],
      perCommittee: [{ committeeId: 'c1', _sum: { amount: dec(1000) } }],
    });

    const f = await svc.getFunding('rep-1');
    expect(f.totalRaised).toBe(1000);
    expect(f.totalSpent).toBe(250);
    // donorCount is now the distinct-canonical bucket count, not a raw
    // COUNT(DISTINCT donor_name): one donor → 1.
    expect(f.donorCount).toBe(1);
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

  it('merges donor-name spelling variants into one donor and sums the money (#954)', async () => {
    // The prod case: one contributor split across spellings. Each fragment can
    // rank below the others, but merged it is the dominant donor.
    const svc = build({
      committees: [{ id: 'c1', name: 'Doe for Senate' }],
      donorAgg: [
        donor('ACME Widgets PAC', 5000, 4),
        donor('Widgets, ACME', 3000, 2), // punctuation + order variant
        donor('acme widgets', 2000, 6), // case variant
        donor('Different Donor LLC', 4000, 1),
      ],
    });

    const f = await svc.getFunding('rep-1');
    // 4 raw names → 2 canonical donors.
    expect(f.donorCount).toBe(2);
    // The three ACME variants merge to $10,000 / 12 gifts and rank first; the
    // displayed name is the highest-dollar raw variant.
    expect(f.topDonors[0]).toEqual({
      donorName: 'ACME Widgets PAC',
      totalAmount: 10000,
      contributionCount: 12,
    });
    expect(f.topDonors[1]).toEqual({
      donorName: 'Different Donor LLC',
      totalAmount: 4000,
      contributionCount: 1,
    });
  });

  it('merges employer variants and drops null employers', async () => {
    const svc = build({
      committees: [{ id: 'c1', name: 'C1' }],
      employerAgg: [
        {
          donorEmployer: null,
          _sum: { amount: dec(999) },
          _count: { _all: 9 },
        },
        {
          donorEmployer: 'Big Oil Co.',
          _sum: { amount: dec(600) },
          _count: { _all: 3 },
        },
        {
          donorEmployer: 'BIG OIL CO',
          _sum: { amount: dec(400) },
          _count: { _all: 2 },
        },
      ],
    });
    const f = await svc.getFunding('rep-1');
    expect(f.topEmployers).toEqual([
      { employer: 'Big Oil Co.', totalAmount: 1000, contributionCount: 5 },
    ]);
  });

  it('does not merge distinct boilerplate-only names together', async () => {
    // Two different all-boilerplate names must stay separate (canonical key ''
    // falls back to the raw name).
    const svc = build({
      committees: [{ id: 'c1', name: 'C1' }],
      donorAgg: [donor('PAC', 100, 1), donor('The Committee', 50, 1)],
    });
    const f = await svc.getFunding('rep-1');
    expect(f.donorCount).toBe(2);
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
