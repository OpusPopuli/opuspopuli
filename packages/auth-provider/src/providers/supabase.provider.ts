import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  IAuthProvider,
  IAuthResult,
  IRegisterUserInput,
  AuthError,
  CircuitBreakerManager,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIGS,
  CircuitBreakerHealth,
} from "@qckstrt/common";

/**
 * Supabase configuration interface
 */
interface ISupabaseAuthConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

/**
 * Supabase Auth Provider
 *
 * Implements authentication operations using Supabase Auth (GoTrue).
 * This is an OSS alternative to AWS Cognito.
 *
 * Requires:
 * - SUPABASE_URL: The Supabase project URL
 * - SUPABASE_ANON_KEY: The anonymous key for client operations
 * - SUPABASE_SERVICE_ROLE_KEY: The service role key for admin operations (optional but recommended)
 */
@Injectable()
export class SupabaseAuthProvider implements IAuthProvider {
  private readonly logger = new Logger(SupabaseAuthProvider.name, {
    timestamp: true,
  });
  private readonly supabase: SupabaseClient;
  private readonly config: ISupabaseAuthConfig;
  private readonly circuitBreaker: CircuitBreakerManager;

  constructor(private readonly configService: ConfigService) {
    const url = configService.get<string>("supabase.url");
    const anonKey = configService.get<string>("supabase.anonKey");
    const serviceRoleKey = configService.get<string>("supabase.serviceRoleKey");

    if (!url || !anonKey) {
      throw new AuthError(
        "Supabase configuration is missing url or anonKey",
        "CONFIG_ERROR",
      );
    }

    this.config = {
      url,
      anonKey,
      serviceRoleKey,
    };

    // Use service role key for admin operations if available
    this.supabase = createClient(url, serviceRoleKey || anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Initialize circuit breaker for Supabase calls
    this.circuitBreaker = createCircuitBreaker(
      DEFAULT_CIRCUIT_CONFIGS.supabase,
    );

    // Log circuit state changes
    this.circuitBreaker.addListener((event) => {
      switch (event) {
        case "break":
          this.logger.warn(
            `Circuit breaker OPENED for Supabase Auth - service unavailable`,
          );
          break;
        case "reset":
          this.logger.log(
            `Circuit breaker RESET for Supabase Auth - service recovered`,
          );
          break;
        case "half_open":
          this.logger.log(
            `Circuit breaker HALF-OPEN for Supabase Auth - testing recovery`,
          );
          break;
      }
    });

    this.logger.log(`SupabaseAuthProvider initialized for: ${url}`);
  }

  getName(): string {
    return "SupabaseAuthProvider";
  }

  /**
   * Convert a Supabase session to IAuthResult
   */
  private sessionToAuthResult(session: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }): IAuthResult {
    return {
      accessToken: session.access_token,
      idToken: session.access_token, // Supabase uses access token for both
      refreshToken: session.refresh_token || "",
      expiresIn: session.expires_in,
    };
  }

  async registerUser(input: IRegisterUserInput): Promise<string> {
    // Wrap with circuit breaker protection
    return this.circuitBreaker.execute(async () => {
      try {
        // Build user metadata including username and custom attributes
        const userMetadata: Record<string, string> = {
          username: input.username,
        };

        if (input.attributes) {
          for (const [key, value] of Object.entries(input.attributes)) {
            // Remove "custom:" prefix if present (Supabase doesn't use it)
            const cleanKey = key.startsWith("custom:") ? key.slice(7) : key;
            userMetadata[cleanKey] = value;
          }
        }

        const { data, error } = await this.supabase.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: false,
          user_metadata: userMetadata,
        });

        if (error) {
          throw error;
        }

        this.logger.log(`User registered: ${input.username}`);
        return data.user?.id || "unknown";
      } catch (error) {
        this.logger.error(
          `Error registering user: ${(error as Error).message}`,
        );
        throw new AuthError(
          `Failed to register user ${input.username}`,
          "REGISTER_ERROR",
          error as Error,
        );
      }
    });
  }

  async authenticateUser(
    email: string,
    password: string,
  ): Promise<IAuthResult> {
    // Wrap with circuit breaker protection
    return this.circuitBreaker.execute(async () => {
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        this.logger.log(`User authenticated: ${email}`);
        return data.session
          ? this.sessionToAuthResult(data.session)
          : {
              accessToken: "",
              idToken: "",
              refreshToken: "",
              expiresIn: undefined,
            };
      } catch (error) {
        this.logger.error(
          `Error authenticating user: ${(error as Error).message}`,
        );
        throw new AuthError(
          `Failed to authenticate user ${email}`,
          "AUTH_ERROR",
          error as Error,
        );
      }
    });
  }

  async confirmUser(username: string): Promise<void> {
    try {
      // First, find the user by username (stored in user_metadata)
      const userId = await this.getUserIdByUsername(username);

      if (!userId) {
        throw new Error(`User not found: ${username}`);
      }

      // Confirm the user by setting email_confirmed_at
      const { error } = await this.supabase.auth.admin.updateUserById(userId, {
        email_confirm: true,
      });

      if (error) {
        throw error;
      }

      this.logger.log(`User confirmed: ${username}`);
    } catch (error) {
      this.logger.error(`Error confirming user: ${(error as Error).message}`);
      throw new AuthError(
        `Failed to confirm user ${username}`,
        "CONFIRM_ERROR",
        error as Error,
      );
    }
  }

  async deleteUser(username: string): Promise<boolean> {
    try {
      const userId = await this.getUserIdByUsername(username);

      if (!userId) {
        throw new Error(`User not found: ${username}`);
      }

      const { error } = await this.supabase.auth.admin.deleteUser(userId);

      if (error) {
        throw error;
      }

      this.logger.log(`User deleted: ${username}`);
      return true;
    } catch (error) {
      this.logger.error(`Error deleting user: ${(error as Error).message}`);
      throw new AuthError(
        `Failed to delete user ${username}`,
        "DELETE_ERROR",
        error as Error,
      );
    }
  }

  async addToGroup(username: string, group: string): Promise<void> {
    try {
      const userId = await this.getUserIdByUsername(username);

      if (!userId) {
        throw new Error(`User not found: ${username}`);
      }

      // Get current user to retrieve existing roles
      const { data: userData, error: getUserError } =
        await this.supabase.auth.admin.getUserById(userId);

      if (getUserError) {
        throw getUserError;
      }

      // Get existing roles or initialize empty array
      const currentRoles: string[] =
        (userData.user?.app_metadata?.roles as string[]) || [];

      // Add new group if not already present
      if (!currentRoles.includes(group)) {
        const { error } = await this.supabase.auth.admin.updateUserById(
          userId,
          {
            app_metadata: {
              ...userData.user?.app_metadata,
              roles: [...currentRoles, group],
            },
          },
        );

        if (error) {
          throw error;
        }
      }

      this.logger.log(`User ${username} added to group ${group}`);
    } catch (error) {
      this.logger.error(
        `Error adding user to group: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to add user ${username} to group ${group}`,
        "ADD_GROUP_ERROR",
        error as Error,
      );
    }
  }

  async removeFromGroup(username: string, group: string): Promise<void> {
    try {
      const userId = await this.getUserIdByUsername(username);

      if (!userId) {
        throw new Error(`User not found: ${username}`);
      }

      // Get current user to retrieve existing roles
      const { data: userData, error: getUserError } =
        await this.supabase.auth.admin.getUserById(userId);

      if (getUserError) {
        throw getUserError;
      }

      // Get existing roles
      const currentRoles: string[] =
        (userData.user?.app_metadata?.roles as string[]) || [];

      // Remove the group
      const newRoles = currentRoles.filter((r) => r !== group);

      const { error } = await this.supabase.auth.admin.updateUserById(userId, {
        app_metadata: {
          ...userData.user?.app_metadata,
          roles: newRoles,
        },
      });

      if (error) {
        throw error;
      }

      this.logger.log(`User ${username} removed from group ${group}`);
    } catch (error) {
      this.logger.error(
        `Error removing user from group: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to remove user ${username} from group ${group}`,
        "REMOVE_GROUP_ERROR",
        error as Error,
      );
    }
  }

  async changePassword(
    accessToken: string,
    _currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    try {
      // Create a client with the user's access token
      const userClient = createClient(this.config.url, this.config.anonKey, {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });

      const { error } = await userClient.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      this.logger.log("Password changed successfully");
      return true;
    } catch (error) {
      this.logger.error(`Error changing password: ${(error as Error).message}`);
      throw new AuthError(
        "Failed to change password",
        "CHANGE_PASSWORD_ERROR",
        error as Error,
      );
    }
  }

  async forgotPassword(username: string): Promise<boolean> {
    try {
      // In Supabase, forgotPassword uses email, so we need to find the email
      // If username is already an email, use it directly
      const email = username.includes("@")
        ? username
        : await this.getEmailByUsername(username);

      if (!email) {
        throw new Error(`User not found: ${username}`);
      }

      const { error } = await this.supabase.auth.resetPasswordForEmail(email);

      if (error) {
        throw error;
      }

      this.logger.log(`Forgot password initiated for: ${username}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error initiating forgot password: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to initiate forgot password for ${username}`,
        "FORGOT_PASSWORD_ERROR",
        error as Error,
      );
    }
  }

  async confirmForgotPassword(
    username: string,
    password: string,
    confirmationCode: string,
  ): Promise<boolean> {
    try {
      // Get email for the username
      const email = username.includes("@")
        ? username
        : await this.getEmailByUsername(username);

      if (!email) {
        throw new Error(`User not found: ${username}`);
      }

      // Verify the OTP token
      const { data, error: verifyError } = await this.supabase.auth.verifyOtp({
        email,
        token: confirmationCode,
        type: "recovery",
      });

      if (verifyError) {
        throw verifyError;
      }

      // Update the password using the session from OTP verification
      if (data.session) {
        const userClient = createClient(this.config.url, this.config.anonKey, {
          global: {
            headers: {
              Authorization: `Bearer ${data.session.access_token}`,
            },
          },
        });

        const { error: updateError } = await userClient.auth.updateUser({
          password,
        });

        if (updateError) {
          throw updateError;
        }
      }

      this.logger.log(`Password reset confirmed for: ${username}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error confirming forgot password: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to confirm forgot password for ${username}`,
        "CONFIRM_FORGOT_PASSWORD_ERROR",
        error as Error,
      );
    }
  }

  /**
   * Send a magic link for passwordless authentication
   * Uses Supabase's built-in OTP email functionality
   */
  async sendMagicLink(email: string, redirectTo?: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: false, // Don't create new users on login
        },
      });

      if (error) {
        throw error;
      }

      this.logger.log(`Magic link sent to: ${email}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending magic link: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to send magic link to ${email}`,
        "MAGIC_LINK_ERROR",
        error as Error,
      );
    }
  }

  /**
   * Verify a magic link token and return auth tokens
   */
  async verifyMagicLink(email: string, token: string): Promise<IAuthResult> {
    try {
      const { data, error } = await this.supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        throw new Error("No session returned from magic link verification");
      }

      this.logger.log(`Magic link verified for: ${email}`);
      return this.sessionToAuthResult(data.session);
    } catch (error) {
      this.logger.error(
        `Error verifying magic link: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to verify magic link for ${email}`,
        "MAGIC_LINK_VERIFY_ERROR",
        error as Error,
      );
    }
  }

  /**
   * Register a new user with magic link (passwordless registration)
   * Sends a verification email that will create the account on confirmation
   */
  async registerWithMagicLink(
    email: string,
    redirectTo?: string,
  ): Promise<boolean> {
    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: true, // Create user if they don't exist
        },
      });

      if (error) {
        throw error;
      }

      this.logger.log(`Registration magic link sent to: ${email}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending registration magic link: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to send registration magic link to ${email}`,
        "REGISTER_MAGIC_LINK_ERROR",
        error as Error,
      );
    }
  }

  /**
   * Create a session for a verified user (used after passkey authentication)
   * Uses admin.generateLink to create a magic link token, then verifies it to get a session
   */
  async createSessionForUser(email: string): Promise<IAuthResult> {
    try {
      // Generate a magic link using admin API (doesn't send email)
      const { data: linkData, error: linkError } =
        await this.supabase.auth.admin.generateLink({
          type: "magiclink",
          email,
        });

      if (linkError) {
        throw linkError;
      }

      if (!linkData.properties?.hashed_token) {
        throw new Error("Failed to generate magic link token");
      }

      // The hashed_token from generateLink can be used directly with verifyOtp
      // to create a session without sending an email
      const { data, error } = await this.supabase.auth.verifyOtp({
        email,
        token: linkData.properties.hashed_token,
        type: "email",
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        throw new Error("No session returned from token verification");
      }

      this.logger.log(`Session created for verified user: ${email}`);
      return this.sessionToAuthResult(data.session);
    } catch (error) {
      this.logger.error(
        `Error creating session for user: ${(error as Error).message}`,
      );
      throw new AuthError(
        `Failed to create session for ${email}`,
        "CREATE_SESSION_ERROR",
        error as Error,
      );
    }
  }

  /**
   * Helper method to find a user's ID by their username
   * Username is stored in user_metadata
   */
  private async getUserIdByUsername(username: string): Promise<string | null> {
    try {
      // List users and find by username in metadata
      // Note: This is not ideal for large user bases - consider using a lookup table
      const { data, error } = await this.supabase.auth.admin.listUsers();

      if (error) {
        throw error;
      }

      const user = data.users.find(
        (u) => u.user_metadata?.username === username || u.email === username,
      );

      return user?.id || null;
    } catch (error) {
      this.logger.error(
        `Error finding user by username: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Helper method to find a user's email by their username
   */
  private async getEmailByUsername(username: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.auth.admin.listUsers();

      if (error) {
        throw error;
      }

      const user = data.users.find(
        (u) => u.user_metadata?.username === username,
      );

      return user?.email || null;
    } catch (error) {
      this.logger.error(
        `Error finding email by username: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Get circuit breaker health status
   */
  getCircuitBreakerHealth(): CircuitBreakerHealth {
    return this.circuitBreaker.getHealth();
  }
}
