import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

/**
 * What a funding total rests on (#991). See `FundingBasis` in
 * `funding-basis.service.ts` for the full semantics; the short version:
 *
 * - `undated*` / `unattributed*` — money that IS in `totalSpent` and that we
 *   cannot fully describe. These two can overlap (a row missing both) and
 *   **must never be summed**.
 * - `unitemized*` — money that is NOT in `totalRaised` at all, reported only
 *   on a Form 460 summary line.
 *
 * Every field is required, including the zeros. A surface that only receives
 * this object when something is wrong cannot distinguish "nothing undated"
 * from "nobody asked", and the UI rule is that a total never ships without
 * its basis.
 */
@ObjectType()
export class FundingBasisModel {
  @Field(() => Float, {
    description: 'Amount inside totalSpent whose spend date is unreported.',
  })
  undatedAmount!: number;

  @Field(() => Int)
  undatedCount!: number;

  @Field(() => Float, {
    description: 'Amount inside totalSpent whose payee is unreported.',
  })
  unattributedAmount!: number;

  @Field(() => Int)
  unattributedCount!: number;

  @Field(() => Float, {
    description:
      'Contributions reported in aggregate with no detail rows, and therefore ABSENT from totalRaised.',
  })
  unitemizedAmount!: number;

  @Field(() => Int, {
    description:
      'How many filings here were reconciled against their summary totals. Zero makes unitemizedAmount ambiguous: it then means "never checked", not "nothing hidden".',
  })
  reconciledFilings!: number;

  @Field({
    nullable: true,
    description:
      'last-modified of the bulk export behind these figures. Null when unrecorded — our own sync time is a different fact and is not substituted.',
  })
  asOfSource?: Date;

  @Field({
    description:
      'False when these numbers were not computed at all. The zeros then mean "nobody looked", not "nothing is missing", and the surface must not present the total as fully described.',
  })
  measured!: boolean;
}
