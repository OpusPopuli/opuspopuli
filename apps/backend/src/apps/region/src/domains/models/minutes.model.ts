import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * Kind of claim surfaced from a minutes AI synopsis. Values map to the
 * lowercase strings stored in `minutes.summary_claims` (#813).
 */
export enum MinutesClaimKindGQL {
  DECISION = 'decision',
  CONCERN = 'concern',
  CONTROVERSY = 'controversy',
  PUBLIC_COMMENT = 'public_comment',
  DISCLOSURE = 'disclosure',
}

registerEnumType(MinutesClaimKindGQL, {
  name: 'MinutesClaimKind',
  description: 'Category of a minutes summary claim',
});

/** Severity for `concern` / `controversy` claim kinds. */
export enum ClaimSeverityGQL {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

registerEnumType(ClaimSeverityGQL, {
  name: 'ClaimSeverity',
  description: 'Severity of a flagged minutes concern',
});

/**
 * Citation anchoring a claim back into the minutes source text.
 */
@ObjectType()
export class MinutesSummaryCitationModel {
  /** Optional page/section hint from the PDF, e.g. "p. 12". */
  @Field({ nullable: true })
  pageHint?: string;

  /** Verbatim supporting quote from the minutes text. */
  @Field({ nullable: true })
  quote?: string;
}

/**
 * A structured decision or flagged concern extracted from a minutes
 * document by the MinutesSummaryService (#813). Rendered as a per-meeting
 * concern badge + synopsis panel on the frontend.
 */
@ObjectType()
export class MinutesSummaryClaimModel {
  @Field(() => MinutesClaimKindGQL)
  kind!: MinutesClaimKindGQL;

  /** Short headline, e.g. "Voted 5-2 to advance AB 1234". */
  @Field()
  title!: string;

  /** 1–2 sentence plain-language context. */
  @Field()
  detail!: string;

  @Field(() => MinutesSummaryCitationModel)
  citation!: MinutesSummaryCitationModel;

  /** External IDs of bills referenced (links to bill data). */
  @Field(() => [String])
  billRefs!: string[];

  @Field(() => ClaimSeverityGQL, { nullable: true })
  severity?: ClaimSeverityGQL;
}

/**
 * A meeting-minutes / journal document with its AI synopsis + claims.
 * `summary`/`claims` are null/empty until MinutesSummaryService runs (#813).
 * Linking minutes to a Meeting is a separate follow-up.
 */
@ObjectType()
export class MinutesModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  /** "Assembly" | "Senate". */
  @Field()
  body!: string;

  @Field()
  date!: Date;

  /** Plain-English synopsis — null until generated. */
  @Field({ nullable: true })
  summary?: string;

  /** Structured decisions + flagged concerns — empty until generated. */
  @Field(() => [MinutesSummaryClaimModel])
  claims!: MinutesSummaryClaimModel[];

  @Field()
  sourceUrl!: string;

  @Field(() => Int, { nullable: true })
  pageCount?: number;

  @Field({ nullable: true })
  parsedAt?: Date;
}

/**
 * A page of minutes for list queries.
 */
@ObjectType()
export class PaginatedMinutes {
  @Field(() => [MinutesModel])
  items!: MinutesModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
