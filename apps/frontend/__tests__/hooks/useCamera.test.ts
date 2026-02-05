import { renderHook, act } from "@testing-library/react";
import { useCamera } from "@/lib/hooks/useCamera";

// Mock MediaStream and tracks
const mockTrack = {
  stop: jest.fn(),
  getCapabilities: jest.fn(() => ({})),
  applyConstraints: jest.fn(),
};

const mockMediaStream = {
  getTracks: jest.fn(() => [mockTrack]),
  getVideoTracks: jest.fn(() => [mockTrack]),
};

// Mock getUserMedia
const mockGetUserMedia = jest.fn();
const mockEnumerateDevices = jest.fn();

Object.defineProperty(global, "navigator", {
  value: {
    mediaDevices: {
      getUserMedia: mockGetUserMedia,
      enumerateDevices: mockEnumerateDevices,
    },
    permissions: {
      query: jest.fn().mockResolvedValue({
        state: "prompt",
        addEventListener: jest.fn(),
      }),
    },
  },
  writable: true,
});

describe("useCamera", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserMedia.mockResolvedValue(mockMediaStream);
    mockEnumerateDevices.mockResolvedValue([]);
  });

  it("initializes with default state", () => {
    const { result } = renderHook(() => useCamera());

    expect(result.current.stream).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasTorch).toBe(false);
    expect(result.current.hasMultipleCameras).toBe(false);
  });

  it("starts camera and sets stream", async () => {
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(mockGetUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    expect(result.current.stream).toBe(mockMediaStream);
    expect(result.current.permissionState).toBe("granted");
  });

  it("handles permission denied error", async () => {
    mockGetUserMedia.mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.error).toEqual({
      type: "permission",
      message: "Camera permission denied",
    });
    expect(result.current.permissionState).toBe("denied");
  });

  it("handles not found error", async () => {
    mockGetUserMedia.mockRejectedValue(
      new DOMException("No camera", "NotFoundError"),
    );

    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.error).toEqual({
      type: "not-found",
      message: "No camera found on this device",
    });
  });

  it("handles overconstrained error", async () => {
    mockGetUserMedia.mockRejectedValue(
      new DOMException("Overconstrained", "OverconstrainedError"),
    );

    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.error).toEqual({
      type: "overconstrained",
      message: "Camera does not support requested settings",
    });
  });

  it("stops camera and cleans up stream", async () => {
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.startCamera();
    });

    act(() => {
      result.current.stopCamera();
    });

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(result.current.stream).toBeNull();
  });

  it("uses custom facing mode", async () => {
    const { result } = renderHook(() => useCamera({ facingMode: "user" }));

    await act(async () => {
      await result.current.startCamera();
    });

    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          facingMode: "user",
        }),
      }),
    );
  });

  it("uses custom resolution", async () => {
    const { result } = renderHook(() => useCamera({ resolution: "high" }));

    await act(async () => {
      await result.current.startCamera();
    });

    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        }),
      }),
    );
  });

  it("detects torch capability", async () => {
    mockTrack.getCapabilities.mockReturnValue({ torch: true });

    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.startCamera();
    });

    expect(result.current.hasTorch).toBe(true);
  });

  it("detects multiple cameras", async () => {
    mockEnumerateDevices.mockResolvedValue([
      { kind: "videoinput", deviceId: "1" },
      { kind: "videoinput", deviceId: "2" },
    ]);

    const { result } = renderHook(() => useCamera());

    // Wait for the enumerateDevices effect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.hasMultipleCameras).toBe(true);
  });

  it("returns null from captureFrame when video not ready", () => {
    const { result } = renderHook(() => useCamera());

    const frame = result.current.captureFrame();
    expect(frame).toBeNull();
  });

  it("sets unsupported state when mediaDevices unavailable", () => {
    const originalNavigator = global.navigator;
    Object.defineProperty(global, "navigator", {
      value: { mediaDevices: undefined },
      writable: true,
    });

    const { result } = renderHook(() => useCamera());

    expect(result.current.permissionState).toBe("unsupported");

    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
    });
  });
});
