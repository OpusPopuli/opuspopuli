import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  Matches,
  IsBase64,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Custom validator to prevent path traversal attacks
 */
function IsSecureFilename(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSecureFilename',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const dangerousPatterns = ['..', '/', '\\', '\0'];
          return !dangerousPatterns.some((pattern) => value.includes(pattern));
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} contains invalid characters`;
        },
      },
    });
  };
}

/**
 * Input for extracting text from an uploaded file
 */
@InputType()
export class ExtractTextFromFileInput {
  @Field()
  @IsString()
  @IsNotEmpty({ message: 'Filename is required' })
  @MaxLength(255)
  @IsSecureFilename()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
    message: 'Filename must be alphanumeric with dots, underscores, hyphens',
  })
  filename!: string;
}

/**
 * Input for extracting text from base64 encoded image
 */
@InputType()
export class ExtractTextFromBase64Input {
  @Field()
  @IsString()
  @IsNotEmpty()
  @IsBase64()
  data!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Matches(
    /^(image\/(png|jpeg|jpg|webp|bmp|gif|tiff)|application\/pdf|text\/.*)$/,
    {
      message:
        'MIME type must be a supported format (image/*, application/pdf, text/*)',
    },
  )
  mimeType!: string;
}

/**
 * Result of text extraction operation
 */
@ObjectType()
export class ExtractTextResult {
  @Field()
  text!: string;

  @Field(() => Float)
  confidence!: number;

  @Field()
  provider!: string;

  @Field(() => Int)
  processingTimeMs!: number;
}
