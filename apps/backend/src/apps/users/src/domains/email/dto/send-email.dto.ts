import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

@InputType()
export class SendWelcomeEmailDto {
  @Field()
  @IsEmail()
  email!: string;

  @Field({ nullable: true })
  @IsOptional()
  @MaxLength(100)
  userName?: string;
}

@InputType()
export class SendGenericEmailDto {
  @Field()
  @IsEmail()
  to!: string;

  @Field()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @Field()
  @IsNotEmpty()
  @MaxLength(10000)
  htmlContent!: string;

  @Field({ nullable: true })
  @IsOptional()
  @MaxLength(10000)
  textContent?: string;
}
