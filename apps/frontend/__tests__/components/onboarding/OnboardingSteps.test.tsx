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
  totalSteps: 4,
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
      expect(dots.length).toBe(4);
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

    it("should render scan step on step 1", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 1,
      };
      render(<OnboardingSteps />);

      expect(screen.getByText("Scan Petitions")).toBeInTheDocument();
    });

    it("should render analyze step on step 2", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 2,
      };
      render(<OnboardingSteps />);

      expect(screen.getByText("Instant Analysis")).toBeInTheDocument();
    });

    it("should render track step on step 3", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 3,
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
      expect(mockPush).toHaveBeenCalledWith("/petition");
    });
  });

  describe("completion", () => {
    it("should show Get Started button on last step", () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 3,
      };
      render(<OnboardingSteps />);

      expect(
        screen.getByRole("button", { name: /get started/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^next$/i }),
      ).not.toBeInTheDocument();
    });

    it("should call completeOnboarding and redirect on Get Started", async () => {
      mockOnboardingContextValue = {
        ...defaultOnboardingContext,
        currentStep: 3,
      };
      render(<OnboardingSteps />);

      await userEvent.click(
        screen.getByRole("button", { name: /get started/i }),
      );

      expect(mockCompleteOnboarding).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/petition");
    });
  });
});
