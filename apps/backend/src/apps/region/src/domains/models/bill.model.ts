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
