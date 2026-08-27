import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
  IsUrl,
  Matches,
  IsTimeZone,
  IsLocale,
  IsBoolean,
} from 'class-validator';

/**
 * Coerces a stray empty string to `undefined` BEFORE validation runs so
 * `@IsOptional()` (which only short-circuits on null/undefined) can do
 * its job for format-validated fields. Without this, an unfilled form
 * input that ships `phone: ""` fails the E.164 regex even though the
 * user intended "no phone." Apply via `@Transform(emptyToUndefined)`.
 */
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : value;

@InputType()
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public middleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public preferredName?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsDateString()
  @Field({ nullable: true })
  public dateOfBirth?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Phone must be a valid E.164 format',
  })
  @Field({ nullable: true })
  public phone?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsTimeZone()
  @Field({ nullable: true })
  public timezone?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsLocale()
  @Field({ nullable: true })
  public locale?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/^(en|es)$/, {
    message: 'preferredLanguage must be either "en" or "es"',
  })
  @Field({ nullable: true })
  public preferredLanguage?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  @Field({ nullable: true })
  public avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Field({ nullable: true })
  public bio?: string;

  // Profile Visibility
  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public isPublic?: boolean;

  // Avatar Storage Key
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public avatarStorageKey?: string;

  // The civic and demographic fields were removed here in #1071. They
  // duplicated Your Model (SignalProfile / SensitiveProfile), which is what
  // actually drives relevance; their only consumer was the profile-completion
  // percentage, which now reads the SignalProfile counterparts instead.
  // The database columns are dropped in a follow-up, after this deploys.
}
