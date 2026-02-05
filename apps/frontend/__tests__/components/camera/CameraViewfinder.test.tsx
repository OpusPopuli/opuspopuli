import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CameraViewfinder } from "@/components/camera/CameraViewfinder";
import { createRef } from "react";

// Mock child components
jest.mock("@/components/camera/DocumentFrameOverlay", () => ({
  DocumentFrameOverlay: () => (
    <div data-testid="document-frame-overlay">Frame Overlay</div>
  ),
}));

jest.mock("@/components/camera/LightingFeedback", () => ({
  LightingFeedback: ({ level }: { level: string }) => (
    <div data-testid="lighting-feedback">{level}</div>
  ),
}));

jest.mock("@/components/camera/CaptureControls", () => ({
  CaptureControls: ({
    onCapture,
    disabled,
  }: {
    onCapture: () => void;
    disabled: boolean;
  }) => (
    <div data-testid="capture-controls">
      <button onClick={onCapture} disabled={disabled}>
        Capture
      </button>
    </div>
  ),
}));

describe("CameraViewfinder", () => {
  const mockImageData = {
    data: new Uint8ClampedArray(4),
    width: 1,
    height: 1,
    colorSpace: "srgb" as const,
  } as ImageData;

  const defaultProps = {
    videoRef: createRef<HTMLVideoElement | null>(),
    canvasRef: createRef<HTMLCanvasElement | null>(),
    stream: null as MediaStream | null,
    isLoading: false,
    hasTorch: false,
    hasMultipleCameras: false,
    lightingLevel: "good" as const,
    torchEnabled: false,
    captureFrame: jest.fn(() => mockImageData),
    switchCamera: jest.fn(),
    startContinuousAnalysis: jest.fn(),
    stopContinuousAnalysis: jest.fn(),
    onCapture: jest.fn(),
    onToggleTorch: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(global.navigator, "vibrate", {
      value: jest.fn(),
      writable: true,
      configurable: true,
    });
  });

  describe("rendering", () => {
    it("should render video element with correct attributes", () => {
      const { container } = render(<CameraViewfinder {...defaultProps} />);

      const video = container.querySelector("video");
      expect(video).toBeInTheDocument();
      expect(video).toHaveAttribute("autoplay");
      expect(video).toHaveAttribute("playsinline");
    });

    it("should render hidden canvas for frame capture", () => {
      const { container } = render(<CameraViewfinder {...defaultProps} />);

      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
      expect(canvas).toHaveClass("hidden");
    });

    it("should render document frame overlay", () => {
      render(<CameraViewfinder {...defaultProps} />);

      expect(screen.getByTestId("document-frame-overlay")).toBeInTheDocument();
    });

    it("should render lighting feedback with correct level", () => {
      render(<CameraViewfinder {...defaultProps} lightingLevel="dark" />);

      expect(screen.getByTestId("lighting-feedback")).toHaveTextContent("dark");
    });

    it("should render capture controls", () => {
      render(<CameraViewfinder {...defaultProps} />);

      expect(screen.getByTestId("capture-controls")).toBeInTheDocument();
    });
  });

  describe("lighting analysis", () => {
    it("should start continuous analysis when stream is active", () => {
      const mockStream = {} as MediaStream;

      render(<CameraViewfinder {...defaultProps} stream={mockStream} />);

      expect(defaultProps.startContinuousAnalysis).toHaveBeenCalledWith(
        defaultProps.captureFrame,
      );
    });

    it("should not start analysis when stream is null", () => {
      render(<CameraViewfinder {...defaultProps} stream={null} />);

      expect(defaultProps.startContinuousAnalysis).not.toHaveBeenCalled();
    });
  });

  describe("capture", () => {
    it("should call onCapture with frame data when capture clicked", async () => {
      const user = userEvent.setup();

      render(<CameraViewfinder {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: "Capture" }));

      expect(defaultProps.captureFrame).toHaveBeenCalled();
      expect(defaultProps.onCapture).toHaveBeenCalledWith(mockImageData);
    });

    it("should not call onCapture when captureFrame returns null", async () => {
      const user = userEvent.setup();
      const captureFrame = jest.fn(() => null);

      render(
        <CameraViewfinder {...defaultProps} captureFrame={captureFrame} />,
      );

      await user.click(screen.getByRole("button", { name: "Capture" }));

      expect(defaultProps.onCapture).not.toHaveBeenCalled();
    });

    it("should trigger haptic feedback on capture", async () => {
      const user = userEvent.setup();

      render(<CameraViewfinder {...defaultProps} />);

      await user.click(screen.getByRole("button", { name: "Capture" }));

      expect(navigator.vibrate).toHaveBeenCalledWith(50);
    });
  });
});
