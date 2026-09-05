import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockNextStep = jest.fn();
const mockPrevStep = jest.fn();
const mockSkipOnboarding = jest.fn();
const mockCompleteOnboarding = jest.fn();

const defaultOnboardingContext = {
  hasCompletedOnboarding: false,
  currentStep: 0,
  totalSteps: 6,
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

// The steps themselves depend on Apollo, the locale context and the toast
// provider. This spec is about the flow's shape — which step renders, which
// chrome shows, where the actions go — so the steps stand in as markers.
// Their own behaviour is covered by their specs and by e2e/onboarding.spec.ts.
jest.mock("@/components/onboarding/steps/CountyStep", () => ({
  CountyStep: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="step-county" onClick={onComplete}>
      county
    </button>
  ),
}));
jest.mock("@/components/onboarding/steps/ThresholdStep", () => ({
  ThresholdStep: ({ onCorrect }: { onCorrect: () => void }) => (
    <button data-testid="step-threshold" onClick={onCorrect}>
      threshold
    </button>
  ),
}));
jest.mock("@/components/onboarding/steps/TopicsStep", () => ({
  TopicsStep: () => <div data-testid="step-topics">topics</div>,
}));
jest.mock("@/components/onboarding/steps/VeteranStep", () => ({
  VeteranStep: () => <div data-testid="step-veteran">veteran</div>,
}));
jest.mock("@/components/onboarding/steps/ExpectationsStep", () => ({
  ExpectationsStep: () => <div data-testid="step-expectations">expect</div>,
}));
jest.mock("@/components/onboarding/steps/CommitmentsStep", () => ({
  CommitmentsStep: ({ onComplete }: { onComplete: () => void }) => (
    <button data-testid="step-commitments" onClick={onComplete}>
      commitments
    </button>
  ),
}));

const at = (step: number) => {
  mockOnboardingContextValue = {
    ...defaultOnboardingContext,
    currentStep: step,
  };
};

describe("OnboardingSteps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOnboardingContextValue = { ...defaultOnboardingContext };
  });

  describe("the flow's shape", () => {
    it("opens on the county, not on a welcome screen", () => {
      // The address is the only thing the product cannot proceed without, and
      // the four product slides that used to precede it sold a reader who had
      // already clicked Get started.
      render(<OnboardingSteps />);
      expect(screen.getByTestId("step-county")).toBeInTheDocument();
    });

    it.each([
      [0, "step-county"],
      [1, "step-threshold"],
      [2, "step-topics"],
      [3, "step-veteran"],
      [4, "step-expectations"],
      [5, "step-commitments"],
    ])("renders the right step at index %i", (step, testId) => {
      at(step);
      render(<OnboardingSteps />);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });

    it("names every step rather than showing anonymous dots", () => {
      render(<OnboardingSteps />);
      const rail = screen.getByRole("list", { name: "Setup progress" });
      expect(rail).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(6);
    });

    it("marks the current step for assistive technology", () => {
      at(2);
      render(<OnboardingSteps />);
      const current = screen
        .getAllByRole("listitem")
        .filter((li) => li.getAttribute("aria-current") === "step");
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent("What you watch");
    });

    it("carries no global Next, because every step owns its action", () => {
      render(<OnboardingSteps />);
      expect(screen.queryByRole("button", { name: /^next$/i })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^get started$/i }),
      ).toBeNull();
    });
  });

  describe("navigation", () => {
    it("advances when a step reports completion", async () => {
      const user = userEvent.setup();
      render(<OnboardingSteps />);
      await user.click(screen.getByTestId("step-county"));
      expect(mockNextStep).toHaveBeenCalled();
    });

    it("completes and routes to the briefing from the last step", async () => {
      at(5);
      const user = userEvent.setup();
      render(<OnboardingSteps />);
      await user.click(screen.getByTestId("step-commitments"));
      expect(mockCompleteOnboarding).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/me/briefing");
    });

    it("sends 'wrong county' back to the address form", async () => {
      // The threshold screen names a county at the reader. If it named the
      // wrong one, the fix has to be one click away or the number reads as
      // broken rather than correctable.
      at(1);
      const user = userEvent.setup();
      render(<OnboardingSteps />);
      await user.click(screen.getByTestId("step-threshold"));
      expect(mockPrevStep).toHaveBeenCalled();
    });

    it("disables Back on the first step", () => {
      render(<OnboardingSteps />);
      expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    });
  });

  describe("skipping", () => {
    it("skips the whole flow and routes to the briefing", async () => {
      const user = userEvent.setup();
      render(<OnboardingSteps />);
      await user.click(screen.getByRole("button", { name: "Skip for now" }));
      expect(mockSkipOnboarding).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/me/briefing");
    });

    it("hides Skip and Back on the mandatory commitments step (#754)", () => {
      // The issue AC says the commitments MUST be acknowledged. Leaving any
      // escape hatch on that screen would make it optional in practice.
      at(5);
      render(<OnboardingSteps />);
      expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
      expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    });
  });
});
