import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  IsBase64,
  Matches,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsInt,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentType } from '@opuspopuli/relationaldb-provider';

/**
 * What the on-device document detector decided about the frame the client
 * captured (#1049).
 *
 * ── Why the server accepts this at all ───────────────────────────────────
 *
 * Detection thresholds (`minCoverage`, `minSharpness`, `minConfidence`) were
 * never chosen from observed device behaviour, because nothing recorded it.
 * Scan images are dropped on the device by design (#1075), so there is no way
 * to reconstruct after the fact whether the deskew-crop fired or which gate
 * stopped it. Without these six numbers, tuning is guesswork on one phone.
 *
 * ── Why it is not a new personal-data sink ───────────────────────────────
 *
 * Six numbers about a decision: no pixels, no text, nothing that narrows down
 * what was photographed. That property is load-bearing — a petition page
 * carries names, addresses and signatures belonging to people who are not our
 * users. Do not extend this input with a thumbnail, a cropped strip, or an OCR
 * snippet.
 *
 * Every field is client-supplied and therefore untrusted. Bounds below are
 * deliberately generous: they reject values that could only be an attack or a
 * bug, while never rejecting a real reading and thereby failing a real scan
 * over telemetry.
 */
@InputType()
export class CaptureMetricsInput {
  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(1)
  detectionConfidence!: number;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(1)
  coverage!: number;

  /**
   * Laplacian variance — unbounded above in principle. A camera-app still
   * measured 10472 (eval-harness detect-probe), so the ceiling sits far above
   * any plausible reading rather than at a value we have actually seen.
   */
  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  sharpness!: number;

  @Field()
  @IsBoolean()
  cropFired!: boolean;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(100_000)
  frameWidth!: number;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  @Max(100_000)
  frameHeight!: number;
}

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

  /**
   * Optional, and must stay optional: an older client that does not send it
   * records NULL, which is honest, rather than failing a scan over telemetry.
   */
  @Field(() => CaptureMetricsInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CaptureMetricsInput)
  capture?: CaptureMetricsInput;
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
