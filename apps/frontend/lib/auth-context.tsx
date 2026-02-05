"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useMutation } from "@apollo/client/react";
import { jwtDecode } from "jwt-decode";
import {
  LOGIN_USER,
  REGISTER_USER,
  SEND_MAGIC_LINK,
  VERIFY_MAGIC_LINK,
  REGISTER_WITH_MAGIC_LINK,
  GENERATE_PASSKEY_REGISTRATION_OPTIONS,
  VERIFY_PASSKEY_REGISTRATION,
  GENERATE_PASSKEY_AUTHENTICATION_OPTIONS,
  VERIFY_PASSKEY_AUTHENTICATION,
  LOGOUT,
  LoginUserInput,
  RegisterUserInput,
  LoginUserData,
  RegisterUserData,
  AuthTokens,
  LogoutData,
} from "./graphql/auth";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

interface User {
  id: string;
  email: string;
  roles: string[];
  department?: string;
  clearance?: string;
}

interface AuthContextType {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  // Password-based auth (legacy)
  login: (input: LoginUserInput) => Promise<void>;
  register: (input: RegisterUserInput) => Promise<boolean>;

  // Passwordless - Passkeys
  supportsPasskeys: boolean;
  hasPlatformAuthenticator: boolean;
  loginWithPasskey: (email?: string) => Promise<void>;
  registerPasskey: (email: string, friendlyName?: string) => Promise<boolean>;

  // Passwordless - Magic Links
  sendMagicLink: (email: string, redirectTo?: string) => Promise<boolean>;
  verifyMagicLink: (email: string, token: string) => Promise<void>;
  registerWithMagicLink: (
    email: string,
    redirectTo?: string,
  ) => Promise<boolean>;
  magicLinkSent: boolean;

  // Common
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// SECURITY: Only store user info, NOT tokens
// Tokens are now stored in httpOnly cookies by the backend
// @see https://github.com/OpusPopuli/opuspopuli/issues/186
const USER_KEY = "auth_user";

function decodeToken(idToken: string): User | null {
  try {
    const decoded = jwtDecode<{
      sub: string;
      email: string;
      "cognito:groups"?: string[];
      "custom:department"?: string;
      "custom:clearance"?: string;
    }>(idToken);

    return {
      id: decoded.sub,
      email: decoded.email,
      roles: decoded["cognito:groups"] || [],
      department: decoded["custom:department"],
      clearance: decoded["custom:clearance"],
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<User | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supportsPasskeys, setSupportsPasskeys] = useState(false);
  const [hasPlatformAuthenticator, setHasPlatformAuthenticator] =
    useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Password-based mutations
  const [loginMutation] = useMutation<LoginUserData>(LOGIN_USER);
  const [registerMutation] = useMutation<RegisterUserData>(REGISTER_USER);

  // Magic link mutations
  const [sendMagicLinkMutation] = useMutation<{ sendMagicLink: boolean }>(
    SEND_MAGIC_LINK,
  );
  const [verifyMagicLinkMutation] = useMutation<{
    verifyMagicLink: AuthTokens;
  }>(VERIFY_MAGIC_LINK);
  const [registerWithMagicLinkMutation] = useMutation<{
    registerWithMagicLink: boolean;
  }>(REGISTER_WITH_MAGIC_LINK);

  // Passkey mutations
  const [generateRegOptions] = useMutation<{
    generatePasskeyRegistrationOptions: {
      options: PublicKeyCredentialCreationOptionsJSON;
    };
  }>(GENERATE_PASSKEY_REGISTRATION_OPTIONS);
  const [verifyRegMutation] = useMutation<{
    verifyPasskeyRegistration: boolean;
  }>(VERIFY_PASSKEY_REGISTRATION);
  const [generateAuthOptions] = useMutation<{
    generatePasskeyAuthenticationOptions: {
      options: PublicKeyCredentialRequestOptionsJSON;
      identifier: string;
    };
  }>(GENERATE_PASSKEY_AUTHENTICATION_OPTIONS);
  const [verifyAuthMutation] = useMutation<{
    verifyPasskeyAuthentication: AuthTokens;
  }>(VERIFY_PASSKEY_AUTHENTICATION);

  // Logout mutation to clear httpOnly cookies
  const [logoutMutation] = useMutation<LogoutData>(LOGOUT);

  // Helper to store user info after authentication
  // SECURITY: Tokens are stored in httpOnly cookies by the backend
  // We only store user metadata in localStorage for UI purposes
  const storeAuth = useCallback((authTokens: AuthTokens) => {
    const decodedUser = decodeToken(authTokens.idToken);
    if (decodedUser) {
      setTokens(authTokens); // Keep in memory for backward compatibility
      setUser(decodedUser);
      localStorage.setItem(USER_KEY, JSON.stringify(decodedUser));
    }
  }, []);

  // Check WebAuthn support on mount
  useEffect(() => {
    const checkWebAuthnSupport = async () => {
      const webAuthnSupported = browserSupportsWebAuthn();
      setSupportsPasskeys(webAuthnSupported);

      if (webAuthnSupported) {
        const platformAvailable = await platformAuthenticatorIsAvailable();
        setHasPlatformAuthenticator(platformAvailable);
      }
    };

    checkWebAuthnSupport();
  }, []);

  // Load stored user on mount
  // SECURITY: We only store user metadata, not tokens
  // Actual authentication relies on httpOnly cookies
  useEffect(() => {
    const storedUser = localStorage.getItem(USER_KEY);

    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as User;
        // Trust the stored user for now - actual auth is validated by httpOnly cookies
        // on the next API request. If cookies are invalid, user will be redirected to login.
        setUser(parsedUser);
      } catch {
        localStorage.removeItem(USER_KEY);
      }
    }

    setIsLoading(false);
  }, []);

  const login = useCallback(
    async (input: LoginUserInput) => {
      setError(null);
      setIsLoading(true);

      try {
        const { data } = await loginMutation({
          variables: { loginUserDto: input },
        });

        if (data?.loginUser) {
          const authTokens = data.loginUser;
          const decodedUser = decodeToken(authTokens.idToken);

          if (decodedUser) {
            setTokens(authTokens); // Keep in memory for backward compatibility
            setUser(decodedUser);
            // SECURITY: Only store user metadata, not tokens
            // Tokens are in httpOnly cookies set by the backend
            localStorage.setItem(USER_KEY, JSON.stringify(decodedUser));
          }
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Login failed. Please try again.";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loginMutation],
  );

  const register = useCallback(
    async (input: RegisterUserInput): Promise<boolean> => {
      setError(null);
      setIsLoading(true);

      try {
        const { data } = await registerMutation({
          variables: { registerUserDto: input },
        });

        return data?.registerUser ?? false;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Registration failed. Please try again.";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [registerMutation],
  );

  // ============================================
  // Passkey Authentication
  // ============================================

  const loginWithPasskey = useCallback(
    async (email?: string) => {
      if (!supportsPasskeys) {
        setError("Passkeys are not supported in this browser");
        throw new Error("Passkeys not supported");
      }

      setError(null);
      setIsLoading(true);

      try {
        // Get authentication options from server
        const { data: optionsData } = await generateAuthOptions({
          variables: { input: email ? { email } : undefined },
        });

        const options = optionsData?.generatePasskeyAuthenticationOptions
          ?.options as PublicKeyCredentialRequestOptionsJSON;
        const identifier =
          optionsData?.generatePasskeyAuthenticationOptions?.identifier;

        if (!options || !identifier) {
          throw new Error("Failed to get authentication options");
        }

        // Get credential from authenticator
        const authResponse = await startAuthentication({
          optionsJSON: options,
        });

        // Verify with server
        const { data: verifyData } = await verifyAuthMutation({
          variables: { input: { identifier, response: authResponse } },
        });

        const authTokens = verifyData?.verifyPasskeyAuthentication;
        if (!authTokens) {
          throw new Error("Passkey authentication failed");
        }

        storeAuth(authTokens);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Passkey authentication failed";
        if (message.includes("NotAllowedError")) {
          setError("Passkey authentication was cancelled");
        } else {
          setError(message);
        }
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [supportsPasskeys, generateAuthOptions, verifyAuthMutation, storeAuth],
  );

  const registerPasskey = useCallback(
    async (email: string, friendlyName?: string): Promise<boolean> => {
      if (!supportsPasskeys) {
        setError("Passkeys are not supported in this browser");
        return false;
      }

      setError(null);
      setIsLoading(true);

      try {
        // Get registration options from server
        const { data: optionsData } = await generateRegOptions({
          variables: { input: { email } },
        });

        const options = optionsData?.generatePasskeyRegistrationOptions
          ?.options as PublicKeyCredentialCreationOptionsJSON;

        if (!options) {
          throw new Error("Failed to get registration options");
        }

        // Create credential using WebAuthn API
        const regResponse = await startRegistration({ optionsJSON: options });

        // Verify with server
        const { data: verifyData } = await verifyRegMutation({
          variables: { input: { email, response: regResponse, friendlyName } },
        });

        if (!verifyData?.verifyPasskeyRegistration) {
          throw new Error("Passkey registration failed");
        }

        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Passkey registration failed";
        if (message.includes("NotAllowedError")) {
          setError("Passkey registration was cancelled");
        } else if (message.includes("InvalidStateError")) {
          setError("This passkey is already registered");
        } else {
          setError(message);
        }
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [supportsPasskeys, generateRegOptions, verifyRegMutation],
  );

  // ============================================
  // Magic Link Authentication
  // ============================================

  const sendMagicLink = useCallback(
    async (email: string, redirectTo?: string): Promise<boolean> => {
      setError(null);
      setIsLoading(true);
      setMagicLinkSent(false);

      try {
        const { data } = await sendMagicLinkMutation({
          variables: { input: { email, redirectTo } },
        });

        if (!data?.sendMagicLink) {
          throw new Error("Failed to send magic link");
        }

        setMagicLinkSent(true);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to send magic link";
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [sendMagicLinkMutation],
  );

  const verifyMagicLink = useCallback(
    async (email: string, token: string) => {
      setError(null);
      setIsLoading(true);

      try {
        const { data } = await verifyMagicLinkMutation({
          variables: { input: { email, token } },
        });

        const authTokens = data?.verifyMagicLink;
        if (!authTokens) {
          throw new Error("Invalid or expired magic link");
        }

        storeAuth(authTokens);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to verify magic link";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [verifyMagicLinkMutation, storeAuth],
  );

  const registerWithMagicLink = useCallback(
    async (email: string, redirectTo?: string): Promise<boolean> => {
      setError(null);
      setIsLoading(true);
      setMagicLinkSent(false);

      try {
        const { data } = await registerWithMagicLinkMutation({
          variables: { input: { email, redirectTo } },
        });

        if (!data?.registerWithMagicLink) {
          throw new Error("Failed to send registration link");
        }

        setMagicLinkSent(true);
        return true;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to send registration link";
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [registerWithMagicLinkMutation],
  );

  // ============================================
  // Common
  // ============================================

  const logout = useCallback(async () => {
    // Call backend to clear httpOnly cookies
    try {
      await logoutMutation();
    } catch {
      // Continue with local cleanup even if backend call fails
      console.warn("Failed to call logout endpoint");
    }

    // Clear local state
    setUser(null);
    setTokens(null);
    setMagicLinkSent(false);
    localStorage.removeItem(USER_KEY);
  }, [logoutMutation]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const contextValue = useMemo(
    () => ({
      user,
      tokens,
      isLoading,
      isAuthenticated: !!user,
      error,

      // Password-based auth
      login,
      register,

      // Passkeys
      supportsPasskeys,
      hasPlatformAuthenticator,
      loginWithPasskey,
      registerPasskey,

      // Magic Links
      sendMagicLink,
      verifyMagicLink,
      registerWithMagicLink,
      magicLinkSent,

      // Common
      logout,
      clearError,
    }),
    [
      user,
      tokens,
      isLoading,
      error,
      login,
      register,
      supportsPasskeys,
      hasPlatformAuthenticator,
      loginWithPasskey,
      registerPasskey,
      sendMagicLink,
      verifyMagicLink,
      registerWithMagicLink,
      magicLinkSent,
      logout,
      clearError,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
