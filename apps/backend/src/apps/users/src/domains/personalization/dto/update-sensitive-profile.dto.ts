import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Mutation input for `updateSensitiveProfile` (#742). Mirrors
 * `SensitiveProfilePayload`. Every field is optional; missing keys
 * leave existing values untouched. Setting an array to `[]` clears it.
 *
 * The resolver short-circuits this mutation entirely when the user
 * has `noFieldsMode = true` — see SensitiveProfileService.updatePayload.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : value;

@InputType()
export class UpdateSensitiveProfileDto {
  // §4.4 income
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  incomeBand?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publicBenefits?: string[];

  // §4.5 Health
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  insuranceType?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chronicConditionCategories?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  caregiverFor?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  reproductiveHealthRelevance?: boolean;

  // §4.8 Citizenship & justice
  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  citizenshipStatus?: string;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  veteranStatus?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  justiceInvolvement?: string[];

  // §4.9 Cultural & community identity
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  raceEthnicity?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  primaryLanguages?: string[];

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  religiousCommunity?: string;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lgbtqIdentity?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3])
  immigrationGeneration?: 1 | 2 | 3;

  @Field({ nullable: true })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tribalAffiliation?: string;
}
