import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ConsentType } from 'src/common/enums/consent.enum';

@InputType()
export class UpdateConsentDto {
  @IsEnum(ConsentType)
  @Field(() => ConsentType)
  public consentType!: ConsentType;

  @IsBoolean()
  @Field()
  public granted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Field({ nullable: true })
  public documentVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public documentUrl?: string;
}

@InputType()
export class BulkUpdateConsentsDto {
  @IsNotEmpty()
  @Field(() => [UpdateConsentDto])
  public consents!: UpdateConsentDto[];
}

@InputType()
export class WithdrawConsentDto {
  @IsEnum(ConsentType)
  @Field(() => ConsentType)
  public consentType!: ConsentType;
}
