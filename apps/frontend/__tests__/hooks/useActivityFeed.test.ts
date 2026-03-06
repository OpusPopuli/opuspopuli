import { renderHook } from "@testing-library/react";
import { useActivityFeed } from "@/lib/hooks/useActivityFeed";

const mockUseQuery = jest.fn();
jest.mock("@apollo/client/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

const mockFeed = {
  items: [
    {
      contentHash: "hash-1",
      summary: "A petition about parks",
      documentType: "petition",
      scanCount: 5,
      locationCount: 3,
      latestScanAt: "2024-06-01T12:00:00Z",
      earliestScanAt: "2024-06-01T08:00:00Z",
    },
  ],
  hourlyTrend: [
    { hour: "2024-06-01T08:00:00Z", scanCount: 2 },
    { hour: "2024-06-01T09:00:00Z", scanCount: 3 },
  ],
  totalScansLast24h: 5,
  activePetitionsLast24h: 1,
};

describe("useActivityFeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null feed when loading", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: true,
      error: undefined,
    });

    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.feed).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("returns feed data on completion", () => {
    mockUseQuery.mockReturnValue({
      data: { petitionActivityFeed: mockFeed },
      loading: false,
      error: undefined,
    });

    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.feed).toEqual(mockFeed);
    expect(result.current.feed?.items).toHaveLength(1);
    expect(result.current.feed?.totalScansLast24h).toBe(5);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns error when query fails", () => {
    const error = new Error("Network error");
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: false,
      error,
    });

    const { result } = renderHook(() => useActivityFeed());

    expect(result.current.error).toBe(error);
    expect(result.current.feed).toBeNull();
  });

  it("uses 30s poll interval", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      loading: true,
      error: undefined,
    });

    renderHook(() => useActivityFeed());

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        pollInterval: 30_000,
        fetchPolicy: "cache-and-network",
      }),
    );
  });
});
