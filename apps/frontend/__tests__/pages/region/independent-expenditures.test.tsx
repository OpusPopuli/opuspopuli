import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import IndependentExpendituresPage from "@/app/region/campaign-finance/independent-expenditures/page";

const mockIndependentExpenditures = {
  items: [
    {
      id: "1",
      externalId: "ie-1",
      committeeId: "comm-1",
      committeeName: "Super PAC for Justice",
      candidateName: "Jane Smith",
      propositionTitle: null,
      supportOrOppose: "support",
      amount: 50000,
      date: "2024-10-01T00:00:00Z",
      sourceSystem: "cal_access",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "ie-2",
      committeeId: "comm-2",
      committeeName: "Citizens Against Prop X",
      candidateName: null,
      propositionTitle: "Proposition X",
      supportOrOppose: "oppose",
      amount: 25000,
      date: "2024-10-15T00:00:00Z",
      sourceSystem: "fec",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 2,
  hasMore: false,
};

let mockQueryResult = {
  data: { independentExpenditures: mockIndependentExpenditures },
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

describe("IndependentExpendituresPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { independentExpenditures: mockIndependentExpenditures },
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

      render(<IndependentExpendituresPage />);

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

      render(<IndependentExpendituresPage />);

      expect(
        screen.getByText(/Failed to load independent expenditures/i),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no independent expenditures", () => {
      mockQueryResult = {
        data: {
          independentExpenditures: { items: [], total: 0, hasMore: false },
        },
        loading: false,
        error: null,
      };

      render(<IndependentExpendituresPage />);

      expect(
        screen.getByText("No independent expenditures found."),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render page header", () => {
      render(<IndependentExpendituresPage />);

      expect(
        screen.getByRole("heading", { name: "Independent Expenditures" }),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<IndependentExpendituresPage />);

      expect(screen.getByRole("link", { name: /Region/i })).toHaveAttribute(
        "href",
        "/region",
      );
      expect(
        screen.getByRole("link", { name: /Campaign Finance/i }),
      ).toHaveAttribute("href", "/region/campaign-finance");
    });

    it("should render committee names", () => {
      render(<IndependentExpendituresPage />);

      expect(screen.getByText("Super PAC for Justice")).toBeInTheDocument();
      expect(screen.getByText("Citizens Against Prop X")).toBeInTheDocument();
    });

    it("should format currency amounts", () => {
      render(<IndependentExpendituresPage />);

      expect(screen.getByText("$50,000.00")).toBeInTheDocument();
      expect(screen.getByText("$25,000.00")).toBeInTheDocument();
    });

    it("should render support/oppose badges", () => {
      render(<IndependentExpendituresPage />);

      expect(screen.getByText("support")).toBeInTheDocument();
      expect(screen.getByText("oppose")).toBeInTheDocument();
    });

    it("should render candidate name when present", () => {
      render(<IndependentExpendituresPage />);

      expect(screen.getByText("Candidate: Jane Smith")).toBeInTheDocument();
    });

    it("should render proposition title when present", () => {
      render(<IndependentExpendituresPage />);

      expect(
        screen.getByText("Proposition: Proposition X"),
      ).toBeInTheDocument();
    });

    it("should apply correct badge colors", () => {
      render(<IndependentExpendituresPage />);

      const supportBadge = screen.getByText("support");
      const opposeBadge = screen.getByText("oppose");

      expect(supportBadge).toHaveClass("bg-green-100", "text-green-800");
      expect(opposeBadge).toHaveClass("bg-red-100", "text-red-800");
    });
  });

  describe("pagination", () => {
    it("should show pagination info", () => {
      render(<IndependentExpendituresPage />);

      expect(screen.getByText(/Showing 1 - 2 of 2/)).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      render(<IndependentExpendituresPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });

    it("should navigate to next page when next is clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          independentExpenditures: {
            ...mockIndependentExpenditures,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<IndependentExpendituresPage />);

      await user.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Previous")).not.toBeDisabled();
      });
    });
  });
});
