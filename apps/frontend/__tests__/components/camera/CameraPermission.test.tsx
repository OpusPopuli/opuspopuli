import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CameraPermission } from "@/components/camera/CameraPermission";

describe("CameraPermission", () => {
  const mockOnRequestPermission = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("prompt state", () => {
    it("should render camera access needed heading", () => {
      render(
        <CameraPermission
          state="prompt"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(screen.getByText("Camera Access Needed")).toBeInTheDocument();
    });

    it("should display privacy explanation", () => {
      render(
        <CameraPermission
          state="prompt"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(
        screen.getByText(/processed securely and never saved/),
      ).toBeInTheDocument();
    });

    it("should render enable camera button", () => {
      render(
        <CameraPermission
          state="prompt"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Enable Camera" }),
      ).toBeInTheDocument();
    });

    it("should call onRequestPermission when enable button clicked", async () => {
      const user = userEvent.setup();

      render(
        <CameraPermission
          state="prompt"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Enable Camera" }));
      expect(mockOnRequestPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe("denied state", () => {
    it("should render denied heading", () => {
      render(
        <CameraPermission
          state="denied"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(screen.getByText("Camera Access Denied")).toBeInTheDocument();
    });

    it("should display recovery instructions", () => {
      render(
        <CameraPermission
          state="denied"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(
        screen.getByText("1. Open your browser settings"),
      ).toBeInTheDocument();
      expect(screen.getByText("3. Enable camera access")).toBeInTheDocument();
      expect(screen.getByText("4. Refresh this page")).toBeInTheDocument();
    });

    it("should render refresh page button", () => {
      render(
        <CameraPermission
          state="denied"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Refresh Page" }),
      ).toBeInTheDocument();
    });
  });

  describe("unsupported state", () => {
    it("should render unsupported heading", () => {
      render(
        <CameraPermission
          state="unsupported"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(screen.getByText("Camera Not Supported")).toBeInTheDocument();
    });

    it("should suggest alternative browsers", () => {
      render(
        <CameraPermission
          state="unsupported"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(
        screen.getByText(/Chrome, Safari, or Firefox/),
      ).toBeInTheDocument();
    });

    it("should not render any action buttons", () => {
      render(
        <CameraPermission
          state="unsupported"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("granted state", () => {
    it("should render nothing when permission is granted", () => {
      const { container } = render(
        <CameraPermission
          state="granted"
          onRequestPermission={mockOnRequestPermission}
        />,
      );

      expect(container.innerHTML).toBe("");
    });
  });
});
