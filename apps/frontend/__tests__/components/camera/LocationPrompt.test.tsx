import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { LocationPrompt } from "@/components/camera/LocationPrompt";

describe("LocationPrompt", () => {
  const defaultProps = {
    permissionState: "prompt" as const,
    isLoading: false,
    error: null,
    onAllow: jest.fn(),
    onSkip: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("prompt state", () => {
    it("should render title and description", () => {
      render(<LocationPrompt {...defaultProps} />);

      expect(screen.getByText("Add Scan Location?")).toBeInTheDocument();
      expect(
        screen.getByText(/Adding your location helps track/),
      ).toBeInTheDocument();
    });

    it("should render share location button", () => {
      render(<LocationPrompt {...defaultProps} />);

      expect(
        screen.getByRole("button", { name: "Share Location" }),
      ).toBeInTheDocument();
    });

    it("should render skip button", () => {
      render(<LocationPrompt {...defaultProps} />);

      expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    });

    it("should call onAllow when share location clicked", async () => {
      const user = userEvent.setup();
      const onAllow = jest.fn();

      render(<LocationPrompt {...defaultProps} onAllow={onAllow} />);

      await user.click(screen.getByRole("button", { name: "Share Location" }));
      expect(onAllow).toHaveBeenCalledTimes(1);
    });

    it("should call onSkip when skip clicked", async () => {
      const user = userEvent.setup();
      const onSkip = jest.fn();

      render(<LocationPrompt {...defaultProps} onSkip={onSkip} />);

      await user.click(screen.getByRole("button", { name: "Skip" }));
      expect(onSkip).toHaveBeenCalledTimes(1);
    });
  });

  describe("loading state", () => {
    it("should show loading text", () => {
      render(<LocationPrompt {...defaultProps} isLoading={true} />);

      expect(screen.getByText("Getting your location...")).toBeInTheDocument();
    });

    it("should render spinner when loading", () => {
      const { container } = render(
        <LocationPrompt {...defaultProps} isLoading={true} />,
      );

      const spinner = container.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("denied state", () => {
    it("should show denied message", () => {
      render(<LocationPrompt {...defaultProps} permissionState="denied" />);

      expect(screen.getByText("Location Access Denied")).toBeInTheDocument();
    });

    it("should show continue without location button", () => {
      render(<LocationPrompt {...defaultProps} permissionState="denied" />);

      expect(
        screen.getByRole("button", { name: "Continue Without Location" }),
      ).toBeInTheDocument();
    });

    it("should call onSkip when continue without location clicked", async () => {
      const user = userEvent.setup();
      const onSkip = jest.fn();

      render(
        <LocationPrompt
          {...defaultProps}
          permissionState="denied"
          onSkip={onSkip}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Continue Without Location" }),
      );
      expect(onSkip).toHaveBeenCalledTimes(1);
    });
  });

  describe("error state", () => {
    it("should show error message for unavailable", () => {
      render(
        <LocationPrompt
          {...defaultProps}
          error={{
            type: "unavailable",
            message: "Location information unavailable",
          }}
        />,
      );

      expect(screen.getByText("Location Unavailable")).toBeInTheDocument();
      expect(
        screen.getByText("Location information unavailable"),
      ).toBeInTheDocument();
    });

    it("should show error message for timeout", () => {
      render(
        <LocationPrompt
          {...defaultProps}
          error={{ type: "timeout", message: "Location request timed out" }}
        />,
      );

      expect(
        screen.getByText("Location request timed out"),
      ).toBeInTheDocument();
    });

    it("should show denied state for permission error", () => {
      render(
        <LocationPrompt
          {...defaultProps}
          error={{ type: "permission", message: "Location permission denied" }}
        />,
      );

      expect(screen.getByText("Location Access Denied")).toBeInTheDocument();
    });

    it("should call onSkip from error state", async () => {
      const user = userEvent.setup();
      const onSkip = jest.fn();

      render(
        <LocationPrompt
          {...defaultProps}
          error={{ type: "unavailable", message: "Unavailable" }}
          onSkip={onSkip}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Continue Without Location" }),
      );
      expect(onSkip).toHaveBeenCalledTimes(1);
    });
  });
});
