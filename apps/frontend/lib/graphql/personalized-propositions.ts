import { gql } from "@apollo/client";
import type { BriefingAxisScores, RankingFlags } from "./personalized-feed";

// ============================================
// Personalized propositions feed (#771).
//
// Mirrors the bills feed (#743 / #744) for ballot measures. The
// frontend reuses the `myRankingFlags` + `mySignalProfile { interestTags }`
// prefetch from `personalized-feed.ts` — those signals power BOTH the
// bills section and the propositions section, so there's no benefit
// to re-fetching them per domain.
//
// `myPersonalizedPropositionFeed(input, limit)` from the knowledge
// service returns ranked `PersonalizedPropositionResult[]` with
// `propositionId`, `relevanceScore`, and the per-axis breakdown.
// Proposition details (title, summary, election date, outcomes, …)
// are resolved separately via region's existing `proposition(id)`
// query (see GET_PROPOSITION in `region.ts`).
//
// v1.0 known shape: axes 1–3 (directMaterial / valuesAlignment /
// actionability — propositions' axis 3 = election proximity) are
// populated; axes 4–7 are placeholder 0.0 until follow-ups land.
// `relevanceExplanation` is always null in Phase 1 — the LLM rerank
// flow that powers bills (#745) isn't wired for props yet.
// ============================================

/**
 * Proposition-specific alias for the shared `BriefingAxisScores`
 * shape. Wire-identical to the bill `AxisScores` so card-level
 * components (`WhyThisPanel`, `RelevanceChip`) accept both without
 * structural casts. The per-domain axis-3 semantics (election
 * proximity vs. legislative activity) are documented on the shared
 * interface.
 */
export type PropositionAxisScores = BriefingAxisScores;

export interface PersonalizedPropositionResult {
  propositionId: string;
  relevanceScore: number;
  axisScores: PropositionAxisScores;
  /**
   * LLM-written one-sentence "why this matters to you" — placeholder
   * for Phase 2 of #771 (would reuse the `llm-rerank-worker` infra
   * shipped in #745 with a new prompt-service template). Always null
   * in Phase 1; `WhyThisPanel` falls back to the heuristic axis
   * explanation.
   */
  relevanceExplanation?: string | null;
}

export interface PersonalizedPropositionFeedData {
  myPersonalizedPropositionFeed: PersonalizedPropositionResult[];
}

export interface PropositionPersonalizationInput {
  flags: RankingFlags;
  interestTags: string[];
}

export const GET_MY_PERSONALIZED_PROPOSITION_FEED = gql`
  query MyPersonalizedPropositionFeed(
    $input: PropositionPersonalizationInputDto!
    $limit: Int!
  ) {
    myPersonalizedPropositionFeed(input: $input, limit: $limit) {
      propositionId
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
 * Convenience: pulls the top-scoring axis so the heuristic
 * `WhyThisPanel` can choose an i18n key. Same shape as `topAxisFor`
 * in `personalized-feed.ts` — kept in this file so the propositions
 * card can pass its (Proposition)AxisScores cleanly without a
 * structural cast against the bill shape.
 */
export function topAxisForProposition(
  scores: PropositionAxisScores,
): keyof PropositionAxisScores {
  const axes: (keyof PropositionAxisScores)[] = [
    "directMaterial",
    "valuesAlignment",
    "actionability",
  ];
  return axes.reduce<keyof PropositionAxisScores>(
    (best, axis) => ((scores[axis] ?? 0) > (scores[best] ?? 0) ? axis : best),
    axes[0],
  );
}
