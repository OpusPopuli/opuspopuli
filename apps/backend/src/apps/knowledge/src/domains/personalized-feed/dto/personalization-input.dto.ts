import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';

/**
 * Boolean-flag inputs the ranker uses for axis 1 (direct material).
 * Mirrors `RankingFlagsModel` from the users service — the frontend
 * fetches `myRankingFlags` first, then passes the result here so the
 * ranker can score against stakeholder match without crossing the T3
 * privacy boundary itself. See planning doc §6.3 and issue #743.
 */
@InputType()
export class RankingFlagsInputDto {
  // T1/T2-derived
  @Field() @IsBoolean() isRenter!: boolean;
  @Field() @IsBoolean() isHomeowner!: boolean;
  @Field() @IsBoolean() isParent!: boolean;
  @Field() @IsBoolean() isCaregiver!: boolean;
  @Field() @IsBoolean() isStudent!: boolean;
  @Field() @IsBoolean() isEducator!: boolean;
  @Field() @IsBoolean() isWorker!: boolean;
  @Field() @IsBoolean() isBusinessOwner!: boolean;
  @Field() @IsBoolean() isUnionMember!: boolean;
  @Field() @IsBoolean() isGigWorker!: boolean;
  @Field() @IsBoolean() isTransitRider!: boolean;
  @Field() @IsBoolean() isDriver!: boolean;
  @Field() @IsBoolean() hasSpecialLicense!: boolean;

  // T3-derived (already masked by users service when noFieldsMode is on)
  @Field() @IsBoolean() hasImmigrationConcern!: boolean;
  @Field() @IsBoolean() hasHealthCondition!: boolean;
  @Field() @IsBoolean() hasPublicHealthInsurance!: boolean;
  @Field() @IsBoolean() isVeteran!: boolean;
  @Field() @IsBoolean() hasJusticeInvolvement!: boolean;
  @Field() @IsBoolean() isLowIncome!: boolean;
  @Field() @IsBoolean() receivesPublicBenefits!: boolean;
}

/**
 * Bundled input for `myPersonalizedBillFeed`. The frontend pre-fetches
 * the user's flags + interest tags from the users service in one
 * query, then passes them here so this resolver can do the ranking
 * without making a cross-service call back to users.
 *
 * v1.0 risk: a malicious client could lie about its own flags to
 * surface unrelated bills. Effect is "user gets bills they don't
 * actually care about" — annoying, not a privacy breach. Slice 2
 * hardens this with a subgraph-to-subgraph call.
 */
@InputType()
export class PersonalizationInputDto {
  /** User's declared topic interests (housing, healthcare, etc.) */
  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  interestTags!: string[];

  /** Derived boolean flags from the users service. */
  @Field(() => RankingFlagsInputDto)
  @ValidateNested()
  @Type(() => RankingFlagsInputDto)
  flags!: RankingFlagsInputDto;
}
