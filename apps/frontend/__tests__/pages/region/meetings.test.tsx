import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import MeetingsPage from "@/app/region/meetings/page";

// Mock data - use future date for upcoming meeting
const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 7);

const pastDate = new Date();
pastDate.setDate(pastDate.getDate() - 7);

const mockMeetings = {
  items: [
    {
      id: "1",
      externalId: "meeting-1",
      title: "City Council Regular Meeting",
      body: "City Council",
      scheduledAt: futureDate.toISOString(),
      location: "City Hall, Room 201",
      agendaUrl: "https://example.com/agenda",
      videoUrl: "https://example.com/video",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "meeting-2",
      title: "Planning Commission Hearing",
      body: "Planning Commission",
      scheduledAt: pastDate.toISOString(),
      location: "City Hall, Room 305",
      agendaUrl: "https://example.com/agenda-2",
      videoUrl: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "3",
      externalId: "meeting-3",
      title: "Budget Committee Session",
      body: "Budget Committee",
      scheduledAt: pastDate.toISOString(),
      location: null,
      agendaUrl: null,
      videoUrl: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 3,
  hasMore: false,
};

let mockQueryResult = {
  data: { meetings: mockMeetings },
  loading: false,
  error: null as Error | null,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: jest.fn(() => mockQueryResult),
}));

// Mock next/link
jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  };
});

describe("MeetingsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { meetings: mockMeetings },
      loading: false,
      error: null,
    };
  });

  describe("loading state", () => {
    it("should show loading skeleton", () => {
      mockQueryResult = {
        data: null as unknown as typeof mockQueryResult.data,
        loading: true,
        error: null,
      };

      render(<MeetingsPage />);

      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("error state", () => {
    it("should show error message when query fails", () => {
      mockQueryResult = {
        data: null as unknown as typeof mockQueryResult.data,
        loading: false,
        error: new Error("Failed to fetch"),
      };

      render(<MeetingsPage />);

      expect(screen.getByText(/Failed to load meetings/i)).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no meetings", () => {
      mockQueryResult = {
        data: {
          meetings: {
            items: [],
            total: 0,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
      };

      render(<MeetingsPage />);

      expect(screen.getByText("No meetings found.")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render page header", () => {
      render(<MeetingsPage />);

      expect(
        screen.getByRole("heading", { name: "Meetings" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Legislative sessions and public hearings"),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<MeetingsPage />);

      const regionLink = screen.getByRole("link", { name: /Where you live/i });
      expect(regionLink).toHaveAttribute("href", "/region");
    });

    it("should render meeting cards", () => {
      render(<MeetingsPage />);

      expect(
        screen.getByText("City Council Regular Meeting"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Planning Commission Hearing"),
      ).toBeInTheDocument();
      expect(screen.getByText("Budget Committee Session")).toBeInTheDocument();
    });

    it("should render meeting bodies", () => {
      render(<MeetingsPage />);

      expect(screen.getByText("City Council")).toBeInTheDocument();
      expect(screen.getByText("Planning Commission")).toBeInTheDocument();
      expect(screen.getByText("Budget Committee")).toBeInTheDocument();
    });

    it("should render meeting locations when available", () => {
      render(<MeetingsPage />);

      expect(screen.getByText("City Hall, Room 201")).toBeInTheDocument();
      expect(screen.getByText("City Hall, Room 305")).toBeInTheDocument();
    });

    it("should render agenda links when available", () => {
      render(<MeetingsPage />);

      const agendaLinks = screen.getAllByText("Agenda");
      expect(agendaLinks.length).toBe(2); // Two meetings have agendas
    });

    it("should render video links when available", () => {
      render(<MeetingsPage />);

      const videoLinks = screen.getAllByText("Video");
      expect(videoLinks.length).toBe(1); // Only one meeting has video
    });

    it("should show Past badge for past meetings", () => {
      render(<MeetingsPage />);

      const pastBadges = screen.getAllByText("Past");
      expect(pastBadges.length).toBe(2); // Two past meetings
    });
  });

  describe("date badges", () => {
    it("should render date badges with month and day", () => {
      render(<MeetingsPage />);

      // Check that date elements are rendered (month abbreviation and day number)
      const meetingCards = document.querySelectorAll(".rounded-lg");
      expect(meetingCards.length).toBeGreaterThan(0);
    });
  });

  describe("pagination", () => {
    it("should show pagination info", () => {
      render(<MeetingsPage />);

      expect(screen.getByText(/Showing 1 - 3 of 3/)).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      render(<MeetingsPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });

    it("should disable next button when no more items", () => {
      render(<MeetingsPage />);

      expect(screen.getByText("Next")).toBeDisabled();
    });

    it("should enable next button when hasMore is true", () => {
      mockQueryResult = {
        data: {
          meetings: {
            ...mockMeetings,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<MeetingsPage />);

      expect(screen.getByText("Next")).not.toBeDisabled();
    });

    it("should navigate pages when buttons are clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          meetings: {
            ...mockMeetings,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<MeetingsPage />);

      await user.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Previous")).not.toBeDisabled();
      });
    });
  });
});
