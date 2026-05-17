import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import RegionPage from "@/app/region/page";
import { GET_REGION_INFO } from "@/lib/graphql/region";

// Mock Apollo Client
const mockRegionInfo = {
  id: "test-region",
  name: "Test Region",
  description: "A test region for civic data",
  timezone: "America/Los_Angeles",
  dataSourceUrls: ["https://example.com/data"],
  supportedDataTypes: [
    "PROPOSITIONS",
    "MEETINGS",
    "REPRESENTATIVES",
    "CAMPAIGN_FINANCE",
  ],
};

let mockQueryResult = {
  data: { regionInfo: mockRegionInfo },
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

describe("RegionPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = {
      data: { regionInfo: mockRegionInfo },
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

      render(<RegionPage />);

      // Check for skeleton elements
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

      render(<RegionPage />);

      expect(
        screen.getByText(/Failed to load region information/i),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("should render region name and description", () => {
      render(<RegionPage />);

      expect(screen.getByText("Test Region")).toBeInTheDocument();
      expect(
        screen.getByText("A test region for civic data"),
      ).toBeInTheDocument();
    });

    it("should render timezone", () => {
      render(<RegionPage />);

      expect(
        screen.getByText(/Timezone: America\/Los_Angeles/),
      ).toBeInTheDocument();
    });

    it("should render data type cards for supported types", () => {
      render(<RegionPage />);

      expect(screen.getByText("Propositions")).toBeInTheDocument();
      // MEETINGS card removed from the home page (issue #665) — past
      // meeting minutes flow through the rep + committee L3 feeds and
      // forward-looking calendar entries are lower civic-action value.
      expect(screen.queryByText("Meetings")).not.toBeInTheDocument();
      expect(screen.getByText("Representatives")).toBeInTheDocument();
      // The CAMPAIGN_FINANCE data-type slot now displays as the
      // Legislative Committees card on the home page; the campaign-finance
      // hub stays reachable via direct URL and from proposition pages.
      expect(screen.getByText("Legislative Committees")).toBeInTheDocument();
      expect(screen.queryByText("Campaign Finance")).not.toBeInTheDocument();
    });

    it("should render data type descriptions", () => {
      render(<RegionPage />);

      expect(
        screen.getByText("Ballot measures and initiatives"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Elected officials and legislators"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Where bills get debated and shaped before the floor vote",
        ),
      ).toBeInTheDocument();
      // Meetings description should no longer appear (#665).
      expect(
        screen.queryByText("Legislative sessions and hearings"),
      ).not.toBeInTheDocument();
    });

    it("should render navigation links to sub-pages", () => {
      render(<RegionPage />);

      const propositionsLink = screen.getByRole("link", {
        name: /Propositions/i,
      });
      const representativesLink = screen.getByRole("link", {
        name: /Representatives/i,
      });

      expect(propositionsLink).toHaveAttribute("href", "/region/propositions");
      expect(representativesLink).toHaveAttribute(
        "href",
        "/region/representatives",
      );
      // No meetings card link on the home page anymore.
      expect(
        screen.queryByRole("link", { name: /^Meetings$/i }),
      ).not.toBeInTheDocument();

      const legislativeCommitteesLink = screen.getByRole("link", {
        name: /Legislative Committees/i,
      });
      expect(legislativeCommitteesLink).toHaveAttribute(
        "href",
        "/region/legislative-committees",
      );
    });

    it("should render data source URLs", () => {
      render(<RegionPage />);

      expect(screen.getByText("Data Sources")).toBeInTheDocument();
      expect(screen.getByText("https://example.com/data")).toBeInTheDocument();
    });
  });

  describe("partial data", () => {
    it("should handle missing data source URLs", () => {
      mockQueryResult = {
        data: {
          regionInfo: {
            ...mockRegionInfo,
            dataSourceUrls: undefined,
          },
        },
        loading: false,
        error: null,
      };

      render(<RegionPage />);

      expect(screen.queryByText("Data Sources")).not.toBeInTheDocument();
    });

    it("should handle empty data source URLs", () => {
      mockQueryResult = {
        data: {
          regionInfo: {
            ...mockRegionInfo,
            dataSourceUrls: [],
          },
        },
        loading: false,
        error: null,
      };

      render(<RegionPage />);

      expect(screen.queryByText("Data Sources")).not.toBeInTheDocument();
    });

    it("should handle limited supported data types", () => {
      mockQueryResult = {
        data: {
          regionInfo: {
            ...mockRegionInfo,
            supportedDataTypes: ["PROPOSITIONS"],
          },
        },
        loading: false,
        error: null,
      };

      render(<RegionPage />);

      expect(screen.getByText("Propositions")).toBeInTheDocument();
      expect(screen.queryByText("Meetings")).not.toBeInTheDocument();
      expect(screen.queryByText("Representatives")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Legislative Committees"),
      ).not.toBeInTheDocument();
    });
  });
});
