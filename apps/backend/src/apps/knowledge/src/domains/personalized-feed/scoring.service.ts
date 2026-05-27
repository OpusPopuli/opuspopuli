import { Injectable } from '@nestjs/common';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';
import type { AxisScoresModel } from './models/personalized-bill-result.model';

/**
 * Subset of Bill fields the v1.0 ranker needs. Sourced from the
 * cross-service bills read (see PersonalizedFeedService) — DOES NOT
 * include the full Bill row. Keeping the shape narrow makes the
 * scoring function testable as a pure function with no DB.
 */
export interface RankableBill {
  id: string;
  lastActionDate: Date | null;
  aiSummary: {
    topics: string[];
    whoItAffects: string[];
    fiscalImpact?: { level: string; summary: string };
  } | null;
}

/**
 * Maps the controlled `whoItAffects` vocab values from bill-analysis
 * onto the boolean flag set the users service exposes. The keys MUST
 * match the bill-analysis prompt's vocabulary (prompt-service#71); the
 * values MUST match flags from RankingFlagsService.
 *
 * "seniors" intentionally has no flag mapping — no `isSenior` derivation
 * exists yet (no T1/T2 birth-date field). Bills tagged "seniors" don't
 * contribute to axis 1 in v1.0. Tracked for v1.1.
 */
const WHO_TO_FLAG: Record<string, keyof FlagSet | undefined> = {
  renters: 'isRenter',
  homeowners: 'isHomeowner',
  'small-business-owners': 'isBusinessOwner',
  workers: 'isWorker',
  parents: 'isParent',
  students: 'isStudent',
  seniors: undefined,
  veterans: 'isVeteran',
  immigrants: 'hasImmigrationConcern',
  'low-income-residents': 'isLowIncome',
  drivers: 'isDriver',
  patients: 'hasHealthCondition',
};

type FlagSet = PersonalizationInputDto['flags'];

/**
 * v1.0 axis weights. Sum to 1.0 so the composite score stays normalized
 * regardless of how many axes contribute. Axes 4-7 placeholder at 0 and
 * carry weight 0 in v1.0 — when they ship the weights will rebalance.
 */
const AXIS_WEIGHTS = {
  directMaterial: 0.5,
  valuesAlignment: 0.3,
  actionability: 0.2,
} as const;

/**
 * Pure scoring functions for the v1.0 ranker. Axes 1-3 score on the
 * data we actually have (tag overlap + recency); axes 4-7 return 0.0
 * placeholders. Composite = weighted sum. See planning doc §5.1.
 *
 * Why tag-overlap not embeddings? Embeddings deferred to Slice 2 — for
 * MVP scope, tag-overlap against the controlled vocabularies from the
 * bill-analysis prompt is well-targeted enough. Embeddings unlock
 * SEMANTIC matches that vocab can't capture, but pure tag match is
 * cheap, debuggable, and unblocks the killer-feature demo.
 */
@Injectable()
export class ScoringService {
  /**
   * Axis 1 — Direct material. Counts stakeholder overlap between the
   * bill's `aiSummary.whoItAffects` and the user's derived flags.
   * Normalized to 0.0-1.0; each matched stakeholder contributes +0.2.
   */
  scoreDirectMaterial(bill: RankableBill, flags: FlagSet): number {
    if (!bill.aiSummary) return 0;
    let matches = 0;
    for (const audience of bill.aiSummary.whoItAffects) {
      const flagKey = WHO_TO_FLAG[audience];
      if (flagKey && flags[flagKey]) matches += 1;
    }
    // Cap at 5 matches → 1.0. Most bills hit 0-2 stakeholders; 5+
    // means the bill is broadly relevant.
    return Math.min(matches * 0.2, 1.0);
  }

  /**
   * Axis 2 — Values alignment. Overlap between bill's `aiSummary.topics`
   * and user's declared `interestTags`. Normalized by the user's number
   * of interests so a user who tracks many topics doesn't dominate
   * the composite.
   */
  scoreValuesAlignment(bill: RankableBill, interestTags: string[]): number {
    if (!bill.aiSummary || interestTags.length === 0) return 0;
    const userInterests = new Set(interestTags);
    const matches = bill.aiSummary.topics.filter((t) =>
      userInterests.has(t),
    ).length;
    // Normalize by the user's declared interest count, not the bill's
    // topic count. A user with 3 interests + 1 match = 0.33; with 1
    // interest + 1 match = 1.0. Captures "this bill is dead-center for
    // me" vs "this bill is one of many things I care about."
    return matches / interestTags.length;
  }

  /**
   * Axis 3 — Actionability. Proxy: recency of `lastActionDate` as a
   * stand-in for "vote / hearing window open." Real action-window data
   * lands in #753; this gets replaced when that ships.
   *
   * Tiers:
   *   - within 30 days → 1.0
   *   - 30-60 days → 0.5
   *   - 60+ days → 0.0
   *   - no lastActionDate → 0.0
   */
  scoreActionability(bill: RankableBill, now: Date = new Date()): number {
    if (!bill.lastActionDate) return 0;
    const ageDays =
      (now.getTime() - bill.lastActionDate.getTime()) / (1000 * 60 * 60 * 24);
    // Rare: bills with scheduled future actions show up as ageDays < 0.
    // Treat as urgent rather than dropping them from the feed entirely.
    if (ageDays < 0) return 1.0;
    if (ageDays <= 30) return 1.0;
    if (ageDays <= 60) return 0.5;
    return 0;
  }

  /**
   * Compute the full AxisScores object + composite. Pure function —
   * deterministic given input + a clock. The clock is injectable for
   * tests.
   */
  scoreBill(
    bill: RankableBill,
    input: PersonalizationInputDto,
    now: Date = new Date(),
  ): { axisScores: AxisScoresModel; composite: number } {
    const directMaterial = this.scoreDirectMaterial(bill, input.flags);
    const valuesAlignment = this.scoreValuesAlignment(bill, input.interestTags);
    const actionability = this.scoreActionability(bill, now);

    const axisScores: AxisScoresModel = {
      directMaterial,
      valuesAlignment,
      actionability,
      indirectMaterial: 0,
      coalitionSignal: 0,
      counterfactual: 0,
      noveltyRepetition: 0,
    };

    const composite =
      directMaterial * AXIS_WEIGHTS.directMaterial +
      valuesAlignment * AXIS_WEIGHTS.valuesAlignment +
      actionability * AXIS_WEIGHTS.actionability;

    return { axisScores, composite };
  }
}
