import { Field, InputType } from '@nestjs/graphql';
import {
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
  IsUrl,
  Matches,
  IsTimeZone,
  IsLocale,
  IsBoolean,
  IsEnum,
  IsArray,
} from 'class-validator';
import {
  PoliticalAffiliation,
  VotingFrequency,
  EducationLevel,
  IncomeRange,
  HomeownerStatus,
} from 'src/common/enums/profile.enum';

@InputType()
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public middleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public preferredName?: string;

  @IsOptional()
  @IsDateString()
  @Field({ nullable: true })
  public dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone must be a valid E.164 format',
  })
  @Field({ nullable: true })
  public phone?: string;

  @IsOptional()
  @IsTimeZone()
  @Field({ nullable: true })
  public timezone?: string;

  @IsOptional()
  @IsLocale()
  @Field({ nullable: true })
  public locale?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(en|es)$/, {
    message: 'preferredLanguage must be either "en" or "es"',
  })
  @Field({ nullable: true })
  public preferredLanguage?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  @Field({ nullable: true })
  public avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Field({ nullable: true })
  public bio?: string;

  // Profile Visibility
  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public isPublic?: boolean;

  // Avatar Storage Key
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public avatarStorageKey?: string;

  // Civic Fields
  @IsOptional()
  @IsEnum(PoliticalAffiliation)
  @Field(() => PoliticalAffiliation, { nullable: true })
  public politicalAffiliation?: PoliticalAffiliation;

  @IsOptional()
  @IsEnum(VotingFrequency)
  @Field(() => VotingFrequency, { nullable: true })
  public votingFrequency?: VotingFrequency;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Field(() => [String], { nullable: true })
  public policyPriorities?: string[];

  // Demographic Fields
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public occupation?: string;

  @IsOptional()
  @IsEnum(EducationLevel)
  @Field(() => EducationLevel, { nullable: true })
  public educationLevel?: EducationLevel;

  @IsOptional()
  @IsEnum(IncomeRange)
  @Field(() => IncomeRange, { nullable: true })
  public incomeRange?: IncomeRange;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Field({ nullable: true })
  public householdSize?: string;

  @IsOptional()
  @IsEnum(HomeownerStatus)
  @Field(() => HomeownerStatus, { nullable: true })
  public homeownerStatus?: HomeownerStatus;
}
