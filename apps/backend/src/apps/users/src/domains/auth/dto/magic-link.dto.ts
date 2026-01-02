import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, IsOptional, MaxLength } from 'class-validator';

@InputType()
export class SendMagicLinkDto {
  @Field()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redirectTo?: string;
}

@InputType()
export class VerifyMagicLinkDto {
  @Field()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Field()
  @IsString()
  @MaxLength(500)
  token!: string;
}

@InputType()
export class RegisterWithMagicLinkDto {
  @Field()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redirectTo?: string;
}
