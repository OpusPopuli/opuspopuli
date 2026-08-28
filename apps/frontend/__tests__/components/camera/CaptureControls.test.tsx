import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CaptureControls } from "@/components/camera/CaptureControls";

describe("CaptureControls", () => {
  const defaultProps = {
    onCapture: jest.fn(),
    hasTorch: false,
    hasMultipleCameras: false,
    torchEnabled: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("capture button", () => {
    it("should render capture button", () => {
      render(<CaptureControls {...defaultProps} />);

      expect(
        screen.getByRole("button", { name: "Capture photo" }),
      ).toBeInTheDocument();
    });

    it("should call onCapture when clicked", async () => {
      const user = userEvent.setup();
      const onCapture = jest.fn();

      render(<CaptureControls {...defaultProps} onCapture={onCapture} />);

      await user.click(screen.getByRole("button", { name: "Capture photo" }));
      expect(onCapture).toHaveBeenCalledTimes(1);
    });

    it("should be disabled when disabled prop is true", () => {
      render(<CaptureControls {...defaultProps} disabled={true} />);

      expect(
        screen.getByRole("button", { name: "Capture photo" }),
      ).toBeDisabled();
    });
  });

  describe("torch button", () => {
    it("should not render torch button when hasTorch is false", () => {
      render(<CaptureControls {...defaultProps} hasTorch={false} />);

      expect(
        screen.queryByRole("button", { name: /flash/i }),
      ).not.toBeInTheDocument();
    });

    it("should render torch button when hasTorch is true", () => {
      const onToggleTorch = jest.fn();

      render(
        <CaptureControls
          {...defaultProps}
          hasTorch={true}
          onToggleTorch={onToggleTorch}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Turn on flash" }),
      ).toBeInTheDocument();
    });

    it("should show turn off label when torch is enabled", () => {
      const onToggleTorch = jest.fn();

      render(
        <CaptureControls
          {...defaultProps}
          hasTorch={true}
          torchEnabled={true}
          onToggleTorch={onToggleTorch}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Turn off flash" }),
      ).toBeInTheDocument();
    });

    it("should call onToggleTorch when clicked", async () => {
      const user = userEvent.setup();
      const onToggleTorch = jest.fn();

      render(
        <CaptureControls
          {...defaultProps}
          hasTorch={true}
          onToggleTorch={onToggleTorch}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Turn on flash" }));
      expect(onToggleTorch).toHaveBeenCalledTimes(1);
    });
  });

  describe("camera switch button", () => {
    it("should not render switch button when hasMultipleCameras is false", () => {
      render(<CaptureControls {...defaultProps} hasMultipleCameras={false} />);

      expect(
        screen.queryByRole("button", { name: "Switch camera" }),
      ).not.toBeInTheDocument();
    });

    it("should render switch button when hasMultipleCameras is true", () => {
      const onSwitchCamera = jest.fn();

      render(
        <CaptureControls
          {...defaultProps}
          hasMultipleCameras={true}
          onSwitchCamera={onSwitchCamera}
        />,
      );

      expect(
        screen.getByRole("button", { name: "Switch camera" }),
      ).toBeInTheDocument();
    });

    it("should call onSwitchCamera when clicked", async () => {
      const user = userEvent.setup();
      const onSwitchCamera = jest.fn();

      render(
        <CaptureControls
          {...defaultProps}
          hasMultipleCameras={true}
          onSwitchCamera={onSwitchCamera}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Switch camera" }));
      expect(onSwitchCamera).toHaveBeenCalledTimes(1);
    });
  });
  /**
   * The shutter's appearance tracks framing; its behaviour must not (#1075).
   *
   * Edge detection fails on shadowed sheets, unusual paper stock and low light.
   * A shutter that refuses to fire until detection is happy strands someone
   * holding a petition they are entitled to scan, with no way to tell why — so
   * `ready` is a paint flag and nothing else.
   */
  describe("alignment confirmation", () => {
    function disc(container: HTMLElement) {
      return container.querySelector("button > div");
    }

    it("fills the disc with gold once the page is framed", () => {
      const { container } = render(<CaptureControls {...defaultProps} ready />);

      expect(disc(container)).toHaveClass("bg-accent");
    });

    it("leaves the disc paper while the page is not framed", () => {
      const { container } = render(
        <CaptureControls {...defaultProps} ready={false} />,
      );

      expect(disc(container)).toHaveClass("bg-paper");
    });

    it.each([true, false])(
      "stays pressable whether or not the page is framed (ready=%s)",
      async (ready) => {
        const onCapture = jest.fn();
        const user = userEvent.setup();

        render(
          <CaptureControls
            {...defaultProps}
            ready={ready}
            onCapture={onCapture}
          />,
        );
        await user.click(screen.getByRole("button", { name: "Capture photo" }));

        expect(onCapture).toHaveBeenCalled();
      },
    );

    /** `disabled` is the loading flag, and remains the only thing that gates. */
    it("is gated by loading, not by framing", () => {
      const { rerender } = render(
        <CaptureControls {...defaultProps} ready={false} />,
      );
      expect(
        screen.getByRole("button", { name: "Capture photo" }),
      ).toBeEnabled();

      rerender(<CaptureControls {...defaultProps} ready disabled />);
      expect(
        screen.getByRole("button", { name: "Capture photo" }),
      ).toBeDisabled();
    });
  });
});
