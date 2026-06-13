import { Injectable, Logger } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';
import type { PropositionPersonalizationInputDto } from './dto/proposition-personalization-input.dto';
import type { PersonalizedPropositionResultModel } from './models/personalized-proposition-result.model';
import {
  PropositionScoringService,
  type RankableProposition,
} from './proposition-scoring.service';

/**
 * Column projection for the propositions ranker. Hoisted so the SQL
 * `select` clause and the row type stay in lockstep automatically —
 * a column drift in the schema or this constant is caught by Prisma's
 * generated `GetPayload` type, not silently swallowed by a hand-rolled
 * row interface.
 */
const PROPOSITION_SELECT = {
  id: true,
  summary: true,
  electionDate: true,
  analysisSummary: true,
  keyProvisions: true,
  fiscalImpact: true,
  yesOutcome: true,
  noOutcome: true,
  existingVsProposed: true,
  analysisSections: true,
} as const satisfies Prisma.PropositionSelect;

type PropositionRow = Prisma.PropositionGetPayload<{
  select: typeof PROPOSITION_SELECT;
}>;

/**
 * Default and hard cap for `myPersonalizedPropositionFeed(limit)`.
 * Ballots typically carry ~5-15 propositions; the briefing card
 * surfaces a much shorter ranked list. Default 5 mirrors the bill
 * feed's research-backed sweet spot; max 10 caps it at "full ballot
 * sized" before becoming a list view that the `/region/propositions`
 * page already covers.
 */
export const PROPOSITION_FEED_DEFAULT_LIMIT = 5;
export const PROPOSITION_FEED_MAX_LIMIT = 10;

/**
 * Defensive ceiling on the cross-service propositions read. CA carries
 * O(10) statewide props per cycle; even with local measures included
 * this cap leaves headroom. The warn log will flag if a future region
 * pushes past it.
 */
const RANKABLE_PROPS_FETCH_LIMIT = 500;

/**
 * Maximum recursion depth when walking JSONB columns into string
 * leaves. Real propositions land at depth 1-2 (arrays of strings,
 * `{current, proposed}` pairs); 5 is comfortable headroom against
 * a malformed payload while still bounding worst-case stack use.
 */
const MAX_JSON_DEPTH = 5;

/**
 * Flatten the proposition's text columns into a single lowercased
 * corpus for keyword matching. Some columns are plain strings (e.g.
 * `summary`, `analysisSummary`); others are JSONB (`keyProvisions`,
 * `existingVsProposed`, `analysisSections`) carrying arrays or nested
 * objects. Defensively walk each JSON shape and pull only string
 * leaves so axis 1 + 2 see the prose without false-firing on field
 * names or numeric values. Mirrors the `coerceAiSummary` runtime
 * validation pattern from #745's review (S14).
 */
function extractSearchableText(row: PropositionRow): string {
  const parts: string[] = [row.summary];
  for (const v of [
    row.analysisSummary,
    row.fiscalImpact,
    row.yesOutcome,
    row.noOutcome,
  ]) {
    if (typeof v === 'string' && v.length > 0) parts.push(v);
  }
  parts.push(...stringLeaves(row.keyProvisions));
  parts.push(...stringLeaves(row.existingVsProposed));
  parts.push(...stringLeaves(row.analysisSections));
  return parts.join(' ').toLowerCase();
}

/**
 * Recursively collect every string leaf from an arbitrary JSON value.
 * Tolerant of null / scalar / array / nested-object shapes; non-string
 * leaves (numbers, booleans, dates) are ignored. Bounded by
 * `MAX_JSON_DEPTH` so a pathologically nested payload can't blow the
 * stack — practically a no-op for real proposition data.
 */
function stringLeaves(value: unknown, depth = 0): string[] {
  if (depth >= MAX_JSON_DEPTH) return [];
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringLeaves(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((v) =>
      stringLeaves(v, depth + 1),
    );
  }
  return [];
}

/**
 * Orchestrates the v1.0 personalized propositions feed (#771):
 *   1. Read active propositions with future `electionDate` from the
 *      shared DB (cross-service read, documented shortcut — region
 *      owns the table; v1.1 federation refactor tracked at #761).
 *   2. Score each via PropositionScoringService.
 *   3. Sort by composite + return top-N capped at PROPOSITION_FEED_MAX_LIMIT.
 *
 * No LLM rerank in Phase 1 — heuristic axis explanation in the
 * frontend WhyThisPanel only. Phase 2 candidate: reuse the
 * llm-rerank-worker infra from #745 with a new prompt-service template.
 *
 * Hard exclusions:
 *   - Past-election props (`electionDate < now`)
 *   - Soft-deleted props (`deletedAt IS NOT NULL`)
 *   - Inactive lifecycle stages (Phase 1: keep status='active'/'pending';
 *     when richer lifecycle data lands the filter sharpens)
 *
 * **Known limitation — jurisdiction filter.** The issue AC asks for
 * "propositions in the user's jurisdictions". Today the `Proposition`
 * model has no `regionId` / `jurisdictionId` column and the scraper
 * ingests California statewide measures only, so the implicit
 * scope (every user sees every CA prop) matches the AC for the
 * data we have. Once local / county / city ballot measures get
 * ingested, this service must filter by the user's resolved
 * jurisdictions — tracked as a Phase 2 follow-up.
 */
@Injectable()
export class PersonalizedPropositionsService {
  private readonly logger = new Logger(PersonalizedPropositionsService.name);

  constructor(
    private readonly db: DbService,
    private readonly scoring: PropositionScoringService,
  ) {}

  async getFeedForUser(
    userId: string,
    input: PropositionPersonalizationInputDto,
    requestedLimit: number,
  ): Promise<PersonalizedPropositionResultModel[]> {
    const safe =
      requestedLimit > 0 ? requestedLimit : PROPOSITION_FEED_DEFAULT_LIMIT;
    const limit = Math.min(safe, PROPOSITION_FEED_MAX_LIMIT);

    const startMs = Date.now();
    const candidates = await this.fetchRankableProps();
    const fetchMs = Date.now() - startMs;

    const now = new Date();
    const scored = candidates
      .map((prop) => {
        const { axisScores, composite } = this.scoring.scoreProposition(
          prop,
          input,
          now,
        );
        return {
          propositionId: prop.id,
          relevanceScore: composite,
          axisScores,
        };
      })
      // Require at least one PERSONAL signal match (axis 1 or 2). The
      // briefing surface is about personalization — props with only
      // election-proximity scores but no signal match aren't
      // "personally relevant", they're "imminent", and the unfiltered
      // /region/propositions list page already serves that need.
      .filter(
        (r) =>
          r.axisScores.directMaterial > 0 || r.axisScores.valuesAlignment > 0,
      )
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);

    // Populate relevanceExplanation from the proposition relevance cache
    // (opuspopuli#836). One batch query covers all top-N candidates;
    // missing rows mean either the nightly batch hasn't run yet for this
    // user OR the LLM declined / validator rejected — in both cases the
    // explanation stays null and the frontend falls back to the
    // heuristic axis explanation in WhyThisPanel.
    const enriched = await this.attachRelevanceExplanations(userId, scored);

    const totalMs = Date.now() - startMs;
    this.logger.log(
      {
        event: 'personalized_proposition_feed',
        userId,
        candidates: candidates.length,
        returned: enriched.length,
        explanationsPopulated: enriched.filter((r) => r.relevanceExplanation)
          .length,
        requestedLimit,
        appliedLimit: limit,
        fetchMs,
        totalMs,
      },
      `Personalized propositions for ${userId}: ${enriched.length}/${candidates.length} props (limit=${limit}) in ${totalMs}ms`,
    );

    return enriched;
  }

  /**
   * Batch-fetch the proposition relevance cache for the top-N scored
   * candidates and merge `relevanceExplanation` onto each result. One
   * query (not N+1). Missing rows yield `undefined` — the model field is
   * nullable and the frontend falls back to the heuristic explanation.
   *
   * Cache freshness is the writer's concern (LlmRerankService + nightly
   * cron in opuspopuli#836). This read trusts whatever is in the cache;
   * the writer respects TTL and the resolver doesn't need to.
   */
  private async attachRelevanceExplanations(
    userId: string,
    scored: ReadonlyArray<PersonalizedPropositionResultModel>,
  ): Promise<PersonalizedPropositionResultModel[]> {
    if (scored.length === 0) return [];

    const cacheRows = await this.db.propositionRelevanceCache.findMany({
      where: {
        userId,
        propositionId: { in: scored.map((s) => s.propositionId) },
      },
      select: {
        propositionId: true,
        relevanceExplanation: true,
      },
    });
    const explanationByPropId = new Map(
      cacheRows.map((r) => [r.propositionId, r.relevanceExplanation]),
    );

    return scored.map((s) => ({
      ...s,
      relevanceExplanation:
        explanationByPropId.get(s.propositionId) ?? undefined,
    }));
  }

  /**
   * Cross-service read of active propositions. Filters at the SQL
   * level so we don't pull soft-deleted or past-election rows into
   * memory just to drop them in the scoring loop.
   */
  private async fetchRankableProps(): Promise<RankableProposition[]> {
    const now = new Date();
    const rows = await this.db.proposition.findMany({
      where: {
        deletedAt: null,
        electionDate: { gte: now },
        status: { in: ['active', 'pending'] },
      },
      select: PROPOSITION_SELECT,
      take: RANKABLE_PROPS_FETCH_LIMIT,
    });

    if (rows.length === RANKABLE_PROPS_FETCH_LIMIT) {
      this.logger.warn(
        `Hit RANKABLE_PROPS_FETCH_LIMIT (${RANKABLE_PROPS_FETCH_LIMIT}) — raise the cap or refine the filter.`,
      );
    }

    return rows.map((row) => ({
      id: row.id,
      electionDate: row.electionDate,
      searchableText: extractSearchableText(row),
    }));
  }
}
