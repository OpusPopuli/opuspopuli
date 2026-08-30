import { Field, Float, ID, InputType, ObjectType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@ObjectType()
export class LinkedProposition {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  propositionId!: string;

  @Field()
  title!: string;

  @Field()
  summary!: string;

  @Field()
  status!: string;

  @Field({ nullable: true })
  electionDate?: Date;

  /**
   * The filing's OWN analysis, generated from its authoritative full text
   * (#1074 Phase B) — not a re-analysis of the photograph.
   *
   * This is the point of verifying a scan: it shows the reader what the filed
   * measure actually says, which is not necessarily what the sheet in front of
   * them says. It also keeps the scan surface consistent with
   * /region/propositions, which renders the same analysis — without this the
   * same measure would carry two different AI readings depending on where you
   * met it.
   *
   * All nullable: 8 of 52 propositions currently have no analysis at all, and a
   * verified match to one of those must fall back to the photo-derived
   * analysis rather than render an empty panel.
   */
  @Field({ nullable: true })
  analysisSummary?: string;

  @Field(() => [String], { nullable: true })
  keyProvisions?: string[];

  @Field({ nullable: true })
  fiscalImpact?: string;

  @Field({ nullable: true })
  yesOutcome?: string;

  @Field({ nullable: true })
  noOutcome?: string;

  @Field({ nullable: true })
  analysisGeneratedAt?: Date;

  @Field()
  linkSource!: string;

  @Field(() => Float, { nullable: true })
  confidence?: number;

  @Field({ nullable: true })
  matchedText?: string;

  @Field()
  linkedAt!: Date;
}

@ObjectType()
export class LinkedPetitionDocument {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  documentId!: string;

  @Field()
  summary!: string;

  @Field()
  linkSource!: string;

  @Field(() => Float, { nullable: true })
  confidence?: number;

  @Field()
  linkedAt!: Date;
}

@ObjectType()
export class PropositionSearchResult {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field()
  externalId!: string;

  @Field()
  status!: string;
}

@InputType()
export class LinkDocumentToPropositionInput {
  @Field()
  @IsUUID()
  documentId!: string;

  @Field()
  @IsUUID()
  propositionId!: string;
}

@InputType()
export class UnlinkDocumentFromPropositionInput {
  @Field()
  @IsUUID()
  documentId!: string;

  @Field()
  @IsUUID()
  propositionId!: string;
}

@ObjectType()
export class LinkDocumentResult {
  @Field()
  success!: boolean;

  @Field(() => ID, { nullable: true })
  linkId?: string;
}
