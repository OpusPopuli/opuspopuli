import { gql } from "@apollo/client";
import type { BriefingAxisScores, RankingFlags } from "./personalized-feed";

// ============================================
// Personalized rep-activity briefing (#769).
//
// Mirrors the bills feed (#743 / #744) and propositions feed (#771)
// for representatives. Unlike bills + props (where the candidate set
// is global to the region and the resolver queries it itself), reps
// are user-specific — the frontend pre-resolves the user's reps via
// region's existing `representativesByDistricts` + `countyRepresentatives`
// queries and passes the IDs as part of the input. Knowledge service
// stays stateless re user→rep mapping.
//
// Reuses the `myRankingFlags` + `mySignalProfile { interestTags }`
// prefetch from `personalized-feed.ts` — those signals power all three
// briefing sections, so Apollo's cache makes the per-domain queries
// effectively free when the page mounts.
//
// `myPersonalizedRepActivity(input)` from the knowledge service returns
// ranked `PersonalizedRepActivityResult[]` with `representativeId`,
// `relevanceScore`, the per-axis breakdown, and up to ~3
// `recentActivityBillIds` the rep recently authored / co-authored /
// voted on among the user's bills-of-interest.
//
// v1.0 known shape: axes 1-3 (chamberMatch / committeeMatch /
// actionAlignment) are populated; axes 4-7 are placeholder 0.0 until
// follow-ups land. `relevanceExplanation` is always null in Phase 1 —
// the LLM rerank flow that powers bills (#745) isn't wired for reps
// yet.
// ============================================

/**
 * Rep-specific shape of the shared axis-score wire model. The backend
 * returns the bill/prop axis field names (chamberMatch /
 * committeeMatch / actionAlignment) for axes 1-3, and the same
 * placeholder set (indirectMaterial / coalitionSignal / counterfactual
 * / noveltyRepetition... wait — the rep axes have different names from
 * bills/props on the wire). Defined here to match the actual
 * `RepActivityAxisScores` GraphQL type on the knowledge subgraph.
 */
export interface RepActivityAxisScores {
  chamberMatch: number;
  committeeMatch: number;
  actionAlignment: number;
  constituencyOverlap: number;
  coalitionSignal: number;
  counterfactual: number;
  noveltyRepetition: number;
}

export interface PersonalizedRepActivityResult {
  representativeId: string;
  relevanceScore: number;
  axisScores: RepActivityAxisScores;
  /**
   * Up to ~3 bill ids the rep recently sponsored, co-sponsored, or
   * voted on among the user's bills-of-interest. The briefing card
   * resolves bill titles via the lightweight `GET_BILL_BRIEF` query.
   */
  recentActivityBillIds: string[];
  /**
   * LLM-written one-sentence "why this rep matters to you" —
   * placeholder for the Phase 2 follow-up. Always null in Phase 1;
   * `RepWhyThisPanel` falls back to the heuristic axis explanation.
   */
  relevanceExplanation?: string | null;
}

export interface PersonalizedRepActivityData {
  myPersonalizedRepActivity: PersonalizedRepActivityResult[];
}

export interface RepPersonalizationInput {
  representativeIds: string[];
  flags: RankingFlags;
  interestTags: string[];
}

export const GET_MY_PERSONALIZED_REP_ACTIVITY = gql`
  query MyPersonalizedRepActivity($input: RepPersonalizationInputDto!) {
    myPersonalizedRepActivity(input: $input) {
      representativeId
      relevanceScore
      relevanceExplanation
      recentActivityBillIds
      axisScores {
        chamberMatch
        committeeMatch
        actionAlignment
        constituencyOverlap
        coalitionSignal
        counterfactual
        noveltyRepetition
      }
    }
  }
`;

/**
 * Top-scoring axis among the v1.0-populated triplet (chamberMatch,
 * committeeMatch, actionAlignment). `RepWhyThisPanel` uses this to
 * pick an i18n key. Mirrors the same `topAxisFor` helpers exported by
 * the bills + propositions modules so the card-level rendering layer
 * stays consistent across briefing sections.
 *
 * Compatible with `BriefingAxisScores` at the structural level (both
 * are records of axis-name → 0.0-1.0 score), but the field set is
 * disjoint — that's why this lives next to its own result type rather
 * than being collapsed into the shared axis helper.
 */
export function topAxisForRep(
  scores: RepActivityAxisScores,
): keyof RepActivityAxisScores {
  const axes: (keyof RepActivityAxisScores)[] = [
    "chamberMatch",
    "committeeMatch",
    "actionAlignment",
  ];
  return axes.reduce<keyof RepActivityAxisScores>(
    (best, axis) => ((scores[axis] ?? 0) > (scores[best] ?? 0) ? axis : best),
    axes[0],
  );
}

/**
 * Re-exported for type-symmetry with `personalized-propositions.ts`,
 * even though `RepActivityAxisScores` is structurally distinct from
 * `BriefingAxisScores`. Importing this type from a single seam means
 * future shared briefing-utility helpers can be parameterized cleanly.
 */
export type { BriefingAxisScores };
