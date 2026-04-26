/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import {
  CommitteeMeasurePositionType,
  DbService,
  Prisma,
} from '@opuspopuli/relationaldb-provider';
import type { ICache } from '@opuspopuli/common';

import { PropositionFundingService } from './proposition-funding.service';
import { REGION_CACHE } from './region.tokens';

/**
 * Wrap a JS number in a Prisma.Decimal-shaped stub so toNumber() works
 * the same way the real Prisma client returns aggregate sums. The funding
 * service goes through .toNumber() rather than Number() so we have to
 * provide that method.
 */
function dec(n: number): Prisma.Decimal {
  return { toNumber: () => n } as unknown as Prisma.Decimal;
}

describe('PropositionFundingService', () => {
  async function buildService(
    opts: {
      positions?: Array<{
        committeeId: string;
        position: 'support' | 'oppose';
      }>;
      contributionSums?: Map<string, number>; // committeeId set → sum
      contributionCount?: number;
      expenditureSums?: Map<string, number>;
      ieSums?: Array<{ position: 'support' | 'oppose'; sum: number }>;
      topDonors?: Array<{
        donorName: string;
        sum: number;
        count: number;
      }>;
      distinctDonors?: string[];
      committees?: Array<{ id: string; name: string }>;
      contributionByCommittee?: Map<string, number>;
      cached?: string | null;
      withDb?: boolean;
      withCache?: boolean;
    } = {},
  ) {
    const {
      positions = [],
      contributionSums = new Map(),
      expenditureSums = new Map(),
      ieSums = [],
      topDonors = [],
      distinctDonors = [],
      committees = [],
      contributionByCommittee = new Map(),
      cached = null,
      withDb = true,
      withCache = true,
    } = opts;

    const cacheStore = new Map<string, string>();
    if (cached) cacheStore.set('propositionFunding:prop-1', cached);

    const mockCache: ICache<string> = {
      get: jest.fn(async (k: string) => cacheStore.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        cacheStore.set(k, v);
      }),
      delete: jest.fn(async (k: string) => {
        cacheStore.delete(k);
      }),
      destroy: jest.fn(async () => {}),
      keys: jest.fn(async () => Array.from(cacheStore.keys())),
    } as unknown as ICache<string>;

    const mockDb = {
      committeeMeasurePosition: {
        findMany: jest.fn(async (args: any) =>
          positions
            .filter((p) => p.position === args.where.position)
            .map((p) => ({ committeeId: p.committeeId })),
        ),
      },
      contribution: {
        aggregate: jest.fn(async (args: any) => {
          const ids = args.where.committeeId.in as string[];
          const key = ids.slice().sort().join('|');
          return { _sum: { amount: dec(contributionSums.get(key) ?? 0) } };
        }),
        groupBy: jest.fn(async (args: any) => {
          if (args.by.includes('donorName')) {
            return topDonors.map((d) => ({
              donorName: d.donorName,
              _sum: { amount: dec(d.sum) },
              _count: { _all: d.count },
            }));
          }
          if (args.by.includes('committeeId')) {
            return Array.from(contributionByCommittee.entries()).map(
              ([cid, total]) => ({
                committeeId: cid,
                _sum: { amount: dec(total) },
              }),
            );
          }
          return [];
        }),
        findMany: jest.fn(async () =>
          distinctDonors.map((name) => ({ donorName: name })),
        ),
      },
      expenditure: {
        aggregate: jest.fn(async (args: any) => {
          const ids = args.where.committeeId.in as string[];
          const key = ids.slice().sort().join('|');
          return { _sum: { amount: dec(expenditureSums.get(key) ?? 0) } };
        }),
      },
      independentExpenditure: {
        aggregate: jest.fn(async (args: any) => {
          const codes: string[] = args.where.supportOrOppose.in;
          const position: 'support' | 'oppose' = codes.includes('support')
            ? 'support'
            : 'oppose';
          const match = ieSums.find((s) => s.position === position);
          return { _sum: { amount: dec(match?.sum ?? 0) } };
        }),
      },
      committee: {
        findMany: jest.fn(async () => committees),
      },
    } as unknown as DbService;

    const providers: unknown[] = [PropositionFundingService];
    if (withDb) providers.push({ provide: DbService, useValue: mockDb });
    if (withCache)
      providers.push({ provide: REGION_CACHE, useValue: mockCache });

    const module: TestingModule = await Test.createTestingModule({
      providers: providers as Parameters<
        typeof Test.createTestingModule
      >[0]['providers'],
    }).compile();

    return {
      service: module.get(PropositionFundingService),
      cacheStore,
      mockCache,
      mockDb,
    };
  }

  describe('when db is unavailable', () => {
    it('returns an empty funding shape', async () => {
      const built = await buildService({ withDb: false, withCache: false });
      const out = await built.service.getFunding('prop-1');
      expect(out.propositionId).toBe('prop-1');
      expect(out.support.totalRaised).toBe(0);
      expect(out.oppose.totalRaised).toBe(0);
      expect(out.support.topDonors).toEqual([]);
    });
  });

  describe('aggregation', () => {
    it('sums contributions + expenditures + IEs separately for each side', async () => {
      const built = await buildService({
        positions: [
          { committeeId: 'c-yes', position: 'support' },
          { committeeId: 'c-no', position: 'oppose' },
        ],
        contributionSums: new Map([
          ['c-yes', 100_000],
          ['c-no', 50_000],
        ]),
        expenditureSums: new Map([
          ['c-yes', 80_000],
          ['c-no', 40_000],
        ]),
        ieSums: [
          { position: 'support', sum: 25_000 },
          { position: 'oppose', sum: 15_000 },
        ],
        topDonors: [],
        distinctDonors: [],
        committees: [],
      });

      const out = await built.service.getFunding('prop-1');

      // 100k contributions + 25k IEs = 125k raised on the support side
      expect(out.support.totalRaised).toBe(125_000);
      expect(out.support.totalSpent).toBe(80_000 + 25_000);
      // 50k + 15k = 65k raised on the oppose side
      expect(out.oppose.totalRaised).toBe(65_000);
      expect(out.oppose.totalSpent).toBe(40_000 + 15_000);
    });

    it('returns IE-only totals when no committees are linked to either side', async () => {
      const built = await buildService({
        positions: [],
        ieSums: [
          { position: 'support', sum: 10_000 },
          { position: 'oppose', sum: 20_000 },
        ],
      });

      const out = await built.service.getFunding('prop-1');

      expect(out.support.totalRaised).toBe(10_000);
      expect(out.oppose.totalRaised).toBe(20_000);
      expect(out.support.committeeCount).toBe(0);
      expect(out.oppose.committeeCount).toBe(0);
      expect(out.support.topDonors).toEqual([]);
      expect(out.oppose.topDonors).toEqual([]);
    });

    it('exposes top donors aggregated by donor name', async () => {
      const built = await buildService({
        positions: [{ committeeId: 'c-yes', position: 'support' }],
        contributionSums: new Map([['c-yes', 60_000]]),
        topDonors: [
          { donorName: 'BIG GIVER LLC', sum: 50_000, count: 3 },
          { donorName: 'A. Donor', sum: 10_000, count: 1 },
        ],
        distinctDonors: ['BIG GIVER LLC', 'A. Donor', 'Quiet Donor'],
      });

      const out = await built.service.getFunding('prop-1');

      expect(out.support.topDonors).toHaveLength(2);
      expect(out.support.topDonors[0]).toEqual({
        donorName: 'BIG GIVER LLC',
        totalAmount: 50_000,
        contributionCount: 3,
      });
      // donorCount uses the distinct list, not the top-donors slice
      expect(out.support.donorCount).toBe(3);
    });

    it('returns primary committees sorted by total raised, capped at 3', async () => {
      const built = await buildService({
        positions: [
          { committeeId: 'c-1', position: 'support' },
          { committeeId: 'c-2', position: 'support' },
          { committeeId: 'c-3', position: 'support' },
          { committeeId: 'c-4', position: 'support' },
        ],
        contributionSums: new Map([['c-1|c-2|c-3|c-4', 1_000_000]]),
        committees: [
          { id: 'c-1', name: 'Small Yes Committee' },
          { id: 'c-2', name: 'Big Yes Committee' },
          { id: 'c-3', name: 'Mid Yes Committee' },
          { id: 'c-4', name: 'Tiny Yes Committee' },
        ],
        contributionByCommittee: new Map([
          ['c-1', 50_000],
          ['c-2', 800_000],
          ['c-3', 130_000],
          ['c-4', 20_000],
        ]),
      });

      const out = await built.service.getFunding('prop-1');

      expect(out.support.primaryCommittees).toHaveLength(3);
      expect(out.support.primaryCommittees[0].name).toBe('Big Yes Committee');
      expect(out.support.primaryCommittees[1].name).toBe('Mid Yes Committee');
      expect(out.support.primaryCommittees[2].name).toBe('Small Yes Committee');
    });
  });

  describe('caching', () => {
    it('returns the cached value without hitting the DB', async () => {
      const cachedShape = JSON.stringify({
        propositionId: 'prop-1',
        asOf: new Date('2026-04-25T00:00:00Z').toISOString(),
        support: {
          totalRaised: 999,
          totalSpent: 0,
          donorCount: 0,
          committeeCount: 0,
          topDonors: [],
          primaryCommittees: [],
        },
        oppose: {
          totalRaised: 0,
          totalSpent: 0,
          donorCount: 0,
          committeeCount: 0,
          topDonors: [],
          primaryCommittees: [],
        },
      });
      const built = await buildService({ cached: cachedShape });

      const out = await built.service.getFunding('prop-1');

      expect(out.support.totalRaised).toBe(999);
      expect(built.mockCache.get).toHaveBeenCalledWith(
        'propositionFunding:prop-1',
      );
      expect(out.asOf).toBeInstanceOf(Date);
    });

    it('writes to cache after computing fresh', async () => {
      const built = await buildService({
        positions: [{ committeeId: 'c-yes', position: 'support' }],
        contributionSums: new Map([['c-yes', 1_000]]),
      });

      await built.service.getFunding('prop-1');

      expect(built.mockCache.set).toHaveBeenCalledWith(
        'propositionFunding:prop-1',
        expect.any(String),
      );
    });

    it('invalidateCache deletes the entry', async () => {
      const built = await buildService({
        cached: JSON.stringify({
          propositionId: 'prop-1',
          asOf: new Date().toISOString(),
          support: {
            totalRaised: 1,
            totalSpent: 0,
            donorCount: 0,
            committeeCount: 0,
            topDonors: [],
            primaryCommittees: [],
          },
          oppose: {
            totalRaised: 0,
            totalSpent: 0,
            donorCount: 0,
            committeeCount: 0,
            topDonors: [],
            primaryCommittees: [],
          },
        }),
      });

      await built.service.invalidateCache('prop-1');
      expect(built.mockCache.delete).toHaveBeenCalledWith(
        'propositionFunding:prop-1',
      );
    });

    it('runs without a cache (cache is optional)', async () => {
      const built = await buildService({
        withCache: false,
        positions: [],
        ieSums: [{ position: 'support', sum: 5 }],
      });

      const out = await built.service.getFunding('prop-1');
      expect(out.support.totalRaised).toBe(5);
    });
  });

  describe('position code normalization', () => {
    it('honors both long-form and CalAccess single-letter IE codes', async () => {
      const built = await buildService({
        positions: [],
        ieSums: [
          { position: 'support', sum: 1_000 },
          { position: 'oppose', sum: 2_000 },
        ],
      });

      const out = await built.service.getFunding('prop-1');

      // Verify the aggregate was called with both codes for each side.
      const ieCalls = (
        built.mockDb.independentExpenditure.aggregate as jest.Mock
      ).mock.calls;
      expect(ieCalls).toHaveLength(2);
      const codeSets = ieCalls.map((c) => c[0].where.supportOrOppose.in);
      expect(codeSets).toContainEqual(['support', 'S']);
      expect(codeSets).toContainEqual(['oppose', 'O']);

      expect(out.support.totalRaised).toBe(1_000);
      expect(out.oppose.totalRaised).toBe(2_000);
    });
  });

  // CommitteeMeasurePositionType is referenced indirectly via the service —
  // assert that it's an actual enum object so a future Prisma regen surfaces.
  it('relies on the Prisma-generated CommitteeMeasurePositionType enum', () => {
    expect(CommitteeMeasurePositionType.support).toBe('support');
    expect(CommitteeMeasurePositionType.oppose).toBe('oppose');
  });
});
