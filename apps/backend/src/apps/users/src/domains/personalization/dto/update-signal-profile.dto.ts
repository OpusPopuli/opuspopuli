import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

/**
 * Mutation input for updateSignalProfile. Every field is optional;
 * `undefined` leaves the existing value untouched. Empty strings on
 * single-value fields are coerced to `undefined` to match the existing
 * UpdateProfileDto convention (#739) — class-validator's @IsOptional
 * only short-circuits on null/undefined.
 *
 * Field-level validation is intentionally lenient here — the controlled
 * vocabularies (housing_tenure values, transit modes, etc.) live in
 * `@opuspopuli/common` and are validated at the resolver layer once the
 * shared vocab package lands. For first slice we accept any string and
 * let the consumers (ranking pipeline) ignore unknown values.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : value;

@InputType()
export class UpdateSignalProfileDto {
  // §4.2
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  housingTenure?: string;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  buildingType?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taxExposure?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  housingFlags?: string[];

  // §4.3
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  childrenAgeBands?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  hasEldercareDependents?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  multigenerational?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  hasPets?: boolean;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  partnerStatus?: string;

  // §4.4
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employmentStatus?: string;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  occupationCategory?: string;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employerSizeBand?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  unionMember?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  gigWorker?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  tippedWorker?: boolean;

  // §4.6
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  primaryTransitMode?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleTypes?: string[];

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  commuteBand?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialLicenses?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  transitPassHolder?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  bikeShareMember?: boolean;

  // §4.7
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  studentLevel?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  parentOfStudent?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  educator?: boolean;

  // §4.10
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interestTags?: string[];

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  @IsObject()
  convictionStrength?: Record<string, string>;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  politicalSelfId?: string;

  // §4.11
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trustedOrganizations?: string[];

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  unionAffiliation?: string;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  faithCommunity?: string;

  // §4.13
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080) // minutes in a week
  weeklyAttentionMinutes?: number;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  preferredDepth?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accessibilityNeeds?: string[];

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  readingLevel?: string;

  // §4.14
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Length(2, 2)
  agingParentsState?: string;
}
