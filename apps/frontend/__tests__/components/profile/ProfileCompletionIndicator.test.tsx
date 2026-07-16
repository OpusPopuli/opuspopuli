import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProfileCompletionIndicator } from "@/components/profile/ProfileCompletionIndicator";
import type { ProfileCompletion } from "@/lib/graphql/profile";

// Mock useTranslation
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback || key,
  }),
}));

describe("ProfileCompletionIndicator", () => {
  const createCompletion = (
    overrides: Partial<ProfileCompletion> = {},
  ): ProfileCompletion => ({
    percentage: 50,
    isComplete: false,
    suggestedNextSteps: [],
    coreFieldsComplete: {
      hasName: true,
      hasPhoto: false,
      hasCivic: true,
      hasDemographic: true,
      hasAddress: false,
    },
    ...overrides,
  });

  describe("rendering", () => {
    it("should render profile completion title", () => {
      render(<ProfileCompletionIndicator completion={createCompletion()} />);

      expect(screen.getByText("Profile Completion")).toBeInTheDocument();
    });

    it("should display percentage", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 75 })}
        />,
      );

      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("should display 100% when percentage is 100", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 100 })}
        />,
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("should show complete message when isComplete is true", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            isComplete: true,
            percentage: 100,
          })}
        />,
      );

      expect(screen.getByText("Your profile is complete!")).toBeInTheDocument();
    });

    it("should not show complete message when isComplete is false", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({ isComplete: false })}
        />,
      );

      expect(
        screen.queryByText("Your profile is complete!"),
      ).not.toBeInTheDocument();
    });
  });

  describe("progress bar", () => {
    it("should render progress bar with correct width", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 60 })}
        />,
      );

      const progressBar = container.querySelector('[style*="width: 60%"]');
      expect(progressBar).toBeInTheDocument();
    });

    it("should show progress bar width at 100% for full completion", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 100 })}
        />,
      );

      const progressBar = container.querySelector('[style*="width: 100%"]');
      expect(progressBar).toBeInTheDocument();
    });

    it.each([
      { percentage: 30, isComplete: false, label: "below 50%" },
      { percentage: 60, isComplete: false, label: "50–74%" },
      { percentage: 80, isComplete: false, label: "75%+" },
      { percentage: 100, isComplete: true, label: "100% complete" },
    ])(
      "uses a single sage track at $label (percentage=$percentage)",
      ({ percentage, isComplete }) => {
        const { container } = render(
          <ProfileCompletionIndicator
            completion={createCompletion({ percentage, isComplete })}
          />,
        );

        // Single gold (earned-accent) track replaces the legacy 4-tier color
        // ramp (green/blue/yellow/orange). Assert positively on the new class,
        // and negatively on the old ones so a future regression that
        // reintroduces tier colors fails loudly here.
        const progressBar = container.querySelector(".bg-accent");
        expect(progressBar).toBeInTheDocument();
        expect(container.querySelector(".bg-green-500")).toBeNull();
        expect(container.querySelector(".bg-blue-500")).toBeNull();
        expect(container.querySelector(".bg-yellow-500")).toBeNull();
        expect(container.querySelector(".bg-orange-500")).toBeNull();
      },
    );
  });

  describe("core fields status", () => {
    it("should display all core field badges", () => {
      render(<ProfileCompletionIndicator completion={createCompletion()} />);

      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Photo")).toBeInTheDocument();
      expect(screen.getByText("Civic")).toBeInTheDocument();
      expect(screen.getByText("Demographic")).toBeInTheDocument();
      expect(screen.getByText("Address")).toBeInTheDocument();
    });

    it("should show complete styling for completed fields", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            coreFieldsComplete: {
              hasName: true,
              hasPhoto: false,
              hasCivic: false,
              hasDemographic: false,
              hasAddress: false,
            },
          })}
        />,
      );

      const nameBadge = screen.getByText("Name").closest("div");
      expect(nameBadge).toHaveClass("bg-accent/15", "text-content");
    });

    it("should show incomplete styling for incomplete fields", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            coreFieldsComplete: {
              hasName: false,
              hasPhoto: false,
              hasCivic: false,
              hasDemographic: false,
              hasAddress: false,
            },
          })}
        />,
      );

      const nameBadge = screen.getByText("Name").closest("div");
      expect(nameBadge).toHaveClass("bg-surface-alt", "text-content-dim");
    });
  });

  describe("suggested next steps", () => {
    it("should show suggested next steps when not complete", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            isComplete: false,
            suggestedNextSteps: [
              "Add a profile photo",
              "Complete your address",
            ],
          })}
        />,
      );

      expect(screen.getByText("Suggested next steps:")).toBeInTheDocument();
      expect(screen.getByText("Add a profile photo")).toBeInTheDocument();
      expect(screen.getByText("Complete your address")).toBeInTheDocument();
    });

    it("should not show next steps section when complete", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            isComplete: true,
            suggestedNextSteps: ["This should not show"],
          })}
        />,
      );

      expect(
        screen.queryByText("Suggested next steps:"),
      ).not.toBeInTheDocument();
    });

    it("should not show next steps section when no steps", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            isComplete: false,
            suggestedNextSteps: [],
          })}
        />,
      );

      expect(
        screen.queryByText("Suggested next steps:"),
      ).not.toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("should handle 0% completion", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            percentage: 0,
            coreFieldsComplete: {
              hasName: false,
              hasPhoto: false,
              hasCivic: false,
              hasDemographic: false,
              hasAddress: false,
            },
          })}
        />,
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    it("should handle exactly 50% completion", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 50 })}
        />,
      );

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("should handle exactly 75% completion", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 75 })}
        />,
      );

      expect(screen.getByText("75%")).toBeInTheDocument();
    });
  });
});
