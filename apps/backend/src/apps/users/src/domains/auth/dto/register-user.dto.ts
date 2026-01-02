import { Field, InputType } from '@nestjs/graphql';
import {
  IsDefined,
  IsEmail,
  IsString,
  IsOptional,
  Matches,
  MinLength,
  MaxLength,
  IsBoolean,
} from 'class-validator';

// @ArgsType()
@InputType()
export class RegisterUserDto {
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
  @IsString()
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[$&+,:;=?@#|'<>.^*()%!-])[A-Za-z\d@$&+,:;=?@#|'<>.^*()%!-]{8,}$/,
    { message: 'invalid password' },
  )
  @Field()
  public password!: string;

  /**
   * Optional Fields
   */
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

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public admin?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Field({ nullable: true })
  public confirm?: boolean = false;
}
