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

  /** Nullable (#991): blank on 3,811,692 rows carrying $2.11B. */
  @Field({ nullable: true })
  payeeName?: string;

  @Field(() => Float)
  amount!: number;

  /**
   * Nullable (#991). Blank on 5,232,951 EXPN_CD rows carrying $9.75B, which
   * were rejected outright until those rows were admitted. Left non-null, a
   * single undated row errors the ENTIRE query rather than blanking one field.
   */
  @Field({ nullable: true })
  date?: Date;

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
