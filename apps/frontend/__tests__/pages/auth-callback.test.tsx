import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import AuthCallbackPage from "@/app/(auth)/auth/callback/page";

// Mock Next.js router
const mockPush = jest.fn();

// Search params mock
let mockSearchParamsGet: jest.Mock;

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsGet(key),
  }),
}));

// Mock Next.js Link
jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  };
});

// Mock auth context
const mockVerifyMagicLink = jest.fn();
const mockExchangeSupabaseSession = jest.fn();

const defaultAuthContext = {
  verifyMagicLink: mockVerifyMagicLink,
  exchangeSupabaseSession: mockExchangeSupabaseSession,
  isLoading: false,
  error: null as string | null,
  supportsPasskeys: true,
  user: null,
  tokens: null,
  isAuthenticated: false,
  login: jest.fn(),
  loginWithPasskey: jest.fn(),
  sendMagicLink: jest.fn(),
  register: jest.fn(),
  registerWithMagicLink: jest.fn(),
  registerPasskey: jest.fn(),
  logout: jest.fn(),
  clearError: jest.fn(),
  magicLinkSent: false,
  hasPlatformAuthenticator: true,
};

let mockAuthContextValue = { ...defaultAuthContext };

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockAuthContextValue,
}));

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContextValue = { ...defaultAuthContext };
    mockSearchParamsGet = jest.fn().mockReturnValue(null);
  });

  describe("error state", () => {
    it("should show error when no valid params are found", async () => {
      mockSearchParamsGet = jest.fn().mockReturnValue(null);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
      });
    });

    it("should show error description", async () => {
      mockSearchParamsGet = jest.fn().mockReturnValue(null);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByText(/This magic link has expired or is invalid/),
        ).toBeInTheDocument();
      });
    });

    it("should show back to sign in link", async () => {
      mockSearchParamsGet = jest.fn().mockReturnValue(null);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("link", { name: "Back to Sign in" }),
        ).toBeInTheDocument();
      });
    });

    it("should show error when verification fails", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "invalid-token";
        return null;
      });
      mockVerifyMagicLink.mockRejectedValue(new Error("Invalid token"));

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
      });
    });

    it("should display custom error message from context", async () => {
      mockSearchParamsGet = jest.fn().mockReturnValue(null);
      mockAuthContextValue = {
        ...defaultAuthContext,
        error: "Custom error message",
      };

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByText("Custom error message")).toBeInTheDocument();
      });
    });
  });

  describe("verifying state", () => {
    it("should show verifying message when processing with valid params", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      // Make verification take time so we can see loading state
      mockVerifyMagicLink.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      render(<AuthCallbackPage />);

      // Should show verifying state initially
      expect(screen.getByText("Verifying your link...")).toBeInTheDocument();
      expect(
        screen.getByText("Please wait while we sign you in."),
      ).toBeInTheDocument();
    });
  });

  describe("success state - existing user", () => {
    it("should show success message after verification", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByText("You're signed in!")).toBeInTheDocument();
      });
    });

    it("should show redirecting message", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Redirecting you to the app..."),
        ).toBeInTheDocument();
      });
    });

    it("should show continue to app button", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Continue to App" }),
        ).toBeInTheDocument();
      });
    });

    it("should navigate to region when continue is clicked", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Continue to App" }),
        ).toBeInTheDocument();
      });

      const continueButton = screen.getByRole("button", {
        name: "Continue to App",
      });
      await userEvent.click(continueButton);

      expect(mockPush).toHaveBeenCalledWith("/region");
    });
  });

  describe("success state - new user with passkey support", () => {
    it("should show passkey prompt for new users", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: true };

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByText("Welcome! Your account is ready"),
        ).toBeInTheDocument();
      });
    });

    it("should show passkey question for new users", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: true };

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Would you like to add a passkey for faster sign-in next time?",
          ),
        ).toBeInTheDocument();
      });
    });

    it("should show add passkey link for new users", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: true };

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("link", { name: "Add a Passkey" }),
        ).toBeInTheDocument();
      });
    });

    it("should show skip button for new users", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: true };

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Skip for now" }),
        ).toBeInTheDocument();
      });
    });

    it("should navigate to onboarding when skip is clicked", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: true };

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Skip for now" }),
        ).toBeInTheDocument();
      });

      const skipButton = screen.getByRole("button", { name: "Skip for now" });
      await userEvent.click(skipButton);

      expect(mockPush).toHaveBeenCalledWith("/onboarding");
    });
  });

  describe("verification call", () => {
    it("should call verifyMagicLink with correct params", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "magic-token";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(mockVerifyMagicLink).toHaveBeenCalledWith(
          "test@example.com",
          "magic-token",
        );
      });
    });
  });

  describe("Supabase hash token exchange", () => {
    afterEach(() => {
      window.location.hash = "";
    });

    it("should call exchangeSupabaseSession when hash tokens present", async () => {
      window.location.hash =
        "#access_token=supabase-jwt&refresh_token=refresh-jwt&token_type=bearer";
      mockExchangeSupabaseSession.mockResolvedValue(undefined);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(mockExchangeSupabaseSession).toHaveBeenCalledWith(
          "supabase-jwt",
          "refresh-jwt",
        );
      });
    });

    it("should show success after hash token exchange", async () => {
      window.location.hash =
        "#access_token=supabase-jwt&refresh_token=refresh-jwt";
      mockExchangeSupabaseSession.mockResolvedValue(undefined);

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByText("You're signed in!")).toBeInTheDocument();
      });
    });

    it("should show error when hash token exchange fails", async () => {
      window.location.hash = "#access_token=bad-token";
      mockExchangeSupabaseSession.mockRejectedValue(new Error("Invalid token"));

      render(<AuthCallbackPage />);

      await waitFor(() => {
        expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
      });
    });
  });
});
