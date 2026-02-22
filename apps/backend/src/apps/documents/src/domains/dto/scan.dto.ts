import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  IsBase64,
  Matches,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { DocumentType } from '@opuspopuli/relationaldb-provider';

/**
 * Input for processing a camera scan
 * Combines document creation, storage upload, and OCR text extraction
 */
@InputType()
export class ProcessScanInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @IsBase64()
  data!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Matches(/^(image\/(png|jpeg|jpg|webp|bmp|gif|tiff))$/, {
    message: 'MIME type must be a supported image format',
  })
  mimeType!: string;

  @Field(() => DocumentType, {
    nullable: true,
    defaultValue: DocumentType.petition,
  })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;
}

/**
 * Result of scan processing (document created + text extracted)
 */
@ObjectType()
export class ProcessScanResult {
  @Field()
  documentId!: string;

  @Field()
  text!: string;

  @Field(() => Float)
  confidence!: number;

  @Field()
  provider!: string;

  @Field(() => Int)
  processingTimeMs!: number;
}
