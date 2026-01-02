import { Field, InputType } from '@nestjs/graphql';
import {
  IsDefined,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// @ArgsType()
@InputType()
export class ConfirmForgotPasswordDto {
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
  @IsString()
  @MaxLength(100)
  @Field()
  public confirmationCode!: string;

  @IsDefined()
  @IsString()
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[$&+,:;=?@#|'<>.^*()%!-])[A-Za-z\d@$&+,:;=?@#|'<>.^*()%!-]{8,}$/,
    { message: 'invalid password' },
  )
  @Field()
  public password!: string;
}
