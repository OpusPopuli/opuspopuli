import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";

// Mock Next.js router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock onboarding context
const mockNextStep = jest.fn();
const mockPrevStep = jest.fn();
const mockSkipOnboarding = jest.fn();
const mockCompleteOnboarding = jest.fn();

const defaultOnboardingContext = {
  hasCompletedOnboarding: false,
  currentStep: 0,
  totalSteps: 9,
  nextStep: mockNextStep,
  prevStep: mockPrevStep,
  skipOnboarding: mockSkipOnboarding,
  completeOnboarding: mockCompleteOnboarding,
  resetOnboarding: jest.fn(),
};

let mockOnboardingContextValue = { ...defaultOnboardingContext };

jest.mock("@/lib/onboarding-context", () => ({
  useOnboarding: () => mockOnboardingContextValue,
}));

// WelcomeStep + data steps depend on the i18n locale context and Apollo
// — the OnboardingSteps test is about routing/footer logic, not those
// dependencies, so we stub them here. Full coverage of WelcomeStep +
// data steps lives in the Playwright e2e spec (e2e/onboarding.spec.ts).
jest.mock("@/lib/i18n/context", () => ({
  useLocale: () => ({ locale: "en", setLocale: jest.fn() }),
}));

jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock("@apollo/client/react", () => ({
  useMutation: () => [
    jest.fn().mockResolvedValue({ data: {} }),
    { loading: false },
  ],
}));

describe("OnboardingSteps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnboardingContextValue = { ...defaultOnboardingContext };
  });

  describe("rendering", () => {
    it("should render welcome step initially", () => {
      render(<OnboardingSteps />);

      expect(screen.getByText("Welcome to Opus Populi")).toBeInTheDocument();
    });

    it("should render skip button", () => {
      render(<OnboardingSteps />);

      expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
    });

    it("should render next button on first step", () => {
      render(<OnboardingSteps />);

      expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    });

    it("should render back button (disabled on first step)", () => {
      render(<OnboardingSteps />);

      const backButton = screen.getByRole("button", { name: /back/i });
      expect(backButton).toBeInTheDocument();
      expect(backButton).toBeDisabled();
    });

    it("should render progress dots", () => {
      const { container } = render(<OnboardingSteps />);

      const dots = container.querySelectorAll("[aria-hidden='true']");
      // 9 step dots + decorative SVGs inside marketing steps; assert at
      // least one dot per step exists.
      expect(dots.length).toBeGreaterThanOrEqual(9);
    });
  });

  describe("step navigation", () => {
    it("should call nextStep when Next is clicked", async () => {
      render(<OnboardingSteps />);

      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      expect(mockNextStep).toHaveBeenCalled();
    });

    it("should call prevStep when Back is clicked", async () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 1,
      };
      render(<OnboardingSteps />);

      await userEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(mockPrevStep).toHaveBeenCalled();
    });

    it("should render explore step on step 1", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 1,
      };
      render(<OnboardingSteps />);

      expect(screen.getByText("Explore Your Region")).toBeInTheDocument();
    });

    it("should render scan step on step 2", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 2,
      };
      render(<OnboardingSteps />);

      expect(screen.getByText("Scan Petitions")).toBeInTheDocument();
    });

    it("should render analyze step on step 3", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 3,
      };
      render(<OnboardingSteps />);

      expect(screen.getByText("Instant Analysis")).toBeInTheDocument();
    });

    it("should render track step on step 4", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 4,
      };
      render(<OnboardingSteps />);

      expect(screen.getByText("Track Progress")).toBeInTheDocument();
    });
  });

  describe("skip", () => {
    it("should call skipOnboarding and redirect on skip", async () => {
      render(<OnboardingSteps />);

      await userEvent.click(screen.getByRole("button", { name: /skip/i }));

      expect(mockSkipOnboarding).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/region");
    });
  });

  // Last-step Get Started + completion behavior is covered by the
  // Playwright e2e spec (e2e/onboarding.spec.ts) — the final step
  // (VeteranStep) uses Apollo `useMutation`, so testing it here would
  // require MockedProvider and duplicate the existing e2e coverage.
});
