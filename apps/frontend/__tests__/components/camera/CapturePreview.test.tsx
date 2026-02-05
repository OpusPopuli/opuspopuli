import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CapturePreview } from "@/components/camera/CapturePreview";

// Mock canvas context
const mockPutImageData = jest.fn();
const mockGetContext = jest.fn(() => ({
  putImageData: mockPutImageData,
}));

HTMLCanvasElement.prototype.getContext =
  mockGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext;

function createMockImageData(width = 100, height = 100): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("CapturePreview", () => {
  const defaultProps = {
    imageData: createMockImageData(),
    onRetake: jest.fn(),
    onConfirm: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("rendering", () => {
    it("should render a canvas element", () => {
      const { container } = render(<CapturePreview {...defaultProps} />);

      const canvas = container.querySelector("canvas");
      expect(canvas).toBeInTheDocument();
    });

    it("should draw imageData to canvas on mount", () => {
      render(<CapturePreview {...defaultProps} />);

      expect(mockGetContext).toHaveBeenCalledWith("2d");
      expect(mockPutImageData).toHaveBeenCalledWith(
        defaultProps.imageData,
        0,
        0,
      );
    });

    it("should render retake button", () => {
      render(<CapturePreview {...defaultProps} />);

      expect(
        screen.getByRole("button", { name: "Retake" }),
      ).toBeInTheDocument();
    });

    it("should render use photo button", () => {
      render(<CapturePreview {...defaultProps} />);

      expect(
        screen.getByRole("button", { name: "Use Photo" }),
      ).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("should call onRetake when retake button clicked", async () => {
      const user = userEvent.setup();
      const onRetake = jest.fn();

      render(<CapturePreview {...defaultProps} onRetake={onRetake} />);

      await user.click(screen.getByRole("button", { name: "Retake" }));
      expect(onRetake).toHaveBeenCalledTimes(1);
    });

    it("should call onConfirm when use photo button clicked", async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();

      render(<CapturePreview {...defaultProps} onConfirm={onConfirm} />);

      await user.click(screen.getByRole("button", { name: "Use Photo" }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe("processing state", () => {
    it("should show processing text when isProcessing is true", () => {
      render(<CapturePreview {...defaultProps} isProcessing={true} />);

      expect(screen.getByText("Processing")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Use Photo" }),
      ).not.toBeInTheDocument();
    });

    it("should disable retake button when processing", () => {
      render(<CapturePreview {...defaultProps} isProcessing={true} />);

      expect(screen.getByRole("button", { name: "Retake" })).toBeDisabled();
    });

    it("should render spinner when processing", () => {
      const { container } = render(
        <CapturePreview {...defaultProps} isProcessing={true} />,
      );

      const spinner = container.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });
  });
});
