/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConfigService } from "@nestjs/config";
import { SupabaseAuthProvider } from "../src/providers/supabase.provider";
import { AuthError } from "@opuspopuli/common";

// Mock nodemailer - factory must be self-contained due to jest hoisting
const mockSendMailFn = jest.fn();
jest.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: (...args: any[]) => mockSendMailFn(...args),
  }),
}));

// Mock the Supabase client
const mockAuth = {
  signInWithPassword: jest.fn(),
  resetPasswordForEmail: jest.fn(),
  updateUser: jest.fn(),
  verifyOtp: jest.fn(),
  signInWithOtp: jest.fn(),
  getUser: jest.fn(),
  admin: {
    createUser: jest.fn(),
    deleteUser: jest.fn(),
    updateUserById: jest.fn(),
    getUserById: jest.fn(),
    listUsers: jest.fn(),
    generateLink: jest.fn(),
  },
};

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn().mockImplementation(() => ({
    auth: mockAuth,
  })),
}));

describe("SupabaseAuthProvider", () => {
  let provider: SupabaseAuthProvider;
  let configService: ConfigService;

  const createConfigService = (
    overrides: Record<string, string | undefined> = {},
  ) => {
    const config: Record<string, string | undefined> = {
      "supabase.url": "http://localhost:8000",
      "supabase.anonKey": "test-anon-key",
      "supabase.serviceRoleKey": "test-service-key",
      ...overrides,
    };
    return {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService = createConfigService();
    provider = new SupabaseAuthProvider(configService);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider).toBeDefined();
      expect(provider.getName()).toBe("SupabaseAuthProvider");
    });

    it("should throw AuthError when config is missing", () => {
      const badConfig = createConfigService({
        "supabase.url": undefined,
        "supabase.anonKey": undefined,
      });

      expect(() => new SupabaseAuthProvider(badConfig)).toThrow(AuthError);
    });
  });

  describe("registerUser", () => {
    it("should register user successfully", async () => {
      mockAuth.admin.createUser.mockResolvedValue({
        data: { user: { id: "user-uuid-123" } },
        error: null,
      });

      const result = await provider.registerUser({
        email: "test@example.com",
        username: "testuser",
        password: "Password123!",
      });

      expect(result).toBe("user-uuid-123");
      expect(mockAuth.admin.createUser).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "Password123!",
        email_confirm: false,
        user_metadata: { username: "testuser" },
      });
    });

    it("should register user with custom attributes", async () => {
      mockAuth.admin.createUser.mockResolvedValue({
        data: { user: { id: "user-uuid-123" } },
        error: null,
      });

      const result = await provider.registerUser({
        email: "test@example.com",
        username: "testuser",
        password: "Password123!",
        attributes: {
          department: "Engineering",
          "custom:clearance": "Top Secret",
        },
      });

      expect(result).toBe("user-uuid-123");
      expect(mockAuth.admin.createUser).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "Password123!",
        email_confirm: false,
        user_metadata: {
          username: "testuser",
          department: "Engineering",
          clearance: "Top Secret",
        },
      });
    });

    it("should return unknown when user id is missing", async () => {
      mockAuth.admin.createUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await provider.registerUser({
        email: "test@example.com",
        username: "testuser",
        password: "Password123!",
      });

      expect(result).toBe("unknown");
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.admin.createUser.mockResolvedValue({
        data: null,
        error: { message: "User already exists" },
      });

      await expect(
        provider.registerUser({
          email: "test@example.com",
          username: "testuser",
          password: "Password123!",
        }),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("authenticateUser", () => {
    it("should authenticate user successfully", async () => {
      mockAuth.signInWithPassword.mockResolvedValue({
        data: {
          session: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          },
          user: { id: "user-id" },
        },
        error: null,
      });

      const result = await provider.authenticateUser(
        "test@example.com",
        "Password123!",
      );

      expect(result).toEqual({
        accessToken: "access-token",
        idToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      });
    });

    it("should handle missing session", async () => {
      mockAuth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: null,
      });

      const result = await provider.authenticateUser(
        "test@example.com",
        "Password123!",
      );

      expect(result).toEqual({
        accessToken: "",
        idToken: "",
        refreshToken: "",
        expiresIn: undefined,
      });
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: "Invalid credentials" },
      });

      await expect(
        provider.authenticateUser("test@example.com", "wrong-password"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("confirmUser", () => {
    it("should confirm user successfully", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });

      await expect(provider.confirmUser("testuser")).resolves.toBeUndefined();
      expect(mockAuth.admin.updateUserById).toHaveBeenCalledWith("user-123", {
        email_confirm: true,
      });
    });

    it("should throw AuthError when user not found", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      await expect(provider.confirmUser("unknownuser")).rejects.toThrow(
        AuthError,
      );
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: "Confirm failed" },
      });

      await expect(provider.confirmUser("testuser")).rejects.toThrow(AuthError);
    });
  });

  describe("deleteUser", () => {
    it("should delete user successfully", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.deleteUser.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await provider.deleteUser("testuser");

      expect(result).toBe(true);
    });

    it("should throw AuthError when user not found", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      await expect(provider.deleteUser("unknownuser")).rejects.toThrow(
        AuthError,
      );
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.deleteUser.mockResolvedValue({
        data: null,
        error: { message: "Delete failed" },
      });

      await expect(provider.deleteUser("testuser")).rejects.toThrow(AuthError);
    });
  });

  describe("addToGroup", () => {
    it("should add user to group successfully", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.getUserById.mockResolvedValue({
        data: {
          user: { id: "user-123", app_metadata: { roles: [] } },
        },
        error: null,
      });
      mockAuth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });

      await expect(
        provider.addToGroup("testuser", "admin"),
      ).resolves.toBeUndefined();
      expect(mockAuth.admin.updateUserById).toHaveBeenCalledWith("user-123", {
        app_metadata: { roles: ["admin"] },
      });
    });

    it("should not add duplicate role", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.getUserById.mockResolvedValue({
        data: {
          user: { id: "user-123", app_metadata: { roles: ["admin"] } },
        },
        error: null,
      });

      await provider.addToGroup("testuser", "admin");

      // updateUserById should not be called since role already exists
      expect(mockAuth.admin.updateUserById).not.toHaveBeenCalled();
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.getUserById.mockResolvedValue({
        data: null,
        error: { message: "Get user failed" },
      });

      await expect(provider.addToGroup("testuser", "admin")).rejects.toThrow(
        AuthError,
      );
    });
  });

  describe("removeFromGroup", () => {
    it("should remove user from group successfully", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.getUserById.mockResolvedValue({
        data: {
          user: { id: "user-123", app_metadata: { roles: ["admin", "user"] } },
        },
        error: null,
      });
      mockAuth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });

      await expect(
        provider.removeFromGroup("testuser", "admin"),
      ).resolves.toBeUndefined();
      expect(mockAuth.admin.updateUserById).toHaveBeenCalledWith("user-123", {
        app_metadata: { roles: ["user"] },
      });
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.getUserById.mockResolvedValue({
        data: null,
        error: { message: "Get user failed" },
      });

      await expect(
        provider.removeFromGroup("testuser", "admin"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("changePassword", () => {
    it("should change password successfully", async () => {
      mockAuth.updateUser.mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });

      const result = await provider.changePassword(
        "access-token",
        "OldPass123!",
        "NewPass123!",
      );

      expect(result).toBe(true);
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.updateUser.mockResolvedValue({
        data: null,
        error: { message: "Change password failed" },
      });

      await expect(
        provider.changePassword("access-token", "OldPass123!", "NewPass123!"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("forgotPassword", () => {
    it("should initiate forgot password with email successfully", async () => {
      mockAuth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await provider.forgotPassword("test@example.com");

      expect(result).toBe(true);
      expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith(
        "test@example.com",
      );
    });

    it("should initiate forgot password with username successfully", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [
            {
              id: "user-123",
              email: "test@example.com",
              user_metadata: { username: "testuser" },
            },
          ],
        },
        error: null,
      });
      mockAuth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await provider.forgotPassword("testuser");

      expect(result).toBe(true);
      expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith(
        "test@example.com",
      );
    });

    it("should throw AuthError when user not found by username", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      await expect(provider.forgotPassword("unknownuser")).rejects.toThrow(
        AuthError,
      );
    });

    it("should throw AuthError on failure", async () => {
      mockAuth.resetPasswordForEmail.mockResolvedValue({
        data: null,
        error: { message: "Forgot password failed" },
      });

      await expect(provider.forgotPassword("test@example.com")).rejects.toThrow(
        AuthError,
      );
    });
  });

  describe("confirmForgotPassword", () => {
    it("should confirm forgot password successfully", async () => {
      mockAuth.verifyOtp.mockResolvedValue({
        data: {
          session: { access_token: "temp-token" },
        },
        error: null,
      });
      mockAuth.updateUser.mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });

      const result = await provider.confirmForgotPassword(
        "test@example.com",
        "NewPass123!",
        "123456",
      );

      expect(result).toBe(true);
      expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
        email: "test@example.com",
        token: "123456",
        type: "recovery",
      });
    });

    it("should throw AuthError when OTP verification fails", async () => {
      mockAuth.verifyOtp.mockResolvedValue({
        data: null,
        error: { message: "Invalid OTP" },
      });

      await expect(
        provider.confirmForgotPassword(
          "test@example.com",
          "NewPass123!",
          "bad",
        ),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError on password update failure", async () => {
      mockAuth.verifyOtp.mockResolvedValue({
        data: {
          session: { access_token: "temp-token" },
        },
        error: null,
      });
      mockAuth.updateUser.mockResolvedValue({
        data: null,
        error: { message: "Update failed" },
      });

      await expect(
        provider.confirmForgotPassword(
          "test@example.com",
          "NewPass123!",
          "123456",
        ),
      ).rejects.toThrow(AuthError);
    });

    it("should confirm forgot password with username successfully", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [
            {
              id: "user-123",
              email: "test@example.com",
              user_metadata: { username: "testuser" },
            },
          ],
        },
        error: null,
      });
      mockAuth.verifyOtp.mockResolvedValue({
        data: {
          session: { access_token: "temp-token" },
        },
        error: null,
      });
      mockAuth.updateUser.mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });

      const result = await provider.confirmForgotPassword(
        "testuser",
        "NewPass123!",
        "123456",
      );

      expect(result).toBe(true);
      expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
        email: "test@example.com",
        token: "123456",
        type: "recovery",
      });
    });

    it("should throw AuthError when user not found by username", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      await expect(
        provider.confirmForgotPassword("unknownuser", "NewPass123!", "123456"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("sendMagicLink", () => {
    it("should send magic link successfully via admin.generateLink + SMTP", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            action_link: "http://localhost:8000/auth/v1/verify?token=abc123",
          },
        },
        error: null,
      });

      const result = await provider.sendMagicLink("test@example.com");

      expect(result).toBe(true);
      expect(mockAuth.admin.generateLink).toHaveBeenCalledWith({
        type: "magiclink",
        email: "test@example.com",
        options: {
          redirectTo: "http://localhost:3200/auth/callback",
        },
      });
      expect(mockSendMailFn).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "test@example.com",
          subject: "Sign in to Opus Populi",
        }),
      );
    });

    it("should send magic link with custom redirectTo", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            action_link: "http://localhost:8000/auth/v1/verify?token=abc123",
          },
        },
        error: null,
      });

      const result = await provider.sendMagicLink(
        "test@example.com",
        "http://localhost:3000/callback",
      );

      expect(result).toBe(true);
      expect(mockAuth.admin.generateLink).toHaveBeenCalledWith({
        type: "magiclink",
        email: "test@example.com",
        options: {
          redirectTo: "http://localhost:3000/callback",
        },
      });
    });

    it("should throw AuthError when generateLink fails", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: null,
        error: { message: "Failed to generate link" },
      });

      await expect(provider.sendMagicLink("test@example.com")).rejects.toThrow(
        AuthError,
      );
    });

    it("should throw AuthError when action_link is missing", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: { properties: {} },
        error: null,
      });

      await expect(provider.sendMagicLink("test@example.com")).rejects.toThrow(
        AuthError,
      );
    });

    it("should throw AuthError when SMTP send fails", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            action_link: "http://localhost:8000/auth/v1/verify?token=abc123",
          },
        },
        error: null,
      });
      mockSendMailFn.mockRejectedValueOnce(new Error("SMTP connection failed"));

      await expect(provider.sendMagicLink("test@example.com")).rejects.toThrow(
        AuthError,
      );
    });
  });

  describe("verifyMagicLink", () => {
    it("should verify magic link successfully", async () => {
      mockAuth.verifyOtp.mockResolvedValue({
        data: {
          session: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          },
        },
        error: null,
      });

      const result = await provider.verifyMagicLink(
        "test@example.com",
        "123456",
      );

      expect(result).toEqual({
        accessToken: "access-token",
        idToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      });
      expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
        email: "test@example.com",
        token: "123456",
        type: "email",
      });
    });

    it("should handle missing refresh token", async () => {
      mockAuth.verifyOtp.mockResolvedValue({
        data: {
          session: {
            access_token: "access-token",
            expires_in: 3600,
          },
        },
        error: null,
      });

      const result = await provider.verifyMagicLink(
        "test@example.com",
        "123456",
      );

      expect(result.refreshToken).toBe("");
    });

    it("should throw AuthError on verification failure", async () => {
      mockAuth.verifyOtp.mockResolvedValue({
        data: null,
        error: { message: "Invalid OTP" },
      });

      await expect(
        provider.verifyMagicLink("test@example.com", "bad"),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError when no session returned", async () => {
      mockAuth.verifyOtp.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(
        provider.verifyMagicLink("test@example.com", "123456"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("registerWithMagicLink", () => {
    it("should send registration magic link successfully via admin.generateLink + SMTP", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            action_link: "http://localhost:8000/auth/v1/verify?token=abc123",
          },
        },
        error: null,
      });

      const result = await provider.registerWithMagicLink("test@example.com");

      expect(result).toBe(true);
      expect(mockAuth.admin.generateLink).toHaveBeenCalledWith({
        type: "signup",
        email: "test@example.com",
        password: expect.any(String),
        options: {
          redirectTo: "http://localhost:3200/auth/callback",
        },
      });
      expect(mockSendMailFn).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "test@example.com",
          subject: "Welcome to Opus Populi - Verify your email",
        }),
      );
    });

    it("should send registration magic link with custom redirectTo", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            action_link: "http://localhost:8000/auth/v1/verify?token=abc123",
          },
        },
        error: null,
      });

      const result = await provider.registerWithMagicLink(
        "test@example.com",
        "http://localhost:3000/callback",
      );

      expect(result).toBe(true);
      expect(mockAuth.admin.generateLink).toHaveBeenCalledWith({
        type: "signup",
        email: "test@example.com",
        password: expect.any(String),
        options: {
          redirectTo: "http://localhost:3000/callback",
        },
      });
    });

    it("should throw AuthError when generateLink fails", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: null,
        error: { message: "Failed to generate registration link" },
      });

      await expect(
        provider.registerWithMagicLink("test@example.com"),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError when action_link is missing", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: { properties: {} },
        error: null,
      });

      await expect(
        provider.registerWithMagicLink("test@example.com"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("createSessionForUser", () => {
    it("should create session for verified user successfully", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            hashed_token: "hashed-magic-token",
          },
        },
        error: null,
      });
      mockAuth.verifyOtp.mockResolvedValue({
        data: {
          session: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          },
        },
        error: null,
      });

      const result = await provider.createSessionForUser("test@example.com");

      expect(result).toEqual({
        accessToken: "access-token",
        idToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      });
      expect(mockAuth.admin.generateLink).toHaveBeenCalledWith({
        type: "magiclink",
        email: "test@example.com",
      });
      expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
        email: "test@example.com",
        token: "hashed-magic-token",
        type: "email",
      });
    });

    it("should handle missing refresh token", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            hashed_token: "hashed-magic-token",
          },
        },
        error: null,
      });
      mockAuth.verifyOtp.mockResolvedValue({
        data: {
          session: {
            access_token: "access-token",
            expires_in: 3600,
          },
        },
        error: null,
      });

      const result = await provider.createSessionForUser("test@example.com");

      expect(result.refreshToken).toBe("");
    });

    it("should throw AuthError when generateLink fails", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: null,
        error: { message: "Failed to generate link" },
      });

      await expect(
        provider.createSessionForUser("test@example.com"),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError when hashed_token is missing", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {},
        },
        error: null,
      });

      await expect(
        provider.createSessionForUser("test@example.com"),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError when verifyOtp fails", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            hashed_token: "hashed-magic-token",
          },
        },
        error: null,
      });
      mockAuth.verifyOtp.mockResolvedValue({
        data: null,
        error: { message: "Invalid OTP" },
      });

      await expect(
        provider.createSessionForUser("test@example.com"),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError when no session returned", async () => {
      mockAuth.admin.generateLink.mockResolvedValue({
        data: {
          properties: {
            hashed_token: "hashed-magic-token",
          },
        },
        error: null,
      });
      mockAuth.verifyOtp.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      await expect(
        provider.createSessionForUser("test@example.com"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("addToGroup edge cases", () => {
    it("should throw AuthError when user not found", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      await expect(provider.addToGroup("unknownuser", "admin")).rejects.toThrow(
        AuthError,
      );
    });

    it("should throw AuthError on update failure", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.getUserById.mockResolvedValue({
        data: {
          user: { id: "user-123", app_metadata: { roles: [] } },
        },
        error: null,
      });
      mockAuth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: "Update failed" },
      });

      await expect(provider.addToGroup("testuser", "admin")).rejects.toThrow(
        AuthError,
      );
    });
  });

  describe("removeFromGroup edge cases", () => {
    it("should throw AuthError when user not found", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: { users: [] },
        error: null,
      });

      await expect(
        provider.removeFromGroup("unknownuser", "admin"),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError on update failure", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", user_metadata: { username: "testuser" } }],
        },
        error: null,
      });
      mockAuth.admin.getUserById.mockResolvedValue({
        data: {
          user: { id: "user-123", app_metadata: { roles: ["admin"] } },
        },
        error: null,
      });
      mockAuth.admin.updateUserById.mockResolvedValue({
        data: null,
        error: { message: "Update failed" },
      });

      await expect(
        provider.removeFromGroup("testuser", "admin"),
      ).rejects.toThrow(AuthError);
    });
  });

  describe("getUserIdByUsername edge cases", () => {
    it("should find user by email when username not in metadata", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: {
          users: [{ id: "user-123", email: "test@example.com" }],
        },
        error: null,
      });
      mockAuth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: "user-123" } },
        error: null,
      });

      await expect(
        provider.confirmUser("test@example.com"),
      ).resolves.toBeUndefined();
    });

    it("should handle listUsers error gracefully", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: null,
        error: { message: "List users failed" },
      });

      await expect(provider.confirmUser("testuser")).rejects.toThrow(AuthError);
    });
  });

  describe("getEmailByUsername edge cases", () => {
    it("should handle listUsers error gracefully in forgotPassword", async () => {
      mockAuth.admin.listUsers.mockResolvedValue({
        data: null,
        error: { message: "List users failed" },
      });

      await expect(provider.forgotPassword("testuser")).rejects.toThrow(
        AuthError,
      );
    });
  });

  describe("circuit breaker", () => {
    it("should provide circuit breaker health", () => {
      const health = provider.getCircuitBreakerHealth();

      expect(health).toBeDefined();
      expect(health.serviceName).toBe("Supabase");
      expect(health.state).toBe("closed");
      expect(health.isHealthy).toBe(true);
      expect(health.failureCount).toBe(0);
    });

    it("should track failures through circuit breaker", async () => {
      // Simulate consecutive failures
      mockAuth.admin.createUser.mockResolvedValue({
        data: null,
        error: { message: "Service unavailable" },
      });

      for (let i = 0; i < 3; i++) {
        await provider
          .registerUser({
            email: `test${i}@example.com`,
            username: `testuser${i}`,
            password: "Password123!",
          })
          .catch(() => {});
      }

      const health = provider.getCircuitBreakerHealth();
      expect(health.failureCount).toBeGreaterThan(0);
    });

    it("should reset failure count on success", async () => {
      // First fail
      mockAuth.admin.createUser.mockResolvedValue({
        data: null,
        error: { message: "Service unavailable" },
      });
      await provider
        .registerUser({
          email: "fail@example.com",
          username: "failuser",
          password: "Password123!",
        })
        .catch(() => {});

      // Then succeed
      mockAuth.admin.createUser.mockResolvedValue({
        data: { user: { id: "user-uuid-123" } },
        error: null,
      });

      await provider.registerUser({
        email: "success@example.com",
        username: "successuser",
        password: "Password123!",
      });

      const health = provider.getCircuitBreakerHealth();
      expect(health.failureCount).toBe(0);
    });

    it("should protect authenticateUser with circuit breaker", async () => {
      // Simulate failures
      mockAuth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: "Service unavailable" },
      });

      for (let i = 0; i < 3; i++) {
        await provider
          .authenticateUser(`test${i}@example.com`, "password")
          .catch(() => {});
      }

      const health = provider.getCircuitBreakerHealth();
      expect(health.failureCount).toBeGreaterThan(0);
    });
  });

  describe("validateAccessToken", () => {
    it("should validate token and return email", async () => {
      mockAuth.getUser.mockResolvedValue({
        data: {
          user: { id: "user-123", email: "test@example.com" },
        },
        error: null,
      });

      const email = await provider.validateAccessToken("valid-jwt-token");

      expect(email).toBe("test@example.com");
      expect(mockAuth.getUser).toHaveBeenCalledWith("valid-jwt-token");
    });

    it("should throw AuthError when token is invalid", async () => {
      mockAuth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid token" },
      });

      await expect(
        provider.validateAccessToken("invalid-token"),
      ).rejects.toThrow(AuthError);
    });

    it("should throw AuthError when user has no email", async () => {
      mockAuth.getUser.mockResolvedValue({
        data: {
          user: { id: "user-123", email: null },
        },
        error: null,
      });

      await expect(
        provider.validateAccessToken("valid-but-no-email"),
      ).rejects.toThrow(AuthError);
    });
  });
});
