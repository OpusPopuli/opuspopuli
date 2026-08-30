import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FiledAnalysis } from "@/components/petition/FiledAnalysis";
import type { LinkedProposition } from "@/lib/graphql/documents";

/**
 * The payoff of a verified scan (#1074 Phase B): what the FILED measure says,
 * not a re-reading of the photograph.
 */

const base: LinkedProposition = {
  id: "link-1",
  propositionId: "prop-1",
  title: "ESTABLISHES ADDITIONAL VOTER IDENTIFICATION REQUIREMENTS",
  summary: "AG circulating summary.",
  status: "circulating",
  linkSource: "auto_retrieval",
  linkedAt: "2026-08-30T00:00:00Z",
};

describe("FiledAnalysis", () => {
  it("shows the filing's own analysis", () => {
    render(
      <FiledAnalysis
        proposition={{
          ...base,
          analysisSummary: "This amendment establishes new ID requirements.",
        }}
      />,
    );

    expect(
      screen.getByText("This amendment establishes new ID requirements."),
    ).toBeInTheDocument();
  });

  /**
   * The provenance line is the whole claim. Without it this reads as another
   * AI summary of the photograph, which is exactly what it is not.
   */
  it("says the text came from the filing, not the photograph", () => {
    render(
      <FiledAnalysis proposition={{ ...base, analysisSummary: "Summary." }} />,
    );

    expect(
      screen.getByText(/filed with the Secretary of State/i),
    ).toHaveTextContent(/not from the page you photographed/i);
  });

  /**
   * The most useful thing on the page for someone holding a pen, and the part
   * a circulator's pitch is least likely to have covered evenly.
   */
  it("spells out what a yes and a no actually do", () => {
    render(
      <FiledAnalysis
        proposition={{
          ...base,
          analysisSummary: "Summary.",
          yesOutcome: "Voters would need photo ID.",
          noOutcome: "Current rules continue unchanged.",
        }}
      />,
    );

    expect(screen.getByText("Voters would need photo ID.")).toBeInTheDocument();
    expect(
      screen.getByText("Current rules continue unchanged."),
    ).toBeInTheDocument();
  });

  it("lists key provisions and fiscal impact when present", () => {
    render(
      <FiledAnalysis
        proposition={{
          ...base,
          analysisSummary: "Summary.",
          keyProvisions: ["Requires ID at the polls", "Adds annual audits"],
          fiscalImpact: "Tens of millions annually.",
        }}
      />,
    );

    expect(screen.getByText("Requires ID at the polls")).toBeInTheDocument();
    expect(screen.getByText("Adds annual audits")).toBeInTheDocument();
    expect(screen.getByText("Tens of millions annually.")).toBeInTheDocument();
  });

  it("omits sections the filing does not have", () => {
    render(
      <FiledAnalysis proposition={{ ...base, analysisSummary: "Summary." }} />,
    );

    expect(screen.queryByText(/If it passes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fiscal impact/i)).not.toBeInTheDocument();
  });

  /**
   * Four propositions currently have no analysis at all (#1085). A verified
   * match to one of those must fall through to the photo-derived analysis
   * rather than render an empty panel that implies we found nothing to say.
   */
  it.each([
    ["no proposition at all", undefined],
    ["a proposition with no analysis", base],
  ])("renders nothing given %s", (_label, proposition) => {
    const { container } = render(
      <FiledAnalysis proposition={proposition as LinkedProposition} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("is reachable as a labelled region", () => {
    render(
      <FiledAnalysis proposition={{ ...base, analysisSummary: "Summary." }} />,
    );

    expect(
      screen.getByRole("region", { name: /What the filed measure says/i }),
    ).toBeInTheDocument();
  });
});
