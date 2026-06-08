import { Injectable } from '@nestjs/common';
import type { RepPersonalizationInputDto } from './dto/rep-personalization-input.dto';
import type { RepActivityAxisScoresModel } from './models/rep-activity-axis-scores.model';

/**
 * Role a rep played on a single bill action. Weighted highest → lowest:
 *   - author: 1.0 (they introduced it)
 *   - coauthor: 0.6 (signed on as co-author)
 *   - voteYes: 0.4 (took a position by voting yes on the floor or in committee)
 *   - voteNo: 0.2 (still a real position — surfaces "rep voted against your bill")
 *
 * voteAbsent and abstentions are not surfaced — they're noise for the
 * relevance signal. Multiple roles on the same bill collapse to the
 * best role's weight (a rep who authored AND voted yes doesn't get
 * 1.4 — the action-alignment axis is about distinct bills, not
 * cumulative engagement).
 */
export type RepActionRole = 'author' | 'coauthor' | 'voteYes' | 'voteNo';

const ROLE_WEIGHTS: Record<RepActionRole, number> = {
  author: 1.0,
  coauthor: 0.6,
  voteYes: 0.4,
  voteNo: 0.2,
};

/**
 * One recent action a rep took on a bill. The orchestrator hydrates
 * this list from `BillCoAuthor`, `Bill.authorId`, and `BillVote`
 * (filtered to a recency window — see PersonalizedRepActivityService).
 */
export interface RepActionOnBill {
  billId: string;
  role: RepActionRole;
}

/**
 * Subset of Representative fields the v1.0 ranker needs. Sourced from
 * the cross-service representatives read (see PersonalizedRepActivityService)
 * — DOES NOT include the full Representative row. Keeping the shape
 * narrow makes the scoring function testable as a pure function with
 * no DB.
 *
 * `committeeNames` is pre-flattened from `RepresentativeCommitteeAssignment
 * → LegislativeCommittee.name` so axis 2 can substring-match interestTags
 * against committee names without traversing the relation tree on every
 * tag check.
 *
 * `recentActions` is the list of (billId, role) tuples the rep took
 * within the orchestrator's recency window — typically the last 180
 * days, matching the bill ranker's freshness horizon. Pre-filtering
 * by date in the orchestrator keeps this scorer date-free.
 */
export interface RankableRep {
  id: string;
  chamber: string;
  committeeNames: string[];
  recentActions: RepActionOnBill[];
}

/**
 * Context the orchestrator passes alongside the user's input. Captures
 * the cross-rep state the scorer would otherwise have to re-derive.
 *
 *   - `userBillIdsOfInterest`: bill IDs the bill ranker (#743/#745)
 *     scored above the relevance threshold for this user. Used by axis
 *     3 (action alignment): a rep's action only counts if it landed on
 *     one of these bills.
 *   - `userBillsByChamber`: histogram of those same bill IDs grouped
 *     by the bill's authoring chamber. Used by axis 1 (chamber match):
 *     if 80% of the user's bills-of-interest live in Senate, Senate
 *     reps get a higher chamber-match score than Assembly reps.
 */
export interface RepRankingContext {
  userBillIdsOfInterest: ReadonlySet<string>;
  userBillsByChamber: Readonly<Record<string, number>>;
}

/**
 * v1.0 axis weights. Action alignment is the strongest signal (rep
 * actually moved on your bill) — committee match is the structural
 * proxy — chamber match is the weakest because most users have reps
 * in both chambers, so chamber alone doesn't differentiate much.
 * Sum to 1.0.
 */
const AXIS_WEIGHTS = {
  actionAlignment: 0.5,
  committeeMatch: 0.3,
  chamberMatch: 0.2,
} as const;

/**
 * How many top-quality matched bills surface in the briefing card per
 * rep. The orchestrator uses `pickRecentActivityBillIds` to get this
 * list; the cap matches the briefing card's 3-tag layout.
 */
const RECENT_ACTIVITY_CAP = 3;

/**
 * Saturation point for axis 3 (action alignment). 3 author-grade
 * matches (or equivalent weighted total) puts the rep at 1.0.
 */
const ACTION_ALIGNMENT_SATURATION = 3;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pure scoring functions for the v1.0 rep-activity ranker (#769).
 * Three axes parallel to bills (#743) and propositions (#771), adapted
 * to the rep data shape:
 *
 *   - Axis 1 (chamber match): does this rep sit in the chamber where
 *     the user's bills-of-interest live? Histogram-based, not binary.
 *   - Axis 2 (committee match): substring-match user `interestTags`
 *     against the rep's committee names.
 *   - Axis 3 (action alignment): weighted sum of role-on-bill matches,
 *     deduped to best-role-per-bill so a rep who both authored and
 *     voted yes counts once.
 *
 * Why heuristics and not embeddings? Same MVP scoping as bills/props:
 * cheap, debuggable, well-targeted. Phase 2 candidate: rerank with the
 * llm-rerank-worker pattern from #745 once the heuristic floor is
 * stable enough to use as a candidate-generator.
 */
@Injectable()
export class RepRelevanceService {
  /**
   * Axis 1 — Chamber match. Fraction of the user's bills-of-interest
   * that live in this rep's chamber. Zero when the user has no bills
   * scored above the relevance threshold (bill ranker returned empty).
   */
  scoreChamberMatch(rep: RankableRep, ctx: RepRankingContext): number {
    const total = Object.values(ctx.userBillsByChamber).reduce(
      (a, b) => a + b,
      0,
    );
    if (total === 0) return 0;
    const inChamber = ctx.userBillsByChamber[rep.chamber] ?? 0;
    return inChamber / total;
  }

  /**
   * Axis 2 — Committee match. Fraction of THIS rep's committees whose
   * name contains any of the user's `interestTags` (case-insensitive,
   * word-boundary). Normalising by the rep's own committee count (not
   * the user's tag count) means a rep with 5 committees and 1 match
   * scores 0.2; a rep with 1 committee and 1 match scores 1.0 — the
   * intuition being "this rep mostly works on stuff I care about".
   */
  scoreCommitteeMatch(rep: RankableRep, interestTags: string[]): number {
    if (interestTags.length === 0 || rep.committeeNames.length === 0) return 0;
    const tagRegexes = interestTags.map(
      (t) => new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i'),
    );
    let matched = 0;
    for (const name of rep.committeeNames) {
      if (tagRegexes.some((r) => r.test(name))) matched += 1;
    }
    return matched / rep.committeeNames.length;
  }

  /**
   * Axis 3 — Action alignment. Sum of best-role weights for each
   * distinct bill in the user's bills-of-interest that this rep
   * touched. Capped at 1.0 — 3 author-grade matches saturate.
   *
   * Best-role-per-bill dedup: a rep who both authored bill X and voted
   * yes on it gets `author`'s 1.0, not 1.4. Authorship dominates the
   * later vote.
   */
  scoreActionAlignment(rep: RankableRep, ctx: RepRankingContext): number {
    if (ctx.userBillIdsOfInterest.size === 0) return 0;
    const billBestWeight = new Map<string, number>();
    for (const action of rep.recentActions) {
      if (!ctx.userBillIdsOfInterest.has(action.billId)) continue;
      const w = ROLE_WEIGHTS[action.role];
      const prior = billBestWeight.get(action.billId) ?? 0;
      if (w > prior) billBestWeight.set(action.billId, w);
    }
    let total = 0;
    for (const w of billBestWeight.values()) total += w;
    return Math.min(total / ACTION_ALIGNMENT_SATURATION, 1.0);
  }

  /**
   * Pick up to `RECENT_ACTIVITY_CAP` bill IDs to surface as the
   * "what they've been working on" tags. Sorts by best-role weight
   * descending so author-grade matches show up before vote-only ones,
   * then by billId for deterministic ordering when weights tie.
   */
  pickRecentActivityBillIds(
    rep: RankableRep,
    ctx: RepRankingContext,
  ): string[] {
    const billBestWeight = new Map<string, number>();
    for (const action of rep.recentActions) {
      if (!ctx.userBillIdsOfInterest.has(action.billId)) continue;
      const w = ROLE_WEIGHTS[action.role];
      const prior = billBestWeight.get(action.billId) ?? 0;
      if (w > prior) billBestWeight.set(action.billId, w);
    }
    return Array.from(billBestWeight.entries())
      .sort(([aId, aW], [bId, bW]) => bW - aW || aId.localeCompare(bId))
      .slice(0, RECENT_ACTIVITY_CAP)
      .map(([id]) => id);
  }

  /**
   * Compute the full axis scores + composite. Pure function —
   * deterministic given input + context. Axes 4-7 stay 0.0 in v1.0
   * (parallel to bills/props), reserving the wire shape for v1.1.
   */
  scoreRep(
    rep: RankableRep,
    input: RepPersonalizationInputDto,
    ctx: RepRankingContext,
  ): { axisScores: RepActivityAxisScoresModel; composite: number } {
    const chamberMatch = this.scoreChamberMatch(rep, ctx);
    const committeeMatch = this.scoreCommitteeMatch(rep, input.interestTags);
    const actionAlignment = this.scoreActionAlignment(rep, ctx);

    const axisScores: RepActivityAxisScoresModel = {
      chamberMatch,
      committeeMatch,
      actionAlignment,
      constituencyOverlap: 0,
      coalitionSignal: 0,
      counterfactual: 0,
      noveltyRepetition: 0,
    };

    const composite =
      chamberMatch * AXIS_WEIGHTS.chamberMatch +
      committeeMatch * AXIS_WEIGHTS.committeeMatch +
      actionAlignment * AXIS_WEIGHTS.actionAlignment;

    return { axisScores, composite };
  }
}
