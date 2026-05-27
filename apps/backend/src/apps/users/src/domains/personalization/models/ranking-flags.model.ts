import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Boolean-flag derivations from the user's full profile for consumption
 * by the relevance ranker in the `knowledge` service via federation.
 *
 * Per planning doc §6.3: the ranker MUST NOT receive raw T3 sensitive
 * values (citizenship status, race, health conditions, justice
 * involvement, etc.). Instead the users service exposes derived booleans
 * — flags that indicate the user has SOMETHING in a category without
 * leaking which specific value. This decouples ranking logic from the
 * privacy-sensitive raw data.
 *
 * Honored toggles:
 *   - `noFieldsMode`: when on, every flag whose derivation requires T3
 *     access returns `false` regardless of stored content. The user
 *     opts out of being categorized; the ranker still works but loses
 *     some signal richness — that's the doc §9.2 contract.
 *
 * The set of flags here is the v1.0 ranker contract — additions need
 * a corresponding consumer change in the knowledge ranker. Issue #743.
 */
@ObjectType('RankingFlags')
export class RankingFlagsModel {
  // ─── T1/T2-derived (SignalProfile) ──────────────────────────────

  /** Housing tenure indicates renter. */
  @Field()
  isRenter!: boolean;

  /** Housing tenure indicates owner. */
  @Field()
  isHomeowner!: boolean;

  /** Has children (any age band populated) OR parentOfStudent set. */
  @Field()
  isParent!: boolean;

  /** Eldercare dependents present. */
  @Field()
  isCaregiver!: boolean;

  /** Current student at any level. */
  @Field()
  isStudent!: boolean;

  /** Educator role. */
  @Field()
  isEducator!: boolean;

  /** Employed (w2/1099/self-employed/business-owner). */
  @Field()
  isWorker!: boolean;

  /** Business owner specifically. */
  @Field()
  isBusinessOwner!: boolean;

  /** Union member. */
  @Field()
  isUnionMember!: boolean;

  /** Gig worker. */
  @Field()
  isGigWorker!: boolean;

  /** Primary transit mode is transit (bus/rail). */
  @Field()
  isTransitRider!: boolean;

  /** Has at least one vehicle (any type). */
  @Field()
  isDriver!: boolean;

  /** Has at least one of the niche regulatory licenses (CDL, pilot, etc.). */
  @Field()
  hasSpecialLicense!: boolean;

  // ─── T3-derived (SensitiveProfile) — masked when noFieldsMode is on ───

  /** Citizenship status indicates non-citizen or asylum-seeking. */
  @Field()
  hasImmigrationConcern!: boolean;

  /** Has any chronic condition category populated. */
  @Field()
  hasHealthCondition!: boolean;

  /** Insurance type indicates public coverage (Medicare/Medicaid/VA). */
  @Field()
  hasPublicHealthInsurance!: boolean;

  /** Veteran or active duty. */
  @Field()
  isVeteran!: boolean;

  /** Any justice-involvement category populated. */
  @Field()
  hasJusticeInvolvement!: boolean;

  /** Income band indicates lower brackets (heuristic for benefits-cliff bills). */
  @Field()
  isLowIncome!: boolean;

  /** Receives any public benefits (SNAP/Medicaid/WIC/SSDI/etc.). */
  @Field()
  receivesPublicBenefits!: boolean;
}
