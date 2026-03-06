import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ActivityFeed,
  formatRelativeTime,
  truncate,
} from "@/components/petition/ActivityFeed";

const mockUseActivityFeed = jest.fn();
jest.mock("@/lib/hooks", () => ({
  useActivityFeed: () => mockUseActivityFeed(),
}));

const mockFeed = {
  items: [
    {
      contentHash: "hash-1",
      summary: "A petition about improving local parks and recreation areas",
      documentType: "petition",
      scanCount: 5,
      locationCount: 3,
      latestScanAt: new Date("2024-06-01T12:00:00Z"),
      earliestScanAt: new Date("2024-06-01T08:00:00Z"),
    },
    {
      contentHash: "hash-2",
      summary: "Petition for traffic safety improvements",
      documentType: "petition",
      scanCount: 8,
      locationCount: 2,
      latestScanAt: new Date("2024-06-01T11:00:00Z"),
      earliestScanAt: new Date("2024-06-01T07:00:00Z"),
    },
  ],
  hourlyTrend: [
    { hour: new Date("2024-06-01T08:00:00Z"), scanCount: 2 },
    { hour: new Date("2024-06-01T09:00:00Z"), scanCount: 5 },
    { hour: new Date("2024-06-01T10:00:00Z"), scanCount: 3 },
  ],
  totalScansLast24h: 13,
  activePetitionsLast24h: 2,
};

describe("formatRelativeTime", () => {
  it("returns 'just now' for times less than 1 minute ago", () => {
    const now = new Date();
    expect(formatRelativeTime(now)).toBe("just now");
    expect(formatRelativeTime(new Date(Date.now() - 30_000))).toBe("just now");
  });

  it("returns minutes for times 1-59 minutes ago", () => {
    expect(formatRelativeTime(new Date(Date.now() - 60_000))).toBe("1m ago");
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60_000))).toBe(
      "5m ago",
    );
    expect(formatRelativeTime(new Date(Date.now() - 59 * 60_000))).toBe(
      "59m ago",
    );
  });

  it("returns hours for times 1-23 hours ago", () => {
    expect(formatRelativeTime(new Date(Date.now() - 60 * 60_000))).toBe(
      "1h ago",
    );
    expect(formatRelativeTime(new Date(Date.now() - 12 * 60 * 60_000))).toBe(
      "12h ago",
    );
    expect(formatRelativeTime(new Date(Date.now() - 23 * 60 * 60_000))).toBe(
      "23h ago",
    );
  });

  it("returns days for times 24+ hours ago", () => {
    expect(formatRelativeTime(new Date(Date.now() - 24 * 60 * 60_000))).toBe(
      "1d ago",
    );
    expect(formatRelativeTime(new Date(Date.now() - 72 * 60 * 60_000))).toBe(
      "3d ago",
    );
  });
});

describe("truncate", () => {
  it("returns text unchanged when shorter than max", () => {
    expect(truncate("short text", 120)).toBe("short text");
  });

  it("returns text unchanged when exactly at max length", () => {
    const text = "a".repeat(120);
    expect(truncate(text, 120)).toBe(text);
  });

  it("truncates and adds ellipsis when text exceeds max", () => {
    const text = "a".repeat(130);
    const result = truncate(text, 120);
    expect(result).toHaveLength(121); // 120 chars + ellipsis
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("trims trailing whitespace before ellipsis", () => {
    const text = "word ".repeat(25); // 125 chars
    const result = truncate(text, 120);
    expect(result.endsWith(" \u2026")).toBe(false);
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncate("", 120)).toBe("");
  });
});

describe("ActivityFeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders loading skeleton on initial load", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: null,
      loading: true,
      error: null,
    });

    render(<ActivityFeed />);

    expect(screen.getByTestId("activity-feed-loading")).toBeInTheDocument();
  });

  it("renders null on error (graceful degradation)", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: null,
      loading: false,
      error: new Error("Failed"),
    });

    const { container } = render(<ActivityFeed />);

    expect(container.innerHTML).toBe("");
  });

  it("shows empty state when no activity", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: {
        items: [],
        hourlyTrend: [],
        totalScansLast24h: 0,
        activePetitionsLast24h: 0,
      },
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(
      screen.getByText(/No petition activity in the last 24 hours/),
    ).toBeInTheDocument();
  });

  it("renders activity items with counts", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: mockFeed,
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(screen.getByTestId("activity-feed")).toBeInTheDocument();
    expect(screen.getByText(/improving local parks/)).toBeInTheDocument();
    expect(screen.getByText(/traffic safety/)).toBeInTheDocument();
    expect(
      screen.getByText(/Scanned 5 times in 3 locations/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Scanned 8 times in 2 locations/),
    ).toBeInTheDocument();
  });

  it("renders stats banner with scan counts", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: mockFeed,
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/scans in the last 24 hours/)).toBeInTheDocument();
  });

  it("renders sparkline bars", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: mockFeed,
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(screen.getByLabelText("Hourly scan trend")).toBeInTheDocument();
    expect(screen.getByText("Last 24 hours")).toBeInTheDocument();
  });

  it("shows live indicator", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: mockFeed,
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("does not show skeleton when loading with cached data", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: mockFeed,
      loading: true,
      error: null,
    });

    render(<ActivityFeed />);

    expect(
      screen.queryByTestId("activity-feed-loading"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("activity-feed")).toBeInTheDocument();
  });

  it("uses singular forms for 1 scan and 1 location", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: {
        items: [
          {
            contentHash: "hash-s",
            summary: "Single scan petition",
            scanCount: 1,
            locationCount: 1,
            latestScanAt: new Date(),
            earliestScanAt: new Date(),
          },
        ],
        hourlyTrend: [],
        totalScansLast24h: 1,
        activePetitionsLast24h: 1,
      },
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(
      screen.getByText(/Scanned 1 time in 1 location/),
    ).toBeInTheDocument();
    // Verify singular forms: "scan" not "scans", "petition" not "petitions"
    const statsEl = screen
      .getByTestId("activity-feed")
      .querySelector("p.text-sm.text-gray-300");
    expect(statsEl?.textContent).toMatch(/\bscan\b/);
    expect(statsEl?.textContent).not.toMatch(/\bscans\b/);
    expect(statsEl?.textContent).toMatch(/\bpetition\b/);
    expect(statsEl?.textContent).not.toMatch(/\bpetitions\b/);
  });

  it("hides sparkline when hourlyTrend is empty", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: {
        items: mockFeed.items,
        hourlyTrend: [],
        totalScansLast24h: 13,
        activePetitionsLast24h: 2,
      },
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(
      screen.queryByLabelText("Hourly scan trend"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Last 24 hours")).not.toBeInTheDocument();
  });

  it("shows empty state when feed is null", () => {
    mockUseActivityFeed.mockReturnValue({
      feed: null,
      loading: false,
      error: null,
    });

    render(<ActivityFeed />);

    expect(
      screen.getByText(/No petition activity in the last 24 hours/),
    ).toBeInTheDocument();
  });
});
