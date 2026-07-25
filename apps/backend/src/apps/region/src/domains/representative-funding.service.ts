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

// Canonicalization merges donor-name variants AFTER the DB returns rows, so we
// must scan more than the final 8: a donor fragmented across many spellings can
// have each fragment ranked well below the top 8 yet dominate once merged (in
// prod one labor federation was split 8 ways across a rep's contributions).
// Bounded so the @Public endpoint never does a fully unbounded scan; a rep with
// >1000 distinct raw donor strings would under-report the long tail only.
const DONOR_SCAN_LIMIT = 1000;

// Boilerplate tokens dropped before building a donor's canonical key. Kept
// deliberately conservative — only legal-form / committee-type noise, never
// substantive words — so distinct donors are not merged. Semantic variants
// (e.g. "LA" vs "Los Angeles", added/dropped significant words) still fragment;
// abbreviation and fuzzy/alias resolution are the follow-up (#954).
const DONOR_NOISE_TOKENS = new Set([
  'pac',
  'inc',
  'llc',
  'corp',
  'co',
  'ltd',
  'committee',
  'the',
  'a',
  'of',
  'on',
  'and',
  'for',
]);

interface RawDonorGroup {
  name: string;
  amount: number;
  count: number;
}

interface DonorBucket {
  name: string;
  totalAmount: number;
  contributionCount: number;
}

/**
 * Reduce a donor/employer name to a canonical key so spelling variants of the
 * same contributor aggregate together. Lowercases, expands `&`, strips
 * punctuation, drops boilerplate tokens (see DONOR_NOISE_TOKENS), and sorts the
 * remaining tokens so word-order variants collapse. Returns '' when a name is
 * only boilerplate — callers fall back to the raw name so those never merge.
 */
export function canonicalizeDonorName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !DONOR_NOISE_TOKENS.has(t))
    .sort((a, b) => a.localeCompare(b))
    .join(' ');
}

/**
 * Merge DB-grouped donor/employer rows by their canonical key, summing amounts
 * and counts, and return buckets sorted by total desc. The displayed `name` is
 * the highest-dollar raw variant in each bucket (the most representative
 * spelling). A name that canonicalizes to '' keeps its raw form as its key so
 * boilerplate-only names are never collapsed together.
 */
function bucketByCanonicalName(groups: RawDonorGroup[]): DonorBucket[] {
  const buckets = new Map<string, DonorBucket & { nameAmount: number }>();
  for (const g of groups) {
    const key = canonicalizeDonorName(g.name) || g.name.toLowerCase().trim();
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        name: g.name,
        nameAmount: g.amount,
        totalAmount: g.amount,
        contributionCount: g.count,
      });
    } else {
      existing.totalAmount += g.amount;
      existing.contributionCount += g.count;
      if (g.amount > existing.nameAmount) {
        existing.name = g.name;
        existing.nameAmount = g.amount;
      }
    }
  }
  return [...buckets.values()]
    .map(({ name, totalAmount, contributionCount }) => ({
      name,
      totalAmount,
      contributionCount,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

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
      perCommittee,
    ] = await Promise.all([
      this.db.contribution.aggregate({ where, _sum: { amount: true } }),
      this.db.expenditure.aggregate({ where, _sum: { amount: true } }),
      // Scan the top DONOR_SCAN_LIMIT raw names by amount, then canonicalize +
      // merge in-memory (a fragmented donor's pieces can each rank low yet
      // dominate once summed). donorCount comes from the merged buckets, so a
      // separate COUNT(DISTINCT donor_name) would overcount the fragments.
      this.db.contribution.groupBy({
        by: ['donorName'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: DONOR_SCAN_LIMIT,
      }),
      this.db.contribution.groupBy({
        by: ['donorEmployer'],
        where: { ...where, donorEmployer: { not: null } },
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: DONOR_SCAN_LIMIT,
      }),
      this.db.contribution.groupBy({
        by: ['committeeId'],
        where,
        _sum: { amount: true },
      }),
    ]);

    const raisedByCommittee = new Map(
      perCommittee.map((p) => [p.committeeId, toNumber(p._sum.amount)]),
    );

    const donorBuckets = bucketByCanonicalName(
      donorAgg.map((d) => ({
        name: d.donorName,
        amount: toNumber(d._sum.amount),
        count: d._count._all,
      })),
    );
    const employerBuckets = bucketByCanonicalName(
      employerAgg
        .filter((e) => e.donorEmployer)
        .map((e) => ({
          name: e.donorEmployer as string,
          amount: toNumber(e._sum.amount),
          count: e._count._all,
        })),
    );

    return {
      representativeId,
      asOf: new Date(),
      totalRaised: toNumber(contributionAgg._sum.amount),
      totalSpent: toNumber(expenditureAgg._sum.amount),
      donorCount: donorBuckets.length,
      committeeCount: committees.length,
      topDonors: donorBuckets.slice(0, TOP_DONORS_LIMIT).map((b) => ({
        donorName: b.name,
        totalAmount: b.totalAmount,
        contributionCount: b.contributionCount,
      })),
      topEmployers: employerBuckets.slice(0, TOP_EMPLOYERS_LIMIT).map((b) => ({
        employer: b.name,
        totalAmount: b.totalAmount,
        contributionCount: b.contributionCount,
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
