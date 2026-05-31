import { Field, ID, ObjectType } from '@nestjs/graphql';
import { PropositionAxisScoresModel } from './proposition-axis-scores.model';

/**
 * One entry in the user's personalized proposition feed (#771).
 * Returns the proposition's id + the ranking output. The frontend
 * uses `propositionId` with region's existing `proposition(id)` query
 * to fetch the full Proposition record (title, summary, election
 * date, outcomes, etc.).
 *
 * Same federation tradeoff as `PersonalizedBillResult`: region's
 * Proposition type isn't declared as an `@key("id")` entity, so
 * inline expansion via the gateway isn't free. Tracked alongside the
 * cross-service DB read refactor at #761.
 */
@ObjectType('PersonalizedPropositionResult')
export class PersonalizedPropositionResultModel {
  /**
   * Region-owned Proposition id. Frontend resolves details via
   * region.proposition(id).
   */
  @Field(() => ID)
  propositionId!: string;

  /** Composite 0.0-1.0 score. Higher = more relevant. */
  @Field()
  relevanceScore!: number;

  /** Per-axis breakdown so the why-this panel can render reasons. */
  @Field(() => PropositionAxisScoresModel)
  axisScores!: PropositionAxisScoresModel;

  /**
   * LLM-written one-sentence "why this matters to you" — placeholder
   * for the prop-rerank Phase 2 follow-up (would reuse the
   * `llm-rerank-worker` infrastructure shipped in #745 with a new
   * prompt-service template). Always null in Phase 1; frontend falls
   * back to the heuristic axis explanation rendered by `WhyThisPanel`.
   */
  @Field({ nullable: true })
  relevanceExplanation?: string;
}
