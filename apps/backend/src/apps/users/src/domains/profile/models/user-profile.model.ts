import { Field, ID, ObjectType } from '@nestjs/graphql';
import {
  PoliticalAffiliation,
  VotingFrequency,
  EducationLevel,
  IncomeRange,
  HomeownerStatus,
} from 'src/common/enums/profile.enum';

@ObjectType()
export class UserProfileModel {
  @Field(() => ID)
  id!: string;

  @Field()
  userId!: string;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  middleName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  displayName?: string;

  @Field({ nullable: true })
  preferredName?: string;

  @Field({ nullable: true })
  dateOfBirth?: Date;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  phoneVerifiedAt?: Date;

  @Field({ nullable: true })
  timezone?: string;

  @Field({ nullable: true })
  locale?: string;

  @Field({ nullable: true })
  preferredLanguage?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  avatarStorageKey?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field()
  isPublic!: boolean;

  @Field(() => PoliticalAffiliation, { nullable: true })
  politicalAffiliation?: PoliticalAffiliation;

  @Field(() => VotingFrequency, { nullable: true })
  votingFrequency?: VotingFrequency;

  @Field(() => [String], { nullable: true })
  policyPriorities?: string[];

  @Field({ nullable: true })
  occupation?: string;

  @Field(() => EducationLevel, { nullable: true })
  educationLevel?: EducationLevel;

  @Field(() => IncomeRange, { nullable: true })
  incomeRange?: IncomeRange;

  @Field({ nullable: true })
  householdSize?: string;

  @Field(() => HomeownerStatus, { nullable: true })
  homeownerStatus?: HomeownerStatus;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
