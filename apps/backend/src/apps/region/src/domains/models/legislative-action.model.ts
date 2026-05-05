import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * One discrete legislative action — a presence roll, committee
 * hearing/report, amendment, engrossment/enrollment, or resolution
 * extracted from a Minutes document. See
 * `LegislativeActionLinkerService` for the production logic that
 * mints these from `Minutes.rawText`. Issue #665.
 *
 * Char-offsets `passageStart` / `passageEnd` point back into the
 * parent Minutes' rawText so the UI can render the verbatim
 * passage in citation/quote affordances.
 */
@ObjectType()
export class LegislativeActionModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  body!: string;

  @Field()
  date!: Date;

  /**
   * One of: 'presence' | 'committee_hearing' | 'committee_report' |
   * 'amendment' | 'engrossment' | 'enrollment' | 'resolution' |
   * 'vote' (V2) | 'speech' (V2). Kept as a string so V2 additions
   * don't require a schema change.
   */
  @Field()
  actionType!: string;

  /** 'yes' | 'no' | 'abstain' | 'absent' — null for non-vote actions in V1. */
  @Field({ nullable: true })
  position?: string;

  /** Verbatim source excerpt (capped 4kB at write time). */
  @Field({ nullable: true })
  text?: string;

  /** Inclusive char offset into the parent Minutes' rawText. */
  @Field(() => Int, { nullable: true })
  passageStart?: number;

  /** Exclusive char offset into the parent Minutes' rawText. */
  @Field(() => Int, { nullable: true })
  passageEnd?: number;

  /**
   * Pre-link source text — surname / "Assembly Bill No. N" /
   * committee name. Useful in the UI when an FK couldn't be
   * resolved (e.g. multi-match surname collision).
   */
  @Field({ nullable: true })
  rawSubject?: string;

  @Field(() => ID, { nullable: true })
  representativeId?: string;

  @Field(() => ID, { nullable: true })
  propositionId?: string;

  @Field(() => ID, { nullable: true })
  committeeId?: string;

  @Field(() => ID)
  minutesId!: string;

  /**
   * Denormalized so the frontend can deep-link to
   * `/minutes/<externalId>#passage-<start>-<end>` without an
   * extra fetch.
   */
  @Field()
  minutesExternalId!: string;
}

/**
 * At-a-glance counters for the rep detail page Layer 3 ("What
 * They've Done"). Counts are scoped to a configurable `sinceDays`
 * window (default 90 days). Issue #665.
 */
@ObjectType()
export class RepresentativeActivityStatsModel {
  /**
   * Number of distinct session days where the rep was recorded
   * present (`actionType='presence' AND position='yes'`).
   */
  @Field(() => Int)
  presentSessionDays!: number;

  /**
   * Total distinct session days observed in the window across all
   * Minutes for this rep's chamber. `presentSessionDays /
   * totalSessionDays` is the attendance rate.
   */
  @Field(() => Int)
  totalSessionDays!: number;

  /** Distinct days with at least one absence-with-reason record. */
  @Field(() => Int)
  absenceDays!: number;

  /** Floor + committee amendments authored by this rep. */
  @Field(() => Int)
  amendments!: number;

  /** Hearings linked via committee where this rep is the chair. */
  @Field(() => Int)
  committeeHearings!: number;

  /** Per-bill verdicts where this rep's chaired committee was the reporter. */
  @Field(() => Int)
  committeeReports!: number;

  /** Resolutions introduced (V1: heuristic match on raw text; refined when bill-FK lands). */
  @Field(() => Int)
  resolutions!: number;

  /** V2 — per-rep-per-bill votes; always 0 in V1. */
  @Field(() => Int)
  votes!: number;

  /** V2 — floor speeches; always 0 in V1. */
  @Field(() => Int)
  speeches!: number;
}

@ObjectType()
export class PaginatedLegislativeActions {
  @Field(() => [LegislativeActionModel])
  items!: LegislativeActionModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}

/**
 * The verbatim passage text from a Minutes document for a single
 * action, used by the L4 quote panel + citizen letter-cite flow.
 *
 * Returned by `minutesPassage(actionId)`. The `passageText` is
 * `rawText.slice(passageStart, passageEnd)` capped at 1kB; longer
 * slices truncate at a word boundary. `sectionContext` is an
 * optional ~500-char snippet around the passage for visual context
 * (faded above/below the highlighted quote in the UI).
 */
@ObjectType()
export class MinutesPassageModel {
  @Field(() => ID)
  actionId!: string;

  @Field()
  minutesExternalId!: string;

  @Field()
  body!: string;

  @Field()
  date!: Date;

  @Field()
  sourceUrl!: string;

  @Field(() => Int)
  passageStart!: number;

  @Field(() => Int)
  passageEnd!: number;

  @Field()
  passageText!: string;

  @Field({ nullable: true })
  sectionContext?: string;
}
