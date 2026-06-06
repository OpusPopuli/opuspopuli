import { Field, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * Why a boundary load short-circuited without fetching. Mirrors the
 * runtime literal-union on BoundaryLoadResult.skipped — when a real load
 * runs, the GraphQL field is null and `counts` carries the per-row tally.
 *
 * Values intentionally match the strings the loader uses internally so a
 * direct passthrough is correct; if you rename here, rename in the service
 * literal-union too.
 */
export enum BoundarySkipReason {
  NO_ACTIVE_PLUGIN = 'no-active-plugin',
  NO_BOUNDARY_SOURCES = 'no-boundary-sources',
  ALREADY_POPULATED = 'already-populated',
}
registerEnumType(BoundarySkipReason, {
  name: 'BoundarySkipReason',
  description:
    'Reason a refreshBoundaries call short-circuited without fetching. Null when the load actually ran (counts populated instead).',
});

@ObjectType({
  description: 'Per-row tally for one boundary-load run.',
})
export class BoundaryLoadCountsModel {
  @Field(() => Int, {
    description:
      'Rows already present in jurisdictions before this run. Stable across re-runs of the same region.',
  })
  existing!: number;

  @Field(() => Int, {
    description: 'Rows successfully inserted or updated this run.',
  })
  upserted!: number;

  @Field(() => Int, {
    description: 'Rows that errored during upsert (per-row try/catch).',
  })
  failed!: number;

  @Field(() => Int, {
    description:
      "Rows the fetchers returned without a fipsCode AND without an ocdId — can't be upserted because there's no idempotency key. Counted but not retried.",
  })
  missingKey!: number;
}

@ObjectType({
  description:
    'Outcome of a refreshBoundaries call. Either `skipped` is set (no fetch happened) or counts.upserted reflects the post-fetch persistence tally.',
})
export class BoundaryLoadResultModel {
  @Field(() => Boolean, {
    description:
      'True when every upsertable row landed cleanly (counts.failed === 0). False when one or more rows errored mid-upsert. Skips (counts.failed === 0 by definition) also report ok=true. Use this as a single boolean alarm signal — counts.failed gives the detail.',
  })
  ok!: boolean;

  @Field(() => BoundarySkipReason, { nullable: true })
  skipped?: BoundarySkipReason;

  @Field(() => BoundaryLoadCountsModel)
  counts!: BoundaryLoadCountsModel;
}
