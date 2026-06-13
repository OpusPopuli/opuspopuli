import { Injectable, Logger } from '@nestjs/common';
import { DbService, Prisma } from '@opuspopuli/relationaldb-provider';

import { ScoringService } from '../personalized-feed/scoring.service';
import { toRankableBill } from '../personalized-feed/to-rankable-bill';
import type { PersonalizationInputDto } from '../personalized-feed/dto/personalization-input.dto';

import type { RepPersonalizationInputDto } from './dto/rep-personalization-input.dto';
import type { PersonalizedRepActivityResultModel } from './models/personalized-rep-activity-result.model';
import {
  RepRelevanceService,
  type RankableRep,
  type RepActionOnBill,
  type RepActionRole,
  type RepRankingContext,
} from './rep-relevance.service';

/**
 * Default minimum bill relevance score for a bill to count as
 * "of interest" to the user when building the rep-ranking context.
 * Low bar by design: a bill that scored even a partial signal match
 * is still relevant enough to mean "if your rep touched this, that's
 * a signal worth surfacing". Bills with composite=0 are dropped from
 * both `userBillIdsOfInterest` and `userBillsByChamber`.
 */
const BILL_INTEREST_THRESHOLD = 0.1;

/**
 * How many days back the orchestrator considers when collecting a
 * rep's recent actions (authorship, co-authorship, votes). Matches the
 * bill ranker's freshness horizon — bills that haven't moved in 180
 * days are unlikely to be top-of-list for the user anyway, so a rep's
 * action on them carries little ranking signal.
 */
const RECENT_ACTION_WINDOW_DAYS = 180;

/**
 * Defensive cap on the cross-service bills read used to build the
 * user's bills-of-interest context. CA legislature has ~3000 active
 * bills per session — fetching all of them just to score and pick
 * the relevant subset is wasteful but tractable. The warn log fires
 * if a future region pushes past this.
 */
const RANKABLE_BILLS_FETCH_LIMIT = 5000;

/**
 * Subset of bill columns the orchestrator needs to (a) score each
 * candidate via `ScoringService`, (b) attribute the bill to a chamber
 * via its resolved author. Hoisted so the SQL `select` clause and the
 * row type stay in lockstep automatically (mirrors
 * PersonalizedPropositionsService's PROPOSITION_SELECT pattern).
 */
const BILL_CONTEXT_SELECT = {
  id: true,
  lastActionDate: true,
  aiSummary: true,
  author: { select: { chamber: true } },
} as const satisfies Prisma.BillSelect;

type BillContextRow = Prisma.BillGetPayload<{
  select: typeof BILL_CONTEXT_SELECT;
}>;

/**
 * Subset of rep columns the orchestrator needs to hydrate a
 * `RankableRep` — base fields + committee assignments + recent
 * authorships + co-authorships + votes. The recency-window filters
 * on the related tables run at the SQL layer so we don't pull a
 * rep's entire history into memory just to drop most of it.
 */
function buildRepInclude(windowStart: Date) {
  return {
    committeeAssignments: {
      include: { committee: { select: { name: true } } },
    },
    authoredBills: {
      where: { lastActionDate: { gte: windowStart } },
      select: { id: true },
    },
    billCoAuthorships: {
      where: { bill: { lastActionDate: { gte: windowStart } } },
      select: { billId: true },
    },
    billVotes: {
      where: {
        voteDate: { gte: windowStart },
        position: { in: ['yes', 'no'] },
      },
      select: { billId: true, position: true },
    },
  } as const satisfies Prisma.RepresentativeInclude;
}

type RepWithRelations = Prisma.RepresentativeGetPayload<{
  include: ReturnType<typeof buildRepInclude>;
}>;

/**
 * Map a raw vote `position` string to the typed RepActionRole used by
 * the ranker. Abstentions and non-yes/no positions fall through to
 * `null` and are dropped from the rep's recent-action list — they're
 * not signal for either Aligned-Action or Counter-Action axes.
 */
function voteRoleFromPosition(position: string): RepActionRole | null {
  if (position === 'yes') return 'voteYes';
  if (position === 'no') return 'voteNo';
  return null;
}

/**
 * Orchestrates the v1.0 personalized rep-activity briefing (#769):
 *
 *   1. Compute the user's bills-of-interest context: score every
 *      active+aiSummary-bearing bill via the bill ranker
 *      (ScoringService — reused from the bill feed) and partition the
 *      above-threshold subset by authoring chamber.
 *   2. Hydrate each input `representativeId` from the shared DB:
 *      base record + committee assignments + recent authorship,
 *      co-authorship, and vote actions within the 180-day window.
 *   3. Score each rep via RepRelevanceService, pick up to 3 recent
 *      activity bill IDs, drop zero-relevance reps, sort by composite.
 *
 * Cross-service DB read: knowledge directly reads region's `bills`,
 * `representatives`, and related tables via the shared
 * relationaldb-provider. Documented as a pragmatic shortcut under MVP
 * time pressure — v1.1 federation refactor at #761. Same pattern as
 * PersonalizedFeedService (bills, #743) and PersonalizedPropositionsService
 * (props, #771).
 *
 * No LLM rerank in Phase 1 — heuristic axis explanation only. Phase 2
 * candidate: reuse the llm-rerank-worker infra from #745 with a new
 * `rep-relevance-explanation` prompt-service template.
 */
@Injectable()
export class PersonalizedRepActivityService {
  private readonly logger = new Logger(PersonalizedRepActivityService.name);

  constructor(
    private readonly db: DbService,
    private readonly repScoring: RepRelevanceService,
    private readonly billScoring: ScoringService,
  ) {}

  async getRepActivityForUser(
    userId: string,
    input: RepPersonalizationInputDto,
  ): Promise<PersonalizedRepActivityResultModel[]> {
    if (input.representativeIds.length === 0) return [];

    const startMs = Date.now();
    const billContext = await this.buildBillContext(input);
    const billContextMs = Date.now() - startMs;

    const reps = await this.hydrateRankableReps(input.representativeIds);
    const repFetchMs = Date.now() - startMs - billContextMs;

    // Score every rep + sort by composite descending. opuspopuli#836
    // relaxed the prior `composite > 0` filter: the briefing's rep slate
    // is itself the personalization signal — these reps already match
    // the user's jurisdiction (district + county supervisors), so they
    // ARE relevant by construction. The LLM-written `relevanceExplanation`
    // (cached by the multi-entity rerank batch) now carries the per-rep
    // "why this matters to you" differentiation, with the composite
    // score driving ranking order rather than visibility.
    const scored = reps
      .map((rep) => {
        const { axisScores, composite } = this.repScoring.scoreRep(
          rep,
          input,
          billContext,
        );
        return {
          representativeId: rep.id,
          relevanceScore: composite,
          axisScores,
          recentActivityBillIds: this.repScoring.pickRecentActivityBillIds(
            rep,
            billContext,
          ),
        };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Populate relevanceExplanation from the representative relevance cache
    // (opuspopuli#836). Same pattern as PersonalizedPropositionsService:
    // one batch query covers all survivors; missing rows mean the nightly
    // batch hasn't seen this user yet OR the LLM declined / validator
    // rejected — frontend falls back to the heuristic axis explanation.
    const enriched = await this.attachRelevanceExplanations(userId, scored);

    const totalMs = Date.now() - startMs;
    this.logger.log(
      {
        event: 'personalized_rep_activity',
        userId,
        candidateReps: reps.length,
        returnedReps: enriched.length,
        explanationsPopulated: enriched.filter((r) => r.relevanceExplanation)
          .length,
        userBillsOfInterest: billContext.userBillIdsOfInterest.size,
        billContextMs,
        repFetchMs,
        totalMs,
      },
      `Personalized rep activity for ${userId}: ${enriched.length}/${reps.length} reps in ${totalMs}ms`,
    );

    return enriched;
  }

  /**
   * Batch-fetch the representative relevance cache for the survivors and
   * merge `relevanceExplanation` onto each result. Mirrors the proposition
   * service's `attachRelevanceExplanations`; one query, missing rows yield
   * undefined.
   */
  private async attachRelevanceExplanations(
    userId: string,
    scored: ReadonlyArray<PersonalizedRepActivityResultModel>,
  ): Promise<PersonalizedRepActivityResultModel[]> {
    if (scored.length === 0) return [];

    const cacheRows = await this.db.representativeRelevanceCache.findMany({
      where: {
        userId,
        representativeId: { in: scored.map((s) => s.representativeId) },
      },
      select: {
        representativeId: true,
        relevanceExplanation: true,
      },
    });
    const explanationByRepId = new Map(
      cacheRows.map((r) => [r.representativeId, r.relevanceExplanation]),
    );

    return scored.map((s) => ({
      ...s,
      relevanceExplanation:
        explanationByRepId.get(s.representativeId) ?? undefined,
    }));
  }

  /**
   * Build the user's bills-of-interest context: score every candidate
   * bill, keep the above-threshold ones, derive the chamber histogram.
   * Reuses ScoringService (the bill ranker's scoring function) so the
   * "which bills count as interesting" definition stays in lockstep
   * with the bill briefing card.
   */
  private async buildBillContext(
    input: RepPersonalizationInputDto,
  ): Promise<RepRankingContext> {
    const billInput: PersonalizationInputDto = {
      interestTags: input.interestTags,
      flags: input.flags,
    };
    const rows = await this.fetchBillCandidates();
    const now = new Date();

    const userBillIdsOfInterest = new Set<string>();
    const userBillsByChamber: Record<string, number> = {};

    for (const row of rows) {
      const rankable = toRankableBill(row);
      if (!rankable) continue;
      const { composite } = this.billScoring.scoreBill(
        rankable,
        billInput,
        now,
      );
      if (composite < BILL_INTEREST_THRESHOLD) continue;
      userBillIdsOfInterest.add(row.id);
      const chamber = row.author?.chamber;
      if (chamber) {
        userBillsByChamber[chamber] = (userBillsByChamber[chamber] ?? 0) + 1;
      }
    }

    return { userBillIdsOfInterest, userBillsByChamber };
  }

  /**
   * Cross-service read of bill candidates. Filters at the SQL level so
   * we don't pull soft-deleted, inactive, or aiSummary-less bills into
   * memory just to drop them in the scoring loop. Mirrors
   * PersonalizedFeedService.fetchRankableBills's filter for parity.
   *
   * Known duplication: this query is byte-identical to the bill
   * ranker's fetchRankableBills, and both run once per /me/briefing
   * render. Acceptable for MVP (indexed scan, sub-100ms in
   * integration tests) but flagged as a follow-up at
   * https://github.com/OpusPopuli/opuspopuli/issues/810.
   */
  private async fetchBillCandidates(): Promise<BillContextRow[]> {
    const rows = await this.db.bill.findMany({
      where: { aiSummary: { not: Prisma.DbNull }, isActive: true },
      select: BILL_CONTEXT_SELECT,
      take: RANKABLE_BILLS_FETCH_LIMIT,
    });
    if (rows.length === RANKABLE_BILLS_FETCH_LIMIT) {
      this.logger.warn(
        `Hit RANKABLE_BILLS_FETCH_LIMIT (${RANKABLE_BILLS_FETCH_LIMIT}) when building rep-ranker bill context — raise the cap or refine the filter.`,
      );
    }
    return rows;
  }

  /**
   * Hydrate the `RankableRep` shape for each input representativeId.
   * One DB round-trip via `findMany({ in: [...] })` with the
   * recency-window filters applied at the SQL layer through the
   * relation `where` clauses.
   */
  private async hydrateRankableReps(
    representativeIds: string[],
  ): Promise<RankableRep[]> {
    const windowStart = new Date(
      Date.now() - RECENT_ACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const include = buildRepInclude(windowStart);
    const rows = await this.db.representative.findMany({
      where: { id: { in: representativeIds }, deletedAt: null },
      include,
    });
    return rows.map((row) => this.toRankableRep(row));
  }

  /**
   * Map a hydrated rep row into the `RankableRep` shape the scorer
   * expects. Flattens committee assignments → committee names and
   * folds authorship + co-authorship + yes/no votes into one
   * `recentActions` list. Vote `position` is normalized to the scorer's
   * `RepActionRole` enum; positions outside {yes, no} are already
   * filtered at the SQL layer.
   */
  private toRankableRep(row: RepWithRelations): RankableRep {
    const recentActions: RepActionOnBill[] = [];
    for (const bill of row.authoredBills) {
      recentActions.push({ billId: bill.id, role: 'author' });
    }
    for (const coauth of row.billCoAuthorships) {
      recentActions.push({ billId: coauth.billId, role: 'coauthor' });
    }
    for (const vote of row.billVotes) {
      const role = voteRoleFromPosition(vote.position);
      if (role) recentActions.push({ billId: vote.billId, role });
    }
    const committeeNames = row.committeeAssignments.map(
      (assignment) => assignment.committee.name,
    );
    return {
      id: row.id,
      chamber: row.chamber,
      committeeNames,
      recentActions,
    };
  }
}
