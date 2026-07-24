/**
 * WCAG 2.2 AA accessibility tests for the rep-page campaign-finance money-trail
 * panel (#943, epic #936).
 */
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { axe } from "@/__tests__/utils/a11y-utils";

let mockResult: {
  data: { representativeFunding: unknown } | undefined;
  loading: boolean;
};
jest.mock("@apollo/client/react", () => ({
  useQuery: () => mockResult,
}));

import { RepresentativeFundingPanel } from "@/components/region/RepresentativeFundingPanel";

const funding = {
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

describe("RepresentativeFundingPanel — WCAG 2.2 AA", () => {
  it("populated panel has no axe violations", async () => {
    mockResult = { data: { representativeFunding: funding }, loading: false };
    const { container } = render(
      <RepresentativeFundingPanel representativeId="rep-1" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("empty state has no axe violations", async () => {
    mockResult = {
      data: { representativeFunding: { ...funding, committeeCount: 0 } },
      loading: false,
    };
    const { container } = render(
      <RepresentativeFundingPanel representativeId="rep-1" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
