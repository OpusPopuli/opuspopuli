import { gql } from "@apollo/client";

// ============================================
// Personalized bill feed (#743 / #744).
//
// Two queries chain here:
//   1. `myRankingFlags` + `mySignalProfile { interestTags }` from the
//      users service — these are the 20 boolean derivations + the
//      user's declared topics. v1.0 of the federation boundary
//      (planning doc §6.3) requires the frontend to pass these into
//      the feed resolver as arguments; #761 will collapse this into
//      a subgraph-to-subgraph call so the frontend only sees the feed.
//   2. `myPersonalizedBillFeed(input, limit)` from the knowledge
//      service — returns ranked `PersonalizedBillResult[]` with
//      `billId`, `relevanceScore`, and the per-axis breakdown. Bill
//      details (title, summary, status, …) are *not* embedded — the
//      frontend resolves them via region's existing `bill(id)` query
//      one step later (see GET_BILL_BY_ID in `region.ts`).
//
// v1.0 known shape: axes 1–3 (directMaterial / valuesAlignment /
// actionability) are populated; axes 4–7 are placeholder 0.0 until
// the planning-doc §5.1 follow-ups land.
// ============================================

export interface RankingFlags {
  // T1/T2-derived
  isRenter: boolean;
  isHomeowner: boolean;
  isParent: boolean;
  isCaregiver: boolean;
  isStudent: boolean;
  isEducator: boolean;
  isWorker: boolean;
  isBusinessOwner: boolean;
  isUnionMember: boolean;
  isGigWorker: boolean;
  isTransitRider: boolean;
  isDriver: boolean;
  hasSpecialLicense: boolean;
  // T3-derived (masked when noFieldsMode is on)
  hasImmigrationConcern: boolean;
  hasHealthCondition: boolean;
  hasPublicHealthInsurance: boolean;
  isVeteran: boolean;
  hasJusticeInvolvement: boolean;
  isLowIncome: boolean;
  receivesPublicBenefits: boolean;
}

export interface BriefingPrefetchData {
  myRankingFlags: RankingFlags;
  mySignalProfile: { interestTags: string[] } | null;
}

export const GET_BRIEFING_PREFETCH = gql`
  query BriefingPrefetch {
    myRankingFlags {
      isRenter
      isHomeowner
      isParent
      isCaregiver
      isStudent
      isEducator
      isWorker
      isBusinessOwner
      isUnionMember
      isGigWorker
      isTransitRider
      isDriver
      hasSpecialLicense
      hasImmigrationConcern
      hasHealthCondition
      hasPublicHealthInsurance
      isVeteran
      hasJusticeInvolvement
      isLowIncome
      receivesPublicBenefits
    }
    mySignalProfile {
      interestTags
    }
  }
`;

export interface AxisScores {
  /** Axis 1: does this change the user's money, rights, health, services? */
  directMaterial: number;
  /** Axis 2: does it advance or threaten priorities the user declared? */
  valuesAlignment: number;
  /** Axis 3: is there a vote / comment window the user can affect now? */
  actionability: number;
  // Axes 4-7 — placeholder 0.0 in v1.0 (planning doc §5.1 follow-ups)
  indirectMaterial: number;
  coalitionSignal: number;
  counterfactual: number;
  noveltyRepetition: number;
}

export interface PersonalizedBillResult {
  billId: string;
  relevanceScore: number;
  axisScores: AxisScores;
  /**
   * LLM-written one-sentence "why this matters to you" (#745). Null
   * until the nightly batch job has computed an explanation for this
   * (user, bill) pair, or when the LLM call failed / the validator
   * rejected the output / the per-user token budget capped out.
   * `WhyThisPanel` falls back to the heuristic axis explanation in
   * that case.
   */
  relevanceExplanation?: string | null;
}

export interface PersonalizedBillFeedData {
  myPersonalizedBillFeed: PersonalizedBillResult[];
}

export interface PersonalizationInput {
  flags: RankingFlags;
  interestTags: string[];
}

export const GET_MY_PERSONALIZED_BILL_FEED = gql`
  query MyPersonalizedBillFeed($input: PersonalizationInputDto!, $limit: Int!) {
    myPersonalizedBillFeed(input: $input, limit: $limit) {
      billId
      relevanceScore
      relevanceExplanation
      axisScores {
        directMaterial
        valuesAlignment
        actionability
        indirectMaterial
        coalitionSignal
        counterfactual
        noveltyRepetition
      }
    }
  }
`;

/**
 * Apollo Client auto-decorates every fetched object with `__typename`
 * (and for our RankingFlags it tags it as "RankingFlags"). When that
 * shape is fed back as the `RankingFlagsInputDto` argument of the
 * `myPersonalizedBillFeed` mutation, the InputType validator on the
 * server rejects the extra `__typename` field. Strip it before
 * passing the object back over the wire.
 */
export function stripTypename<T extends object>(obj: T): Omit<T, "__typename"> {
  const rest = { ...obj } as Omit<T, "__typename"> & { __typename?: string };
  delete rest.__typename;
  return rest;
}

/**
 * Convenience: the AC asks for a "Why this matters to you" affordance
 * keyed on the axis scores. This pulls the top-scoring axis to drive
 * the i18n explanation we render today. When #745 ships an LLM-written
 * sentence the frontend stops reading this — but the heuristic stays
 * as a fallback when the LLM is offline or the user opted out.
 */
export function topAxisFor(scores: AxisScores): keyof AxisScores {
  const axes: (keyof AxisScores)[] = [
    "directMaterial",
    "valuesAlignment",
    "actionability",
  ];
  return axes.reduce<keyof AxisScores>(
    (best, axis) => ((scores[axis] ?? 0) > (scores[best] ?? 0) ? axis : best),
    axes[0],
  );
}
