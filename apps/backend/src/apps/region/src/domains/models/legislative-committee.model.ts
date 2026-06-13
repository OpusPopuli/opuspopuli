import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * Compact summary used by the list page + by the detail page's header.
 * memberCount is the size of the assignments join.
 */
@ObjectType()
export class LegislativeCommitteeModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  name!: string;

  @Field()
  chamber!: string;

  @Field({ nullable: true })
  url?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Int)
  memberCount!: number;

  /**
   * LLM-written one-sentence "why this committee matters to you"
   * (opuspopuli#836). Populated by the
   * `LegislativeCommitteeRelevanceFieldResolver` from the per-user
   * `committee_relevance_cache` row keyed by (userId, legislativeCommitteeId).
   * Null when the nightly batch hasn't run yet for this user, the LLM
   * declined (skip:true), or the validator rejected the output —
   * frontend's WhyThisPanel falls back to a heuristic display.
   */
  @Field({ nullable: true })
  relevanceExplanation?: string;
}

@ObjectType()
export class LegislativeCommitteeMemberModel {
  @Field(() => ID)
  representativeId!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  role?: string;

  @Field({ nullable: true })
  party?: string;

  @Field({ nullable: true })
  photoUrl?: string;
}

@ObjectType()
export class LegislativeCommitteeHearingModel {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field()
  scheduledAt!: Date;

  @Field({ nullable: true })
  agendaUrl?: string;
}

/**
 * Detail shape returned by the legislativeCommittee(id) query — the
 * committee summary plus pre-resolved members and recent hearings.
 */
@ObjectType()
export class LegislativeCommitteeDetailModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  name!: string;

  @Field()
  chamber!: string;

  @Field({ nullable: true })
  url?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Int)
  memberCount!: number;

  @Field(() => [LegislativeCommitteeMemberModel])
  members!: LegislativeCommitteeMemberModel[];

  @Field(() => [LegislativeCommitteeHearingModel])
  hearings!: LegislativeCommitteeHearingModel[];

  /** AI-generated 2-3 sentence summary of recent committee activity. Issue #665. */
  @Field({ nullable: true })
  activitySummary?: string;

  @Field({ nullable: true })
  activitySummaryGeneratedAt?: Date;

  @Field({ nullable: true })
  activitySummaryWindowDays?: number;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  /**
   * LLM-written one-sentence "why this committee matters to you"
   * (opuspopuli#836). See LegislativeCommitteeModel.relevanceExplanation
   * for the resolver wiring.
   */
  @Field({ nullable: true })
  relevanceExplanation?: string;
}

@ObjectType()
export class PaginatedLegislativeCommittees {
  @Field(() => [LegislativeCommitteeModel])
  items!: LegislativeCommitteeModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
