import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import CommitteesPage from "@/app/region/campaign-finance/committees/page";

const mockCommittees = {
  items: [
    {
      id: "1",
      externalId: "comm-1",
      name: "Citizens for Progress",
      type: "pac",
      candidateName: null,
      candidateOffice: null,
      propositionId: null,
      party: null,
      status: "active",
      sourceSystem: "cal_access",
      sourceUrl: "https://example.com/comm-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "comm-2",
      name: "Smith for Governor",
      type: "candidate",
      candidateName: "Jane Smith",
      candidateOffice: "Governor",
      propositionId: null,
      party: "Democrat",
      status: "terminated",
      sourceSystem: "fec",
      sourceUrl: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 2,
  hasMore: false,
};

let mockQueryResult = {
  data: { committees: mockCommittees },
  loading: false,
  error: null as Error | null,
};

jest.mock("@apollo/client/react", () => ({
  useQuery: jest.fn(() => mockQueryResult),
}));

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

describe("CommitteesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { committees: mockCommittees },
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

      render(<CommitteesPage />);

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

      render(<CommitteesPage />);

      expect(
        screen.getByText(/Failed to load committees/i),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no committees", () => {
      mockQueryResult = {
        data: { committees: { items: [], total: 0, hasMore: false } },
        loading: false,
        error: null,
      };

      render(<CommitteesPage />);

      expect(screen.getByText("No committees found.")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render page header", () => {
      render(<CommitteesPage />);

      expect(
        screen.getByRole("heading", { name: "Committees" }),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<CommitteesPage />);

      expect(screen.getByRole("link", { name: /Region/i })).toHaveAttribute(
        "href",
        "/region",
      );
      expect(
        screen.getByRole("link", { name: /Campaign Finance/i }),
      ).toHaveAttribute("href", "/region/campaign-finance");
    });

    it("should render committee cards", () => {
      render(<CommitteesPage />);

      expect(screen.getByText("Citizens for Progress")).toBeInTheDocument();
      expect(screen.getByText("Smith for Governor")).toBeInTheDocument();
    });

    it("should render type badges", () => {
      render(<CommitteesPage />);

      expect(screen.getByText("pac")).toBeInTheDocument();
      expect(screen.getByText("candidate")).toBeInTheDocument();
    });

    it("should render status badges", () => {
      render(<CommitteesPage />);

      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("terminated")).toBeInTheDocument();
    });

    it("should render candidate name when present", () => {
      render(<CommitteesPage />);

      expect(screen.getByText("Candidate: Jane Smith")).toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    it("should show pagination info", () => {
      render(<CommitteesPage />);

      expect(screen.getByText(/Showing 1 - 2 of 2/)).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      render(<CommitteesPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });

    it("should enable next button when hasMore is true", () => {
      mockQueryResult = {
        data: {
          committees: { ...mockCommittees, hasMore: true, total: 25 },
        },
        loading: false,
        error: null,
      };

      render(<CommitteesPage />);

      expect(screen.getByText("Next")).not.toBeDisabled();
    });

    it("should navigate to next page when next is clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          committees: { ...mockCommittees, hasMore: true, total: 25 },
        },
        loading: false,
        error: null,
      };

      render(<CommitteesPage />);

      await user.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Previous")).not.toBeDisabled();
      });
    });
  });
});
