import { Field, InputType, ID } from '@nestjs/graphql';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  MaxLength,
  MinLength,
  IsBoolean,
} from 'class-validator';

@InputType()
export class ContactRepresentativeDto {
  @Field(() => ID)
  @IsUUID()
  representativeId!: string;

  @Field()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @Field()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  message!: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  propositionId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  includeAddress?: boolean;
}

@InputType()
export class RepresentativeInfoDto {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @Field()
  @IsEmail()
  email!: string;

  @Field({ nullable: true })
  @IsOptional()
  @MaxLength(100)
  chamber?: string;
}

@InputType()
export class PropositionInfoDto {
  @Field(() => ID)
  @IsUUID()
  id!: string;

  @Field()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;
}
