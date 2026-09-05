/**
 * WCAG 2.2 AA accessibility tests for the onboarding flow.
 *
 * Renders each of the 9 OnboardingSteps screens and runs jest-axe to catch
 * structural a11y regressions (labels, button names, heading order,
 * landmark roles, decorative-svg hiding). Color contrast is NOT covered
 * here — jest-axe runs in jsdom which does not apply Tailwind's external
 * stylesheet, so axe's color-contrast rule can't compute the canvas/text
 * pairs. Contrast verification for the neutral-canvas refactor relies on
 * the token choices (text-content-dim on bg-surface-alt ≈ 4.7:1, sage-dark on
 * white ≈ 5.4:1) and on the manual Docker eyeball pass.
 */

import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";
import { I18nProvider } from "@/lib/i18n/context";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const defaultContext = {
  hasCompletedOnboarding: false,
  currentStep: 0,
  totalSteps: 10,
  nextStep: jest.fn(),
  prevStep: jest.fn(),
  skipOnboarding: jest.fn(),
  completeOnboarding: jest.fn(),
  resetOnboarding: jest.fn(),
};
let mockContext = { ...defaultContext };

jest.mock("@/lib/onboarding-context", () => ({
  useOnboarding: () => mockContext,
}));

// WelcomeStep + LanguageToggle (if rendered) consume the toast provider
// for persistence-failure feedback. Stub it so renders don't crash.
jest.mock("@/lib/toast", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

// Steps render under jsdom without a backing GraphQL server. Each query
// returns an empty/loading-resolved shape so the component renders its
// post-mount empty state, which is the surface a11y is judged on.
jest.mock("@apollo/client/react", () => ({
  useQuery: () => ({
    data: null,
    loading: false,
    error: null,
    refetch: jest.fn(),
  }),
  useMutation: () => [
    jest.fn().mockResolvedValue({ data: {} }),
    { loading: false },
  ],
  useLazyQuery: () => [jest.fn(), { data: null, loading: false, error: null }],
}));

const renderStep = (step: number) => {
  mockContext = { ...defaultContext, currentStep: step };
  return render(
    <I18nProvider>
      <OnboardingSteps />
    </I18nProvider>,
  );
};

const STEPS = [
  { step: 0, name: "County" },
  { step: 1, name: "Threshold" },
  { step: 2, name: "Topics" },
  { step: 3, name: "Veteran" },
  { step: 4, name: "Expectations" },
  { step: 5, name: "Commitments" },
] as const;

describe("Onboarding accessibility (WCAG 2.2 AA, structural)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each(STEPS)("step $step ($name)", ({ step }) => {
    it("has no axe violations", async () => {
      const { container } = renderStep(step);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("hides decorative SVGs from screen readers", () => {
      const { container } = renderStep(step);
      const svgs = container.querySelectorAll("svg");
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute("aria-hidden", "true");
      });
    });
  });

  describe("global chrome", () => {
    // The progress dots became a named list. Six unlabelled dots told a reader
    // how much was left but not what any of it was, which is the information
    // that decides whether they finish.
    it("names every step in a labelled list", () => {
      const { getByRole, getAllByRole } = renderStep(2);
      expect(getByRole("list", { name: "Setup progress" })).toBeInTheDocument();
      expect(getAllByRole("listitem")).toHaveLength(STEPS.length);
    });

    it("marks exactly one step current, without repeating the count", () => {
      // The current step is styled with weight and colour; aria-current is
      // what carries it to anyone not seeing that. The step's own eyebrow
      // already says "Step 3 of 6", so the rail must not say it again.
      const { getAllByRole } = renderStep(2);
      const current = getAllByRole("listitem").filter(
        (li) => li.getAttribute("aria-current") === "step",
      );
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveTextContent("What you watch");
      expect(current[0]).not.toHaveTextContent("Step 3 of 6");
    });
  });
});
