import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Per-axis relevance breakdown for a proposition (#771). Each axis is
 * 0.0-1.0. v1.0 (Phase 1) populates axes 1-3 with non-zero scores;
 * axes 4-7 return 0.0 placeholders parallel to the bill ranker's
 * v1.1 wiring (planning doc §5.1).
 *
 * Axis 3 is renamed semantically for propositions: bills track
 * "actionability" (vote/comment window), props track explicit
 * "election proximity" (days until the ballot). The wire shape stays
 * named `actionability` so the frontend WhyThisPanel can reuse the
 * same i18n keys without per-section forking.
 */
@ObjectType('PropositionAxisScores')
export class PropositionAxisScoresModel {
  /** Axis 1: does this change the user's money, rights, health, services? */
  @Field()
  directMaterial!: number;

  /** Axis 2: does it advance or threaten priorities the user declared? */
  @Field()
  valuesAlignment!: number;

  /**
   * Axis 3 (propositions): election proximity — peaks at ~14 days out,
   * decays linearly toward 0 at 0 days (already past) and at 365 days
   * (too far out to matter). Maps to the same wire field name as the
   * bill ranker's "actionability" for shared frontend rendering.
   */
  @Field()
  actionability!: number;

  /** Axis 4 (v1.1): household, employer, school, neighborhood impact. */
  @Field()
  indirectMaterial!: number;

  /**
   * Axis 5 (v1.1 — propositions specifically): trusted-organization
   * endorsement signal. Phase 2 of #771 populates this once the
   * endorsement model + ingest path land.
   */
  @Field()
  coalitionSignal!: number;

  /** Axis 6 (v1.1): under-covered local prop rewards. */
  @Field()
  counterfactual!: number;

  /** Axis 7 (v1.1): diminishing returns on similar props. */
  @Field()
  noveltyRepetition!: number;
}
