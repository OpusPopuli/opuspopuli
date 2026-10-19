import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

/**
 * GraphQL shapes for the standalone post-sync triggers (#1000).
 *
 * These mirror `SupersessionResult` and `ReconciliationSummary` verbatim rather
 * than summarising them. The counts are the whole point of invoking a step by
 * hand: a corrective run that reports only "ok" tells an operator nothing about
 * whether it did what they expected.
 */

/** What supersession removed from one amendable table. */
@ObjectType()
export class SupersessionTableResultModel {
  /** Rows removed because a higher `amend_id` exists for the same filing. */
  @Field(() => Int)
  superseded!: number;

  /** Filings that carried more than one amendment version. */
  @Field(() => Int)
  filingsAffected!: number;
}

/** What supersession removed, per table. */
@ObjectType()
export class SupersessionResultModel {
  @Field(() => SupersessionTableResultModel)
  contributions!: SupersessionTableResultModel;

  @Field(() => SupersessionTableResultModel)
  expenditures!: SupersessionTableResultModel;
}

/** Filing-level agreement between itemized detail and the filer's own summary. */
@ObjectType()
export class ReconciliationSummaryModel {
  /** Filings written. */
  @Field(() => Int)
  reconciled!: number;

  /**
   * Filings whose detail exceeds the committee's own reported contributions.
   *
   * A fault condition, and the figure #1000 found served 14x too high from a
   * stale table (7,140 against a true 515). Check it after any run.
   */
  @Field(() => Int)
  overItemizedContributions!: number;

  /** Same, for expenditures — the independent check #991 lacks. */
  @Field(() => Int)
  overItemizedExpenditures!: number;

  /** Filings carrying unitemized (<$100) contributions. */
  @Field(() => Int)
  withUnitemized!: number;

  /** Total unitemized contribution money made visible. */
  @Field(() => Float)
  unitemizedTotal!: number;

  /** Filings skipped because their detail rows carry no schedule. */
  @Field(() => Int)
  unknownSchedule!: number;

  /**
   * Filings skipped because the summary and the detail are different
   * amendments, so no comparison between them is valid (#1376).
   */
  @Field(() => Int)
  versionMismatch!: number;
}

/**
 * Result of `supersedeAmendments`.
 *
 * Carries both halves because the mutation runs both: supersession can
 * invalidate every stored verdict, so reconciliation is re-run in the same call
 * rather than left for someone to remember (#1000).
 */
@ObjectType()
export class SupersedeAmendmentsResultModel {
  @Field(() => SupersessionResultModel)
  supersession!: SupersessionResultModel;

  /** Recomputed after supersession, never carried over from before it. */
  @Field(() => ReconciliationSummaryModel)
  reconciliation!: ReconciliationSummaryModel;
}
