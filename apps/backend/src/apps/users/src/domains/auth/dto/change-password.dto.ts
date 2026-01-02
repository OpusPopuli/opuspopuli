import { Field, InputType } from '@nestjs/graphql';
import { IsDefined, IsString, Matches, MaxLength } from 'class-validator';

// @ArgsType()
@InputType()
export class ChangePasswordDto {
  /**
   * Required Fields
   */
  @IsDefined()
  @IsString()
  @MaxLength(2048)
  @Field()
  public accessToken!: string;

  @IsDefined()
  @IsString()
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[$&+,:;=?@#|'<>.^*()%!-])[A-Za-z\d@$&+,:;=?@#|'<>.^*()%!-]{8,}$/,
    { message: 'invalid password' },
  )
  @Field()
  public newPassword!: string;

  @IsDefined()
  @IsString()
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[$&+,:;=?@#|'<>.^*()%!-])[A-Za-z\d@$&+,:;=?@#|'<>.^*()%!-]{8,}$/,
    { message: 'invalid password' },
  )
  @Field()
  public currentPassword!: string;
}
