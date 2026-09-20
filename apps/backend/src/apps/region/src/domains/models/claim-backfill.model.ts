import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * How many pieces of evidence hold each verdict, across the whole corpus.
 *
 * Read back from `evidence.state` rather than accumulated while writing
 * (#1294). A backfill that reports on itself can report success it did not
 * achieve; a query over what was stored cannot.
 */
@ObjectType()
export class EvidenceDistributionModel {
  /** Citation located and supporting its claim. */
  @Field(() => Int)
  verified!: number;

  /** Quote found somewhere other than the span it named, and corrected. */
  @Field(() => Int)
  snapped!: number;

  /** A citation was offered and it did not hold up. */
  @Field(() => Int)
  unverified!: number;

  /**
   * No citation was ever offered — `bio_claims`' `origin: 'training'`.
   *
   * Deliberately not merged into `unverified`: one is a claim whose citation
   * failed a check, the other a claim that never made one, and #1208 requires
   * that difference to survive.
   */
  @Field(() => Int)
  unsourced!: number;
}

/** Result of backfilling the legacy claim blobs into the evidence graph. */
@ObjectType()
export class ClaimBackfillResultModel {
  @Field(() => Int)
  propositions!: number;

  @Field(() => Int)
  minutes!: number;

  @Field(() => Int)
  representatives!: number;

  @Field(() => Int)
  claimsWritten!: number;

  /**
   * Rows that threw and were skipped.
   *
   * Surfaced alongside the distribution because that number cannot reveal it:
   * it is a query over what was stored, so a partial run produces a total that
   * is internally consistent and reads exactly like a complete one.
   */
  @Field(() => Int)
  failed!: number;

  @Field(() => EvidenceDistributionModel)
  distribution!: EvidenceDistributionModel;
}
