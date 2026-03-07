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
