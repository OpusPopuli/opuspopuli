import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Per-axis relevance breakdown for a representative (#769). Each axis is
 * 0.0-1.0. Phase 1 populates axes 1-3 with non-zero scores; axes 4-7
 * return 0.0 placeholders, parallel to the bill ranker's v1.1 wiring
 * (planning doc §5.1) and the proposition ranker (#771).
 *
 * Axis semantics for reps:
 *   - chamberMatch: is this rep in a chamber that can act on bills the
 *     user has surfaced via SignalProfile (axis 1 of the bill ranker)?
 *   - committeeMatch: does this rep sit on committees that handle the
 *     user's declared interestTags?
 *   - actionAlignment: has this rep recently sponsored/co-sponsored or
 *     voted on bills aligned with the user's RankingFlags? The shared
 *     wire name (`actionability` on props/bills) is kept so the
 *     frontend WhyThisPanel can reuse the i18n keys without per-section
 *     forking.
 *
 * Axes 4-7 are reserved for v1.1 / Phase 2:
 *   - constituencyOverlap: does the user's address fall in this rep's
 *     district (distinct from "is in their chamber") — handles the case
 *     where someone has e.g. multiple county supervisors for adjacent
 *     districts.
 *   - coalitionSignal: trusted-org endorsement of this rep (needs
 *     endorsement-data pipeline, same blocker as props axis 5).
 *   - counterfactual: under-covered local rep reward.
 *   - noveltyRepetition: diminishing returns on the same rep being
 *     top-of-list every week.
 */
@ObjectType('RepActivityAxisScores')
export class RepActivityAxisScoresModel {
  /** Axis 1: chamber match against the user's bills-of-interest. */
  @Field()
  chamberMatch!: number;

  /** Axis 2: committee match against the user's interestTags. */
  @Field()
  committeeMatch!: number;

  /** Axis 3: action alignment (sponsorship / vote) on the user's bills. */
  @Field()
  actionAlignment!: number;

  /** Axis 4 (v1.1): constituency overlap with the user's address. */
  @Field()
  constituencyOverlap!: number;

  /** Axis 5 (v1.1): trusted-organization endorsement signal. */
  @Field()
  coalitionSignal!: number;

  /** Axis 6 (v1.1): under-covered local rep reward. */
  @Field()
  counterfactual!: number;

  /** Axis 7 (v1.1): diminishing returns on the same rep being surfaced. */
  @Field()
  noveltyRepetition!: number;
}
