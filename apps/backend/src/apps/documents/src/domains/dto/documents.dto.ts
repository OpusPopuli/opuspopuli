import { Field, InputType } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  Matches,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Custom validator to prevent path traversal attacks
 * Rejects filenames containing:
 * - Path separators (/ or \)
 * - Parent directory references (..)
 * - Null bytes
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
          // Check for path traversal patterns
          const dangerousPatterns = [
            '..', // Parent directory
            '/', // Unix path separator
            '\\', // Windows path separator
            '\0', // Null byte
          ];
          return !dangerousPatterns.some((pattern) => value.includes(pattern));
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} contains invalid characters (path separators or parent references not allowed)`;
        },
      },
    });
  };
}

/**
 * Input validation for filename operations
 * Prevents path traversal and enforces safe naming
 */
@InputType()
export class FilenameInput {
  @Field()
  @IsString()
  @IsNotEmpty({ message: 'Filename is required' })
  @MaxLength(255, { message: 'Filename must not exceed 255 characters' })
  @IsSecureFilename()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
    message:
      'Filename must start with alphanumeric and contain only alphanumeric characters, dots, underscores, and hyphens',
  })
  filename!: string;
}
