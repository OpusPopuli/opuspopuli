import { Inject, Injectable, forwardRef, Optional } from '@nestjs/common';

import { LoginUserDto } from './dto/login-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import { Auth } from './models/auth.model';

import { UsersService } from '../user/users.service';
import { EmailService } from '../email/email.service';
import { IAuthProvider, IAuthResult } from '@qckstrt/auth-provider';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmForgotPasswordDto } from './dto/confirm-forgot-password.dto';
import { Role } from 'src/common/enums/role.enum';
import { AuthStrategy } from 'src/common/enums/auth-strategy.enum';
import { User } from '../user/models/user.model';

// Interface for user data needed by generateTokensForUser
interface UserWithEmail {
  email: string;
}
import { SecureLogger } from 'src/common/services/secure-logger.service';

// Extended auth provider type with optional passwordless methods
interface IAuthProviderWithPasswordless extends IAuthProvider {
  sendMagicLink?(email: string, redirectTo?: string): Promise<boolean>;
  verifyMagicLink?(email: string, token: string): Promise<IAuthResult>;
  registerWithMagicLink?(email: string, redirectTo?: string): Promise<boolean>;
  createSessionForUser?(email: string): Promise<IAuthResult>;
}

@Injectable()
export class AuthService {
  // Use SecureLogger to automatically redact PII (emails, IPs) from log messages
  // @see https://github.com/CommonwealthLabsCode/qckstrt/issues/192
  private readonly logger = new SecureLogger(AuthService.name);

  constructor(
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject('AUTH_PROVIDER')
    private readonly authProvider: IAuthProviderWithPasswordless,
    @Optional()
    @Inject(forwardRef(() => EmailService))
    private readonly emailService?: EmailService,
  ) {}

  async registerUser(registerUserDto: RegisterUserDto): Promise<string> {
    const { email, username, password, department, clearance, admin, confirm } =
      registerUserDto;

    // Find user by email first to make sure they were created
    const user = await this.usersService.findByEmail(email);

    if (user?.email !== registerUserDto.email) {
      const msg = `Can't register user <${registerUserDto.email}>. User does not exist!`;
      this.logger.warn(msg);
      throw new Error(msg);
    }

    const userId = await this.authProvider.registerUser({
      email,
      username,
      password,
      attributes: {
        department: department || 'N/A',
        clearance: clearance || 'N/A',
      },
    });

    const validUUID = /^[a-z,0-9,-]{36,36}$/;

    if (!validUUID.test(userId)) {
      const msg = `Can't register user <${registerUserDto.email}>. Invalid userId!`;
      this.logger.warn(msg);
      throw new Error(msg);
    }

    if (admin) {
      await this.authProvider.addToGroup(username, Role.Admin);
    }

    if (confirm) {
      await this.authProvider.confirmUser(username);
    }

    // Use AWS Cognito User ID as our ID and set auth strategy
    await this.usersService.update(user.id, { id: userId });
    await this.usersService.updateAuthStrategy(userId, AuthStrategy.PASSWORD);

    // Send welcome email (async, don't wait for it)
    if (this.emailService) {
      this.emailService
        .sendWelcomeEmail(userId, email, username)
        .catch((err) => {
          this.logger.warn(
            `Failed to send welcome email to ${email}: ${err.message}`,
          );
        });
    }

    return userId;
  }

  async confirmUser(id: string): Promise<boolean> {
    const user = await this.usersService.findById(id);

    if (user === null) {
      return false;
    }

    await this.authProvider.confirmUser(user.email);

    return true;
  }

  async addPermission(id: string, role: Role): Promise<boolean> {
    const user = await this.usersService.findById(id);

    if (user === null) {
      return false;
    }

    await this.authProvider.addToGroup(user.email, role);

    return true;
  }

  async removePermission(id: string, role: Role): Promise<boolean> {
    const user = await this.usersService.findById(id);

    if (user === null) {
      return false;
    }

    await this.authProvider.removeFromGroup(user.email, role);

    return true;
  }

  async deleteUser(username: string): Promise<boolean> {
    return this.authProvider.deleteUser(username);
  }

  async authenticateUser(loginUserDto: LoginUserDto): Promise<Auth> {
    const { email, password } = loginUserDto;

    // Find user by email first to make sure they were created
    const user = await this.usersService.findByEmail(email);

    if (user?.email !== loginUserDto.email) {
      const msg = `Can't register user <${loginUserDto.email}>. User does not exist!`;
      this.logger.warn(msg);
      throw new Error(msg);
    }

    return this.authProvider.authenticateUser(email, password);
  }

  async changePassword(
    changeUserPassword: ChangePasswordDto,
  ): Promise<boolean> {
    return this.authProvider.changePassword(
      changeUserPassword.accessToken,
      changeUserPassword.newPassword,
      changeUserPassword.currentPassword,
    );
  }

  async forgotPassword(email: string): Promise<boolean> {
    // If user is not found, don't send failure as that could let hackers know which emails do exist
    const user = await this.usersService.findByEmail(email);

    if (user === null) {
      return true;
    }

    return this.authProvider.forgotPassword(email);
  }

  async confirmForgotPassword(
    confirmforgotPassword: ConfirmForgotPasswordDto,
  ): Promise<boolean> {
    // If user is not found, don't send failure as that could let hackers know which emails do exist
    const user = await this.usersService.findByEmail(
      confirmforgotPassword.email,
    );

    if (user === null) {
      return true;
    }

    return this.authProvider.confirmForgotPassword(
      confirmforgotPassword.email,
      confirmforgotPassword.password,
      confirmforgotPassword.confirmationCode,
    );
  }

  // ============================================
  // Passwordless Authentication Methods
  // ============================================

  /**
   * Get a user by email address
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return this.usersService.findByEmail(email);
  }

  /**
   * Send a magic link for passwordless login
   */
  async sendMagicLink(email: string, redirectTo?: string): Promise<boolean> {
    // Check if user exists first (don't reveal if they don't)
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Still return true to not reveal if email exists
      this.logger.warn(`Magic link requested for non-existent user: ${email}`);
      return true;
    }

    if (!this.authProvider.sendMagicLink) {
      throw new Error('Magic link not supported by auth provider');
    }

    return this.authProvider.sendMagicLink(email, redirectTo);
  }

  /**
   * Verify a magic link token and return auth tokens
   */
  async verifyMagicLink(email: string, token: string): Promise<Auth> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new Error('User not found');
    }

    if (!this.authProvider.verifyMagicLink) {
      throw new Error('Magic link not supported by auth provider');
    }

    return this.authProvider.verifyMagicLink(email, token);
  }

  /**
   * Register a new user with magic link (passwordless)
   */
  async registerWithMagicLink(
    email: string,
    redirectTo?: string,
  ): Promise<boolean> {
    // Check if user already exists
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      // User exists, just send a login magic link instead
      this.logger.log(
        `User already exists, sending login magic link: ${email}`,
      );
      return this.sendMagicLink(email, redirectTo);
    }

    if (!this.authProvider.registerWithMagicLink) {
      throw new Error('Magic link registration not supported by auth provider');
    }

    // Create user in our database first (passwordless - no password required)
    const newUser = await this.usersService.createPasswordlessUser(email);

    // Send welcome email (async, don't wait for it)
    if (this.emailService && newUser) {
      this.emailService.sendWelcomeEmail(newUser.id, email).catch((err) => {
        this.logger.warn(
          `Failed to send welcome email to ${email}: ${err.message}`,
        );
      });
    }

    return this.authProvider.registerWithMagicLink(email, redirectTo);
  }

  /**
   * Generate auth tokens for a user (used after passkey authentication)
   * Creates a session for a user who has been verified via WebAuthn
   */
  async generateTokensForUser(user: UserWithEmail): Promise<Auth> {
    if (!this.authProvider.createSessionForUser) {
      throw new Error(
        'Token generation for passkey auth requires createSessionForUser support',
      );
    }

    this.logger.log(
      `Generating tokens for passkey-authenticated user: ${user.email}`,
    );
    return this.authProvider.createSessionForUser(user.email);
  }
}
