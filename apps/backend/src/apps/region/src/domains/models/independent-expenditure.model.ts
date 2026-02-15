import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

/**
 * Independent Expenditure GraphQL model
 */
@ObjectType()
export class IndependentExpenditureModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  committeeId!: string;

  @Field()
  committeeName!: string;

  @Field({ nullable: true })
  candidateName?: string;

  @Field({ nullable: true })
  propositionTitle?: string;

  @Field()
  supportOrOppose!: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  date!: Date;

  @Field({ nullable: true })
  electionDate?: Date;

  @Field({ nullable: true })
  description?: string;

  @Field()
  sourceSystem!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

/**
 * Paginated independent expenditures response
 */
@ObjectType()
export class PaginatedIndependentExpenditures {
  @Field(() => [IndependentExpenditureModel])
  items!: IndependentExpenditureModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
