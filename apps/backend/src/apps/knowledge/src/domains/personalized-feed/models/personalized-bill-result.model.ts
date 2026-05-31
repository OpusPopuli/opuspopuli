import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * Per-axis relevance breakdown. Each axis is 0.0-1.0. v1.0 populates
 * axes 1-3 with non-zero scores; axes 4-7 return 0.0 placeholders and
 * are wired for v1.1 (planning doc §5.1).
 */
@ObjectType('AxisScores')
export class AxisScoresModel {
  /** Axis 1: does this change the user's money, rights, health, services? */
  @Field()
  directMaterial!: number;

  /** Axis 2: does it advance or threaten priorities the user declared? */
  @Field()
  valuesAlignment!: number;

  /** Axis 3: is there a vote / comment window the user can affect now? */
  @Field()
  actionability!: number;

  /** Axis 4 (v1.1): household, employer, school, neighborhood impact. */
  @Field()
  indirectMaterial!: number;

  /** Axis 5 (v1.1): organizations the user trusts for/against this bill. */
  @Field()
  coalitionSignal!: number;

  /** Axis 6 (v1.1): under-covered local bill rewards. */
  @Field()
  counterfactual!: number;

  /** Axis 7 (v1.1): diminishing returns on similar bills. */
  @Field()
  noveltyRepetition!: number;
}

/**
 * One entry in the user's personalized bill feed. Returns the bill's
 * id + the ranking output. The frontend uses `billId` with region's
 * existing `bill(id)` query to fetch the full Bill record.
 *
 * Federated Bill reference (so a single query could expand `bill { ... }`
 * inline via the gateway) was the original plan, but region's Bill type
 * is not currently declared as an `@key("id")` entity. Adding that
 * declaration would creep this PR into region-service territory.
 * Tracked in #761 alongside the cross-service DB read refactor. See #743.
 */
@ObjectType('PersonalizedBillResult')
export class PersonalizedBillResultModel {
  /** Region-owned Bill id. Frontend resolves details via region.bill(id). */
  @Field(() => ID)
  billId!: string;

  /** Composite 0.0-1.0 score. Higher = more relevant. */
  @Field()
  relevanceScore!: number;

  /** Per-axis breakdown so the why-this panel (#750) can render reasons. */
  @Field(() => AxisScoresModel)
  axisScores!: AxisScoresModel;

  /**
   * LLM-written one-sentence "why this matters to you" (15-30 words),
   * cached by the nightly LLM re-rank batch job (#745). Null when the
   * job hasn't run for this bill yet, the LLM call failed, the validator
   * rejected the output, or the per-user token budget capped out. The
   * frontend's WhyThisPanel falls back to a heuristic axis explanation
   * when this is null (#744 ships that fallback).
   */
  @Field({ nullable: true })
  relevanceExplanation?: string;
}
