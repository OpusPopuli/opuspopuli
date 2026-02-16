import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import PropositionsPage from "@/app/region/propositions/page";

// Mock data
const mockPropositions = {
  items: [
    {
      id: "1",
      externalId: "prop-1",
      title: "Proposition 1: Test Measure",
      summary: "This is a test proposition summary.",
      status: "PENDING",
      electionDate: "2024-11-05T00:00:00Z",
      sourceUrl: "https://example.com/prop-1",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "prop-2",
      title: "Proposition 2: Passed Measure",
      summary: "This proposition passed.",
      status: "PASSED",
      electionDate: "2024-03-05T00:00:00Z",
      sourceUrl: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "3",
      externalId: "prop-3",
      title: "Proposition 3: Failed Measure",
      summary: "This proposition failed.",
      status: "FAILED",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 3,
  hasMore: false,
};

let mockQueryResult = {
  data: { propositions: mockPropositions },
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

describe("PropositionsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { propositions: mockPropositions },
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

      render(<PropositionsPage />);

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

      render(<PropositionsPage />);

      expect(
        screen.getByText(/Failed to load propositions/i),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no propositions", () => {
      mockQueryResult = {
        data: {
          propositions: {
            items: [],
            total: 0,
            hasMore: false,
          },
        },
        loading: false,
        error: null,
      };

      render(<PropositionsPage />);

      expect(screen.getByText("No propositions found.")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render page header", () => {
      render(<PropositionsPage />);

      expect(
        screen.getByRole("heading", { name: "Propositions" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Ballot measures and initiatives for your region"),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<PropositionsPage />);

      const regionLink = screen.getByRole("link", { name: /Region/i });
      expect(regionLink).toHaveAttribute("href", "/region");
    });

    it("should render proposition cards", () => {
      render(<PropositionsPage />);

      expect(
        screen.getByText("Proposition 1: Test Measure"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Proposition 2: Passed Measure"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Proposition 3: Failed Measure"),
      ).toBeInTheDocument();
    });

    it("should render proposition summaries", () => {
      render(<PropositionsPage />);

      expect(
        screen.getByText("This is a test proposition summary."),
      ).toBeInTheDocument();
    });

    it("should render status badges", () => {
      render(<PropositionsPage />);

      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(screen.getByText("Passed")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    it("should render election dates", () => {
      render(<PropositionsPage />);

      // Use flexible regex to handle timezone differences (Nov 4 or 5 depending on TZ)
      expect(
        screen.getByText(/Election: November \d+, 2024/),
      ).toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    it("should show pagination info", () => {
      render(<PropositionsPage />);

      expect(screen.getByText(/Showing 1 - 3 of 3/)).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      render(<PropositionsPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });

    it("should disable next button when no more items", () => {
      render(<PropositionsPage />);

      expect(screen.getByText("Next")).toBeDisabled();
    });

    it("should enable next button when hasMore is true", () => {
      mockQueryResult = {
        data: {
          propositions: {
            ...mockPropositions,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<PropositionsPage />);

      expect(screen.getByText("Next")).not.toBeDisabled();
    });

    it("should navigate to next page when next is clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          propositions: {
            ...mockPropositions,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<PropositionsPage />);

      await user.click(screen.getByText("Next"));

      // After clicking next, Previous should be enabled
      await waitFor(() => {
        expect(screen.getByText("Previous")).not.toBeDisabled();
      });
    });
  });

  describe("card links", () => {
    it("should render proposition cards as links to detail pages", () => {
      render(<PropositionsPage />);

      const link1 = screen.getByRole("link", {
        name: /Proposition 1: Test Measure/,
      });
      expect(link1).toHaveAttribute("href", "/region/propositions/1");

      const link2 = screen.getByRole("link", {
        name: /Proposition 2: Passed Measure/,
      });
      expect(link2).toHaveAttribute("href", "/region/propositions/2");
    });
  });

  describe("status badge colors", () => {
    it("should apply correct colors for different statuses", () => {
      render(<PropositionsPage />);

      const pendingBadge = screen.getByText("Pending");
      const passedBadge = screen.getByText("Passed");
      const failedBadge = screen.getByText("Failed");

      expect(pendingBadge).toHaveClass("bg-yellow-100", "text-yellow-800");
      expect(passedBadge).toHaveClass("bg-green-100", "text-green-800");
      expect(failedBadge).toHaveClass("bg-red-100", "text-red-800");
    });
  });
});
