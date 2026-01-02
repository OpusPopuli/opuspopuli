import { Field, InputType } from '@nestjs/graphql';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';

// @ArgsType()
@InputType()
export class UpdateUserDto {
  /**
   * Optional Fields
   */
  @IsOptional()
  @IsString()
  @IsEmail()
  @MaxLength(255)
  @Field({ nullable: true })
  public email?: string;

  @IsOptional()
  @MinLength(6)
  @MaxLength(50)
  @IsString()
  @Field({ nullable: true })
  public username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Field({ nullable: true })
  public clearance?: string;
}
