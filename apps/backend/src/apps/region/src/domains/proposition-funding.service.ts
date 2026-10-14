import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CommitteeMeasurePositionType,
  DbService,
} from '@opuspopuli/relationaldb-provider';
import type { ICache } from '@opuspopuli/common';
import { REGION_CACHE } from './region.tokens';
import {
  EMPTY_FUNDING_BASIS,
  FundingBasisService,
  type FundingBasis,
} from './funding-basis.service';
import { reviveBasis, toNumber } from './finance-money';

/** Output shape — mirrored by PropositionFundingModel for the GraphQL surface. */
export interface SidedFunding {
  totalRaised: number;
  totalSpent: number;
  donorCount: number;
  committeeCount: number;
  topDonors: {
    donorName: string;
    totalAmount: number;
    contributionCount: number;
  }[];
  primaryCommittees: { id: string; name: string; totalRaised: number }[];
  /** What this side's totals rest on (#991) — never omitted, zeros included. */
  basis: FundingBasis;
}

export interface PropositionFunding {
  propositionId: string;
  asOf: Date;
  support: SidedFunding;
  oppose: SidedFunding;
}

/**
 * Bumped whenever the cached SHAPE changes (#991).
 *
 * The entry is JSON, so a deploy that adds a field to the cached object meets
 * entries written by the previous build for the full 4-hour TTL. Guarding on
 * one field's presence does not scale: this change added `basis`, then added
 * `measured` inside it, and an entry written between those two revisions
 * satisfies `!!parsed.basis` while leaving a non-nullable GraphQL field
 * undefined — which fails EVERY query for that id until the TTL expires.
 *
 * A version in the key makes a shape change a cache miss by construction:
 * stale entries are never read and expire on their own. Bump this on any
 * change to the cached interface.
 */
const CACHE_VERSION = 'v2';

const TOP_DONORS_LIMIT = 5;
const PRIMARY_COMMITTEES_LIMIT = 3;

/**
 * Aggregates campaign-finance flows for a single proposition.
 *
 * For each side (support / oppose), totals come from two channels:
 *
 * 1. Contributions to committees that have a `CommitteeMeasurePosition`
 *    matching the proposition + side. These are the primarily-formed and
 *    inferred ballot-measure committees.
 * 2. Independent expenditures whose `propositionId = $1` and whose
 *    `supportOrOppose` matches the side. These cover general-purpose
 *    committees (Super PACs, party committees) that spend on the measure
 *    without forming a primarily-formed committee for it.
 *
 * `totalSpent` follows the same dual-channel logic with `Expenditure` rows.
 * `topDonors` aggregates by donor name across the side's committees.
 *
 * Cached in REGION_CACHE under `propositionFunding:{version}:{id}` for 4 hours; the
 * linker is responsible for invalidating after each sync (this service
 * doesn't know when the underlying data changes).
 */
@Injectable()
export class PropositionFundingService {
  private readonly logger = new Logger(PropositionFundingService.name);

  constructor(
    @Optional() private readonly db?: DbService,
    @Optional() @Inject(REGION_CACHE) private readonly cache?: ICache<string>,
    @Optional() private readonly basis?: FundingBasisService,
  ) {}

  /**
   * Compute (or return cached) funding totals for a proposition. Returns
   * an empty-shaped result when the service has no DB or no positions exist.
   */
  async getFunding(propositionId: string): Promise<PropositionFunding> {
    const cacheKey = `propositionFunding:${CACHE_VERSION}:${propositionId}`;
    const cached = await this.cache?.get(cacheKey);
    const revived = cached ? reviveCached(cached) : null;
    if (revived) return revived;

    const fresh = await this.computeFunding(propositionId);
    await this.cache?.set(cacheKey, JSON.stringify(fresh));
    return fresh;
  }

  /**
   * Compute funding from scratch. Splits the read into per-side queries
   * because the aggregation differs by position; runs them in parallel.
   */
  private async computeFunding(
    propositionId: string,
  ): Promise<PropositionFunding> {
    if (!this.db) {
      return this.emptyFunding(propositionId);
    }
    // Resolved ONCE for both sides. The two sides are two committee sets and
    // each would otherwise issue the identical snapshot query for the
    // identical row.
    const asOfSource = (await this.basis?.sourceDate()) ?? null;
    const [support, oppose] = await Promise.all([
      this.computeSide(
        propositionId,
        CommitteeMeasurePositionType.support,
        asOfSource,
      ),
      this.computeSide(
        propositionId,
        CommitteeMeasurePositionType.oppose,
        asOfSource,
      ),
    ]);
    return {
      propositionId,
      asOf: new Date(),
      support,
      oppose,
    };
  }

  /**
   * Compute aggregates for one side. Reads the committees declaring this
   * position, then sums their contributions and expenditures, plus any
   * independent expenditures targeting the measure with the matching code.
   */
  private async computeSide(
    propositionId: string,
    position: CommitteeMeasurePositionType,
    asOfSource: Date | null,
  ): Promise<SidedFunding> {
    const positions = await this.db!.committeeMeasurePosition.findMany({
      where: { propositionId, position },
      select: { committeeId: true },
    });
    const committeeIds = positions.map((p) => p.committeeId);

    if (committeeIds.length === 0) {
      // Even with no primarily-formed committees, IEs may target the measure.
      const ieAggregates = await this.computeIndependentExpenditureAggregates(
        propositionId,
        position,
      );
      return {
        totalRaised: ieAggregates.totalRaised,
        totalSpent: ieAggregates.totalSpent,
        donorCount: 0,
        committeeCount: 0,
        topDonors: [],
        primaryCommittees: [],
        basis: await this.resolveBasis(committeeIds, asOfSource),
      };
    }

    const [
      contributionAgg,
      expenditureAgg,
      ieAgg,
      donorAgg,
      uniqueDonors,
      primaryCommittees,
      // Inside the fan-out, not awaited after it: the basis depends on none of
      // the others, so a serial await only added a round trip to the critical
      // path — twice per proposition, once per side.
      basis,
    ] = await Promise.all([
      this.db!.contribution.aggregate({
        where: { committeeId: { in: committeeIds } },
        _sum: { amount: true },
      }),
      this.db!.expenditure.aggregate({
        where: { committeeId: { in: committeeIds } },
        _sum: { amount: true },
      }),
      this.computeIndependentExpenditureAggregates(propositionId, position),
      this.db!.contribution.groupBy({
        by: ['donorName'],
        where: { committeeId: { in: committeeIds } },
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: TOP_DONORS_LIMIT,
      }),
      this.db!.contribution.findMany({
        where: { committeeId: { in: committeeIds } },
        distinct: ['donorName'],
        select: { donorName: true },
      }),
      this.computePrimaryCommittees(propositionId, position),
      this.resolveBasis(committeeIds, asOfSource),
    ]);

    return {
      basis,
      totalRaised: toNumber(contributionAgg._sum.amount) + ieAgg.totalRaised,
      totalSpent: toNumber(expenditureAgg._sum.amount) + ieAgg.totalSpent,
      donorCount: uniqueDonors.length,
      committeeCount: committeeIds.length,
      topDonors: donorAgg.map((d) => ({
        donorName: d.donorName,
        totalAmount: toNumber(d._sum.amount),
        contributionCount: d._count._all,
      })),
      primaryCommittees,
    };
  }

  /**
   * Sum independent expenditures targeting the measure with this position.
   * Counts both `totalRaised` and `totalSpent` against the same number — an
   * IE represents money spent (not raised through a committee) but for the
   * UI's "total against this measure" view both columns include it.
   */
  private async computeIndependentExpenditureAggregates(
    propositionId: string,
    position: CommitteeMeasurePositionType,
  ): Promise<{ totalRaised: number; totalSpent: number }> {
    const codes =
      position === CommitteeMeasurePositionType.support
        ? ['support', 'S']
        : ['oppose', 'O'];

    const ieAgg = await this.db!.independentExpenditure.aggregate({
      where: {
        propositionId,
        supportOrOppose: { in: codes },
      },
      _sum: { amount: true },
    });
    const total = toNumber(ieAgg._sum.amount);
    return { totalRaised: total, totalSpent: total };
  }

  /**
   * Top N committees by total raised for a side. Useful UI signal: lets
   * the funding card show "Backed by: <Committee Name>" links.
   */
  private async computePrimaryCommittees(
    propositionId: string,
    position: CommitteeMeasurePositionType,
  ): Promise<{ id: string; name: string; totalRaised: number }[]> {
    const positions = await this.db!.committeeMeasurePosition.findMany({
      where: { propositionId, position },
      select: { committeeId: true },
    });
    if (positions.length === 0) return [];

    const committeeIds = positions.map((p) => p.committeeId);
    const committees = await this.db!.committee.findMany({
      where: { id: { in: committeeIds } },
      select: { id: true, name: true },
    });
    const totals = await this.db!.contribution.groupBy({
      by: ['committeeId'],
      where: { committeeId: { in: committeeIds } },
      _sum: { amount: true },
    });
    const totalsMap = new Map(
      totals.map((t) => [t.committeeId, toNumber(t._sum.amount)]),
    );

    return committees
      .map((c) => ({
        id: c.id,
        name: c.name,
        totalRaised: totalsMap.get(c.id) ?? 0,
      }))
      .sort((a, b) => b.totalRaised - a.totalRaised)
      .slice(0, PRIMARY_COMMITTEES_LIMIT);
  }

  /**
   * `FundingBasisService` is @Optional(). Unwired, the zeros carry
   * `measured: false` so the surface says "not computed" rather than
   * rendering them as an all-clear (#991).
   */
  private async resolveBasis(
    committeeIds: string[],
    asOfSource: Date | null,
  ): Promise<FundingBasis> {
    return this.basis
      ? this.basis.forCommittees(committeeIds, { asOfSource })
      : { ...EMPTY_FUNDING_BASIS };
  }

  private emptyFunding(propositionId: string): PropositionFunding {
    const empty: SidedFunding = {
      totalRaised: 0,
      totalSpent: 0,
      donorCount: 0,
      committeeCount: 0,
      topDonors: [],
      primaryCommittees: [],
      basis: { ...EMPTY_FUNDING_BASIS },
    };
    return {
      propositionId,
      asOf: new Date(),
      support: empty,
      oppose: { ...empty },
    };
  }

  /**
   * Invalidate the cached funding entry for one proposition. Called by the
   * linker after each sync so subsequent reads recompute from fresh data.
   */
  async invalidateCache(propositionId: string): Promise<void> {
    await this.cache?.delete(
      `propositionFunding:${CACHE_VERSION}:${propositionId}`,
    );
  }
}

/** Rehydrate a cached result, or null to force a recompute. See `reviveBasis`. */
function reviveCached(cached: string): PropositionFunding | null {
  const parsed = JSON.parse(cached) as PropositionFunding;
  // Both sides, and either one failing means the whole entry is stale.
  if (!reviveBasis(parsed.support?.basis)) return null;
  if (!reviveBasis(parsed.oppose?.basis)) return null;
  parsed.asOf = new Date(parsed.asOf);
  return parsed;
}
