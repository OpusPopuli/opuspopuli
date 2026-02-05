import { renderHook, act } from "@testing-library/react";
import { useGeolocation } from "@/lib/hooks/useGeolocation";

// Mock getCurrentPosition
const mockGetCurrentPosition = jest.fn();

Object.defineProperty(globalThis, "navigator", {
  value: {
    geolocation: {
      getCurrentPosition: mockGetCurrentPosition,
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

describe("useGeolocation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initializes with default state", () => {
    const { result } = renderHook(() => useGeolocation());

    expect(result.current.coordinates).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns coordinates on successful request", async () => {
    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 50,
        },
      });
    });

    const { result } = renderHook(() => useGeolocation());

    let coords: unknown;
    await act(async () => {
      coords = await result.current.requestLocation();
    });

    expect(coords).toEqual({
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 50,
    });
    expect(result.current.coordinates).toEqual({
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 50,
    });
    expect(result.current.permissionState).toBe("granted");
    expect(result.current.isLoading).toBe(false);
  });

  it("handles permission denied error", async () => {
    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "User denied",
      });
    });

    const { result } = renderHook(() => useGeolocation());

    let coords: unknown;
    await act(async () => {
      coords = await result.current.requestLocation();
    });

    expect(coords).toBeNull();
    expect(result.current.error).toEqual({
      type: "permission",
      message: "Location permission denied",
    });
    expect(result.current.permissionState).toBe("denied");
  });

  it("handles position unavailable error", async () => {
    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({
        code: 2,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "Position unavailable",
      });
    });

    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      await result.current.requestLocation();
    });

    expect(result.current.error).toEqual({
      type: "unavailable",
      message: "Location information unavailable",
    });
  });

  it("handles timeout error", async () => {
    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({
        code: 3,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "Timed out",
      });
    });

    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      await result.current.requestLocation();
    });

    expect(result.current.error).toEqual({
      type: "timeout",
      message: "Location request timed out",
    });
  });

  it("clears location and error", async () => {
    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: {
          latitude: 37.7749,
          longitude: -122.4194,
          accuracy: 50,
        },
      });
    });

    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      await result.current.requestLocation();
    });

    expect(result.current.coordinates).not.toBeNull();

    act(() => {
      result.current.clearLocation();
    });

    expect(result.current.coordinates).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("passes options to getCurrentPosition", async () => {
    mockGetCurrentPosition.mockImplementation((success) => {
      success({
        coords: { latitude: 0, longitude: 0, accuracy: 100 },
      });
    });

    const { result } = renderHook(() =>
      useGeolocation({
        timeout: 5000,
        maximumAge: 30000,
        enableHighAccuracy: true,
      }),
    );

    await act(async () => {
      await result.current.requestLocation();
    });

    expect(mockGetCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 30000,
      },
    );
  });

  it("sets unsupported state when geolocation unavailable", () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { geolocation: undefined },
      writable: true,
    });

    const { result } = renderHook(() => useGeolocation());

    expect(result.current.permissionState).toBe("unsupported");

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
    });
  });

  it("returns null and sets error when requesting without geolocation support", async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { geolocation: undefined },
      writable: true,
    });

    const { result } = renderHook(() => useGeolocation());

    let coords: unknown;
    await act(async () => {
      coords = await result.current.requestLocation();
    });

    expect(coords).toBeNull();
    expect(result.current.error).toEqual({
      type: "unsupported",
      message: "Geolocation not supported in this browser",
    });

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
    });
  });

  it("handles unknown error code", async () => {
    mockGetCurrentPosition.mockImplementation((_success, error) => {
      error({
        code: 99,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: "Unknown error",
      });
    });

    const { result } = renderHook(() => useGeolocation());

    await act(async () => {
      await result.current.requestLocation();
    });

    expect(result.current.error).toEqual({
      type: "unknown",
      message: "An unexpected location error occurred",
    });
  });

  it("sets isLoading to true during request", async () => {
    let resolvePosition: (value: unknown) => void;
    mockGetCurrentPosition.mockImplementation((success) => {
      resolvePosition = () =>
        success({
          coords: { latitude: 0, longitude: 0, accuracy: 100 },
        });
    });

    const { result } = renderHook(() => useGeolocation());

    // Start request without resolving
    let requestPromise: Promise<unknown>;
    act(() => {
      requestPromise = result.current.requestLocation();
    });

    expect(result.current.isLoading).toBe(true);

    // Resolve and finish
    await act(async () => {
      resolvePosition!(null);
      await requestPromise!;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("handles permissions query rejection gracefully", async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        geolocation: { getCurrentPosition: mockGetCurrentPosition },
        permissions: {
          query: jest.fn().mockRejectedValue(new Error("Not supported")),
        },
      },
      writable: true,
    });

    const { result } = renderHook(() => useGeolocation());

    // Wait for the rejected promise to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Should still be in prompt state (catch block swallows error)
    expect(result.current.permissionState).toBe("prompt");
    expect(result.current.error).toBeNull();

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
    });
  });

  it("updates permission state on change event", async () => {
    const originalNavigator = globalThis.navigator;
    let changeListener: (() => void) | null = null;
    const mockStatus = {
      state: "prompt",
      addEventListener: (_event: string, listener: () => void) => {
        changeListener = listener;
      },
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        geolocation: { getCurrentPosition: mockGetCurrentPosition },
        permissions: {
          query: jest.fn().mockResolvedValue(mockStatus),
        },
      },
      writable: true,
    });

    const { result } = renderHook(() => useGeolocation());

    // Wait for effect to register the listener
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.permissionState).toBe("prompt");
    expect(changeListener).not.toBeNull();

    // Simulate permission change to granted
    mockStatus.state = "granted";
    act(() => {
      changeListener!();
    });

    expect(result.current.permissionState).toBe("granted");

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
    });
  });

  it("does not override permission state from effect after requestLocation", async () => {
    const originalNavigator = globalThis.navigator;
    let changeListener: (() => void) | null = null;
    const mockStatus = {
      state: "prompt",
      addEventListener: (_event: string, listener: () => void) => {
        changeListener = listener;
      },
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        geolocation: {
          getCurrentPosition: (success: (pos: GeolocationPosition) => void) => {
            success({
              coords: { latitude: 0, longitude: 0, accuracy: 100 },
            } as GeolocationPosition);
          },
        },
        permissions: {
          query: jest.fn().mockResolvedValue(mockStatus),
        },
      },
      writable: true,
    });

    const { result } = renderHook(() => useGeolocation());

    // Wait for effect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Request location → sets hasRequestedRef
    await act(async () => {
      await result.current.requestLocation();
    });

    expect(result.current.permissionState).toBe("granted");

    // Simulate change event trying to override back to "prompt"
    mockStatus.state = "prompt";
    act(() => {
      changeListener!();
    });

    // hasRequestedRef should prevent the override
    expect(result.current.permissionState).toBe("granted");

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
    });
  });

  it("detects permission state from permissions API", async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {
        geolocation: { getCurrentPosition: mockGetCurrentPosition },
        permissions: {
          query: jest.fn().mockResolvedValue({
            state: "granted",
            addEventListener: jest.fn(),
          }),
        },
      },
      writable: true,
    });

    const { result } = renderHook(() => useGeolocation());

    // Wait for the permissions query effect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.permissionState).toBe("granted");

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
    });
  });
});
