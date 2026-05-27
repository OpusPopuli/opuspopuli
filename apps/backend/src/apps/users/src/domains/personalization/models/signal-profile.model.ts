import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

/**
 * GraphQL surface for the T1 + T2 personalization signals (#742).
 * Every field is nullable since users opt in progressively — a missing
 * field is "user has not declared this," not "unknown."
 *
 * Field comments cite the doc section so cross-references stay
 * navigable. See docs/architecture/personalized-relevance.md.
 */
@ObjectType('SignalProfile')
export class SignalProfileModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  // §4.2 Housing
  @Field({ nullable: true }) housingTenure?: string;
  @Field({ nullable: true }) buildingType?: string;
  @Field(() => [String]) taxExposure!: string[];
  @Field(() => [String]) housingFlags!: string[];

  // §4.3 Household
  @Field(() => [String]) childrenAgeBands!: string[];
  @Field({ nullable: true }) hasEldercareDependents?: boolean;
  @Field({ nullable: true }) multigenerational?: boolean;
  @Field({ nullable: true }) hasPets?: boolean;
  @Field({ nullable: true }) partnerStatus?: string;

  // §4.4 Work
  @Field({ nullable: true }) employmentStatus?: string;
  @Field({ nullable: true }) industry?: string;
  @Field({ nullable: true }) occupationCategory?: string;
  @Field({ nullable: true }) employerSizeBand?: string;
  @Field({ nullable: true }) unionMember?: boolean;
  @Field({ nullable: true }) gigWorker?: boolean;
  @Field({ nullable: true }) tippedWorker?: boolean;

  // §4.6 Transportation
  @Field({ nullable: true }) primaryTransitMode?: string;
  @Field(() => [String]) vehicleTypes!: string[];
  @Field({ nullable: true }) commuteBand?: string;
  @Field(() => [String]) specialLicenses!: string[];
  @Field({ nullable: true }) transitPassHolder?: boolean;
  @Field({ nullable: true }) bikeShareMember?: boolean;

  // §4.7 Education
  @Field({ nullable: true }) studentLevel?: string;
  @Field(() => [String]) parentOfStudent!: string[];
  @Field({ nullable: true }) educator?: boolean;

  // §4.10 Declared values
  @Field(() => [String]) interestTags!: string[];
  /** Map { tag: 'passing' | 'important' | 'core' }. */
  @Field(() => GraphQLJSON, { nullable: true })
  convictionStrength?: Record<string, string>;
  @Field({ nullable: true }) politicalSelfId?: string;

  // §4.11 Affiliations
  @Field(() => [String]) trustedOrganizations!: string[];
  @Field({ nullable: true }) unionAffiliation?: string;
  @Field({ nullable: true }) faithCommunity?: string;

  // §4.13 Attention & format
  @Field(() => Int, { nullable: true }) weeklyAttentionMinutes?: number;
  @Field({ nullable: true }) preferredDepth?: string;
  @Field(() => [String]) accessibilityNeeds!: string[];
  @Field({ nullable: true }) readingLevel?: string;

  // §4.14 Relational graph (minimal)
  @Field({ nullable: true }) agingParentsState?: string;

  @Field(() => GraphQLISODateTime) createdAt!: Date;
  @Field(() => GraphQLISODateTime) updatedAt!: Date;
}
