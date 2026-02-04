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
  totalSteps: 4,
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

  it("should redirect to /petition when onboarding is completed", async () => {
    mockOnboardingContextValue = {
      ...defaultOnboardingContext,
      hasCompletedOnboarding: true,
    };

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/petition");
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

  it("should render nothing when onboarding is already completed", () => {
    mockOnboardingContextValue = {
      ...defaultOnboardingContext,
      hasCompletedOnboarding: true,
    };

    const { container } = render(<OnboardingPage />);

    expect(container.innerHTML).toBe("");
  });
});
