import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    it("should show user email", () => {
      render(<Header />);

      expect(screen.getByText("test@example.com")).toBeInTheDocument();
    });

    it("should show region link", () => {
      render(<Header />);

      expect(screen.getByRole("link", { name: /region/i })).toHaveAttribute(
        "href",
        "/region",
      );
    });

    it("should show settings link with user email", () => {
      render(<Header />);

      expect(
        screen.getByRole("link", { name: "test@example.com" }),
      ).toHaveAttribute("href", "/settings");
    });

    it("should show sign out button", () => {
      render(<Header />);

      expect(
        screen.getByRole("button", { name: /sign out/i }),
      ).toBeInTheDocument();
    });

    it("should call logout when sign out is clicked", async () => {
      const user = userEvent.setup();
      render(<Header />);

      await user.click(screen.getByRole("button", { name: /sign out/i }));

      expect(mockLogout).toHaveBeenCalledTimes(1);
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
