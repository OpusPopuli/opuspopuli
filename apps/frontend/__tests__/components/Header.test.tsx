import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Header } from "@/components/Header";

// Mock auth context
const mockLogout = jest.fn();

const defaultAuthContext = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  tokens: null,
  login: jest.fn(),
  loginWithPasskey: jest.fn(),
  sendMagicLink: jest.fn(),
  register: jest.fn(),
  registerWithMagicLink: jest.fn(),
  verifyMagicLink: jest.fn(),
  registerPasskey: jest.fn(),
  logout: mockLogout,
  clearError: jest.fn(),
  error: null,
  supportsPasskeys: false,
  magicLinkSent: false,
  hasPlatformAuthenticator: false,
};

let mockAuthContextValue = { ...defaultAuthContext };

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => mockAuthContextValue,
}));

// LanguageToggle (mounted by Header) depends on the i18n locale + toast
// providers and Apollo. The Header tests assert on nav/auth behavior, not
// on the language toggle — stub these dependencies so the component
// renders. Toast assertions live in LanguageToggle's own spec.
jest.mock("@/lib/i18n/context", () => ({
  useLocale: () => ({ locale: "en", setLocale: jest.fn() }),
}));

jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// ThemeToggle (mounted by Header) needs the theme provider; stub it the same
// way as i18n/toast above. Theme behavior is covered by its own context.
jest.mock("@/lib/theme-context", () => ({
  useTheme: () => ({ theme: "light", setTheme: jest.fn(), toggle: jest.fn() }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("@apollo/client/react", () => ({
  useMutation: () => [
    jest.fn().mockResolvedValue({ data: {} }),
    { loading: false },
  ],
}));

describe("Header", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContextValue = { ...defaultAuthContext };
  });

  it("should render the brand name as a link to home", () => {
    render(<Header />);

    const brandLink = screen.getByRole("link", { name: /opus populi/i });
    expect(brandLink).toHaveAttribute("href", "/");
  });

  describe("when loading", () => {
    it("should show loading text", () => {
      mockAuthContextValue = { ...defaultAuthContext, isLoading: true };
      render(<Header />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });
  });

  describe("when not authenticated", () => {
    it("should show sign in and get started links", () => {
      render(<Header />);

      expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
        "href",
        "/login",
      );
      expect(
        screen.getByRole("link", { name: /get started/i }),
      ).toHaveAttribute("href", "/register");
    });

    it("should not show sign out button", () => {
      render(<Header />);

      expect(
        screen.queryByRole("button", { name: /sign out/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when authenticated", () => {
    beforeEach(() => {
      mockAuthContextValue = {
        ...defaultAuthContext,
        isAuthenticated: true,
        user: { email: "test@example.com" },
      };
    });

    it("should show profile icon link to settings", () => {
      render(<Header />);

      expect(
        screen.getByRole("link", { name: /profile settings/i }),
      ).toHaveAttribute("href", "/settings");
    });

    it("should show region link", () => {
      render(<Header />);

      expect(screen.getByRole("link", { name: /region/i })).toHaveAttribute(
        "href",
        "/region",
      );
    });

    it("should not show sign out button (moved to settings sidebar)", () => {
      render(<Header />);

      expect(
        screen.queryByRole("button", { name: /sign out/i }),
      ).not.toBeInTheDocument();
    });

    it("should not show sign in or get started links", () => {
      render(<Header />);

      expect(
        screen.queryByRole("link", { name: /sign in/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /get started/i }),
      ).not.toBeInTheDocument();
    });
  });
});
