/**
 * /region/search page tests (#1154 review, blocker B1).
 *
 * Every other region page has a sibling suite here; this one was
 * missing, leaving setType, pagination, the error/loading/empty
 * branches, the es-locale note and the live-region text with no
 * coverage at all (and the file sitting at 0% in the coverage gate,
 * since `app/**` is in collectCoverageFrom).
 *
 * Follows the propositions.test.tsx pattern: mock useQuery rather than
 * standing up MockedProvider, so each branch is addressable directly.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import SearchPage from "@/app/region/search/page";

const push = jest.fn();
const replace = jest.fn();
let searchParams = new URLSearchParams("q=wildfire");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

const mockResult = {
  items: [
    {
      rank: 9.6,
      snippet: "premium discounts for ⟪wildfire⟫-hardened homes",
      result: {
        __typename: "Bill",
        id: "b1",
        billNumber: "AB 1236",
        sessionYear: "2025-2026",
        measureTypeCode: "AB",
        title: "Residential property insurance",
        authorName: "Asm. L. Rivera",
        status: "In Senate",
        lastAction: "Read second time.",
        lastActionDate: "2026-08-28",
        isActive: true,
        isDead: false,
      },
    },
    {
      rank: 4.2,
      snippet: "bonds for ⟪wildfire⟫ prevention",
      result: {
        __typename: "PropositionModel",
        id: "p1",
        externalId: "Proposition 12",
        title: "Wildfire Response Bond Act",
        status: "PENDING",
        electionDate: "2026-11-03T00:00:00Z",
      },
    },
  ],
  total: 42,
  hasMore: true,
  billCount: 40,
  propositionCount: 5,
};

let mockQueryResult = {
  data: { regionSearch: mockResult },
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

/** The always-mounted sr-only live region. */
function liveRegion() {
  return document.querySelector('[aria-live="polite"]');
}

describe("SearchPage (#1154)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    searchParams = new URLSearchParams("q=wildfire");
    mockQueryResult = {
      data: { regionSearch: mockResult },
      loading: false,
      error: null,
    };
  });

  describe("result rendering", () => {
    it("renders both entity kinds from the union", () => {
      render(<SearchPage />);
      expect(screen.getByText("AB 1236")).toBeInTheDocument();
      expect(
        screen.getByText("Wildfire Response Bond Act"),
      ).toBeInTheDocument();
    });

    it("renders snippet markers as <mark>, never literal sentinels", () => {
      const { container } = render(<SearchPage />);
      const marks = container.querySelectorAll("mark");
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0]).toHaveTextContent("wildfire");
      expect(container.textContent).not.toContain("⟪");
    });
  });

  describe("facet chips", () => {
    it("labels chips with corpus-wide counts, not the page size", () => {
      render(<SearchPage />);
      expect(
        screen.getByRole("radio", { name: /Bills · 40/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /Propositions · 5/ }),
      ).toBeInTheDocument();
    });

    it("setType writes the filter to the URL and resets to page 1", async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      await user.click(screen.getByRole("radio", { name: /Bills · 40/ }));

      expect(replace).toHaveBeenCalledWith(
        "/region/search?q=wildfire&type=BILL",
      );
    });

    it("clearing the filter drops type from the URL", async () => {
      searchParams = new URLSearchParams("q=wildfire&type=BILL");
      const user = userEvent.setup();
      render(<SearchPage />);

      await user.click(screen.getByRole("radio", { name: /All ·/ }));

      expect(replace).toHaveBeenCalledWith("/region/search?q=wildfire");
    });

    it("ignores an unrecognised ?type instead of erroring", () => {
      searchParams = new URLSearchParams("q=wildfire&type=bogus");
      render(<SearchPage />);
      // Renders results, and "All" is the selected facet.
      expect(screen.getByText("AB 1236")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /All ·/ })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
  });

  describe("summary line", () => {
    it("includes the breakdown when nothing is filtered", () => {
      render(<SearchPage />);
      expect(liveRegion()).toHaveTextContent("42 results");
      expect(liveRegion()).toHaveTextContent("40 bills");
    });

    it("omits the breakdown when a filter is active, so the scales cannot contradict", () => {
      searchParams = new URLSearchParams("q=wildfire&type=BILL");
      render(<SearchPage />);
      expect(liveRegion()).toHaveTextContent("42 results");
      expect(liveRegion()).not.toHaveTextContent("propositions");
    });
  });

  describe("pagination", () => {
    it("passes the filtered total and hasMore through to the pager", () => {
      render(<SearchPage />);
      expect(screen.getByText(/Showing 1 - 10 of 42/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    });

    it("advances the page without touching the URL query", async () => {
      const user = userEvent.setup();
      render(<SearchPage />);

      await user.click(screen.getByRole("button", { name: "Next" }));

      expect(screen.getByText(/Showing 11 - 20 of 42/)).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe("non-result states", () => {
    it("shows the skeleton while loading with no data", () => {
      mockQueryResult = {
        data: null as unknown as typeof mockQueryResult.data,
        loading: true,
        error: null,
      };
      render(<SearchPage />);
      expect(
        document.querySelectorAll(".animate-pulse").length,
      ).toBeGreaterThan(0);
    });

    it("reports a failed search as an error, never as 'no results'", () => {
      mockQueryResult = {
        data: null as unknown as typeof mockQueryResult.data,
        loading: false,
        error: new Error("boom"),
      };
      render(<SearchPage />);

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(within(alert).getByText(/isn’t available/i)).toBeInTheDocument();
      expect(screen.queryByText(/No results for/)).not.toBeInTheDocument();
    });

    it("announces the empty state, which previously had no live region", () => {
      mockQueryResult = {
        data: {
          regionSearch: {
            items: [],
            total: 0,
            hasMore: false,
            billCount: 0,
            propositionCount: 0,
          },
        },
        loading: false,
        error: null,
      };
      render(<SearchPage />);

      // Present twice by design: the visible card (browsable) and the
      // live region (announced on change).
      expect(screen.getAllByText(/No results for/).length).toBe(2);
      expect(liveRegion()).toHaveTextContent(/No results for/);
    });

    it("prompts rather than querying when there is no q", () => {
      searchParams = new URLSearchParams();
      render(<SearchPage />);
      expect(screen.getByText(/Type to search/i)).toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    });
  });
});
