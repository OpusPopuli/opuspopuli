import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType('BillVote')
export class BillVoteModel {
  @Field(() => ID)
  id!: string;

  @Field()
  representativeName!: string;

  @Field({ nullable: true })
  representativeId?: string;

  @Field()
  chamber!: string;

  @Field()
  voteDate!: Date;

  /** yes | no | abstain | absent | excused | no_vote */
  @Field()
  position!: string;

  @Field({ nullable: true })
  motionText?: string;

  @Field()
  sourceUrl!: string;
}

@ObjectType('BillCoAuthor')
export class BillCoAuthorModel {
  @Field(() => ID, { nullable: true })
  representativeId?: string;

  /** Representative's display name. */
  @Field()
  name!: string;

  /** Co-author role. Currently always "coauthor" — principal/coauthor
   *  distinction requires LLM prompt + Bill interface update (#686). */
  @Field({ nullable: true })
  coAuthorType?: string;
}

@ObjectType('BillFiscalImpact')
export class BillFiscalImpactModel {
  /** Normalized fiscal-impact magnitude: none | low | medium | high. */
  @Field()
  level!: string;

  /** One-sentence description of the fiscal effect, paraphrased from the
   *  official fiscal analysis when available. */
  @Field()
  summary!: string;
}

/**
 * Structured AI summary for the personalized bill feed (epic #740,
 * this issue #741). Produced by the bill-analysis prompt-service
 * endpoint and consumed by the ranking pipeline (#743) and the
 * briefing feed UI (#744). The controlled vocabularies for `topics`
 * and `whoItAffects` align with the user-profile schema (#742).
 */
@ObjectType('BillAiSummary')
export class BillAiSummaryModel {
  /** 2-3 sentence plain-English summary a non-lawyer can understand. */
  @Field()
  plainEnglishSummary!: string;

  /** Controlled-vocabulary topic tags (e.g. "housing", "healthcare"). */
  @Field(() => [String])
  topics!: string[];

  /** Controlled-vocabulary stakeholder tags (e.g. "renters", "parents"). */
  @Field(() => [String])
  whoItAffects!: string[];

  @Field(() => BillFiscalImpactModel)
  fiscalImpact!: BillFiscalImpactModel;

  /** One-sentence stakeholder impact note. */
  @Field()
  stakeholderImpact!: string;
}

@ObjectType('Bill')
export class BillModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  billNumber!: string;

  @Field()
  sessionYear!: string;

  @Field()
  measureTypeCode!: string;

  @Field()
  title!: string;

  @Field({ nullable: true })
  subject?: string;

  @Field({ nullable: true })
  status?: string;

  @Field({ nullable: true })
  currentStageId?: string;

  @Field({ nullable: true })
  lastAction?: string;

  @Field({ nullable: true })
  lastActionDate?: Date;

  @Field({ nullable: true })
  fiscalImpact?: string;

  @Field({ nullable: true })
  fullTextUrl?: string;

  @Field({ nullable: true })
  authorId?: string;

  @Field({ nullable: true })
  authorName?: string;

  @Field()
  sourceUrl!: string;

  @Field()
  extractedAt!: Date;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field(() => [BillVoteModel])
  votes!: BillVoteModel[];

  @Field(() => [BillCoAuthorModel])
  coAuthors!: BillCoAuthorModel[];

  /** Null when the bill has not yet been enriched or when the LLM emitted
   *  `{ skip: true }` (input was garbled / not-a-bill). See #741. */
  @Field(() => BillAiSummaryModel, { nullable: true })
  aiSummary?: BillAiSummaryModel;
}

@ObjectType('PaginatedBills')
export class PaginatedBillsModel {
  @Field(() => [BillModel])
  items!: BillModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
