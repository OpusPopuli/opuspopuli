import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import type { ICache } from '@opuspopuli/common';
import { REGION_CACHE } from './region.tokens';

export interface RepFundingTopDonor {
  donorName: string;
  totalAmount: number;
  contributionCount: number;
}

export interface RepFundingTopEmployer {
  employer: string;
  totalAmount: number;
  contributionCount: number;
}

export interface RepFundingCommittee {
  id: string;
  name: string;
  totalRaised: number;
}

export interface RepresentativeFunding {
  representativeId: string;
  asOf: Date;
  totalRaised: number;
  totalSpent: number;
  donorCount: number;
  committeeCount: number;
  topDonors: RepFundingTopDonor[];
  topEmployers: RepFundingTopEmployer[];
  committees: RepFundingCommittee[];
}

const TOP_DONORS_LIMIT = 8;
const TOP_EMPLOYERS_LIMIT = 8;

/**
 * Aggregate campaign finance for a representative (#943, epic #936) across the
 * committees the candidate-committee linker (#941) attributed to them. Powers
 * the rep-page "follow the money" surface: totals, top donors, and the top
 * employers behind the money (the industry / conflict-of-interest lens).
 *
 * Cached in REGION_CACHE under `representativeFunding:{id}`; returns an
 * empty-shaped result when the rep has no linked committees (or no DB).
 */
@Injectable()
export class RepresentativeFundingService {
  private readonly logger = new Logger(RepresentativeFundingService.name);

  constructor(
    @Optional() private readonly db?: DbService,
    @Optional() @Inject(REGION_CACHE) private readonly cache?: ICache<string>,
  ) {}

  async getFunding(representativeId: string): Promise<RepresentativeFunding> {
    const cacheKey = `representativeFunding:${representativeId}`;
    const cached = await this.cache?.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as RepresentativeFunding;
      parsed.asOf = new Date(parsed.asOf);
      return parsed;
    }
    const fresh = await this.computeFunding(representativeId);
    // Don't cache the empty-shaped result: a rep freshly attributed committees
    // by the linker (#941) + a finance sync would otherwise stay empty until
    // the 4h TTL expires. Populated results are safe to cache.
    if (fresh.committeeCount > 0) {
      await this.cache?.set(cacheKey, JSON.stringify(fresh));
    }
    return fresh;
  }

  private async computeFunding(
    representativeId: string,
  ): Promise<RepresentativeFunding> {
    if (!this.db) return this.empty(representativeId);

    const committees = await this.db.committee.findMany({
      where: { representativeId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (committees.length === 0) return this.empty(representativeId);
    const committeeIds = committees.map((c) => c.id);
    const where = { committeeId: { in: committeeIds } };

    const [
      contributionAgg,
      expenditureAgg,
      donorAgg,
      employerAgg,
      donorCountRows,
      perCommittee,
    ] = await Promise.all([
      this.db.contribution.aggregate({ where, _sum: { amount: true } }),
      this.db.expenditure.aggregate({ where, _sum: { amount: true } }),
      this.db.contribution.groupBy({
        by: ['donorName'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: TOP_DONORS_LIMIT,
      }),
      this.db.contribution.groupBy({
        by: ['donorEmployer'],
        where: { ...where, donorEmployer: { not: null } },
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: TOP_EMPLOYERS_LIMIT,
      }),
      // DB-side distinct count — returns a single row instead of materializing
      // every distinct donor name just to `.length` it (the @Public endpoint
      // could otherwise force a large unbounded scan). committeeIds are bound
      // via Prisma.join, so this is parameterized.
      this.db.$queryRaw<{ count: number }[]>`
        SELECT COUNT(DISTINCT donor_name)::int AS count
        FROM contributions
        WHERE committee_id IN (${Prisma.join(committeeIds)})
      `,
      this.db.contribution.groupBy({
        by: ['committeeId'],
        where,
        _sum: { amount: true },
      }),
    ]);

    const raisedByCommittee = new Map(
      perCommittee.map((p) => [p.committeeId, toNumber(p._sum.amount)]),
    );

    return {
      representativeId,
      asOf: new Date(),
      totalRaised: toNumber(contributionAgg._sum.amount),
      totalSpent: toNumber(expenditureAgg._sum.amount),
      donorCount: donorCountRows[0]?.count ?? 0,
      committeeCount: committees.length,
      topDonors: donorAgg.map((d) => ({
        donorName: d.donorName,
        totalAmount: toNumber(d._sum.amount),
        contributionCount: d._count._all,
      })),
      topEmployers: employerAgg
        .filter((e) => e.donorEmployer)
        .map((e) => ({
          employer: e.donorEmployer as string,
          totalAmount: toNumber(e._sum.amount),
          contributionCount: e._count._all,
        })),
      // Ordered by money so the "flows through" list is meaningful + stable.
      committees: committees
        .map((c) => ({
          id: c.id,
          name: c.name,
          totalRaised: raisedByCommittee.get(c.id) ?? 0,
        }))
        .sort((a, b) => b.totalRaised - a.totalRaised),
    };
  }

  private empty(representativeId: string): RepresentativeFunding {
    return {
      representativeId,
      asOf: new Date(),
      totalRaised: 0,
      totalSpent: 0,
      donorCount: 0,
      committeeCount: 0,
      topDonors: [],
      topEmployers: [],
      committees: [],
    };
  }
}

function toNumber(value: Prisma.Decimal | null | undefined): number {
  return value ? value.toNumber() : 0;
}
