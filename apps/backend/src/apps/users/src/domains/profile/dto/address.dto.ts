import { Field, InputType, ID } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { AddressType } from 'src/common/enums/address.enum';

@InputType()
export class CreateAddressDto {
  @IsEnum(AddressType)
  @Field(() => String)
  public addressType!: AddressType;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true, defaultValue: false })
  public isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public label?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  @Field()
  public addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public addressLine2?: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @Field()
  public city!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @Field()
  public state!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  @Field()
  public postalCode!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Field({ nullable: true, defaultValue: 'US' })
  public country?: string;
}

@InputType()
export class UpdateAddressDto {
  @IsUUID()
  @Field(() => ID)
  public id!: string;

  @IsOptional()
  @IsEnum(AddressType)
  @Field(() => String, { nullable: true })
  public addressType?: AddressType;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public isPrimary?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Field({ nullable: true })
  public postalCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Field({ nullable: true })
  public country?: string;
}

@InputType()
export class GeocodeResultDto {
  @IsNumber()
  @Field()
  public latitude!: number;

  @IsNumber()
  @Field()
  public longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Field({ nullable: true })
  public formattedAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Field({ nullable: true })
  public placeId?: string;
}
