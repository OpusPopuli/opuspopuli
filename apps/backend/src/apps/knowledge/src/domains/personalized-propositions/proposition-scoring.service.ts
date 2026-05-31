import { Injectable } from '@nestjs/common';
import type { PropositionPersonalizationInputDto } from './dto/proposition-personalization-input.dto';
import type { PropositionAxisScoresModel } from './models/proposition-axis-scores.model';

type FlagSet = PropositionPersonalizationInputDto['flags'];

/**
 * Subset of Proposition fields the v1.0 ranker needs. Sourced from
 * the cross-service propositions read (see PersonalizedPropositionsService)
 * — DOES NOT include the full Proposition row. Keeping the shape narrow
 * makes the scoring function testable as a pure function with no DB.
 *
 * `searchableText` is a pre-flattened, lowercased corpus assembled
 * from `summary`, `aiSummary.analysisSummary`, `aiSummary.keyProvisions`,
 * `aiSummary.yesOutcome`, and `aiSummary.noOutcome`. The orchestrator
 * service builds it once per proposition so axis 1 and 2 don't need
 * to traverse the JSON tree on every flag/tag check.
 */
export interface RankableProposition {
  id: string;
  electionDate: Date | null;
  /** Lowercased plain-text corpus for keyword matching. */
  searchableText: string;
}

/**
 * Flag → keyword dictionary for axis 1 (proposition material relevance).
 *
 * Propositions don't have a structured `whoItAffects` array like bills'
 * `aiSummary.whoItAffects`. Phase 1 of #771 substring-matches a small
 * keyword vocabulary per flag against the proposition's plain text
 * (analysisSummary + keyProvisions + summary + yesOutcome + noOutcome).
 * Phase 2 candidate: extend proposition ingest to populate a structured
 * `whoItAffects` field parallel to bills, then collapse this dictionary
 * into the same `WHO_TO_FLAG` shape the bill ranker uses.
 *
 * Keywords are lowercased and matched with `\b` boundaries so "renter"
 * doesn't match "rentier" or "rental" (rentals get an explicit entry
 * where they're meaningful).
 */
const FLAG_KEYWORDS: Record<keyof FlagSet, readonly string[]> = {
  isRenter: ['renter', 'renters', 'tenant', 'tenants', 'rental housing'],
  isHomeowner: ['homeowner', 'homeowners', 'property tax'],
  isParent: ['parent', 'parents', 'child', 'children', 'k-12', 'public school'],
  isCaregiver: ['caregiver', 'caregivers', 'elderly', 'eldercare'],
  isStudent: [
    'student',
    'students',
    'college',
    'university',
    'higher education',
  ],
  isEducator: ['teacher', 'teachers', 'educator', 'educators', 'k-12'],
  isWorker: ['worker', 'workers', 'employee', 'employees', 'wage', 'wages'],
  isBusinessOwner: ['small business', 'business owner', 'small businesses'],
  isUnionMember: ['union', 'unions', 'collective bargaining'],
  isGigWorker: ['gig worker', 'gig workers', 'independent contractor'],
  isTransitRider: ['transit', 'public transportation', 'bus', 'rail'],
  isDriver: ['driver', 'drivers', 'motorist', 'motorists', 'vehicle'],
  hasSpecialLicense: ['commercial driver', 'cdl'],
  hasImmigrationConcern: [
    'immigrant',
    'immigrants',
    'undocumented',
    'immigration',
  ],
  hasHealthCondition: [
    'patient',
    'patients',
    'disabled',
    'disability',
    'chronic',
  ],
  hasPublicHealthInsurance: ['medicaid', 'medi-cal', 'medicare'],
  isVeteran: ['veteran', 'veterans'],
  hasJusticeInvolvement: [
    'formerly incarcerated',
    'criminal record',
    'expungement',
  ],
  isLowIncome: ['low-income', 'low income', 'poverty', 'safety net'],
  receivesPublicBenefits: [
    'snap',
    'food stamps',
    'public benefits',
    'calworks',
    'tanf',
  ],
};

/**
 * Escape regex metacharacters in a keyword so the `\b` anchors are
 * the only special tokens in the compiled pattern. The hyphen in
 * "medi-cal" doesn't need escaping (literal in this position) but
 * the function handles all `RegExp` metacharacters uniformly.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pre-compile a `\b`-anchored case-insensitive regex per keyword once
 * at module load so per-prop scoring stays O(flags × keywords) without
 * any regex compilation hot path. Keyed-reducer pattern (not
 * `Object.fromEntries`) so TypeScript can infer the result type
 * directly without an `unknown`-cast escape hatch.
 */
const FLAG_REGEXES = (Object.keys(FLAG_KEYWORDS) as (keyof FlagSet)[]).reduce(
  (acc, flag) => {
    acc[flag] = FLAG_KEYWORDS[flag].map(
      (kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i'),
    );
    return acc;
  },
  {} as Record<keyof FlagSet, readonly RegExp[]>,
);

/**
 * v1.0 axis weights — same shape as the bill ranker so a future shared
 * abstraction can collapse the two. Sum to 1.0.
 */
const AXIS_WEIGHTS = {
  directMaterial: 0.5,
  valuesAlignment: 0.3,
  actionability: 0.2,
} as const;

/**
 * Pure scoring functions for the v1.0 propositions ranker (#771).
 * Three axes parallel to the bill ranker (#743), adapted to the
 * different data shape propositions carry:
 *
 *   - Axis 1: substring keyword matching (no structured `whoItAffects`)
 *   - Axis 2: substring keyword matching against `interestTags` (no
 *     structured `topics` array)
 *   - Axis 3: election proximity (props have `electionDate`; bills had
 *     the much looser `lastActionDate` recency proxy)
 *
 * Why keyword match not embeddings or structured tags? Same MVP-scope
 * reasoning as bills: cheap, debuggable, well-targeted. Phase 2 candidate:
 * extend prop ingest to populate `aiSummary.topics` + `aiSummary.whoItAffects`
 * the same way the bill pipeline does — then this service can collapse
 * into the bill ranker's exact code path.
 */
@Injectable()
export class PropositionScoringService {
  /**
   * Axis 1 — Direct material. For each user flag that's TRUE, check
   * whether any of its keywords appears in the proposition's text.
   * Score = matched_flags × 0.2, capped at 1.0 (5 matches saturates).
   * Mirrors the bill ranker's saturation point so the two cards
   * surface comparably "strong" relevance scores.
   */
  scoreDirectMaterial(
    proposition: RankableProposition,
    flags: FlagSet,
  ): number {
    if (!proposition.searchableText) return 0;
    let matches = 0;
    for (const [flag, isTrue] of Object.entries(flags)) {
      if (!isTrue) continue;
      const regexes = FLAG_REGEXES[flag as keyof FlagSet];
      if (!regexes) continue;
      if (regexes.some((r) => r.test(proposition.searchableText))) {
        matches += 1;
      }
    }
    return Math.min(matches * 0.2, 1.0);
  }

  /**
   * Axis 2 — Values alignment. Substring match each user `interestTag`
   * against the prop's text. Same normalization as the bill ranker:
   * divide by the user's declared interest count so a user with 3
   * interests + 1 match = 0.33; with 1 interest + 1 match = 1.0.
   */
  scoreValuesAlignment(
    proposition: RankableProposition,
    interestTags: string[],
  ): number {
    if (!proposition.searchableText || interestTags.length === 0) return 0;
    let matches = 0;
    for (const tag of interestTags) {
      const re = new RegExp(`\\b${escapeRegExp(tag)}\\b`, 'i');
      if (re.test(proposition.searchableText)) matches += 1;
    }
    return matches / interestTags.length;
  }

  /**
   * Axis 3 — Election proximity. Piecewise function:
   *
   *   < 0 days (election past)        → 0.0
   *   0–30 days  (urgent voting window) → 1.0
   *   30–90 days (research window)      → linear 1.0 → 0.4
   *   90–365 days (background awareness) → linear 0.4 → 0.0
   *   > 365 days (too far)              → 0.0
   *   no electionDate                   → 0.0
   *
   * Captures the planning-doc's "3 weeks > 1 year" requirement and
   * preserves a non-zero floor through the full research window so
   * propositions show up before they hit the urgent 30-day band.
   */
  scoreElectionProximity(
    proposition: RankableProposition,
    now: Date = new Date(),
  ): number {
    if (!proposition.electionDate) return 0;
    const daysUntil =
      (proposition.electionDate.getTime() - now.getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysUntil < 0) return 0;
    if (daysUntil <= 30) return 1.0;
    if (daysUntil <= 90) {
      // 30 days → 1.0; 90 days → 0.4
      return 1.0 - ((daysUntil - 30) / 60) * 0.6;
    }
    if (daysUntil <= 365) {
      // 90 days → 0.4; 365 days → 0.0
      return 0.4 - ((daysUntil - 90) / 275) * 0.4;
    }
    return 0;
  }

  /**
   * Compute the full axis scores + composite. Pure function —
   * deterministic given input + a clock. The clock is injectable so
   * the election-proximity tests stay stable.
   */
  scoreProposition(
    proposition: RankableProposition,
    input: PropositionPersonalizationInputDto,
    now: Date = new Date(),
  ): { axisScores: PropositionAxisScoresModel; composite: number } {
    const directMaterial = this.scoreDirectMaterial(proposition, input.flags);
    const valuesAlignment = this.scoreValuesAlignment(
      proposition,
      input.interestTags,
    );
    const actionability = this.scoreElectionProximity(proposition, now);

    const axisScores: PropositionAxisScoresModel = {
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
