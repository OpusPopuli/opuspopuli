import { Args, Mutation, Resolver, Context } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, Optional } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';

import { UserInputError } from '@nestjs/apollo';

import { Auth } from './models/auth.model';
import { Public } from 'src/common/decorators/public.decorator';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';
import { AuditAction } from 'src/common/enums/audit-action.enum';
import { ConfirmForgotPasswordDto } from './dto/confirm-forgot-password.dto';
import { UsersService } from '../user/users.service';
import {
  GqlContext,
  createAuditContext,
} from 'src/common/utils/graphql-context';
import { setAuthCookies } from 'src/common/utils/cookie.utils';
import { AUTH_THROTTLE } from 'src/config/auth-throttle.config';
import { AccountLockoutService } from './services/account-lockout.service';
import { AuditLogService } from 'src/common/services/audit-log.service';
import { SecureLogger } from 'src/common/services/secure-logger.service';

// Passkey DTOs
import {
  GeneratePasskeyRegistrationOptionsDto,
  VerifyPasskeyRegistrationDto,
  GeneratePasskeyAuthenticationOptionsDto,
  VerifyPasskeyAuthenticationDto,
  PasskeyRegistrationOptions,
  PasskeyAuthenticationOptions,
} from './dto/passkey.dto';
import { PasskeyService } from './services/passkey.service';

// Magic Link DTOs
import {
  SendMagicLinkDto,
  VerifyMagicLinkDto,
  RegisterWithMagicLinkDto,
  ExchangeSupabaseSessionDto,
} from './dto/magic-link.dto';

/**
 * Auth Resolver
 *
 * Handles public authentication operations:
 * - Registration (standard + magic link)
 * - Login (password, passkey, magic link)
 * - Password reset (forgot/confirm)
 * - Passkey registration and authentication
 *
 * All operations are @Public() and rate-limited.
 *
 * @see https://github.com/OpusPopuli/opuspopuli/issues/464
 */
@Resolver(() => Boolean)
export class AuthResolver {
  // Use SecureLogger to automatically redact PII (emails, IPs) from log messages
  // @see https://github.com/OpusPopuli/opuspopuli/issues/192
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
   * Register a new user account
   * Rate limited: 3 attempts per minute
   * @see https://github.com/OpusPopuli/opuspopuli/issues/187
   */
  @Public()
  @Throttle({ default: AUTH_THROTTLE.register })
  @Mutation(() => Boolean)
  async registerUser(
    @Args('registerUserDto') registerUserDto: RegisterUserDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = createAuditContext(
      context,
      this.serviceName,
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
   * @see https://github.com/OpusPopuli/opuspopuli/issues/187
   */
  @Public()
  @Throttle({ default: AUTH_THROTTLE.login })
  @Mutation(() => Auth)
  async loginUser(
    @Args('loginUserDto') loginUserDto: LoginUserDto,
    @Context() context: GqlContext,
  ): Promise<Auth> {
    const { email } = loginUserDto;
    const auditContext = createAuditContext(context, this.serviceName, email);
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

  /**
   * Request password reset email
   * Rate limited: 3 attempts per hour (prevents email bombing)
   * @see https://github.com/OpusPopuli/opuspopuli/issues/187
   */
  @Public()
  @Throttle({ default: AUTH_THROTTLE.passwordReset })
  @Mutation(() => Boolean)
  async forgotPassword(
    @Args('email') email: string,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = createAuditContext(context, this.serviceName, email);

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
    const auditContext = createAuditContext(
      context,
      this.serviceName,
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

  // ============================================
  // Passkey (WebAuthn) Mutations
  // Rate limited: 10 attempts per minute
  // @see https://github.com/OpusPopuli/opuspopuli/issues/187
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
    const auditContext = createAuditContext(
      context,
      this.serviceName,
      input.email,
    );

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
    const auditContext = createAuditContext(context, this.serviceName);

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

  // ============================================
  // Magic Link Mutations
  // Rate limited: 3 attempts per minute
  // @see https://github.com/OpusPopuli/opuspopuli/issues/187
  // ============================================

  @Public()
  @Throttle({ default: AUTH_THROTTLE.magicLink })
  @Mutation(() => Boolean)
  async sendMagicLink(
    @Args('input') input: SendMagicLinkDto,
    @Context() context: GqlContext,
  ): Promise<boolean> {
    const auditContext = createAuditContext(
      context,
      this.serviceName,
      input.email,
    );

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
    const auditContext = createAuditContext(
      context,
      this.serviceName,
      input.email,
    );

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
    const auditContext = createAuditContext(
      context,
      this.serviceName,
      input.email,
    );

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

  /**
   * Exchange a Supabase access token (from GoTrue redirect) for a backend session.
   * Used when GoTrue verifies a magic link and redirects with hash fragment tokens.
   * Rate limited: 3 attempts per minute
   */
  @Public()
  @Throttle({ default: AUTH_THROTTLE.magicLink })
  @Mutation(() => Auth)
  async exchangeSupabaseSession(
    @Args('input') input: ExchangeSupabaseSessionDto,
    @Context() context: GqlContext,
  ): Promise<Auth> {
    const auditContext = createAuditContext(context, this.serviceName);

    try {
      const auth = await this.authService.exchangeSupabaseSession(
        input.accessToken,
        input.refreshToken,
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

      // Audit: Supabase session exchange success
      this.auditLogService?.log({
        ...auditContext,
        action: AuditAction.MAGIC_LINK_VERIFIED,
        success: true,
        resolverName: 'exchangeSupabaseSession',
        operationType: 'mutation',
      });

      return auth;
    } catch (error) {
      // Audit: Session exchange failure
      this.auditLogService?.logSync({
        ...auditContext,
        action: AuditAction.MAGIC_LINK_FAILED,
        success: false,
        resolverName: 'exchangeSupabaseSession',
        operationType: 'mutation',
        errorMessage: error.message,
      });
      throw new UserInputError(error.message);
    }
  }
}
