import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';

/**
 * Committee type enum for GraphQL
 */
export enum CommitteeTypeGQL {
  CANDIDATE = 'candidate',
  BALLOT_MEASURE = 'ballot_measure',
  PAC = 'pac',
  SUPER_PAC = 'super_pac',
  PARTY = 'party',
  SMALL_CONTRIBUTOR = 'small_contributor',
  OTHER = 'other',
}

registerEnumType(CommitteeTypeGQL, {
  name: 'CommitteeType',
  description: 'Types of campaign finance committees',
});

/**
 * Committee status enum for GraphQL
 */
export enum CommitteeStatusGQL {
  ACTIVE = 'active',
  TERMINATED = 'terminated',
}

registerEnumType(CommitteeStatusGQL, {
  name: 'CommitteeStatus',
  description: 'Status of a campaign committee',
});

/**
 * Committee GraphQL model
 */
@ObjectType()
export class CommitteeModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  name!: string;

  @Field()
  type!: string;

  @Field({ nullable: true })
  candidateName?: string;

  @Field({ nullable: true })
  candidateOffice?: string;

  @Field({ nullable: true })
  propositionId?: string;

  @Field({ nullable: true })
  party?: string;

  @Field()
  status!: string;

  @Field()
  sourceSystem!: string;

  @Field({ nullable: true })
  sourceUrl?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

/**
 * Paginated committees response
 */
@ObjectType()
export class PaginatedCommittees {
  @Field(() => [CommitteeModel])
  items!: CommitteeModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
