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
  basis: {
    undatedAmount: 0,
    undatedCount: 0,
    unattributedAmount: 0,
    unattributedCount: 0,
    unitemizedAmount: 0,
    asOfSource: "2026-10-12T08:52:56Z",
    measured: true,
  },
};

describe("RepresentativeFundingPanel — WCAG 2.2 AA", () => {
  it("populated panel has no axe violations", async () => {
    mockResult = { data: { representativeFunding: funding }, loading: false };
    const { container } = render(
      <RepresentativeFundingPanel representativeId="rep-1" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("panel with a populated disclosure has no axe violations", async () => {
    // The all-zero basis renders a single all-clear line; the disclosure
    // readers will actually meet is a multi-item list inside a role="note"
    // nested in the panel's section landmark (#991). That nesting is what
    // fails "landmark-complementary-is-top-level" if the note is ever
    // changed to an <aside>, so it needs its own pass.
    mockResult = {
      data: {
        representativeFunding: {
          ...funding,
          basis: {
            undatedAmount: 9_000,
            undatedCount: 14,
            unattributedAmount: 3_000,
            unattributedCount: 6,
            unitemizedAmount: 2_500,
            asOfSource: null,
            measured: true,
          },
        },
      },
      loading: false,
    };
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
