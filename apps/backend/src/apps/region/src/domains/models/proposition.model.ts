import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import {
  ExistingVsProposedModel,
  PropositionAnalysisClaimModel,
  PropositionAnalysisSectionModel,
} from './proposition-analysis.model';

/**
 * Proposition status enum for GraphQL
 */
export enum PropositionStatusGQL {
  PENDING = 'pending',
  PASSED = 'passed',
  FAILED = 'failed',
  WITHDRAWN = 'withdrawn',
}

registerEnumType(PropositionStatusGQL, {
  name: 'PropositionStatus',
  description: 'The status of a proposition',
});

/**
 * Proposition GraphQL model
 */
@ObjectType()
export class PropositionModel {
  @Field(() => ID)
  id!: string;

  @Field()
  externalId!: string;

  @Field()
  title!: string;

  @Field()
  summary!: string;

  @Field({ nullable: true })
  fullText?: string;

  @Field(() => PropositionStatusGQL)
  status!: PropositionStatusGQL;

  @Field({ nullable: true })
  electionDate?: Date;

  /**
   * Which jurisdiction's sync wrote this row — "california" for statewide
   * measures, "california-sonoma" for a county's own.
   *
   * Written by propositions-sync.service since the 2026-09-07 migration and
   * populated for every row, but never exposed: county measures were
   * ingested and unreachable, so surfaces that wanted them had to say "in
   * the data, not yet listed". Nullable because the column is, and a row
   * predating the migration should read as unknown rather than as
   * statewide (#1202).
   */
  @Field({ nullable: true })
  regionPluginName?: string;

  @Field({ nullable: true })
  sourceUrl?: string;

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

  @Field(() => ExistingVsProposedModel, { nullable: true })
  existingVsProposed?: ExistingVsProposedModel;

  @Field(() => [PropositionAnalysisSectionModel], { nullable: true })
  analysisSections?: PropositionAnalysisSectionModel[];

  @Field(() => [PropositionAnalysisClaimModel], { nullable: true })
  analysisClaims?: PropositionAnalysisClaimModel[];

  @Field({ nullable: true })
  analysisSource?: string;

  @Field({ nullable: true })
  analysisGeneratedAt?: Date;

  @Field({ nullable: true })
  lifecycleStageId?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

/**
 * Paginated propositions response
 */
@ObjectType()
export class PaginatedPropositions {
  @Field(() => [PropositionModel])
  items!: PropositionModel[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}
