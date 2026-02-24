import {
  Field,
  InputType,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AbuseReportReason } from '@opuspopuli/relationaldb-provider';

// Register enum for GraphQL schema
registerEnumType(AbuseReportReason, {
  name: 'AbuseReportReason',
  description: 'Reason for reporting a document analysis',
});

/**
 * Input for submitting an abuse report on a document analysis
 */
@InputType()
export class SubmitAbuseReportInput {
  @Field()
  @IsUUID()
  documentId!: string;

  @Field(() => AbuseReportReason)
  @IsEnum(AbuseReportReason)
  reason!: AbuseReportReason;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

/**
 * Result of submitting an abuse report
 */
@ObjectType()
export class SubmitAbuseReportResult {
  @Field()
  success!: boolean;

  @Field()
  reportId!: string;
}
