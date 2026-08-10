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

  // donorEmployer, donorOccupation and donorZip are deliberately NOT exposed
  // over GraphQL (#980). They are still ingested and stored — CAL-ACCESS
  // publishes them and they support internal analysis — but name + employer +
  // occupation + ZIP+4 together approach an individually identifying record,
  // and the re-ingest takes this table to ~17M rows. No UI ever rendered them:
  // the contributions page selects donorName/donorType/amount/date, and the
  // single-contribution query that did select them had no consumer at all.
  // Read them through a privileged path if a real use case appears.

  @Field({ nullable: true })
  donorCity?: string;

  @Field({ nullable: true })
  donorState?: string;

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
