import {
  Field,
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
