import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * GraphQL surface for the T3 sensitive profile (#742). All fields
 * mirror the SensitiveProfilePayload shape and are nullable.
 *
 * When `noFieldsMode` is true on the underlying row, the resolver
 * returns this model with `noFieldsMode: true` and every other field
 * null — regardless of what's encrypted at rest. The high-risk-user
 * safety toggle from doc §9.2 is the only field guaranteed to round-
 * trip when noFieldsMode is on.
 */
@ObjectType('SensitiveProfile')
export class SensitiveProfileModel {
  /**
   * The master toggle. When true, all other fields are null on read
   * and writes are ignored. The user can flip this back to `false` at
   * any time; doing so restores access to whatever was previously
   * encrypted at rest (the toggle does not erase data — see the doc).
   */
  @Field()
  noFieldsMode!: boolean;

  // §4.4 income band
  @Field({ nullable: true }) incomeBand?: string;
  @Field(() => [String], { nullable: true }) publicBenefits?: string[];

  // §4.5 Health
  @Field({ nullable: true }) insuranceType?: string;
  @Field(() => [String], { nullable: true })
  chronicConditionCategories?: string[];
  @Field(() => [String], { nullable: true }) caregiverFor?: string[];
  @Field({ nullable: true }) reproductiveHealthRelevance?: boolean;

  // §4.8 Citizenship & justice
  @Field({ nullable: true }) citizenshipStatus?: string;
  @Field({ nullable: true }) veteranStatus?: string;
  @Field(() => [String], { nullable: true }) justiceInvolvement?: string[];

  // §4.9 Cultural & community identity
  @Field(() => [String], { nullable: true }) raceEthnicity?: string[];
  @Field(() => [String], { nullable: true }) primaryLanguages?: string[];
  @Field({ nullable: true }) religiousCommunity?: string;
  @Field({ nullable: true }) lgbtqIdentity?: string;
  @Field(() => Int, { nullable: true }) immigrationGeneration?: number;
  @Field({ nullable: true }) tribalAffiliation?: string;
}
