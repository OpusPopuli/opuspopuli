import {
  ObjectType,
  Field,
  ID,
  Int,
  Float,
  registerEnumType,
} from '@nestjs/graphql';

/**
 * Support or Oppose enum for GraphQL
 * Shared by Expenditure and IndependentExpenditure
 */
export enum SupportOrOpposeGQL {
  SUPPORT = 'support',
  OPPOSE = 'oppose',
}

registerEnumType(SupportOrOpposeGQL, {
  name: 'SupportOrOppose',
  description: 'Whether spending supports or opposes a candidate/measure',
});

/**
 * Expenditure GraphQL model
 */
@ObjectType()
export class ExpenditureModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  committeeId!: string;

  @Field()
  payeeName!: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  date!: Date;

  @Field({ nullable: true })
  purposeDescription?: string;

  @Field({ nullable: true })
  expenditureCode?: string;

  @Field({ nullable: true })
  candidateName?: string;

  @Field({ nullable: true })
  propositionTitle?: string;

  @Field({ nullable: true })
  supportOrOppose?: string;

  @Field()
  sourceSystem!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

/**
 * Paginated expenditures response
 */
@ObjectType()
export class PaginatedExpenditures {
  @Field(() => [ExpenditureModel])
  items!: ExpenditureModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
