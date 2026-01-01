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
      hasTimezone: true,
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

    it("should cap percentage display at 100%", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 150 })}
        />,
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("should show bonus percentage when over 100%", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 120 })}
        />,
      );

      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.getByText("+20%")).toBeInTheDocument();
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

    it("should cap progress bar width at 100%", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 150 })}
        />,
      );

      const progressBar = container.querySelector('[style*="width: 100%"]');
      expect(progressBar).toBeInTheDocument();
    });

    it("should have green color when complete", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            isComplete: true,
            percentage: 100,
          })}
        />,
      );

      const progressBar = container.querySelector(".bg-green-500");
      expect(progressBar).toBeInTheDocument();
    });

    it("should have blue color when 75% or more", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 80 })}
        />,
      );

      const progressBar = container.querySelector(".bg-blue-500");
      expect(progressBar).toBeInTheDocument();
    });

    it("should have yellow color when 50-74%", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 60 })}
        />,
      );

      const progressBar = container.querySelector(".bg-yellow-500");
      expect(progressBar).toBeInTheDocument();
    });

    it("should have orange color when below 50%", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 30 })}
        />,
      );

      const progressBar = container.querySelector(".bg-orange-500");
      expect(progressBar).toBeInTheDocument();
    });
  });

  describe("core fields status", () => {
    it("should display all core field badges", () => {
      render(<ProfileCompletionIndicator completion={createCompletion()} />);

      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Photo")).toBeInTheDocument();
      expect(screen.getByText("Timezone")).toBeInTheDocument();
      expect(screen.getByText("Address")).toBeInTheDocument();
    });

    it("should show complete styling for completed fields", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            coreFieldsComplete: {
              hasName: true,
              hasPhoto: false,
              hasTimezone: false,
              hasAddress: false,
            },
          })}
        />,
      );

      const nameBadge = screen.getByText("Name").closest("div");
      expect(nameBadge).toHaveClass("bg-green-50", "text-green-700");
    });

    it("should show incomplete styling for incomplete fields", () => {
      render(
        <ProfileCompletionIndicator
          completion={createCompletion({
            coreFieldsComplete: {
              hasName: false,
              hasPhoto: false,
              hasTimezone: false,
              hasAddress: false,
            },
          })}
        />,
      );

      const nameBadge = screen.getByText("Name").closest("div");
      expect(nameBadge).toHaveClass("bg-gray-50", "text-gray-500");
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
              hasTimezone: false,
              hasAddress: false,
            },
          })}
        />,
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    it("should handle exactly 50% completion", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 50 })}
        />,
      );

      expect(screen.getByText("50%")).toBeInTheDocument();
      const progressBar = container.querySelector(".bg-yellow-500");
      expect(progressBar).toBeInTheDocument();
    });

    it("should handle exactly 75% completion", () => {
      const { container } = render(
        <ProfileCompletionIndicator
          completion={createCompletion({ percentage: 75 })}
        />,
      );

      expect(screen.getByText("75%")).toBeInTheDocument();
      const progressBar = container.querySelector(".bg-blue-500");
      expect(progressBar).toBeInTheDocument();
    });
  });
});
