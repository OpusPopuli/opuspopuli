import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PropositionFundingSection } from "@/components/region/PropositionFundingSection";
import type { PropositionFunding, SidedFunding } from "@/lib/graphql/region";

let mockQueryResult: {
  data: { propositionFunding: PropositionFunding | null } | null;
  loading: boolean;
  error: Error | null;
} = { data: null, loading: false, error: null };

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

const emptySide: SidedFunding = {
  totalRaised: 0,
  totalSpent: 0,
  donorCount: 0,
  committeeCount: 0,
  topDonors: [],
  primaryCommittees: [],
};

const populatedFunding: PropositionFunding = {
  propositionId: "prop-1",
  asOf: "2026-04-25T00:00:00Z",
  support: {
    totalRaised: 1_250_000,
    totalSpent: 980_000,
    donorCount: 42,
    committeeCount: 2,
    topDonors: [
      {
        donorName: "BIG GIVER LLC",
        totalAmount: 500_000,
        contributionCount: 5,
      },
      {
        donorName: "Alice Donor",
        totalAmount: 75_000,
        contributionCount: 1,
      },
    ],
    primaryCommittees: [
      { id: "c-1", name: "Yes on Prop 1", totalRaised: 1_200_000 },
      { id: "c-2", name: "Coalition for Yes", totalRaised: 50_000 },
    ],
  },
  oppose: {
    totalRaised: 600_000,
    totalSpent: 400_000,
    donorCount: 18,
    committeeCount: 1,
    topDonors: [
      {
        donorName: "Anti-Prop Coalition",
        totalAmount: 300_000,
        contributionCount: 3,
      },
    ],
    primaryCommittees: [
      { id: "c-3", name: "No on Prop 1", totalRaised: 600_000 },
    ],
  },
};

describe("PropositionFundingSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = { data: null, loading: false, error: null };
  });

  it("renders the loading skeleton while the query is in flight", () => {
    mockQueryResult = { data: null, loading: true, error: null };

    const { container } = render(
      <PropositionFundingSection propositionId="prop-1" />,
    );

    // SectionTitle still renders + the skeleton placeholders pulse
    expect(screen.getByText(/Who's Funding This/i)).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
  });

  it("renders the empty state when the query errors", () => {
    mockQueryResult = {
      data: null,
      loading: false,
      error: new Error("network down"),
    };

    render(<PropositionFundingSection propositionId="prop-1" />);

    expect(
      screen.getByText(/No campaign-finance filings linked/i),
    ).toBeInTheDocument();
  });

  it("renders the empty state when no funding has been linked yet", () => {
    mockQueryResult = {
      data: { propositionFunding: null },
      loading: false,
      error: null,
    };

    render(<PropositionFundingSection propositionId="prop-1" />);

    expect(
      screen.getByText(/No campaign-finance filings linked/i),
    ).toBeInTheDocument();
  });

  it("renders the empty state when both sides report zero money", () => {
    mockQueryResult = {
      data: {
        propositionFunding: {
          propositionId: "prop-1",
          asOf: "2026-04-25T00:00:00Z",
          support: { ...emptySide },
          oppose: { ...emptySide },
        },
      },
      loading: false,
      error: null,
    };

    render(<PropositionFundingSection propositionId="prop-1" />);

    expect(
      screen.getByText(/No campaign-finance filings linked/i),
    ).toBeInTheDocument();
  });

  describe("with populated funding", () => {
    beforeEach(() => {
      mockQueryResult = {
        data: { propositionFunding: populatedFunding },
        loading: false,
        error: null,
      };
    });

    it("renders Supporting and Opposing column labels", () => {
      render(<PropositionFundingSection propositionId="prop-1" />);

      expect(screen.getByText("Supporting")).toBeInTheDocument();
      expect(screen.getByText("Opposing")).toBeInTheDocument();
    });

    it("formats the totals as currency", () => {
      render(<PropositionFundingSection propositionId="prop-1" />);

      // formatCurrency uses the en-US Intl default which includes cents.
      expect(screen.getByText("$1,250,000.00")).toBeInTheDocument();
      expect(screen.getByText("$600,000.00")).toBeInTheDocument();
    });

    it("shows pluralized donor + committee counts", () => {
      render(<PropositionFundingSection propositionId="prop-1" />);

      expect(
        screen.getByText("raised by 2 committees from 42 donors"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("raised by 1 committee from 18 donors"),
      ).toBeInTheDocument();
    });

    it("renders the top-donor list with names and amounts", () => {
      render(<PropositionFundingSection propositionId="prop-1" />);

      expect(screen.getByText("BIG GIVER LLC")).toBeInTheDocument();
      expect(screen.getByText("$500,000.00")).toBeInTheDocument();
      expect(screen.getByText("Anti-Prop Coalition")).toBeInTheDocument();
    });

    it("renders primary committees as links to their detail pages", () => {
      render(<PropositionFundingSection propositionId="prop-1" />);

      const yesLink = screen.getByRole("link", { name: "Yes on Prop 1" });
      expect(yesLink).toHaveAttribute(
        "href",
        "/region/campaign-finance/committees/c-1",
      );
      const noLink = screen.getByRole("link", { name: "No on Prop 1" });
      expect(noLink).toHaveAttribute(
        "href",
        "/region/campaign-finance/committees/c-3",
      );
    });

    it("shows the asOf timestamp footer", () => {
      render(<PropositionFundingSection propositionId="prop-1" />);

      expect(
        screen.getByText(/Reflects CalAccess records as of/i),
      ).toBeInTheDocument();
    });
  });
});
