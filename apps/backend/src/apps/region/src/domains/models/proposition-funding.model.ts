import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * A single donor's aggregated giving to one side of a measure.
 * Grouped by donor name with names normalized at aggregation time.
 */
@ObjectType()
export class TopDonorModel {
  @Field()
  donorName!: string;

  @Field(() => Float)
  totalAmount!: number;

  @Field(() => Int)
  contributionCount!: number;
}

/**
 * Compact summary of a primarily-formed committee for a measure: enough
 * for the funding section to render a clickable name with a money figure
 * without a second round-trip.
 */
@ObjectType()
export class CommitteeSummaryModel {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field(() => Float)
  totalRaised!: number;
}

/**
 * Funding totals for one side of a ballot measure (support OR oppose).
 * `totalRaised` includes contributions to all committees declaring this
 * position plus independent expenditures targeting the measure with this
 * support/oppose code. `totalSpent` mirrors that scope for outflows.
 *
 * NOTE on multi-measure attribution: when a committee has positions on
 * multiple measures, each measure's `totalRaised` includes the full
 * contribution amount — i.e. we don't fractionally split contributions
 * across measures yet. UI surfaces `committeeCount` so readers can see
 * when a side is concentrated in a few primarily-formed committees vs.
 * spread across general-purpose ones.
 */
@ObjectType()
export class SidedFundingModel {
  @Field(() => Float)
  totalRaised!: number;

  @Field(() => Float)
  totalSpent!: number;

  @Field(() => Int)
  donorCount!: number;

  @Field(() => Int)
  committeeCount!: number;

  @Field(() => [TopDonorModel])
  topDonors!: TopDonorModel[];

  @Field(() => [CommitteeSummaryModel])
  primaryCommittees!: CommitteeSummaryModel[];
}

/**
 * Aggregated funding for a single proposition: support + oppose sides,
 * each summarized. `asOf` is the wall-clock time the aggregation was
 * computed (cache key) so the UI can show an "as of" timestamp.
 */
@ObjectType()
export class PropositionFundingModel {
  @Field(() => ID)
  propositionId!: string;

  @Field()
  asOf!: Date;

  @Field(() => SidedFundingModel)
  support!: SidedFundingModel;

  @Field(() => SidedFundingModel)
  oppose!: SidedFundingModel;
}
