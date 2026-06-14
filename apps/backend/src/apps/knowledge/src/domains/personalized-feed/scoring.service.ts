import { Injectable } from '@nestjs/common';
import type { PersonalizationInputDto } from './dto/personalization-input.dto';
import type { AxisScoresModel } from './models/personalized-bill-result.model';
import {
  AxisName,
  ContributingSignalModel,
  SignalType,
} from './models/contributing-signal.model';

/**
 * Subset of Bill fields the v1.0 ranker needs. Sourced from the
 * cross-service bills read (see PersonalizedFeedService) — DOES NOT
 * include the full Bill row. Keeping the shape narrow makes the
 * scoring function testable as a pure function with no DB.
 */
export interface RankableBill {
  id: string;
  lastActionDate: Date | null;
  /**
   * Canonical legislature URL for the bill (e.g. leginfo.legislature.ca.gov
   * detail page). Surfaces in the why-this panel as "Read the source"
   * (#750) so users can verify the recommendation against the original
   * document. Nullable because some early-ingest rows lack it; the
   * panel just hides the link in that case.
   */
  sourceUrl: string | null;
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
 * Per-axis ceiling on signals retained before the global cap (#750
 * review suggestion 5). Prevents a high-direct-match bill from
 * entirely starving out interest-tag and actionability evidence in
 * the panel — citizens see multi-axis reasoning when it exists rather
 * than 5 stakeholder bullets and nothing else. Within an axis the
 * scorer's insertion order wins (which respects the LLM's
 * whoItAffects / topics ordering).
 */
const MAX_PER_AXIS = {
  directMaterial: 3,
  valuesAlignment: 1,
  actionability: 1,
} as const;

/**
 * Maximum total ContributingSignal entries surfaced per bill (#750).
 * Sum-of-per-axis ceilings naturally equals 5; the global cap is the
 * belt-and-suspenders guard against a future axis being added without
 * updating the per-axis allocation.
 */
const MAX_SIGNALS_PER_BILL = 5;

/**
 * RankingFlags keys that are derived from T3 (sensitive) profile
 * fields (planning doc §4 sensitivity tiers). Source of truth:
 * RankingFlagsService — the `if (!sensitiveState.noFieldsMode)` block
 * is what populates these flags. Keep in lockstep with that service.
 *
 * Per issue #750 AC the panel must NOT name which specific T3 trait
 * surfaced a recommendation while "show me why" mode is still
 * pre-MVP — the frontend signal-label helper renders a single neutral
 * string for any signal where `isSensitive === true`.
 */
const T3_DERIVED_FLAGS: ReadonlySet<keyof FlagSet> = new Set([
  'hasImmigrationConcern',
  'hasHealthCondition',
  'hasPublicHealthInsurance',
  'isVeteran',
  'hasJusticeInvolvement',
  'isLowIncome',
  'receivesPublicBenefits',
]);

/**
 * Internal shape used by the per-axis scorers. The public `scoreBill`
 * promotes these into the `ContributingSignalModel` GraphQL shape and
 * applies the per-axis + global caps. Kept as a plain object so axis
 * scorers can still be tested as pure functions.
 */
export interface AxisSignal {
  type: SignalType;
  key: string;
  axis: AxisName;
  isSensitive: boolean;
}

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
   *
   * Emits one FLAG signal per matched flag for the why-this panel
   * (#750). Signal order matches the bill's `whoItAffects` order, so
   * if the LLM put "renters" first it surfaces first in the panel too.
   */
  scoreDirectMaterial(
    bill: RankableBill,
    flags: FlagSet,
  ): { score: number; signals: AxisSignal[] } {
    if (!bill.aiSummary) return { score: 0, signals: [] };
    const signals: AxisSignal[] = [];
    for (const audience of bill.aiSummary.whoItAffects) {
      const flagKey = WHO_TO_FLAG[audience];
      if (flagKey && flags[flagKey]) {
        signals.push({
          type: SignalType.FLAG,
          key: flagKey,
          axis: AxisName.DIRECT_MATERIAL,
          isSensitive: T3_DERIVED_FLAGS.has(flagKey),
        });
      }
    }
    // Cap at 5 matches → 1.0. Most bills hit 0-2 stakeholders; 5+
    // means the bill is broadly relevant.
    return { score: Math.min(signals.length * 0.2, 1.0), signals };
  }

  /**
   * Axis 2 — Values alignment. Overlap between bill's `aiSummary.topics`
   * and user's declared `interestTags`. Normalized by the user's number
   * of interests so a user who tracks many topics doesn't dominate
   * the composite.
   *
   * Emits one INTEREST_TAG signal per matched topic. The frontend
   * uses the tag slug verbatim as the visible label when no i18n key
   * matches — per-region interest taxonomies stay open-set.
   */
  scoreValuesAlignment(
    bill: RankableBill,
    interestTags: string[],
  ): { score: number; signals: AxisSignal[] } {
    if (!bill.aiSummary || interestTags.length === 0) {
      return { score: 0, signals: [] };
    }
    const userInterests = new Set(interestTags);
    const matched = bill.aiSummary.topics.filter((t) => userInterests.has(t));
    const signals: AxisSignal[] = matched.map((tag) => ({
      type: SignalType.INTEREST_TAG,
      key: tag,
      axis: AxisName.VALUES_ALIGNMENT,
      // Interest tags are user-declared topics — non-sensitive by
      // construction (controlled vocab from the public civics_blocks
      // taxonomy, not from the T3 SensitiveProfile).
      isSensitive: false,
    }));
    // Normalize by the user's declared interest count, not the bill's
    // topic count. A user with 3 interests + 1 match = 0.33; with 1
    // interest + 1 match = 1.0. Captures "this bill is dead-center for
    // me" vs "this bill is one of many things I care about."
    return {
      score: signals.length / interestTags.length,
      signals,
    };
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
   *
   * Emits a single ACTIONABILITY signal tagged with the bucket so the
   * frontend can pick between "vote scheduled this week" and "moved
   * within the last 30 days" copy.
   */
  scoreActionability(
    bill: RankableBill,
    now: Date = new Date(),
  ): { score: number; signals: AxisSignal[] } {
    if (!bill.lastActionDate) return { score: 0, signals: [] };
    const ageDays =
      (now.getTime() - bill.lastActionDate.getTime()) / (1000 * 60 * 60 * 24);
    // Rare: bills with scheduled future actions show up as ageDays < 0.
    // Treat as urgent rather than dropping them from the feed entirely.
    // Actionability tier signals are always non-sensitive — they
    // describe legislative-process state (vote/hearing recency), not
    // anything about the user.
    if (ageDays < 0) {
      return {
        score: 1.0,
        signals: [
          {
            type: SignalType.ACTIONABILITY,
            key: 'future_action_scheduled',
            axis: AxisName.ACTIONABILITY,
            isSensitive: false,
          },
        ],
      };
    }
    if (ageDays <= 30) {
      return {
        score: 1.0,
        signals: [
          {
            type: SignalType.ACTIONABILITY,
            key: 'within_30_days',
            axis: AxisName.ACTIONABILITY,
            isSensitive: false,
          },
        ],
      };
    }
    if (ageDays <= 60) {
      return {
        score: 0.5,
        signals: [
          {
            type: SignalType.ACTIONABILITY,
            key: 'within_60_days',
            axis: AxisName.ACTIONABILITY,
            isSensitive: false,
          },
        ],
      };
    }
    return { score: 0, signals: [] };
  }

  /**
   * Compute the full AxisScores object + composite + the top
   * contributing signals. Pure function — deterministic given input +
   * a clock. The clock is injectable for tests.
   *
   * Signals are collected from all three axes, then sorted by axis
   * weight so the most load-bearing reasons appear first when the
   * frontend truncates to display. Cap at MAX_SIGNALS_PER_BILL to keep
   * the bullet list panel-sized.
   */
  scoreBill(
    bill: RankableBill,
    input: PersonalizationInputDto,
    now: Date = new Date(),
  ): {
    axisScores: AxisScoresModel;
    composite: number;
    signals: ContributingSignalModel[];
  } {
    const direct = this.scoreDirectMaterial(bill, input.flags);
    const values = this.scoreValuesAlignment(bill, input.interestTags);
    const action = this.scoreActionability(bill, now);

    const axisScores: AxisScoresModel = {
      directMaterial: direct.score,
      valuesAlignment: values.score,
      actionability: action.score,
      indirectMaterial: 0,
      coalitionSignal: 0,
      counterfactual: 0,
      noveltyRepetition: 0,
    };

    const composite =
      direct.score * AXIS_WEIGHTS.directMaterial +
      values.score * AXIS_WEIGHTS.valuesAlignment +
      action.score * AXIS_WEIGHTS.actionability;

    // Per-axis ceiling first, then global truncate. The per-axis caps
    // keep multi-axis evidence visible (suggestion #5 from review of
    // #750): a bill matching 6 stakeholder flags + 2 interest tags
    // surfaces 3 stakeholders + 1 interest + 1 actionability rather
    // than 5 stakeholders and nothing else.
    const ordered: ContributingSignalModel[] = [
      ...direct.signals.slice(0, MAX_PER_AXIS.directMaterial),
      ...values.signals.slice(0, MAX_PER_AXIS.valuesAlignment),
      ...action.signals.slice(0, MAX_PER_AXIS.actionability),
    ];
    const signals = ordered.slice(0, MAX_SIGNALS_PER_BILL);

    return { axisScores, composite, signals };
  }
}
