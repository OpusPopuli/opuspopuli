import {
  Field,
  Float,
  ObjectType,
  InputType,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { IsUUID, IsBoolean, IsOptional } from 'class-validator';
import { DocumentType } from '@opuspopuli/relationaldb-provider';

// Register DocumentType enum for GraphQL
registerEnumType(DocumentType, {
  name: 'DocumentType',
  description: 'Type of document for analysis routing',
});

/**
 * Source provenance for an analysis data source (#423)
 */
@ObjectType()
export class AnalysisSource {
  @Field()
  name!: string;

  @Field({ nullable: true })
  url?: string;

  @Field()
  accessedAt!: string;

  @Field(() => Float)
  dataCompleteness!: number;
}

/**
 * Data completeness details for an analysis (#425)
 */
@ObjectType()
export class CompletenessDetails {
  @Field(() => Int)
  availableCount!: number;

  @Field(() => Int)
  idealCount!: number;

  @Field(() => [String])
  missingItems!: string[];

  @Field()
  explanation!: string;
}

/**
 * Analysis result for all document types
 * Common fields are always present; type-specific fields are nullable
 */
@ObjectType()
export class DocumentAnalysis {
  // Common fields (all document types)
  @Field(() => DocumentType)
  documentType!: DocumentType;

  @Field()
  summary!: string;

  @Field(() => [String])
  keyPoints!: string[];

  @Field(() => [String])
  entities!: string[];

  @Field()
  analyzedAt!: Date;

  @Field()
  provider!: string;

  @Field()
  model!: string;

  @Field(() => Int, { nullable: true })
  tokensUsed?: number;

  @Field(() => Int)
  processingTimeMs!: number;

  @Field({ nullable: true })
  cachedFrom?: string;

  // Prompt provenance (#424)
  @Field({ nullable: true })
  promptVersion?: string;

  @Field({ nullable: true })
  promptHash?: string;

  // Source provenance (#423)
  @Field(() => [AnalysisSource], { nullable: true })
  sources?: AnalysisSource[];

  // Data completeness (#425)
  @Field(() => Int, { nullable: true })
  completenessScore?: number;

  @Field(() => CompletenessDetails, { nullable: true })
  completenessDetails?: CompletenessDetails;

  // Petition/Proposition fields
  @Field({ nullable: true })
  actualEffect?: string;

  @Field(() => [String], { nullable: true })
  potentialConcerns?: string[];

  @Field(() => [String], { nullable: true })
  beneficiaries?: string[];

  @Field(() => [String], { nullable: true })
  potentiallyHarmed?: string[];

  @Field(() => [String], { nullable: true })
  relatedMeasures?: string[];

  // Contract fields
  @Field(() => [String], { nullable: true })
  parties?: string[];

  @Field(() => [String], { nullable: true })
  obligations?: string[];

  @Field(() => [String], { nullable: true })
  risks?: string[];

  @Field({ nullable: true })
  effectiveDate?: string;

  @Field({ nullable: true })
  terminationClause?: string;

  // Form fields
  @Field(() => [String], { nullable: true })
  requiredFields?: string[];

  @Field({ nullable: true })
  purpose?: string;

  @Field({ nullable: true })
  submissionDeadline?: string;
}

/**
 * Input for analyzing a document
 */
@InputType()
export class AnalyzeDocumentInput {
  @Field()
  @IsUUID()
  documentId!: string;

  @Field({ nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  forceReanalyze?: boolean;
}

/**
 * Result of document analysis operation
 */
@ObjectType()
export class AnalyzeDocumentResult {
  @Field(() => DocumentAnalysis)
  analysis!: DocumentAnalysis;

  @Field()
  fromCache!: boolean;
}
