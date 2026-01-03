import { Args, ID, Mutation, Query, Resolver, Context } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, Optional } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { AuthService } from './auth.service';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

import { UserInputError } from '@nestjs/apollo';

import { Auth } from './models/auth.model';
import { Permissions } from 'src/common/decorators/permissions.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { Role } from 'src/common/enums/role.enum';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Action } from 'src/common/enums/action.enum';
import { AuditAction } from 'src/common/enums/audit-action.enum';
import { ConfirmForgotPasswordDto } from './dto/confirm-forgot-password.dto';
import { UsersService } from '../user/users.service';
import {
  GqlContext,
  getUserFromContext,
} from 'src/common/utils/graphql-context';
import {
  setAuthCookies,
  clearAuthCookies,
} from 'src/common/utils/cookie.utils';
import { AUTH_THROTTLE } from 'src/config/auth-throttle.config';
import { AccountLockoutService } from './services/account-lockout.service';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { SecureLogger } from 'src/common/services/secure-logger.service';
import { IAuditContext } from 'src/common/interfaces/audit.interface';

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
  // Use SecureLogger to automatically redact PII (emails, IPs) from log messages
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
  private readonly logger = new SecureLogger(AuthResolver.name);
  private readonly serviceName = 'users-service';

  constructor(
    private readonly authService: AuthService,
    private readonly passkeyService: PasskeyService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly lockoutService: AccountLockoutService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  /**
   * Create audit context from GraphQL context
   * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/191
   */
  private createAuditContext(
    context: GqlContext,
    userEmail?: string,
  ): IAuditContext {
    const user = context.req?.user;
    return {
      requestId: randomUUID(),
      userId: user?.id,
      userEmail: userEmail || user?.email,
      ipAddress:
        context.req?.ip ||
        (context.req?.headers as Record<string, string>)?.['x-forwarded-for'],
      userAgent: context.req?.headers?.['user-agent'],
      serviceName: this.serviceName,
    };
  }

  /**
   * Register a new user account
   * Rate limited: 3 attempts per minute
   * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/187
   */
  @Public()
  @Throttle({ default: AUTH_THROTTLE.register })
  @Mutation(() => Boolean)
  async registerUser(
    @Args('registerUserDto') registerUserDto: RegisterUserDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(
      context,
      registerUserDto.email,
    );

    let userRegistered: string;
    try {
      userRegistered = await this.authService.registerUser(registerUserDto);

      // Audit: Registration success
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.REGISTRATION,
        success: true,
        entityType: 'User',
        entityId: userRegistered,
        resolverName: 'registerUser',
        operationType: 'mutation',
        inputVariables: { email: registerUserDto.email },
      });
    } catch (error) {
      // Audit: Registration failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.REGISTRATION_FAILED,
        success: false,
        resolverName: 'registerUser',
        operationType: 'mutation',
        inputVariables: { email: registerUserDto.email },
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
    return userRegistered !== null;
  }

  /**
   * Login with email and password
   * Rate limited: 5 attempts per minute
   * Includes account lockout after 5 failed attempts
   * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/187
   */
  @Public()
  @Throttle({ default: AUTH_THROTTLE.login })
  @Mutation(() => Auth)
  async loginUser(
    @Args('loginUserDto') loginUserDto: LoginUserDto,
    @Context() context: GqlContext,
  ): Promise<Auth> {
    const { email } = loginUserDto;
    const auditContext = this.createAuditContext(context, email);
    const clientIp = auditContext.ipAddress;

    // Check if account is locked
    if (this.lockoutService.isLocked(email)) {
      const remainingMs = this.lockoutService.getRemainingLockoutTime(email);
      const remainingMin = Math.ceil(remainingMs / 60000);
      this.logger.warn(
        `Blocked login attempt for locked account: ${email} (IP: ${clientIp})`,
      );

      // Audit: Blocked login attempt on locked account
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        resolverName: 'loginUser',
        operationType: 'mutation',
        errorMessage: 'Account locked - login attempt blocked',
      });

      throw new ForbiddenException(
        `Account temporarily locked. Try again in ${remainingMin} minute(s).`,
      );
    }

    let auth: Auth;
    try {
      auth = await this.authService.authenticateUser(loginUserDto);

      // Clear lockout on successful login
      this.lockoutService.clearLockout(email);

      // Set httpOnly cookies for browser clients
      if (context.res) {
        setAuthCookies(
          context.res,
          this.configService,
          auth.accessToken,
          auth.refreshToken,
        );
      }

      // Audit: Login success
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.LOGIN,
        success: true,
        resolverName: 'loginUser',
        operationType: 'mutation',
      });
    } catch (error) {
      // Record failed attempt (may trigger lockout)
      const isNowLocked = this.lockoutService.recordFailedAttempt(
        email,
        clientIp as string,
      );

      if (isNowLocked) {
        // Audit: Account locked
        this.auditLogService?.logSync({
          ...auditContext,
          action: AuditAction.ACCOUNT_LOCKED,
          success: false,
          resolverName: 'loginUser',
          operationType: 'mutation',
          errorMessage: 'Account locked after too many failed attempts',
        });

        throw new ForbiddenException(
          'Too many failed login attempts. Account temporarily locked for 15 minutes.',
        );
      }

      // Audit: Login failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        resolverName: 'loginUser',
        operationType: 'mutation',
        errorMessage: error.message,
      });

      throw new UserInputError(error.message);
    }
    return auth;
  }

  @Mutation(() => Boolean)
  @Permissions({
    action: Action.Update,
    subject: 'User',
    conditions: { id: '{{ id }}' },
  })
  async changePassword(
    @Args('changePasswordDto') changePasswordDto: ChangePasswordDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    let passwordUpdated: boolean;
    try {
      passwordUpdated =
        await this.authService.changePassword(changePasswordDto);

      // Audit: Password change success
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.PASSWORD_CHANGE,
        success: true,
        resolverName: 'changePassword',
        operationType: 'mutation',
      });
    } catch (error) {
      // Audit: Password change failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.PASSWORD_CHANGE_FAILED,
        success: false,
        resolverName: 'changePassword',
        operationType: 'mutation',
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
    return passwordUpdated;
  }

  /**
   * Request password reset email
   * Rate limited: 3 attempts per hour (prevents email bombing)
   * @see https://github.com/CommonwealthLabsCode/qckstrt/issues/187
   */
  @Public()
  @Throttle({ default: AUTH_THROTTLE.passwordReset })
  @Mutation(() => Boolean)
  async forgotPassword(
    @Args('email') email: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context, email);

    // Audit: Password reset request (always log, regardless of user existence)
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.PASSWORD_RESET_REQUEST,
      success: true,
      resolverName: 'forgotPassword',
      operationType: 'mutation',
    });

    return this.authService.forgotPassword(email);
  }

  @Public()
  @Mutation(() => Boolean)
  async confirmForgotPassword(
    @Args('confirmForgotPasswordDto')
    confirmForgotPasswordDto: ConfirmForgotPasswordDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(
      context,
      confirmForgotPasswordDto.email,
    );

    let passwordUpdated: boolean;
    try {
      passwordUpdated = await this.authService.confirmForgotPassword(
        confirmForgotPasswordDto,
      );

      // Audit: Password reset success
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.PASSWORD_RESET,
        success: true,
        resolverName: 'confirmForgotPassword',
        operationType: 'mutation',
      });
    } catch (error) {
      // Audit: Password reset failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.PASSWORD_RESET_FAILED,
        success: false,
        resolverName: 'confirmForgotPassword',
        operationType: 'mutation',
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
    return passwordUpdated;
  }

  /** Administration */
  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async confirmUser(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    const result = await this.authService.confirmUser(id);

    // Audit: User confirmation
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.USER_CONFIRMED,
      success: result,
      entityType: 'User',
      entityId: id,
      resolverName: 'confirmUser',
      operationType: 'mutation',
    });

    if (!result) throw new UserInputError('User not confirmed!');
    return result;
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async addAdminPermission(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    const result = await this.authService.addPermission(id, Role.Admin);

    // Audit: Admin permission granted
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.PERMISSION_GRANTED,
      success: result,
      entityType: 'User',
      entityId: id,
      resolverName: 'addAdminPermission',
      operationType: 'mutation',
      newValues: { role: Role.Admin },
    });

    if (!result)
      throw new UserInputError('Admin Permissions were not granted!');
    return result;
  }

  @Mutation(() => Boolean)
  @Roles(Role.Admin)
  async removeAdminPermission(
    @Args({ name: 'id', type: () => ID }) id: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    const result = await this.authService.removePermission(id, Role.Admin);

    // Audit: Admin permission revoked
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.PERMISSION_REVOKED,
      success: result,
      entityType: 'User',
      entityId: id,
      resolverName: 'removeAdminPermission',
      operationType: 'mutation',
      previousValues: { role: Role.Admin },
    });

    if (!result)
      throw new UserInputError('Admin Permissions were not revoked!');
    return result;
  }

  // ============================================
  // Passkey (WebAuthn) Mutations
  // Rate limited: 10 attempts per minute
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/187
  // ============================================

  @Public()
  @Throttle({ default: AUTH_THROTTLE.passkey })
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

  @Public()
  @Throttle({ default: AUTH_THROTTLE.passkey })
  @Mutation(() => Boolean)
  async verifyPasskeyRegistration(
    @Args('input') input: VerifyPasskeyRegistrationDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context, input.email);

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

        // Audit: Passkey registration success
        this.auditLogService?.log({
          ...auditContext,
          userId: user.id,
          action: AuditAction.PASSKEY_REGISTRATION,
          success: true,
          entityType: 'PasskeyCredential',
          resolverName: 'verifyPasskeyRegistration',
          operationType: 'mutation',
        });

        return true;
      }

      // Audit: Passkey registration verification failed
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.PASSKEY_REGISTRATION_FAILED,
        success: false,
        resolverName: 'verifyPasskeyRegistration',
        operationType: 'mutation',
        errorMessage: 'Passkey verification returned false',
      });

      return false;
    } catch (error) {
      // Audit: Passkey registration failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.PASSKEY_REGISTRATION_FAILED,
        success: false,
        resolverName: 'verifyPasskeyRegistration',
        operationType: 'mutation',
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE.passkey })
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

  @Public()
  @Throttle({ default: AUTH_THROTTLE.passkey })
  @Mutation(() => Auth)
  async verifyPasskeyAuthentication(
    @Args('input') input: VerifyPasskeyAuthenticationDto,
    @Context() context: GqlContext,
  ): Promise<Auth> {
    const auditContext = this.createAuditContext(context);

    try {
      const { verification, user } =
        await this.passkeyService.verifyAuthentication(
          input.identifier,
          input.response,
        );

      if (!verification.verified) {
        // Audit: Passkey authentication failed
        this.auditLogService?.logSync({
          ...auditContext,
          action: AuditAction.PASSKEY_AUTHENTICATION_FAILED,
          success: false,
          resolverName: 'verifyPasskeyAuthentication',
          operationType: 'mutation',
          errorMessage: 'Passkey verification failed',
        });
        throw new UserInputError('Passkey verification failed');
      }

      // Generate tokens for the authenticated user
      const auth = await this.authService.generateTokensForUser(user);

      // Set httpOnly cookies for browser clients
      if (context.res) {
        setAuthCookies(
          context.res,
          this.configService,
          auth.accessToken,
          auth.refreshToken,
        );
      }

      // Audit: Passkey authentication success
      this.auditLogService?.log({
        ...auditContext,
        userId: user.id,
        userEmail: user.email,
        action: AuditAction.PASSKEY_AUTHENTICATION,
        success: true,
        resolverName: 'verifyPasskeyAuthentication',
        operationType: 'mutation',
      });

      return auth;
    } catch (error) {
      // Audit: Passkey authentication failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.PASSKEY_AUTHENTICATION_FAILED,
        success: false,
        resolverName: 'verifyPasskeyAuthentication',
        operationType: 'mutation',
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
  }

  @Query(() => [PasskeyCredential])
  async myPasskeys(
    @Context() context: GqlContext,
  ): Promise<PasskeyCredential[]> {
    const user = getUserFromContext(context);
    return this.passkeyService.getUserCredentials(user.id);
  }

  @Mutation(() => Boolean)
  async deletePasskey(
    @Args('credentialId') credentialId: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const user = getUserFromContext(context);
    const auditContext = this.createAuditContext(context, user.email);

    const result = await this.passkeyService.deleteCredential(
      credentialId,
      user.id,
    );

    // Audit: Passkey deletion
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.PASSKEY_DELETED,
      success: result,
      entityType: 'PasskeyCredential',
      entityId: credentialId,
      resolverName: 'deletePasskey',
      operationType: 'mutation',
    });

    return result;
  }

  // ============================================
  // Magic Link Mutations
  // Rate limited: 3 attempts per minute
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/187
  // ============================================

  @Public()
  @Throttle({ default: AUTH_THROTTLE.magicLink })
  @Mutation(() => Boolean)
  async sendMagicLink(
    @Args('input') input: SendMagicLinkDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context, input.email);

    try {
      const result = await this.authService.sendMagicLink(
        input.email,
        input.redirectTo,
      );

      // Audit: Magic link sent (don't reveal if user exists)
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.MAGIC_LINK_SENT,
        success: true,
        resolverName: 'sendMagicLink',
        operationType: 'mutation',
      });

      return result;
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE.magicLink })
  @Mutation(() => Auth)
  async verifyMagicLink(
    @Args('input') input: VerifyMagicLinkDto,
    @Context() context: GqlContext,
  ): Promise<Auth> {
    const auditContext = this.createAuditContext(context, input.email);

    try {
      const auth = await this.authService.verifyMagicLink(
        input.email,
        input.token,
      );

      // Set httpOnly cookies for browser clients
      if (context.res) {
        setAuthCookies(
          context.res,
          this.configService,
          auth.accessToken,
          auth.refreshToken,
        );
      }

      // Audit: Magic link verified (login success)
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.MAGIC_LINK_VERIFIED,
        success: true,
        resolverName: 'verifyMagicLink',
        operationType: 'mutation',
      });

      return auth;
    } catch (error) {
      // Audit: Magic link verification failed
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.MAGIC_LINK_FAILED,
        success: false,
        resolverName: 'verifyMagicLink',
        operationType: 'mutation',
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
  }

  @Public()
  @Throttle({ default: AUTH_THROTTLE.magicLink })
  @Mutation(() => Boolean)
  async registerWithMagicLink(
    @Args('input') input: RegisterWithMagicLinkDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = this.createAuditContext(context, input.email);

    try {
      const result = await this.authService.registerWithMagicLink(
        input.email,
        input.redirectTo,
      );

      // Audit: Magic link registration
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.MAGIC_LINK_SENT,
        success: true,
        resolverName: 'registerWithMagicLink',
        operationType: 'mutation',
      });

      return result;
    } catch (error) {
      throw new UserInputError(error.message);
    }
  }

  // ============================================
  // Logout
  // ============================================

  @Mutation(() => Boolean)
  async logout(@Context() context: GqlContext): Promise<boolean> {
    const auditContext = this.createAuditContext(context);

    // Clear httpOnly auth cookies
    if (context.res) {
      clearAuthCookies(context.res, this.configService);
    }

    // Audit: Logout
    this.auditLogService?.log({
      ...auditContext,
      action: AuditAction.LOGOUT,
      success: true,
      resolverName: 'logout',
      operationType: 'mutation',
    });

    return true;
  }
}
