import { Args, ID, Mutation, Query, Resolver, Context } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

import { UserInputError } from '@nestjs/apollo';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from 'src/common/guards/auth.guard';

import { Auth } from './models/auth.model';
import { Permissions } from 'src/common/decorators/permissions.decorator';
import { Role } from 'src/common/enums/role.enum';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Action } from 'src/common/enums/action.enum';
import { ConfirmForgotPasswordDto } from './dto/confirm-forgot-password.dto';
import { UsersService } from '../user/users.service';

// Passkey DTOs
import {
  GeneratePasskeyRegistrationOptionsDto,
  VerifyPasskeyRegistrationDto,
  GeneratePasskeyAuthenticationOptionsDto,
  VerifyPasskeyAuthenticationDto,
  PasskeyRegistrationOptions,
  PasskeyAuthenticationOptions,
  PasskeyCredential,
} from './dto/passkey.dto';
import { PasskeyService } from './services/passkey.service';

// Magic Link DTOs
import {
  SendMagicLinkDto,
  VerifyMagicLinkDto,
  RegisterWithMagicLinkDto,
} from './dto/magic-link.dto';

@Resolver(() => Boolean)
export class AuthResolver {
  constructor(
    private readonly authService: AuthService,
    private readonly passkeyService: PasskeyService,
    private readonly usersService: UsersService,
  ) {}

  @Mutation(() => Boolean)
  async registerUser(
    @Args('registerUserDto') registerUserDto: RegisterUserDto,
  ): Promise<boolean> {
    let userRegistered: string;
    try {
      userRegistered = await this.authService.registerUser(registerUserDto);
    } catch (error) {
      throw new UserInputError(error.message);
    }
    return userRegistered !== null;
  }

  @Mutation(() => Auth)
  async loginUser(
    @Args('loginUserDto') loginUserDto: LoginUserDto,
  ): Promise<Auth> {
    let auth: Auth;
    try {
      auth = await this.authService.authenticateUser(loginUserDto);
    } catch (error) {
      throw new UserInputError(error.message);
    }
    return auth;
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  @Permissions({
    action: Action.Update,
    subject: 'User',
    conditions: { id: '{{ id }}' },
  })
  async changePassword(
    @Args('changePasswordDto') changePasswordDto: ChangePasswordDto,
  ): Promise<boolean> {
    let passwordUpdated: boolean;
    try {
      passwordUpdated =
        await this.authService.changePassword(changePasswordDto);
    } catch (error) {
      throw new UserInputError(error.message);
    }
    return passwordUpdated;
  }

  @Mutation(() => Boolean)
  forgotPassword(@Args('email') email: string): Promise<boolean> {
    return this.authService.forgotPassword(email);
  }

  @Mutation(() => Boolean)
  async confirmForgotPassword(
    @Args('confirmForgotPasswordDto')
    confirmForgotPasswordDto: ConfirmForgotPasswordDto,
  ): Promise<boolean> {
    let passwordUpdated: boolean;
    try {
      passwordUpdated = await this.authService.confirmForgotPassword(
        confirmForgotPasswordDto,
      );
    } catch (error) {
      throw new UserInputError(error.message);
    }
    return passwordUpdated;
  }

  /** Administration */
  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async confirmUser(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<boolean> {
    const result = await this.authService.confirmUser(id);
    if (!result) throw new UserInputError('User not confirmed!');
    return result;
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async addAdminPermission(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<boolean> {
    const result = await this.authService.addPermission(id, Role.Admin);
    if (!result)
      throw new UserInputError('Admin Permissions were not granted!');
    return result;
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async removeAdminPermission(
    @Args({ name: 'id', type: () => ID }) id: string,
  ): Promise<boolean> {
    const result = await this.authService.removePermission(id, Role.Admin);
    if (!result)
      throw new UserInputError('Admin Permissions were not revoked!');
    return result;
  }

  // ============================================
  // Passkey (WebAuthn) Mutations
  // ============================================

  @Mutation(() => PasskeyRegistrationOptions)
  async generatePasskeyRegistrationOptions(
    @Args('input') input: GeneratePasskeyRegistrationOptionsDto,
  ): Promise<PasskeyRegistrationOptions> {
    try {
      const user = await this.authService.getUserByEmail(input.email);
      if (!user) {
        throw new UserInputError('User not found');
      }

      const options = await this.passkeyService.generateRegistrationOptions(
        user.id,
        user.email,
        user.firstName || user.email,
      );

      return { options };
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  @Mutation(() => Boolean)
  async verifyPasskeyRegistration(
    @Args('input') input: VerifyPasskeyRegistrationDto,
  ): Promise<boolean> {
    try {
      const user = await this.authService.getUserByEmail(input.email);
      if (!user) {
        throw new UserInputError('User not found');
      }

      const verification = await this.passkeyService.verifyRegistration(
        input.email,
        input.response,
      );

      if (verification.verified) {
        await this.passkeyService.saveCredential(
          user.id,
          verification,
          input.friendlyName,
        );

        // Update user's auth strategy to passkey (most secure method)
        await this.usersService.updateAuthStrategy(
          user.id,
          AuthStrategy.PASSKEY,
        );

        return true;
      }

      return false;
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  @Mutation(() => PasskeyAuthenticationOptions)
  async generatePasskeyAuthenticationOptions(
    @Args('input', { nullable: true })
    input?: GeneratePasskeyAuthenticationOptionsDto,
  ): Promise<PasskeyAuthenticationOptions> {
    try {
      const { options, identifier } =
        await this.passkeyService.generateAuthenticationOptions(input?.email);
      return { options, identifier };
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  @Mutation(() => Auth)
  async verifyPasskeyAuthentication(
    @Args('input') input: VerifyPasskeyAuthenticationDto,
  ): Promise<Auth> {
    try {
      const { verification, user } =
        await this.passkeyService.verifyAuthentication(
          input.identifier,
          input.response,
        );

      if (!verification.verified) {
        throw new UserInputError('Passkey verification failed');
      }

      // Generate tokens for the authenticated user
      return this.authService.generateTokensForUser(user);
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  @Query(() => [PasskeyCredential])
  @UseGuards(AuthGuard)
  async myPasskeys(
    @Context() context: { req: { headers: { user: string } } },
  ): Promise<PasskeyCredential[]> {
    const userHeader = context.req.headers.user;
    if (!userHeader) {
      throw new UserInputError('User not authenticated');
    }

    const user = JSON.parse(userHeader);
    return this.passkeyService.getUserCredentials(user.id);
  }

  @Mutation(() => Boolean)
  @UseGuards(AuthGuard)
  async deletePasskey(
    @Args('credentialId') credentialId: string,
    @Context() context: { req: { headers: { user: string } } },
  ): Promise<boolean> {
    const userHeader = context.req.headers.user;
    if (!userHeader) {
      throw new UserInputError('User not authenticated');
    }

    const user = JSON.parse(userHeader);
    return this.passkeyService.deleteCredential(credentialId, user.id);
  }

  // ============================================
  // Magic Link Mutations
  // ============================================

  @Mutation(() => Boolean)
  async sendMagicLink(
    @Args('input') input: SendMagicLinkDto,
  ): Promise<boolean> {
    try {
      return await this.authService.sendMagicLink(
        input.email,
        input.redirectTo,
      );
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  @Mutation(() => Auth)
  async verifyMagicLink(
    @Args('input') input: VerifyMagicLinkDto,
  ): Promise<Auth> {
    try {
      return await this.authService.verifyMagicLink(input.email, input.token);
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  @Mutation(() => Boolean)
  async registerWithMagicLink(
    @Args('input') input: RegisterWithMagicLinkDto,
  ): Promise<boolean> {
    try {
      return await this.authService.registerWithMagicLink(
        input.email,
        input.redirectTo,
      );
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }
}
