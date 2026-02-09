import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Mock Next.js navigation
const mockReplace = jest.fn();
const mockPathname = "/settings";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => mockPathname,
}));

// Mock auth context
const defaultAuthContext = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  tokens: null,
  login: jest.fn(),
  loginWithPasskey: jest.fn(),
  sendMagicLink: jest.fn(),
  register: jest.fn(),
  registerWithMagicLink: jest.fn(),
  verifyMagicLink: jest.fn(),
  registerPasskey: jest.fn(),
  logout: jest.fn(),
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

describe("ProtectedRoute", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContextValue = { ...defaultAuthContext };
  });

  it("should show loading state when auth is loading", () => {
    mockAuthContextValue = { ...defaultAuthContext, isLoading: true };
    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("should redirect to login when not authenticated", () => {
    mockAuthContextValue = {
      ...defaultAuthContext,
      isAuthenticated: false,
      isLoading: false,
    };
    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/login?redirect=%2Fsettings");
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("should render children when authenticated", () => {
    mockAuthContextValue = {
      ...defaultAuthContext,
      isAuthenticated: true,
      isLoading: false,
    };
    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("should use custom redirectTo path", () => {
    mockAuthContextValue = {
      ...defaultAuthContext,
      isAuthenticated: false,
      isLoading: false,
    };
    render(
      <ProtectedRoute redirectTo="/signin">
        <div>Protected Content</div>
      </ProtectedRoute>,
    );

    expect(mockReplace).toHaveBeenCalledWith("/signin?redirect=%2Fsettings");
  });
});
