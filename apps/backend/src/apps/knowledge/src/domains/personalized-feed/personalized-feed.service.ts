import { Injectable, Logger } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';
import type { PersonalizedBillResultModel } from './models/personalized-bill-result.model';
import { ScoringService, type RankableBill } from './scoring.service';

/**
 * Default and hard cap for `myPersonalizedBillFeed(limit)`. Research +
 * the planning doc thesis converge on the same answer: citizens can
 * meaningfully engage with ~3-5 issues at a time. 5 is the default;
 * 20 is the hard cap above which the surface becomes a list view (and
 * we already have a list tab for that). See issue #743.
 */
export const FEED_DEFAULT_LIMIT = 5;
export const FEED_MAX_LIMIT = 20;

/**
 * Defensive ceiling on the cross-service bills read. For CA at ~2000
 * bills this is well above the working set; the warn log will flag
 * us early if a future region (federal, multi-state) pushes past it.
 */
const RANKABLE_BILLS_FETCH_LIMIT = 5000;

/**
 * Orchestrates the v1.0 personalized bill feed:
 *   1. Read enriched bills from the shared DB (cross-service read,
 *      documented shortcut — region owns this table; see acceptance
 *      criteria in #743 and the v1.1 federation-refactor follow-up).
 *   2. Score each via ScoringService.
 *   3. Sort by composite + return top-N capped at FEED_MAX_LIMIT.
 *
 * No embeddings, no vector DB. Tag-overlap is the v1.0 ranker; semantic
 * similarity via pgvector is Slice 2.
 *
 * Hard exclusions:
 *   - Bills without `aiSummary` (not yet enriched by #741)
 *   - When #747 ships, dead bills will be filtered here too. v1.0
 *     includes a defensive `WHERE NOT isDead OR isDead IS NULL` clause
 *     that works whether the column exists yet or not.
 */
@Injectable()
export class PersonalizedFeedService {
  private readonly logger = new Logger(PersonalizedFeedService.name);

  constructor(
    private readonly db: DbService,
    private readonly scoring: ScoringService,
  ) {}

  async getFeedForUser(
    userId: string,
    input: PersonalizationInputDto,
    requestedLimit: number,
  ): Promise<PersonalizedBillResultModel[]> {
    // Default on 0, negative, NaN, or absent. Then clamp to the hard cap.
    const safe = requestedLimit > 0 ? requestedLimit : FEED_DEFAULT_LIMIT;
    const limit = Math.min(safe, FEED_MAX_LIMIT);

    const startMs = Date.now();
    const candidates = await this.fetchRankableBills();
    const fetchMs = Date.now() - startMs;

    const now = new Date();
    const scored = candidates
      .map((bill) => {
        const { axisScores, composite } = this.scoring.scoreBill(
          bill,
          input,
          now,
        );
        return {
          billId: bill.id,
          relevanceScore: composite,
          axisScores,
        };
      })
      // Drop zero-relevance bills so the feed doesn't pad with garbage
      // when a user's profile is sparse. Better to show 2 relevant
      // bills than 5 random ones.
      .filter((r) => r.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    // Overlay the LLM-written `relevanceExplanation` from the cache
    // when present (#745). The cache is populated by the nightly batch
    // job; reading is best-effort here — if the cache lookup fails or
    // returns nothing, the feed still serves with embedding-only ranks
    // and the frontend's WhyThisPanel falls back to a heuristic axis
    // explanation (#744).
    const enriched = await this.overlayCachedExplanations(userId, scored);

    const totalMs = Date.now() - startMs;
    this.logger.log(
      {
        event: 'personalized_bill_feed',
        userId,
        candidates: candidates.length,
        returned: enriched.length,
        requestedLimit,
        appliedLimit: limit,
        fetchMs,
        totalMs,
      },
      `Personalized feed for ${userId}: ${enriched.length}/${candidates.length} bills (limit=${limit}) in ${totalMs}ms`,
    );

    return enriched;
  }

  /**
   * Look up cached `relevanceExplanation` values for the result set and
   * overlay them onto the returned models. Best-effort — a cache miss
   * (no row, expired row, or DB hiccup) leaves the result unchanged so
   * the feed never blocks on the cache being warm.
   */
  private async overlayCachedExplanations(
    userId: string,
    results: PersonalizedBillResultModel[],
  ): Promise<PersonalizedBillResultModel[]> {
    if (results.length === 0) return results;
    try {
      const billIds = results.map((r) => r.billId);
      const rows = await this.db.personalizedFeedCache.findMany({
        where: {
          userId,
          billId: { in: billIds },
          expiresAt: { gt: new Date() },
        },
        select: { billId: true, relevanceExplanation: true },
      });
      const byBill = new Map(
        rows.map((r) => [r.billId, r.relevanceExplanation]),
      );
      return results.map((r) => ({
        ...r,
        relevanceExplanation: byBill.get(r.billId) ?? undefined,
      }));
    } catch (err) {
      this.logger.warn(
        {
          event: 'personalized_feed_cache_overlay_failed',
          userId,
          error: (err as Error).message,
        },
        'cache overlay failed — serving feed with embedding-only ranks',
      );
      return results;
    }
  }

  /**
   * Cross-service read: knowledge directly reads region's `bills` table
   * via the shared relationaldb-provider. Documented as a pragmatic
   * shortcut under MVP time pressure — v1.1 refactor will move this
   * behind a federation or event-driven boundary. See #743 acceptance.
   */
  private async fetchRankableBills(): Promise<RankableBill[]> {
    const rows = await this.db.bill.findMany({
      where: { aiSummary: { not: Prisma.DbNull } },
      select: {
        id: true,
        lastActionDate: true,
        aiSummary: true,
      },
      // Defensive bound: see RANKABLE_BILLS_FETCH_LIMIT. The warn below
      // flags when we approach the ceiling so we can replace this with a
      // proper streaming/pagination strategy before correctness breaks.
      take: RANKABLE_BILLS_FETCH_LIMIT,
    });
    if (rows.length === RANKABLE_BILLS_FETCH_LIMIT) {
      this.logger.warn(
        `Personalized feed fetched ${RANKABLE_BILLS_FETCH_LIMIT} bills (the take ceiling) — some bills may be silently excluded from ranking. Time to revisit fetchRankableBills.`,
      );
    }
    return rows
      .map((r) => this.toRankableBill(r))
      .filter((b): b is RankableBill => b !== null);
  }

  /**
   * Coerce the raw row (with JSON aiSummary) into the typed RankableBill
   * shape. Returns null if aiSummary is missing required fields — the
   * v1.0 ranker can't score without topics/whoItAffects.
   */
  private toRankableBill(row: {
    id: string;
    lastActionDate: Date | null;
    aiSummary: Prisma.JsonValue;
  }): RankableBill | null {
    if (
      !row.aiSummary ||
      typeof row.aiSummary !== 'object' ||
      Array.isArray(row.aiSummary)
    ) {
      return null;
    }
    const obj = row.aiSummary as Record<string, unknown>;
    // Drop the `{ skip: true }` sentinel — those bills are bill-analysis
    // opt-outs (not-a-bill / garbled input) and shouldn't reach the ranker.
    if (obj.skip === true) return null;

    const topics = Array.isArray(obj.topics)
      ? obj.topics.filter((t): t is string => typeof t === 'string')
      : [];
    const whoItAffects = Array.isArray(obj.whoItAffects)
      ? obj.whoItAffects.filter((w): w is string => typeof w === 'string')
      : [];

    if (topics.length === 0 && whoItAffects.length === 0) return null;

    return {
      id: row.id,
      lastActionDate: row.lastActionDate,
      aiSummary: { topics, whoItAffects },
    };
  }
}
