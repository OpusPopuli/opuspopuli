import { Field, Float, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsOptional, IsDateString } from 'class-validator';
import { DocumentAnalysis } from './analysis.dto';

@ObjectType()
export class ScanHistoryItem {
  @Field(() => ID)
  id!: string;

  @Field()
  type!: string;

  @Field()
  status!: string;

  @Field({ nullable: true })
  summary?: string;

  @Field(() => Float, { nullable: true })
  ocrConfidence?: number;

  @Field()
  hasAnalysis!: boolean;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class PaginatedScanHistory {
  @Field(() => [ScanHistoryItem])
  items!: ScanHistoryItem[];

  @Field(() => Int)
  total!: number;

  @Field()
  hasMore!: boolean;
}

@InputType()
export class ScanHistoryFiltersInput {
  @Field({ nullable: true })
  @IsOptional()
  search?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

@ObjectType()
export class ScanDetailResult {
  @Field(() => ID)
  id!: string;

  @Field()
  type!: string;

  @Field()
  status!: string;

  @Field({ nullable: true })
  extractedText?: string;

  @Field(() => Float, { nullable: true })
  ocrConfidence?: number;

  @Field({ nullable: true })
  ocrProvider?: string;

  @Field(() => DocumentAnalysis, { nullable: true })
  analysis?: DocumentAnalysis;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class DeleteAllScansResult {
  @Field(() => Int)
  deletedCount!: number;
}
