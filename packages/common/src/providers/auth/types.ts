/**
 * Auth Provider Types
 *
 * Interfaces for authentication operations (Cognito, Auth0, etc.)
 */

/**
 * Authentication result with tokens
 */
export interface IAuthResult {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn?: number;
}

/**
 * User registration input
 */
export interface IRegisterUserInput {
  email: string;
  username: string;
  password: string;
  attributes?: Record<string, string>;
}

/**
 * Auth provider configuration
 */
export interface IAuthConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret?: string;
}

/**
 * Auth provider interface
 */
export interface IAuthProvider {
  /**
   * Get provider name
   */
  getName(): string;

  /**
   * Register a new user
   */
  registerUser(input: IRegisterUserInput): Promise<string>;

  /**
   * Authenticate user with credentials
   */
  authenticateUser(email: string, password: string): Promise<IAuthResult>;

  /**
   * Confirm user registration (admin)
   */
  confirmUser(username: string): Promise<void>;

  /**
   * Delete a user
   */
  deleteUser(username: string): Promise<boolean>;

  /**
   * Add user to a group/role
   */
  addToGroup(username: string, group: string): Promise<void>;

  /**
   * Remove user from a group/role
   */
  removeFromGroup(username: string, group: string): Promise<void>;

  /**
   * Change user password
   */
  changePassword(
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean>;

  /**
   * Initiate forgot password flow
   */
  forgotPassword(username: string): Promise<boolean>;

  /**
   * Confirm forgot password with code
   */
  confirmForgotPassword(
    username: string,
    password: string,
    confirmationCode: string,
  ): Promise<boolean>;

  /**
   * Send magic link for passwordless login
   * @param email User's email address
   * @param redirectTo Optional URL to redirect after verification
   * @returns true if email was sent successfully
   */
  sendMagicLink?(email: string, redirectTo?: string): Promise<boolean>;

  /**
   * Verify magic link token and authenticate user
   * @param email User's email address
   * @param token The OTP token from the magic link
   * @returns Auth tokens if verification successful
   */
  verifyMagicLink?(email: string, token: string): Promise<IAuthResult>;

  /**
   * Register a new user with just email (passwordless registration)
   * @param email User's email address
   * @param redirectTo Optional URL to redirect after verification
   * @returns true if registration email was sent successfully
   */
  registerWithMagicLink?(email: string, redirectTo?: string): Promise<boolean>;

  /**
   * Create a session for a verified user (used after passkey authentication)
   * Generates tokens without requiring password authentication
   * @param email User's email address
   * @returns Auth tokens for the user
   */
  createSessionForUser?(email: string): Promise<IAuthResult>;
}

/**
 * Auth error class
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
