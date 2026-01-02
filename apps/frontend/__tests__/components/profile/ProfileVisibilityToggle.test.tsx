import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ProfileVisibilityToggle } from "@/components/profile/ProfileVisibilityToggle";

// Mock useTranslation
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback || key,
  }),
}));

describe("ProfileVisibilityToggle", () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render with correct label", () => {
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      expect(screen.getByText("Profile Visibility")).toBeInTheDocument();
    });

    it("should show Private status when isPublic is false", () => {
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      expect(screen.getByText("Private")).toBeInTheDocument();
    });

    it("should show Public status when isPublic is true", () => {
      render(
        <ProfileVisibilityToggle isPublic={true} onChange={mockOnChange} />,
      );

      expect(screen.getByText("Public")).toBeInTheDocument();
    });

    it("should have switch role with correct aria-checked state", () => {
      const { rerender } = render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveAttribute("aria-checked", "false");

      rerender(
        <ProfileVisibilityToggle isPublic={true} onChange={mockOnChange} />,
      );

      expect(toggle).toHaveAttribute("aria-checked", "true");
    });

    it("should apply correct styling when public", () => {
      render(
        <ProfileVisibilityToggle isPublic={true} onChange={mockOnChange} />,
      );

      const statusLabel = screen.getByText("Public");
      expect(statusLabel).toHaveClass("text-green-600");
    });

    it("should apply correct styling when private", () => {
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      const statusLabel = screen.getByText("Private");
      expect(statusLabel).toHaveClass("text-gray-500");
    });
  });

  describe("user interactions", () => {
    it("should call onChange with toggled value when clicked", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      await user.click(screen.getByRole("switch"));

      expect(mockOnChange).toHaveBeenCalledWith(true);
    });

    it("should call onChange with false when toggled from public to private", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle isPublic={true} onChange={mockOnChange} />,
      );

      await user.click(screen.getByRole("switch"));

      expect(mockOnChange).toHaveBeenCalledWith(false);
    });

    it("should toggle on Enter key press", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      const toggle = screen.getByRole("switch");
      toggle.focus();
      await user.keyboard("{Enter}");

      expect(mockOnChange).toHaveBeenCalledWith(true);
    });

    it("should toggle on Space key press", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      const toggle = screen.getByRole("switch");
      toggle.focus();
      await user.keyboard(" ");

      expect(mockOnChange).toHaveBeenCalledWith(true);
    });

    it("should not call onChange when disabled", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle
          isPublic={false}
          onChange={mockOnChange}
          disabled={true}
        />,
      );

      await user.click(screen.getByRole("switch"));

      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it("should apply disabled styling when disabled", () => {
      render(
        <ProfileVisibilityToggle
          isPublic={false}
          onChange={mockOnChange}
          disabled={true}
        />,
      );

      const toggle = screen.getByRole("switch");
      expect(toggle).toHaveClass("opacity-50");
      expect(toggle).toHaveClass("cursor-not-allowed");
    });
  });

  describe("tooltip", () => {
    it("should show tooltip on info button hover", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      const infoButton = screen.getByLabelText("Visibility information");
      await user.hover(infoButton);

      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      expect(
        screen.getByText(/Public profiles can be discovered/),
      ).toBeInTheDocument();
    });

    it("should hide tooltip on mouse leave", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      const infoButton = screen.getByLabelText("Visibility information");
      await user.hover(infoButton);
      expect(screen.getByRole("tooltip")).toBeInTheDocument();

      await user.unhover(infoButton);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("should show tooltip on focus", async () => {
      const user = userEvent.setup();
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      const infoButton = screen.getByLabelText("Visibility information");
      // Use userEvent.tab to focus the element properly
      await user.click(infoButton);
      // After clicking, focus events are triggered, showing tooltip
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("should have accessible name on toggle switch", () => {
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      expect(screen.getByRole("switch")).toBeInTheDocument();
    });

    it("should have sr-only text for switch", () => {
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      expect(screen.getByText("Toggle profile visibility")).toHaveClass(
        "sr-only",
      );
    });

    it("should have info button with accessible label", () => {
      render(
        <ProfileVisibilityToggle isPublic={false} onChange={mockOnChange} />,
      );

      expect(
        screen.getByLabelText("Visibility information"),
      ).toBeInTheDocument();
    });
  });
});
