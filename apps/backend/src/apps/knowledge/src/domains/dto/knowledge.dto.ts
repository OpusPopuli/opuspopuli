import { Field, InputType, Int } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  Max,
  Matches,
} from 'class-validator';

/**
 * Input validation for knowledge query operations
 */
@InputType()
export class QueryInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000, { message: 'Query must not exceed 10000 characters' })
  query!: string;
}

/**
 * Input validation for search with pagination
 */
@InputType()
export class SearchInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000, { message: 'Query must not exceed 10000 characters' })
  query!: string;

  @Field(() => Int, { defaultValue: 0 })
  @Min(0, { message: 'Skip must be non-negative' })
  @Max(10000, { message: 'Skip must not exceed 10000' })
  skip!: number;

  @Field(() => Int, { defaultValue: 10 })
  @Min(1, { message: 'Take must be at least 1' })
  @Max(100, { message: 'Take must not exceed 100' })
  take!: number;
}

/**
 * Input validation for document indexing
 */
@InputType()
export class IndexDocumentInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255, { message: 'Document ID must not exceed 255 characters' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message:
      'Document ID must contain only alphanumeric characters, underscores, and hyphens',
  })
  documentId!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000000, { message: 'Text must not exceed 1MB' })
  text!: string;
}
