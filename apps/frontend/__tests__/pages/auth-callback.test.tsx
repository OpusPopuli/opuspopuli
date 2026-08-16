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
}));

/**
 * Render with the params actually in the URL.
 *
 * The page reads `location.search` directly rather than `useSearchParams()`,
 * because this route is prerendered as static and that hook is empty until
 * hydration — which silently skipped onboarding for every new registration.
 * Mocking the hook would therefore test a code path the app no longer has, so
 * these tests put the values where the component genuinely looks for them.
 *
 * Each test still declares its params via `mockSearchParamsGet`; this just
 * translates that into a real URL before mounting.
 */
const PARAM_KEYS = ["token", "email", "type", "redirect"] as const;

function renderCallback() {
  const params = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const value = mockSearchParamsGet?.(key);
    if (value) params.set(key, value as string);
  }
  // history.replaceState, not `location.search = ...`: jsdom implements hash
  // changes but not navigation, so assigning search would throw. replaceState
  // updates location without navigating, and preserves any hash the test set
  // before rendering (the hash-exchange cases rely on that).
  const qs = params.toString();
  const search = qs ? `?${qs}` : "";
  const hash = globalThis.location.hash || "";
  globalThis.history.replaceState({}, "", `/auth/callback${search}${hash}`);
  return render(<AuthCallbackPage />);
}

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

      renderCallback();

      await waitFor(() => {
        expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
      });
    });

    it("should show error description", async () => {
      mockSearchParamsGet = jest.fn().mockReturnValue(null);

      renderCallback();

      await waitFor(() => {
        expect(
          screen.getByText(/This magic link has expired or is invalid/),
        ).toBeInTheDocument();
      });
    });

    it("should show back to sign in link", async () => {
      mockSearchParamsGet = jest.fn().mockReturnValue(null);

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

      await waitFor(() => {
        expect(
          screen.getByText("Taking you to the app..."),
        ).toBeInTheDocument();
      });
    });

    // The click this removes. The page used to claim "Redirecting you to the
    // app..." while doing nothing but render a button — a promise the code did
    // not keep.
    it("navigates into the app without waiting for a click", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      renderCallback();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/me/briefing");
      });
    });

    it("honours an explicit ?redirect= when auto-navigating", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "redirect") return "/me/saved";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      renderCallback();

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/me/saved");
      });
    });

    it("does not navigate while verification is still in flight", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      // Never resolves — the page must sit on the spinner, not redirect.
      mockVerifyMagicLink.mockReturnValue(new Promise(() => {}));

      renderCallback();

      await waitFor(() => {
        expect(screen.getByText("Verifying your link...")).toBeInTheDocument();
      });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("should show continue to app button", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);

      renderCallback();

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

      renderCallback();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Continue to App" }),
        ).toBeInTheDocument();
      });

      const continueButton = screen.getByRole("button", {
        name: "Continue to App",
      });
      await userEvent.click(continueButton);

      expect(mockPush).toHaveBeenCalledWith("/me/briefing");
    });

    it("routes a new user without passkeys to onboarding (#758)", async () => {
      // Regression: when the passkey prompt can't render (no WebAuthn /
      // support check unresolved), a fresh registrant must still be sent
      // through onboarding instead of skipping straight to the briefing.
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: false };

      renderCallback();

      const continueButton = await screen.findByRole("button", {
        name: "Continue to App",
      });
      await userEvent.click(continueButton);

      expect(mockPush).toHaveBeenCalledWith("/onboarding");
      expect(mockPush).not.toHaveBeenCalledWith("/me/briefing");
    });
  });

  describe("success state - new user with passkey support", () => {
    // The one screen that must still wait for a click. It offers a real choice
    // — "Add a Passkey" or "Skip for now" — so auto-navigating past it would
    // silently kill passkey enrolment for every new user.
    it("does NOT auto-navigate past the passkey choice", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: true };

      renderCallback();

      await waitFor(() => {
        expect(
          screen.getByText("Welcome! Your account is ready"),
        ).toBeInTheDocument();
      });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("should show passkey prompt for new users", async () => {
      mockSearchParamsGet = jest.fn().mockImplementation((key: string) => {
        if (key === "email") return "test@example.com";
        if (key === "token") return "valid-token";
        if (key === "type") return "register";
        return null;
      });
      mockVerifyMagicLink.mockResolvedValue(undefined);
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: true };

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

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

      renderCallback();

      await waitFor(() => {
        expect(screen.getByText("You're signed in!")).toBeInTheDocument();
      });
    });

    it("should show error when hash token exchange fails", async () => {
      window.location.hash = "#access_token=bad-token";
      mockExchangeSupabaseSession.mockRejectedValue(new Error("Invalid token"));

      renderCallback();

      await waitFor(() => {
        expect(screen.getByText("Link expired or invalid")).toBeInTheDocument();
      });
    });
  });
});
