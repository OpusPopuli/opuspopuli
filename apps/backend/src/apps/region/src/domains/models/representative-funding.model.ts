import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * Campaign-finance surface for a representative (#943, epic #936). Aggregates
 * contributions/expenditures across the committees linked to this rep by the
 * candidate-committee linker (#941). The "follow the money" view.
 */

@ObjectType()
export class FinanceTopDonorModel {
  @Field()
  donorName!: string;

  @Field(() => Float)
  totalAmount!: number;

  @Field(() => Int)
  contributionCount!: number;
}

/** Aggregated giving by donor employer — the industry / conflict-of-interest lens. */
@ObjectType()
export class FinanceTopEmployerModel {
  @Field()
  employer!: string;

  @Field(() => Float)
  totalAmount!: number;

  @Field(() => Int)
  contributionCount!: number;
}

@ObjectType()
export class RepFundingCommitteeModel {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => Float)
  totalRaised!: number;
}

@ObjectType()
export class RepresentativeFundingModel {
  @Field(() => ID)
  representativeId!: string;

  @Field()
  asOf!: Date;

  @Field(() => Float)
  totalRaised!: number;

  @Field(() => Float)
  totalSpent!: number;

  @Field(() => Int)
  donorCount!: number;

  @Field(() => Int)
  committeeCount!: number;

  @Field(() => [FinanceTopDonorModel])
  topDonors!: FinanceTopDonorModel[];

  @Field(() => [FinanceTopEmployerModel])
  topEmployers!: FinanceTopEmployerModel[];

  @Field(() => [RepFundingCommitteeModel])
  committees!: RepFundingCommitteeModel[];
}
