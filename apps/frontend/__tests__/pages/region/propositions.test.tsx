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
  __esModule: true,
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

/** The status pill, not the identically-worded filter <option> (#1155). */
function statusBadge(label: string) {
  return screen.getByText(
    (content, element) =>
      content === label && element?.tagName.toLowerCase() === "span",
  );
}

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

      // Scoped to <span> badges: the status filter added in #1155 puts
      // the same words in <option>s, so a bare getByText is ambiguous.
      expect(statusBadge("Pending")).toBeInTheDocument();
      expect(statusBadge("Passed")).toBeInTheDocument();
      expect(statusBadge("Failed")).toBeInTheDocument();
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

      const pendingBadge = statusBadge("Pending");
      const passedBadge = statusBadge("Passed");
      const failedBadge = statusBadge("Failed");

      expect(pendingBadge).toHaveClass("bg-warning-surface", "text-warning");
      expect(passedBadge).toHaveClass("bg-positive-surface", "text-positive");
      expect(failedBadge).toHaveClass("bg-danger-surface", "text-danger");
    });
  });

  describe("search and filters (#1155)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useQuery } = require("@apollo/client/react");

    function lastVariables() {
      const calls = (useQuery as jest.Mock).mock.calls;
      return calls[calls.length - 1][1].variables;
    }

    it("does not send a search variable until the user types", () => {
      render(<PropositionsPage />);
      expect(lastVariables().search).toBeUndefined();
    });

    it("sends the typed query after the debounce", async () => {
      const user = userEvent.setup();
      render(<PropositionsPage />);

      await user.type(
        screen.getByRole("searchbox", { name: /search propositions/i }),
        "wildfire",
      );
      await waitFor(() => expect(lastVariables().search).toBe("wildfire"));
    });

    it("sends status and election year, and composes them with search", async () => {
      const user = userEvent.setup();
      render(<PropositionsPage />);

      await user.selectOptions(
        screen.getByLabelText(/filter by status/i),
        "PASSED",
      );
      await waitFor(() => expect(lastVariables().status).toBe("PASSED"));

      await user.type(
        screen.getByRole("searchbox", { name: /search propositions/i }),
        "bond",
      );
      await waitFor(() => {
        const v = lastVariables();
        expect(v.search).toBe("bond");
        expect(v.status).toBe("PASSED");
      });
    });

    it("clear filters resets the query, the selects and the input box", async () => {
      const user = userEvent.setup();
      render(<PropositionsPage />);

      const box = screen.getByRole("searchbox", {
        name: /search propositions/i,
      });
      await user.type(box, "wildfire");
      await user.selectOptions(
        screen.getByLabelText(/filter by status/i),
        "PASSED",
      );
      await waitFor(() => expect(lastVariables().search).toBe("wildfire"));

      await user.click(screen.getByRole("button", { name: /clear filters/i }));

      await waitFor(() => {
        const v = lastVariables();
        expect(v.search).toBeUndefined();
        expect(v.status).toBeUndefined();
      });
      // The box owns its own state — clearing must reset it too, or the
      // UI shows a query that is no longer being applied.
      expect(
        screen.getByRole("searchbox", { name: /search propositions/i }),
      ).toHaveValue("");
    });
  });

  describe("search UX regressions caught in review (#1155)", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useQuery } = require("@apollo/client/react");

    function lastVariables() {
      const calls = (useQuery as jest.Mock).mock.calls;
      return calls[calls.length - 1][1].variables;
    }

    function liveRegion() {
      return document.querySelector('[aria-live="polite"]');
    }

    it("keeps the live region mounted so a change is actually announced", () => {
      render(<PropositionsPage />);
      // Present before any search — a region inserted with its content is
      // not reliably announced.
      expect(liveRegion()).toBeInTheDocument();
    });

    it("announces a zero-result search instead of saying nothing", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: { propositions: { items: [], total: 0, hasMore: false } },
        loading: false,
        error: null,
      };
      render(<PropositionsPage />);

      await user.type(
        screen.getByRole("searchbox", { name: /search propositions/i }),
        "zzzz",
      );
      await waitFor(() =>
        expect(liveRegion()).toHaveTextContent(/No results for/),
      );
    });

    it("says 'no results for your query', not 'no propositions', when a search misses", async () => {
      const user = userEvent.setup();
      mockQueryResult = {
        data: { propositions: { items: [], total: 0, hasMore: false } },
        loading: false,
        error: null,
      };
      render(<PropositionsPage />);

      await user.type(
        screen.getByRole("searchbox", { name: /search propositions/i }),
        "zzzz",
      );
      // Appears twice by design: the visible card and the live region.
      await waitFor(() =>
        expect(screen.getAllByText(/No results for/).length).toBe(2),
      );
      expect(screen.queryByText(/No propositions found/i)).toBeNull();
    });

    it("still shows the corpus-empty message when there is no search", () => {
      mockQueryResult = {
        data: { propositions: { items: [], total: 0, hasMore: false } },
        loading: false,
        error: null,
      };
      render(<PropositionsPage />);
      expect(screen.getByText(/No propositions found/i)).toBeInTheDocument();
    });

    it("does not blank the list while refining a search", () => {
      // loading with data present must keep rendering results rather than
      // swapping in a skeleton on every debounce settle.
      mockQueryResult = {
        data: { propositions: mockPropositions },
        loading: true,
        error: null,
      };
      const { container } = render(<PropositionsPage />);
      expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
      expect(
        screen.getByText("Proposition 1: Test Measure"),
      ).toBeInTheDocument();
    });

    it("resets pagination when a new search is applied", async () => {
      const user = userEvent.setup();
      // Next is disabled unless the server reports more pages.
      mockQueryResult = {
        data: {
          propositions: { ...mockPropositions, total: 40, hasMore: true },
        },
        loading: false,
        error: null,
      };
      render(<PropositionsPage />);

      await user.click(screen.getByRole("button", { name: "Next" }));
      await waitFor(() => expect(lastVariables().skip).toBe(10));

      await user.type(
        screen.getByRole("searchbox", { name: /search propositions/i }),
        "wildfire",
      );
      await waitFor(() => {
        const v = lastVariables();
        expect(v.search).toBe("wildfire");
        expect(v.skip).toBe(0);
      });
    });
  });
});
