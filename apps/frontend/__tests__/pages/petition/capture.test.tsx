import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PetitionCapturePage from "@/app/petition/capture/page";

// Mock next/navigation
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock CameraCapture component
let capturedOnConfirm:
  | ((
      imageData: ImageData,
      location?: { latitude: number; longitude: number },
    ) => void)
  | null = null;
let capturedOnCancel: (() => void) | null = null;

jest.mock("@/components/camera", () => ({
  CameraCapture: ({
    onConfirm,
    onCancel,
  }: {
    onConfirm: (
      imageData: ImageData,
      location?: { latitude: number; longitude: number },
    ) => void;
    onCancel: () => void;
  }) => {
    capturedOnConfirm = onConfirm;
    capturedOnCancel = onCancel;
    return (
      <div data-testid="camera-capture">
        <button
          onClick={() =>
            onConfirm(
              {
                data: new Uint8ClampedArray(4),
                width: 640,
                height: 480,
                colorSpace: "srgb",
              } as ImageData,
              { latitude: 37.7749, longitude: -122.4194 },
            )
          }
        >
          Confirm With Location
        </button>
        <button
          onClick={() =>
            onConfirm({
              data: new Uint8ClampedArray(4),
              width: 640,
              height: 480,
              colorSpace: "srgb",
            } as ImageData)
          }
        >
          Confirm Without Location
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    );
  },
}));

describe("PetitionCapturePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnConfirm = null;
    capturedOnCancel = null;
  });

  it("should render CameraCapture component", () => {
    render(<PetitionCapturePage />);

    expect(screen.getByTestId("camera-capture")).toBeInTheDocument();
  });

  it("should navigate to petition page on confirm with location", async () => {
    const user = userEvent.setup();

    render(<PetitionCapturePage />);

    await user.click(
      screen.getByRole("button", { name: "Confirm With Location" }),
    );

    expect(mockPush).toHaveBeenCalledWith("/petition");
  });

  it("should navigate to petition page on confirm without location", async () => {
    const user = userEvent.setup();

    render(<PetitionCapturePage />);

    await user.click(
      screen.getByRole("button", { name: "Confirm Without Location" }),
    );

    expect(mockPush).toHaveBeenCalledWith("/petition");
  });

  it("should navigate to petition page on cancel", async () => {
    const user = userEvent.setup();

    render(<PetitionCapturePage />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockPush).toHaveBeenCalledWith("/petition");
  });

  it("should pass onConfirm and onCancel to CameraCapture", () => {
    render(<PetitionCapturePage />);

    expect(capturedOnConfirm).toBeInstanceOf(Function);
    expect(capturedOnCancel).toBeInstanceOf(Function);
  });
});
