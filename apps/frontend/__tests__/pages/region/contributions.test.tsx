import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import ContributionsPage from "@/app/region/campaign-finance/contributions/page";

const mockContributions = {
  items: [
    {
      id: "1",
      externalId: "contrib-1",
      committeeId: "comm-1",
      donorName: "Jane Doe",
      donorType: "individual",
      amount: 500.5,
      date: "2024-06-15T00:00:00Z",
      sourceSystem: "cal_access",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "contrib-2",
      committeeId: "comm-2",
      donorName: "ACME Corp PAC",
      donorType: "committee",
      amount: 10000,
      date: "2024-07-20T00:00:00Z",
      sourceSystem: "fec",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 2,
  hasMore: false,
};

let mockQueryResult = {
  data: { contributions: mockContributions },
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

describe("ContributionsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { contributions: mockContributions },
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

      render(<ContributionsPage />);

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

      render(<ContributionsPage />);

      expect(
        screen.getByText(/Failed to load contributions/i),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no contributions", () => {
      mockQueryResult = {
        data: { contributions: { items: [], total: 0, hasMore: false } },
        loading: false,
        error: null,
      };

      render(<ContributionsPage />);

      expect(screen.getByText("No contributions found.")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render page header", () => {
      render(<ContributionsPage />);

      expect(
        screen.getByRole("heading", { name: "Contributions" }),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<ContributionsPage />);

      expect(screen.getByRole("link", { name: /Region/i })).toHaveAttribute(
        "href",
        "/region",
      );
      expect(
        screen.getByRole("link", { name: /Campaign Finance/i }),
      ).toHaveAttribute("href", "/region/campaign-finance");
    });

    it("should render contribution cards with donor names", () => {
      render(<ContributionsPage />);

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByText("ACME Corp PAC")).toBeInTheDocument();
    });

    it("should format currency amounts", () => {
      render(<ContributionsPage />);

      expect(screen.getByText("$500.50")).toBeInTheDocument();
      expect(screen.getByText("$10,000.00")).toBeInTheDocument();
    });

    it("should render donor type badges", () => {
      render(<ContributionsPage />);

      expect(screen.getByText("individual")).toBeInTheDocument();
      expect(screen.getByText("committee")).toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    it("should show pagination info", () => {
      render(<ContributionsPage />);

      expect(screen.getByText(/Showing 1 - 2 of 2/)).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      render(<ContributionsPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });

    it("should navigate to next page when next is clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          contributions: {
            ...mockContributions,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<ContributionsPage />);

      await user.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Previous")).not.toBeDisabled();
      });
    });
  });
});
