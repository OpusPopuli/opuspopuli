import { renderHook, act } from "@testing-library/react";
import { useMapPetitions } from "@/lib/hooks/useMapPetitions";

const mockUseQuery = jest.fn();
jest.mock("@apollo/client/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

const mockMarkers = [
  {
    id: "doc-1",
    latitude: 37.7749,
    longitude: -122.4194,
    documentType: "petition",
    createdAt: "2024-06-01T00:00:00Z",
  },
  {
    id: "doc-2",
    latitude: 34.0522,
    longitude: -118.2437,
    documentType: "proposition",
    createdAt: "2024-06-02T00:00:00Z",
  },
];

const mockStats = {
  totalPetitions: 42,
  totalWithLocation: 35,
  recentPetitions: 8,
};

describe("useMapPetitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("initializes with empty markers and null stats", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: true,
      error: undefined,
    });

    const { result } = renderHook(() => useMapPetitions());

    expect(result.current.markers).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("returns markers from locations query", () => {
    mockUseQuery
      .mockReturnValueOnce({
        data: { petitionMapLocations: mockMarkers },
        loading: false,
        error: undefined,
      })
      .mockReturnValueOnce({
        data: { petitionMapStats: mockStats },
        loading: false,
        error: undefined,
      });

    const { result } = renderHook(() => useMapPetitions());

    expect(result.current.markers).toEqual(mockMarkers);
    expect(result.current.markers).toHaveLength(2);
    expect(result.current.markers[0].id).toBe("doc-1");
  });

  it("returns stats from stats query", () => {
    mockUseQuery
      .mockReturnValueOnce({
        data: { petitionMapLocations: mockMarkers },
        loading: false,
        error: undefined,
      })
      .mockReturnValueOnce({
        data: { petitionMapStats: mockStats },
        loading: false,
        error: undefined,
      });

    const { result } = renderHook(() => useMapPetitions());

    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.stats?.totalPetitions).toBe(42);
  });

  it("reports loading when either query is loading", () => {
    mockUseQuery
      .mockReturnValueOnce({
        data: undefined,
        loading: true,
        error: undefined,
      })
      .mockReturnValueOnce({
        data: { petitionMapStats: mockStats },
        loading: false,
        error: undefined,
      });

    const { result } = renderHook(() => useMapPetitions());

    expect(result.current.loading).toBe(true);
  });

  it("reports not loading when both queries complete", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });

    const { result } = renderHook(() => useMapPetitions());

    expect(result.current.loading).toBe(false);
  });

  it("returns error from locations query", () => {
    const locError = new Error("Network error");
    mockUseQuery
      .mockReturnValueOnce({
        data: undefined,
        loading: false,
        error: locError,
      })
      .mockReturnValueOnce({
        data: undefined,
        loading: false,
        error: undefined,
      });

    const { result } = renderHook(() => useMapPetitions());

    expect(result.current.error).toBe(locError);
  });

  it("returns error from stats query when locations succeeds", () => {
    const statsError = new Error("Stats failed");
    mockUseQuery
      .mockReturnValueOnce({
        data: { petitionMapLocations: [] },
        loading: false,
        error: undefined,
      })
      .mockReturnValueOnce({
        data: undefined,
        loading: false,
        error: statsError,
      });

    const { result } = renderHook(() => useMapPetitions());

    expect(result.current.error).toBe(statsError);
  });

  it("debounces bounds updates", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });

    const { result } = renderHook(() => useMapPetitions());

    act(() => {
      result.current.updateBounds({
        swLat: 34,
        swLng: -119,
        neLat: 38,
        neLng: -117,
      });
    });

    // Filters should not include bounds yet (debounce pending)
    expect(result.current.filters.bounds).toBeUndefined();

    // Fast-forward past debounce
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(result.current.filters.bounds).toEqual({
      swLat: 34,
      swLng: -119,
      neLat: 38,
      neLng: -117,
    });
  });

  it("cancels pending debounce on rapid bounds updates", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });

    const { result } = renderHook(() => useMapPetitions());

    act(() => {
      result.current.updateBounds({
        swLat: 34,
        swLng: -119,
        neLat: 38,
        neLng: -117,
      });
    });

    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Send a second update before debounce fires
    act(() => {
      result.current.updateBounds({
        swLat: 35,
        swLng: -120,
        neLat: 39,
        neLng: -118,
      });
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Should have the second bounds, not the first
    expect(result.current.filters.bounds).toEqual({
      swLat: 35,
      swLng: -120,
      neLat: 39,
      neLng: -118,
    });
  });

  it("updates filters immediately (no debounce)", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });

    const { result } = renderHook(() => useMapPetitions());

    act(() => {
      result.current.updateFilters({ documentType: "petition" });
    });

    expect(result.current.filters.documentType).toBe("petition");
  });

  it("merges filter updates with existing filters", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });

    const { result } = renderHook(() => useMapPetitions());

    act(() => {
      result.current.updateFilters({ documentType: "petition" });
    });

    act(() => {
      result.current.updateFilters({ startDate: "2024-01-01" });
    });

    expect(result.current.filters.documentType).toBe("petition");
    expect(result.current.filters.startDate).toBe("2024-01-01");
  });

  it("accepts initial filters", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });

    const { result } = renderHook(() =>
      useMapPetitions({ documentType: "proposition" }),
    );

    expect(result.current.filters.documentType).toBe("proposition");
  });

  it("cleans up debounce timer on unmount", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error: undefined,
    });

    const { result, unmount } = renderHook(() => useMapPetitions());

    act(() => {
      result.current.updateBounds({
        swLat: 34,
        swLng: -119,
        neLat: 38,
        neLng: -117,
      });
    });

    unmount();

    // Should not throw when timer fires after unmount
    expect(() => {
      jest.advanceTimersByTime(300);
    }).not.toThrow();
  });
});
