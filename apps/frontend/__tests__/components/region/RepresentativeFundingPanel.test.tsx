import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

let mockResult: {
  data: { representativeFunding: unknown } | undefined;
  loading: boolean;
};
jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockResult,
}));

import { RepresentativeFundingPanel } from "@/components/region/RepresentativeFundingPanel";

const base = {
  representativeId: "rep-1",
  asOf: "2026-07-24",
  totalRaised: 125000,
  totalSpent: 40000,
  donorCount: 320,
  committeeCount: 2,
  topDonors: [
    { donorName: "ACME PAC", totalAmount: 25000, contributionCount: 12 },
  ],
  topEmployers: [
    { employer: "Big Oil Co", totalAmount: 18000, contributionCount: 8 },
  ],
  committees: [{ id: "c1", name: "Re-Elect Jane Doe", totalRaised: 100000 }],
};

describe("RepresentativeFundingPanel (#943)", () => {
  it("renders totals, top donors and top employers as formatted currency", () => {
    mockResult = { data: { representativeFunding: base }, loading: false };
    render(<RepresentativeFundingPanel representativeId="rep-1" />);

    expect(screen.getByText("$125,000")).toBeInTheDocument(); // total raised
    expect(screen.getByText("$40,000")).toBeInTheDocument(); // total spent
    expect(screen.getByText("ACME PAC")).toBeInTheDocument();
    expect(screen.getByText("$25,000")).toBeInTheDocument();
    expect(screen.getByText("Big Oil Co")).toBeInTheDocument(); // the industry lens
    expect(screen.getByText("$18,000")).toBeInTheDocument();
    // money's path — the real (roster-identified) committee names
    expect(screen.getByText("Re-Elect Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("$100,000")).toBeInTheDocument();
  });

  it("shows the empty state when the rep has no linked committees", () => {
    mockResult = {
      data: { representativeFunding: { ...base, committeeCount: 0 } },
      loading: false,
    };
    render(<RepresentativeFundingPanel representativeId="rep-1" />);
    expect(
      screen.getByText(/no campaign-finance filings are linked/i),
    ).toBeInTheDocument();
  });

  it("shows the empty state when funding is null", () => {
    mockResult = { data: { representativeFunding: null }, loading: false };
    render(<RepresentativeFundingPanel representativeId="rep-1" />);
    expect(
      screen.getByText(/no campaign-finance filings are linked/i),
    ).toBeInTheDocument();
  });
});
