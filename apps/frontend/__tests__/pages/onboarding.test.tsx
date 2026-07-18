import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import OnboardingPage from "@/app/onboarding/page";

// Mock Next.js router
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

// Mock the server read (#758). The page reads onboarding completion from
// `myProfile` and treats the server as authoritative; the local cache is
// only a fallback when the query hasn't resolved.
type MockQueryResult = {
  data?: { myProfile: { onboardingCompletedAt: string | null } | null };
  loading: boolean;
};
const NOT_COMPLETED: MockQueryResult = {
  data: { myProfile: { onboardingCompletedAt: null } },
  loading: false,
};
let mockUseQueryValue: MockQueryResult = { ...NOT_COMPLETED };
jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockUseQueryValue,
}));

// Mock auth context
const defaultAuthContext = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: "user-123", email: "test@example.com", roles: ["user"] },
  tokens: null,
  login: jest.fn(),
  loginWithPasskey: jest.fn(),
  sendMagicLink: jest.fn(),
  clearError: jest.fn(),
  error: null,
  supportsPasskeys: true,
  magicLinkSent: false,
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

// Mock onboarding context
const defaultOnboardingContext = {
  hasCompletedOnboarding: false,
  currentStep: 0,
  totalSteps: 10,
  nextStep: jest.fn(),
  prevStep: jest.fn(),
  skipOnboarding: jest.fn(),
  completeOnboarding: jest.fn(),
  resetOnboarding: jest.fn(),
};

let mockOnboardingContextValue = { ...defaultOnboardingContext };

jest.mock("@/lib/onboarding-context", () => ({
  useOnboarding: () => mockOnboardingContextValue,
}));

// Mock OnboardingSteps component
jest.mock("@/components/onboarding/OnboardingSteps", () => ({
  OnboardingSteps: () => <div data-testid="onboarding-steps">Steps</div>,
}));

describe("OnboardingPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthContextValue = { ...defaultAuthContext };
    mockOnboardingContextValue = { ...defaultOnboardingContext };
    mockUseQueryValue = { ...NOT_COMPLETED };
  });

  it("should render OnboardingSteps when authenticated and not completed", () => {
    render(<OnboardingPage />);

    expect(screen.getByTestId("onboarding-steps")).toBeInTheDocument();
  });

  it("should redirect to /login when not authenticated", async () => {
    mockAuthContextValue = {
      ...defaultAuthContext,
      isAuthenticated: false,
    };

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login");
    });
  });

  it("should redirect to /me/briefing when the server flag is set", async () => {
    mockUseQueryValue = {
      data: {
        myProfile: { onboardingCompletedAt: "2026-07-18T00:00:00.000Z" },
      },
      loading: false,
    };

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/me/briefing");
    });
  });

  it("server 'not completed' overrides a stale local cache (#758)", async () => {
    // The exact original bug: a leftover localStorage flag must NOT skip
    // onboarding once the server says this account hasn't completed it.
    mockOnboardingContextValue = {
      ...defaultOnboardingContext,
      hasCompletedOnboarding: true,
    };
    mockUseQueryValue = { ...NOT_COMPLETED };

    render(<OnboardingPage />);

    expect(screen.getByTestId("onboarding-steps")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalledWith("/me/briefing");
  });

  it("falls back to the local cache when the query hasn't resolved", async () => {
    // Query errored / offline: data undefined. A returning user with a
    // warm cache should not be re-onboarded.
    mockOnboardingContextValue = {
      ...defaultOnboardingContext,
      hasCompletedOnboarding: true,
    };
    mockUseQueryValue = { data: undefined, loading: false };

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/me/briefing");
    });
  });

  it("should render nothing when auth is loading", () => {
    mockAuthContextValue = {
      ...defaultAuthContext,
      isLoading: true,
    };

    const { container } = render(<OnboardingPage />);

    expect(container.innerHTML).toBe("");
  });

  it("should render nothing while the server flag is still loading", () => {
    mockUseQueryValue = { data: undefined, loading: true };

    const { container } = render(<OnboardingPage />);

    expect(container.innerHTML).toBe("");
  });
});
