import { Field, ID, ObjectType } from '@nestjs/graphql';
import { RepActivityAxisScoresModel } from './rep-activity-axis-scores.model';

/**
 * One entry in the user's personalized rep-activity briefing (#769).
 * Returns the representative's id + the ranking output + a small set of
 * recent activity bill ids the briefing card renders as "what they've
 * been working on". The frontend uses `representativeId` with region's
 * existing `representative(id)` query to fetch the full Representative
 * record (name, party, district, contact, etc.).
 *
 * Federation tradeoff: region's Representative type isn't declared as
 * an `@key("id")` entity, so inline expansion via the gateway isn't
 * free. Tracked alongside the cross-service DB read refactor at #761,
 * same as the bill and proposition results.
 */
@ObjectType('PersonalizedRepActivityResult')
export class PersonalizedRepActivityResultModel {
  /**
   * Region-owned Representative id. Frontend resolves details via
   * region.representative(id).
   */
  @Field(() => ID)
  representativeId!: string;

  /** Composite 0.0-1.0 score. Higher = more relevant to this user. */
  @Field()
  relevanceScore!: number;

  /** Per-axis breakdown so the why-this panel can render reasons. */
  @Field(() => RepActivityAxisScoresModel)
  axisScores!: RepActivityAxisScoresModel;

  /**
   * Up to ~3 bill ids this rep has recently sponsored, co-sponsored, or
   * voted on that aligned with the user's signals. The briefing card
   * renders these as "what they've been working on for you" tags; the
   * frontend resolves bill titles via the knowledge subgraph's existing
   * `bill(id)` query (no new federation surface).
   */
  @Field(() => [ID])
  recentActivityBillIds!: string[];

  /**
   * LLM-written one-sentence "why this rep matters to you" — placeholder
   * for the Phase 2 follow-up (would reuse the `llm-rerank-worker`
   * infrastructure shipped in #745 with a new prompt-service template).
   * Always null in Phase 1; frontend falls back to the heuristic axis
   * explanation rendered by WhyThisPanel.
   */
  @Field({ nullable: true })
  relevanceExplanation?: string;
}
