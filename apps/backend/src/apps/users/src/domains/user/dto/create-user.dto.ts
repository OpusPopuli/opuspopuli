import { Field, InputType } from '@nestjs/graphql';
import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';

// @ArgsType()
@InputType()
export class CreateUserDto {
  /**
   * Required Fields
   */
  @IsDefined()
  @IsString()
  @IsEmail()
  @MaxLength(255)
  @Field()
  public email!: string;

  @IsDefined()
  @MinLength(6)
  @MaxLength(50)
  @IsString()
  @Field()
  public username!: string;

  @IsDefined()
  @MinLength(6)
  @MaxLength(128)
  @IsString()
  @Field()
  public password!: string;

  /**
   * Optional Fields
   */
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

// TEMPORARY: add dept, clearance, admin, confirm to registerUserDto
