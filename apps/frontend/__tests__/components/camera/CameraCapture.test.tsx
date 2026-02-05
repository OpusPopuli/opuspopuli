import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CameraCapture } from "@/components/camera/CameraCapture";

// Mock hooks
const mockStartCamera = jest.fn();
const mockStopCamera = jest.fn();
const mockCaptureFrame = jest.fn();
const mockSetTorch = jest.fn();
const mockSwitchCamera = jest.fn();
const mockStartContinuousAnalysis = jest.fn();
const mockStopContinuousAnalysis = jest.fn();
const mockRequestLocation = jest.fn();
const mockClearLocation = jest.fn();

let mockPermissionState = "prompt";
let mockError: { type: string; message: string } | null = null;
let mockStream: MediaStream | null = null;
let mockIsLoading = false;
let mockGeoPermissionState = "prompt";
let mockGeoIsLoading = false;
let mockGeoError: { type: string; message: string } | null = null;

jest.mock("@/lib/hooks/useCamera", () => ({
  useCamera: () => ({
    videoRef: { current: null },
    canvasRef: { current: null },
    stream: mockStream,
    isLoading: mockIsLoading,
    error: mockError,
    permissionState: mockPermissionState,
    hasTorch: false,
    hasMultipleCameras: false,
    startCamera: mockStartCamera,
    stopCamera: mockStopCamera,
    captureFrame: mockCaptureFrame,
    setTorch: mockSetTorch,
    switchCamera: mockSwitchCamera,
  }),
}));

jest.mock("@/lib/hooks/useLightingAnalysis", () => ({
  useLightingAnalysis: () => ({
    analysis: { level: "good", luminance: 128 },
    analyze: jest.fn(),
    startContinuousAnalysis: mockStartContinuousAnalysis,
    stopContinuousAnalysis: mockStopContinuousAnalysis,
  }),
}));

jest.mock("@/lib/hooks/useGeolocation", () => ({
  useGeolocation: () => ({
    coordinates: null,
    isLoading: mockGeoIsLoading,
    error: mockGeoError,
    permissionState: mockGeoPermissionState,
    requestLocation: mockRequestLocation,
    clearLocation: mockClearLocation,
  }),
}));

// Mock child components to simplify testing
jest.mock("@/components/camera/CameraViewfinder", () => ({
  CameraViewfinder: ({
    onCapture,
  }: {
    onCapture: (imageData: ImageData) => void;
  }) => (
    <div data-testid="camera-viewfinder">
      <button
        onClick={() =>
          onCapture({
            data: new Uint8ClampedArray(4),
            width: 100,
            height: 100,
            colorSpace: "srgb",
          } as ImageData)
        }
      >
        Mock Capture
      </button>
    </div>
  ),
}));

jest.mock("@/components/camera/CapturePreview", () => ({
  CapturePreview: ({
    onRetake,
    onConfirm,
  }: {
    onRetake: () => void;
    onConfirm: () => void;
  }) => (
    <div data-testid="capture-preview">
      <button onClick={onRetake}>Retake</button>
      <button onClick={onConfirm}>Use Photo</button>
    </div>
  ),
}));

jest.mock("@/components/camera/CameraPermission", () => ({
  CameraPermission: ({
    state,
    onRequestPermission,
  }: {
    state: string;
    onRequestPermission: () => void;
  }) => (
    <div data-testid="camera-permission">
      <span>{state}</span>
      <button onClick={onRequestPermission}>Request Permission</button>
    </div>
  ),
}));

jest.mock("@/components/camera/LocationPrompt", () => ({
  LocationPrompt: ({
    permissionState,
    isLoading,
    error,
    onAllow,
    onSkip,
  }: {
    permissionState: string;
    isLoading: boolean;
    error: { type: string; message: string } | null;
    onAllow: () => void;
    onSkip: () => void;
  }) => (
    <div data-testid="location-prompt">
      <span data-testid="geo-permission">{permissionState}</span>
      <span data-testid="geo-loading">{isLoading.toString()}</span>
      <span data-testid="geo-error">{error ? error.message : "none"}</span>
      <button onClick={onAllow}>Allow Location</button>
      <button onClick={onSkip}>Skip Location</button>
    </div>
  ),
}));

describe("CameraCapture", () => {
  const mockOnConfirm = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissionState = "prompt";
    mockError = null;
    mockStream = null;
    mockIsLoading = false;
    mockGeoPermissionState = "prompt";
    mockGeoIsLoading = false;
    mockGeoError = null;
  });

  describe("permission state", () => {
    it("should show CameraPermission when permission is prompt", () => {
      mockPermissionState = "prompt";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      expect(screen.getByTestId("camera-permission")).toBeInTheDocument();
      expect(screen.getByText("prompt")).toBeInTheDocument();
    });

    it("should show CameraPermission when permission is denied", () => {
      mockPermissionState = "denied";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      expect(screen.getByTestId("camera-permission")).toBeInTheDocument();
      expect(screen.getByText("denied")).toBeInTheDocument();
    });

    it("should call startCamera when permission requested", async () => {
      const user = userEvent.setup();
      mockPermissionState = "prompt";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      await user.click(
        screen.getByRole("button", { name: "Request Permission" }),
      );
      expect(mockStartCamera).toHaveBeenCalled();
    });
  });

  describe("error state", () => {
    it("should show error message when camera error occurs", () => {
      mockError = { type: "not-found", message: "No camera found" };

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      expect(screen.getByText("Camera Error")).toBeInTheDocument();
      expect(screen.getByText("No camera found")).toBeInTheDocument();
    });

    it("should show try again button on error", () => {
      mockError = { type: "unknown", message: "Something went wrong" };

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      expect(
        screen.getByRole("button", { name: "Try Again" }),
      ).toBeInTheDocument();
    });

    it("should show go back button when onCancel is provided", () => {
      mockError = { type: "unknown", message: "Error" };
      const onCancel = jest.fn();

      render(<CameraCapture onConfirm={mockOnConfirm} onCancel={onCancel} />);

      expect(
        screen.getByRole("button", { name: "Go Back" }),
      ).toBeInTheDocument();
    });

    it("should not show go back button when onCancel is not provided", () => {
      mockError = { type: "unknown", message: "Error" };

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      expect(
        screen.queryByRole("button", { name: "Go Back" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("should show spinner when camera is loading", () => {
      mockIsLoading = true;
      mockPermissionState = "granted";

      const { container } = render(<CameraCapture onConfirm={mockOnConfirm} />);

      const spinner = container.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("capture flow", () => {
    it("should show viewfinder when permission is granted", () => {
      mockPermissionState = "granted";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      expect(screen.getByTestId("camera-viewfinder")).toBeInTheDocument();
    });

    it("should transition to preview after capture", async () => {
      const user = userEvent.setup();
      mockPermissionState = "granted";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      await user.click(screen.getByRole("button", { name: "Mock Capture" }));

      expect(screen.getByTestId("capture-preview")).toBeInTheDocument();
      expect(mockStopContinuousAnalysis).toHaveBeenCalled();
    });

    it("should return to viewfinder on retake", async () => {
      const user = userEvent.setup();
      mockPermissionState = "granted";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      // Capture
      await user.click(screen.getByRole("button", { name: "Mock Capture" }));
      expect(screen.getByTestId("capture-preview")).toBeInTheDocument();

      // Retake
      await user.click(screen.getByRole("button", { name: "Retake" }));
      expect(screen.getByTestId("camera-viewfinder")).toBeInTheDocument();
    });
  });

  describe("location flow", () => {
    it("should transition to location prompt after use photo", async () => {
      const user = userEvent.setup();
      mockPermissionState = "granted";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      // Capture
      await user.click(screen.getByRole("button", { name: "Mock Capture" }));
      expect(screen.getByTestId("capture-preview")).toBeInTheDocument();

      // Use Photo -> location prompt
      await user.click(screen.getByRole("button", { name: "Use Photo" }));
      expect(screen.getByTestId("location-prompt")).toBeInTheDocument();
    });

    it("should call onConfirm with location when allow location clicked", async () => {
      const user = userEvent.setup();
      mockPermissionState = "granted";
      mockRequestLocation.mockResolvedValue({
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 50,
      });

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      // Capture -> Use Photo -> Allow Location
      await user.click(screen.getByRole("button", { name: "Mock Capture" }));
      await user.click(screen.getByRole("button", { name: "Use Photo" }));
      await user.click(screen.getByRole("button", { name: "Allow Location" }));

      expect(mockRequestLocation).toHaveBeenCalled();
      expect(mockOnConfirm).toHaveBeenCalledWith(expect.any(Object), {
        latitude: 37.7749,
        longitude: -122.4194,
      });
    });

    it("should call onConfirm without location when skip clicked", async () => {
      const user = userEvent.setup();
      mockPermissionState = "granted";

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      // Capture -> Use Photo -> Skip Location
      await user.click(screen.getByRole("button", { name: "Mock Capture" }));
      await user.click(screen.getByRole("button", { name: "Use Photo" }));
      await user.click(screen.getByRole("button", { name: "Skip Location" }));

      expect(mockOnConfirm).toHaveBeenCalledWith(expect.any(Object), undefined);
    });

    it("should pass geolocation state to LocationPrompt", async () => {
      const user = userEvent.setup();
      mockPermissionState = "granted";
      mockGeoPermissionState = "denied";
      mockGeoIsLoading = false;
      mockGeoError = { type: "permission", message: "Denied by user" };

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      await user.click(screen.getByRole("button", { name: "Mock Capture" }));
      await user.click(screen.getByRole("button", { name: "Use Photo" }));

      expect(screen.getByTestId("geo-permission")).toHaveTextContent("denied");
      expect(screen.getByTestId("geo-loading")).toHaveTextContent("false");
      expect(screen.getByTestId("geo-error")).toHaveTextContent(
        "Denied by user",
      );
    });

    it("should call onConfirm without location when requestLocation returns null", async () => {
      const user = userEvent.setup();
      mockPermissionState = "granted";
      mockRequestLocation.mockResolvedValue(null);

      render(<CameraCapture onConfirm={mockOnConfirm} />);

      // Capture -> Use Photo -> Allow Location (but returns null)
      await user.click(screen.getByRole("button", { name: "Mock Capture" }));
      await user.click(screen.getByRole("button", { name: "Use Photo" }));
      await user.click(screen.getByRole("button", { name: "Allow Location" }));

      expect(mockOnConfirm).toHaveBeenCalledWith(expect.any(Object), undefined);
    });
  });
});
