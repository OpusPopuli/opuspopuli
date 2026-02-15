import {
  ObjectType,
  Field,
  ID,
  Int,
  Float,
  registerEnumType,
} from '@nestjs/graphql';

/**
 * Donor type enum for GraphQL
 */
export enum DonorTypeGQL {
  INDIVIDUAL = 'individual',
  COMMITTEE = 'committee',
  PARTY = 'party',
  SELF = 'self',
  OTHER = 'other',
}

registerEnumType(DonorTypeGQL, {
  name: 'DonorType',
  description: 'Types of campaign contribution donors',
});

/**
 * Contribution GraphQL model
 */
@ObjectType()
export class ContributionModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  committeeId!: string;

  @Field()
  donorName!: string;

  @Field()
  donorType!: string;

  @Field({ nullable: true })
  donorEmployer?: string;

  @Field({ nullable: true })
  donorOccupation?: string;

  @Field({ nullable: true })
  donorCity?: string;

  @Field({ nullable: true })
  donorState?: string;

  @Field({ nullable: true })
  donorZip?: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  date!: Date;

  @Field({ nullable: true })
  electionType?: string;

  @Field({ nullable: true })
  contributionType?: string;

  @Field()
  sourceSystem!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

/**
 * Paginated contributions response
 */
@ObjectType()
export class PaginatedContributions {
  @Field(() => [ContributionModel])
  items!: ContributionModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
