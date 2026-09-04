import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

/**
 * The cheapest county adjacent to this one, by signatures required.
 *
 * Adjacency comes from `county_adjacency`, materialized from the loaded
 * county geometry rather than a published adjacency list, so it cannot
 * disagree with the polygons the map draws.
 */
@ObjectType({
  description:
    'The adjacent county with the lowest signature requirement. Null only if a county touches no other, which no California county does.',
})
export class CheapestNeighborModel {
  @Field(() => String, { description: 'County FIPS code.' })
  fips!: string;

  @Field(() => String, { description: 'County display name.' })
  name!: string;

  @Field(() => Int, {
    description: 'Signatures required in that neighbour — ceil(votes * 0.10).',
  })
  signaturesRequired!: number;
}

/**
 * One county's signature threshold for a county initiative.
 *
 * Elections Code §9118 sets the requirement at 10% of the votes cast for
 * ALL gubernatorial candidates at the last gubernatorial general — not the
 * winner's total, and not registered voters.
 *
 * Public records only. This type must never gain a field that joins to user,
 * signup or activation data (epic #1105, criterion 9): the whole point of the
 * landing page is that it needs no session, so a field requiring one would
 * either leak or break it.
 *
 * Geometry is deliberately absent. It is ~60-80KB, identical for every
 * visitor and changes at most once a decade, so it ships as a static
 * TopoJSON asset rather than through a query that would re-send it per request.
 */
@ObjectType({
  description:
    "A county's signature threshold for a county initiative under California Elections Code §9118, with the public records it derives from.",
})
export class CountyThresholdModel {
  @Field(() => String, { description: 'County FIPS code.' })
  fips!: string;

  @Field(() => String, { description: 'County display name.' })
  name!: string;

  @Field(() => Int, {
    description:
      "Votes cast for ALL gubernatorial candidates at the last gubernatorial general — the §9118 denominator, NOT the winner's total.",
  })
  gubernatorialVotes!: number;

  @Field(() => Int, {
    description: 'Election year the vote total describes.',
  })
  gubernatorialYear!: number;

  @Field(() => Int, {
    nullable: true,
    description: 'Registered voters, for context. Never the §9118 basis.',
  })
  registeredVoters?: number | null;

  @Field(() => Int, { nullable: true, description: 'County population.' })
  population?: number | null;

  @Field(() => Int, {
    description:
      'ceil(gubernatorialVotes * 0.10). Derived per request, never stored, so it cannot drift from the votes it describes. Rounded UP — a fractional signature is not a thing, and rounding down would understate a legal requirement.',
  })
  signaturesRequired!: number;

  @Field(() => Float, {
    nullable: true,
    description:
      'signaturesRequired / registeredVoters, as a fraction. Null when registration is unknown. Context only — the legal basis is the vote total.',
  })
  shareOfRegistered?: number | null;

  @Field(() => Int, {
    description:
      'Rank by signaturesRequired, 1 = fewest signatures. Ties share the lower rank.',
  })
  rank!: number;

  @Field(() => CheapestNeighborModel, {
    nullable: true,
    description: 'Adjacent county with the lowest signature requirement.',
  })
  cheapestNeighbor?: CheapestNeighborModel | null;

  @Field(() => String, {
    description:
      'The record this row derives from. Part of the contract, not decoration — a reader must be able to check the figure themselves.',
  })
  sourceUrl!: string;

  @Field(() => Date, { description: 'When the source was last read.' })
  retrievedAt!: Date;
}
