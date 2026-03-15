import { waitFor, act, renderHook } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import "@testing-library/jest-dom";

// Mock jwt-decode
jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn((token: string) => {
    if (token === "valid-id-token" || token === "valid-access-token") {
      return {
        sub: "user-123",
        email: "test@example.com",
        "cognito:groups": ["user"],
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      };
    }
    if (token === "expired-token") {
      return {
        sub: "user-123",
        email: "test@example.com",
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };
    }
    throw new Error("Invalid token");
  }),
}));

// Mock WebAuthn browser APIs
const mockBrowserSupportsWebAuthn = jest.fn(() => true);
const mockPlatformAuthenticatorIsAvailable = jest.fn(() =>
  Promise.resolve(true),
);
const mockStartRegistration = jest.fn();
const mockStartAuthentication = jest.fn();

jest.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => mockBrowserSupportsWebAuthn(),
  platformAuthenticatorIsAvailable: () =>
    mockPlatformAuthenticatorIsAvailable(),
  startRegistration: (options: unknown) => mockStartRegistration(options),
  startAuthentication: (options: unknown) => mockStartAuthentication(options),
}));

// Mock Apollo Client
const mockLoginMutation = jest.fn();
const mockRegisterMutation = jest.fn();
const mockSendMagicLinkMutation = jest.fn();
const mockVerifyMagicLinkMutation = jest.fn();
const mockRegisterWithMagicLinkMutation = jest.fn();
const mockGenerateRegOptions = jest.fn();
const mockVerifyRegMutation = jest.fn();
const mockGenerateAuthOptions = jest.fn();
const mockVerifyAuthMutation = jest.fn();
const mockExchangeSupabaseSessionMutation = jest.fn();
const mockLogoutMutation = jest.fn();

jest.mock("@apollo/client/react", () => ({
  useMutation: jest.fn((mutation) => {
    const mutationName = mutation?.definitions?.[0]?.name?.value;
    switch (mutationName) {
      case "LoginUser":
        return [mockLoginMutation, { loading: false }];
      case "RegisterUser":
        return [mockRegisterMutation, { loading: false }];
      case "SendMagicLink":
        return [mockSendMagicLinkMutation, { loading: false }];
      case "VerifyMagicLink":
        return [mockVerifyMagicLinkMutation, { loading: false }];
      case "RegisterWithMagicLink":
        return [mockRegisterWithMagicLinkMutation, { loading: false }];
      case "ExchangeSupabaseSession":
        return [mockExchangeSupabaseSessionMutation, { loading: false }];
      case "GeneratePasskeyRegistrationOptions":
        return [mockGenerateRegOptions, { loading: false }];
      case "VerifyPasskeyRegistration":
        return [mockVerifyRegMutation, { loading: false }];
      case "GeneratePasskeyAuthenticationOptions":
        return [mockGenerateAuthOptions, { loading: false }];
      case "VerifyPasskeyAuthentication":
        return [mockVerifyAuthMutation, { loading: false }];
      case "Logout":
        return [mockLogoutMutation, { loading: false }];
      default:
        return [jest.fn(), { loading: false }];
    }
  }),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    _getStore: () => store,
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("AuthProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockPlatformAuthenticatorIsAvailable.mockResolvedValue(true);
  });

  describe("initial state", () => {
    it("should provide auth context", async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(result.current.user).toBeNull();
      expect(result.current.tokens).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should detect WebAuthn support", async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(result.current.supportsPasskeys).toBe(true);
      expect(result.current.hasPlatformAuthenticator).toBe(true);
    });

    it("should throw error when used outside provider", () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow("useAuth must be used within an AuthProvider");

      consoleError.mockRestore();
    });
  });

  describe("password-based login", () => {
    const mockTokens = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "valid-id-token",
    };

    it("should login successfully", async () => {
      mockLoginMutation.mockResolvedValue({
        data: { loginUser: mockTokens },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        await result.current.login({
          email: "test@example.com",
          password: "password123",
        });
      });

      expect(result.current.user).toEqual({
        id: "user-123",
        email: "test@example.com",
        roles: ["user"],
        department: undefined,
        clearance: undefined,
      });
      expect(result.current.isAuthenticated).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it("should handle login error", async () => {
      mockLoginMutation.mockRejectedValue(new Error("Invalid credentials"));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        try {
          await result.current.login({
            email: "test@example.com",
            password: "wrong-password",
          });
        } catch {
          // Expected to throw
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe("Invalid credentials");
      });
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe("password-based registration", () => {
    it("should register successfully", async () => {
      mockRegisterMutation.mockResolvedValue({
        data: { registerUser: true },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      let success: boolean = false;
      await act(async () => {
        success = await result.current.register({
          email: "new@example.com",
          username: "newuser",
          password: "password123",
        });
      });

      expect(success).toBe(true);
    });

    it("should handle registration error", async () => {
      mockRegisterMutation.mockRejectedValue(new Error("Email already exists"));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        try {
          await result.current.register({
            email: "existing@example.com",
            username: "existinguser",
            password: "password123",
          });
        } catch {
          // Expected to throw
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe("Email already exists");
      });
    });
  });

  describe("magic link authentication", () => {
    it("should send magic link successfully", async () => {
      mockSendMagicLinkMutation.mockResolvedValue({
        data: { sendMagicLink: true },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      let success: boolean = false;
      await act(async () => {
        success = await result.current.sendMagicLink("test@example.com");
      });

      expect(success).toBe(true);
      expect(result.current.magicLinkSent).toBe(true);
    });

    it("should verify magic link successfully", async () => {
      mockVerifyMagicLinkMutation.mockResolvedValue({
        data: {
          verifyMagicLink: {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            idToken: "valid-id-token",
          },
        },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        await result.current.verifyMagicLink("test@example.com", "magic-token");
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.email).toBe("test@example.com");
    });

    it("should register with magic link successfully", async () => {
      mockRegisterWithMagicLinkMutation.mockResolvedValue({
        data: { registerWithMagicLink: true },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      let success: boolean = false;
      await act(async () => {
        success = await result.current.registerWithMagicLink("new@example.com");
      });

      expect(success).toBe(true);
      expect(result.current.magicLinkSent).toBe(true);
    });

    it("should exchange Supabase session successfully", async () => {
      mockExchangeSupabaseSessionMutation.mockResolvedValue({
        data: {
          exchangeSupabaseSession: {
            accessToken: "valid-access-token",
            refreshToken: "refresh-token",
            idToken: "valid-id-token",
          },
        },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        await result.current.exchangeSupabaseSession(
          "valid-access-token",
          "refresh-token",
        );
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.email).toBe("test@example.com");
      expect(mockExchangeSupabaseSessionMutation).toHaveBeenCalledWith({
        variables: {
          input: {
            accessToken: "valid-access-token",
            refreshToken: "refresh-token",
          },
        },
      });
    });

    it("should handle exchange Supabase session error", async () => {
      mockExchangeSupabaseSessionMutation.mockRejectedValue(
        new Error("Invalid token"),
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        try {
          await result.current.exchangeSupabaseSession(
            "bad-token",
            "refresh-token",
          );
        } catch {
          // Expected
        }
      });

      expect(result.current.error).toBe("Invalid token");
    });
  });

  describe("passkey authentication", () => {
    const mockAuthOptions = {
      challenge: "auth-challenge",
      rpId: "localhost",
      allowCredentials: [],
    };

    const mockTokens = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "valid-id-token",
    };

    it("should login with passkey successfully", async () => {
      mockGenerateAuthOptions.mockResolvedValue({
        data: {
          generatePasskeyAuthenticationOptions: {
            options: mockAuthOptions,
            identifier: "session-123",
          },
        },
      });
      mockStartAuthentication.mockResolvedValue({
        id: "credential-id",
        rawId: "raw-id",
        response: {
          clientDataJSON: "data",
          authenticatorData: "auth",
          signature: "sig",
        },
        type: "public-key",
      });
      mockVerifyAuthMutation.mockResolvedValue({
        data: { verifyPasskeyAuthentication: mockTokens },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        await result.current.loginWithPasskey("test@example.com");
      });

      expect(result.current.isAuthenticated).toBe(true);
    });

    it("should fail passkey login if not supported", async () => {
      mockBrowserSupportsWebAuthn.mockReturnValue(false);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        try {
          await result.current.loginWithPasskey();
        } catch {
          // Expected to throw
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe(
          "Passkeys are not supported in this browser",
        );
      });
    });

    it("should register passkey successfully", async () => {
      mockGenerateRegOptions.mockResolvedValue({
        data: {
          generatePasskeyRegistrationOptions: {
            options: {
              challenge: "reg-challenge",
              rp: { name: "Test", id: "localhost" },
              user: {
                id: "user-id",
                name: "test@example.com",
                displayName: "Test",
              },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            },
          },
        },
      });
      mockStartRegistration.mockResolvedValue({
        id: "credential-id",
        rawId: "raw-id",
        response: { clientDataJSON: "data", attestationObject: "attestation" },
        type: "public-key",
      });
      mockVerifyRegMutation.mockResolvedValue({
        data: { verifyPasskeyRegistration: true },
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      let success: boolean = false;
      await act(async () => {
        success = await result.current.registerPasskey(
          "test@example.com",
          "My Device",
        );
      });

      expect(success).toBe(true);
    });
  });

  describe("logout", () => {
    it("should clear auth state on logout", async () => {
      mockLoginMutation.mockResolvedValue({
        data: {
          loginUser: {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            idToken: "valid-id-token",
          },
        },
      });
      // Mock logout mutation to succeed
      mockLogoutMutation.mockResolvedValue({ data: { logout: true } });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        await result.current.login({
          email: "test@example.com",
          password: "password123",
        });
      });

      expect(result.current.isAuthenticated).toBe(true);

      // Logout is now async
      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.tokens).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      // SECURITY: We only store user metadata now, not tokens
      // Tokens are stored in httpOnly cookies by the backend
      expect(localStorageMock.removeItem).toHaveBeenCalledWith("auth_user");
    });
  });

  describe("clearError", () => {
    it("should clear error state", async () => {
      mockLoginMutation.mockRejectedValue(new Error("Test error"));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await act(async () => {
        try {
          await result.current.login({
            email: "test@example.com",
            password: "wrong",
          });
        } catch {
          // Expected to throw
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe("Test error");
      });

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("stored auth restoration", () => {
    it("should restore valid stored auth on mount", async () => {
      const storedTokens = {
        accessToken: "valid-access-token",
        refreshToken: "refresh-token",
        idToken: "valid-id-token",
      };
      const storedUser = {
        id: "user-123",
        email: "test@example.com",
        roles: ["user"],
      };

      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === "auth_tokens") return JSON.stringify(storedTokens);
        if (key === "auth_user") return JSON.stringify(storedUser);
        return null;
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.email).toBe("test@example.com");
    });

    // SECURITY: Token expiry is no longer checked in frontend
    // We trust stored user metadata and rely on httpOnly cookies for actual auth validation
    // If cookies are invalid, the next API request will fail and redirect to login
    // This test now verifies that stored user metadata is restored on mount
    it("should restore stored user metadata on mount (token validation via httpOnly cookies)", async () => {
      const storedUser = {
        id: "user-123",
        email: "test@example.com",
        roles: ["user"],
      };

      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === "auth_user") return JSON.stringify(storedUser);
        return null;
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // User is considered authenticated based on stored metadata
      // Actual auth is validated by httpOnly cookies on the next API request
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(storedUser);
    });
  });
});
