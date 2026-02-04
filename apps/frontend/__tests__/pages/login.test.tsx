import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import LoginPage from "@/app/(auth)/login/page";

// Mock Next.js router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock auth context
const mockLogin = jest.fn();
const mockLoginWithPasskey = jest.fn();
const mockSendMagicLink = jest.fn();
const mockClearError = jest.fn();

const defaultAuthContext = {
  login: mockLogin,
  loginWithPasskey: mockLoginWithPasskey,
  sendMagicLink: mockSendMagicLink,
  isLoading: false,
  error: null,
  clearError: mockClearError,
  supportsPasskeys: true,
  magicLinkSent: false,
  // Other required context values
  user: null,
  tokens: null,
  isAuthenticated: false,
  register: jest.fn(),
  registerWithMagicLink: jest.fn(),
  verifyMagicLink: jest.fn(),
  registerPasskey: jest.fn(),
  logout: jest.fn(),
  hasPlatformAuthenticator: true,
};

let mockAuthContextValue = { ...defaultAuthContext };

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockAuthContextValue,
}));

describe("LoginPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContextValue = { ...defaultAuthContext };
  });

  describe("rendering", () => {
    it("should render the login page with header", () => {
      render(<LoginPage />);

      expect(screen.getByText("Welcome back")).toBeInTheDocument();
      expect(
        screen.getByText("Sign in to your account to continue"),
      ).toBeInTheDocument();
    });

    it("should render all auth mode tabs when passkeys are supported", () => {
      render(<LoginPage />);

      expect(
        screen.getByRole("button", { name: "Passkey" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Email Link" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Password" }),
      ).toBeInTheDocument();
    });

    it("should not render passkey tab when passkeys are not supported", () => {
      mockAuthContextValue = { ...defaultAuthContext, supportsPasskeys: false };
      render(<LoginPage />);

      expect(
        screen.queryByRole("button", { name: "Passkey" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Email Link" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Password" }),
      ).toBeInTheDocument();
    });

    it("should render register link", () => {
      render(<LoginPage />);

      expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Create one" }),
      ).toBeInTheDocument();
    });
  });

  describe("passkey mode", () => {
    it("should show passkey mode by default when supported", () => {
      render(<LoginPage />);

      expect(
        screen.getByText(
          "Sign in instantly with your fingerprint, face, or device PIN",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Sign in with Passkey/i }),
      ).toBeInTheDocument();
    });

    it("should show optional email input in passkey mode", () => {
      render(<LoginPage />);

      expect(screen.getByLabelText(/Email \(Optional\)/i)).toBeInTheDocument();
    });

    it("should call loginWithPasskey when button is clicked", async () => {
      mockLoginWithPasskey.mockResolvedValue(undefined);
      render(<LoginPage />);

      const button = screen.getByRole("button", {
        name: /Sign in with Passkey/i,
      });
      await userEvent.click(button);

      expect(mockClearError).toHaveBeenCalled();
      expect(mockLoginWithPasskey).toHaveBeenCalledWith(undefined);
    });

    it("should call loginWithPasskey with email when provided", async () => {
      mockLoginWithPasskey.mockResolvedValue(undefined);
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/Email \(Optional\)/i);
      await userEvent.type(emailInput, "test@example.com");

      const button = screen.getByRole("button", {
        name: /Sign in with Passkey/i,
      });
      await userEvent.click(button);

      expect(mockLoginWithPasskey).toHaveBeenCalledWith("test@example.com");
    });

    it("should redirect to onboarding on successful passkey login", async () => {
      mockLoginWithPasskey.mockResolvedValue(undefined);
      render(<LoginPage />);

      const button = screen.getByRole("button", {
        name: /Sign in with Passkey/i,
      });
      await userEvent.click(button);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/onboarding");
      });
    });
  });

  describe("magic link mode", () => {
    it("should switch to magic link mode when tab is clicked", async () => {
      render(<LoginPage />);

      const magicLinkTab = screen.getByRole("button", { name: "Email Link" });
      await userEvent.click(magicLinkTab);

      expect(
        screen.getByText("We'll send you a magic link to sign in instantly"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Send Magic Link/i }),
      ).toBeInTheDocument();
    });

    it("should require email in magic link mode", async () => {
      render(<LoginPage />);

      const magicLinkTab = screen.getByRole("button", { name: "Email Link" });
      await userEvent.click(magicLinkTab);

      const submitButton = screen.getByRole("button", {
        name: /Send Magic Link/i,
      });
      expect(submitButton).toBeDisabled();
    });

    it("should enable submit button when valid email is entered", async () => {
      render(<LoginPage />);

      const magicLinkTab = screen.getByRole("button", { name: "Email Link" });
      await userEvent.click(magicLinkTab);

      const emailInput = screen.getByLabelText(/Email Address/i);
      await userEvent.type(emailInput, "test@example.com");

      const submitButton = screen.getByRole("button", {
        name: /Send Magic Link/i,
      });
      expect(submitButton).not.toBeDisabled();
    });

    it("should call sendMagicLink when form is submitted", async () => {
      mockSendMagicLink.mockResolvedValue(true);
      render(<LoginPage />);

      const magicLinkTab = screen.getByRole("button", { name: "Email Link" });
      await userEvent.click(magicLinkTab);

      const emailInput = screen.getByLabelText(/Email Address/i);
      await userEvent.type(emailInput, "test@example.com");

      const submitButton = screen.getByRole("button", {
        name: /Send Magic Link/i,
      });
      await userEvent.click(submitButton);

      expect(mockClearError).toHaveBeenCalled();
      expect(mockSendMagicLink).toHaveBeenCalled();
    });

    it("should show check email message when magic link is sent", async () => {
      mockAuthContextValue = {
        ...defaultAuthContext,
        magicLinkSent: true,
        supportsPasskeys: false,
      };
      render(<LoginPage />);

      // Switch to magic link mode
      const magicLinkTab = screen.getByRole("button", { name: "Email Link" });
      await userEvent.click(magicLinkTab);

      expect(screen.getByText("Check your email")).toBeInTheDocument();
      expect(
        screen.getByText("The link expires in 2 hours"),
      ).toBeInTheDocument();
    });
  });

  describe("password mode", () => {
    it("should switch to password mode when tab is clicked", async () => {
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
    });

    it("should show forgot password link in password mode", async () => {
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      expect(
        screen.getByRole("link", { name: "Forgot your password?" }),
      ).toBeInTheDocument();
    });

    it("should require email and password", async () => {
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      const submitButton = screen.getByRole("button", { name: "Sign in" });
      expect(submitButton).toBeDisabled();
    });

    it("should enable submit when valid email and password are entered", async () => {
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      const emailInput = screen.getByLabelText(/Email Address/i);
      await userEvent.type(emailInput, "test@example.com");

      const passwordInput = screen.getByLabelText(/^Password$/i);
      await userEvent.type(passwordInput, "password123");

      const submitButton = screen.getByRole("button", { name: "Sign in" });
      expect(submitButton).not.toBeDisabled();
    });

    it("should call login when password form is submitted", async () => {
      mockLogin.mockResolvedValue(undefined);
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      const emailInput = screen.getByLabelText(/Email Address/i);
      await userEvent.type(emailInput, "test@example.com");

      const passwordInput = screen.getByLabelText(/^Password$/i);
      await userEvent.type(passwordInput, "password123");

      const submitButton = screen.getByRole("button", { name: "Sign in" });
      await userEvent.click(submitButton);

      expect(mockClearError).toHaveBeenCalled();
      expect(mockLogin).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "password123",
      });
    });

    it("should toggle password visibility", async () => {
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      const passwordInput = screen.getByLabelText(/^Password$/i);
      expect(passwordInput).toHaveAttribute("type", "password");

      // Find the show/hide password button using its aria-label
      const toggleButton = screen.getByRole("button", {
        name: /show password/i,
      });

      await userEvent.click(toggleButton);
      expect(passwordInput).toHaveAttribute("type", "text");

      // After clicking, the button label changes to "Hide password"
      const hideButton = screen.getByRole("button", { name: /hide password/i });
      expect(hideButton).toBeInTheDocument();
    });

    it("should redirect to onboarding on successful password login", async () => {
      mockLogin.mockResolvedValue(undefined);
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      const emailInput = screen.getByLabelText(/Email Address/i);
      await userEvent.type(emailInput, "test@example.com");

      const passwordInput = screen.getByLabelText(/^Password$/i);
      await userEvent.type(passwordInput, "password123");

      const submitButton = screen.getByRole("button", { name: "Sign in" });
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/onboarding");
      });
    });
  });

  describe("error handling", () => {
    it("should display error message when error exists", () => {
      mockAuthContextValue = {
        ...defaultAuthContext,
        error: "Invalid credentials",
      };
      render(<LoginPage />);

      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });

    it("should clear error when switching auth modes", async () => {
      mockAuthContextValue = { ...defaultAuthContext, error: "Some error" };
      render(<LoginPage />);

      const passwordTab = screen.getByRole("button", { name: "Password" });
      await userEvent.click(passwordTab);

      expect(mockClearError).toHaveBeenCalled();
    });
  });

  describe("loading state", () => {
    it("should show loading state when isLoading is true in passkey mode", () => {
      mockAuthContextValue = { ...defaultAuthContext, isLoading: true };
      render(<LoginPage />);

      expect(screen.getByText("Authenticating...")).toBeInTheDocument();
    });

    it("should disable buttons when loading", () => {
      mockAuthContextValue = { ...defaultAuthContext, isLoading: true };
      render(<LoginPage />);

      const button = screen.getByRole("button", { name: /Authenticating/i });
      expect(button).toBeDisabled();
    });
  });
});
