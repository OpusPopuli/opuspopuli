import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import ExpendituresPage from "@/app/region/campaign-finance/expenditures/page";

const mockExpenditures = {
  items: [
    {
      id: "1",
      externalId: "exp-1",
      committeeId: "comm-1",
      payeeName: "Ad Agency Inc",
      amount: 15000,
      date: "2024-08-01T00:00:00Z",
      purposeDescription: "Television advertising",
      supportOrOppose: "support",
      sourceSystem: "cal_access",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "2",
      externalId: "exp-2",
      committeeId: "comm-2",
      payeeName: "Consulting Group LLC",
      amount: 5000,
      date: "2024-09-15T00:00:00Z",
      purposeDescription: null,
      supportOrOppose: "oppose",
      sourceSystem: "fec",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  total: 2,
  hasMore: false,
};

let mockQueryResult = {
  data: { expenditures: mockExpenditures },
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

describe("ExpendituresPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { expenditures: mockExpenditures },
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

      render(<ExpendituresPage />);

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

      render(<ExpendituresPage />);

      expect(
        screen.getByText(/Failed to load expenditures/i),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("should show empty message when no expenditures", () => {
      mockQueryResult = {
        data: { expenditures: { items: [], total: 0, hasMore: false } },
        loading: false,
        error: null,
      };

      render(<ExpendituresPage />);

      expect(screen.getByText("No expenditures found.")).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render page header", () => {
      render(<ExpendituresPage />);

      expect(
        screen.getByRole("heading", { name: "Expenditures" }),
      ).toBeInTheDocument();
    });

    it("should render breadcrumb navigation", () => {
      render(<ExpendituresPage />);

      expect(screen.getByRole("link", { name: /Region/i })).toHaveAttribute(
        "href",
        "/region",
      );
      expect(
        screen.getByRole("link", { name: /Campaign Finance/i }),
      ).toHaveAttribute("href", "/region/campaign-finance");
    });

    it("should render expenditure cards", () => {
      render(<ExpendituresPage />);

      expect(screen.getByText("Ad Agency Inc")).toBeInTheDocument();
      expect(screen.getByText("Consulting Group LLC")).toBeInTheDocument();
    });

    it("should format currency amounts", () => {
      render(<ExpendituresPage />);

      expect(screen.getByText("$15,000.00")).toBeInTheDocument();
      expect(screen.getByText("$5,000.00")).toBeInTheDocument();
    });

    it("should render support/oppose badges", () => {
      render(<ExpendituresPage />);

      expect(screen.getByText("support")).toBeInTheDocument();
      expect(screen.getByText("oppose")).toBeInTheDocument();
    });

    it("should render purpose description when present", () => {
      render(<ExpendituresPage />);

      expect(screen.getByText("Television advertising")).toBeInTheDocument();
    });

    it("should apply correct badge colors", () => {
      render(<ExpendituresPage />);

      const supportBadge = screen.getByText("support");
      const opposeBadge = screen.getByText("oppose");

      expect(supportBadge).toHaveClass("bg-green-100", "text-green-800");
      expect(opposeBadge).toHaveClass("bg-red-100", "text-red-800");
    });
  });

  describe("pagination", () => {
    it("should show pagination info", () => {
      render(<ExpendituresPage />);

      expect(screen.getByText(/Showing 1 - 2 of 2/)).toBeInTheDocument();
    });

    it("should disable previous button on first page", () => {
      render(<ExpendituresPage />);

      expect(screen.getByText("Previous")).toBeDisabled();
    });

    it("should navigate to next page when next is clicked", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: {
          expenditures: {
            ...mockExpenditures,
            hasMore: true,
            total: 25,
          },
        },
        loading: false,
        error: null,
      };

      render(<ExpendituresPage />);

      await user.click(screen.getByText("Next"));

      await waitFor(() => {
        expect(screen.getByText("Previous")).not.toBeDisabled();
      });
    });
  });
});
