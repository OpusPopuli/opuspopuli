import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PropositionBriefingCard } from "@/components/briefing/propositions/PropositionBriefingCard";
import type { RankedProposition } from "@/components/briefing/propositions/usePropositionsBriefing";
import type { Proposition } from "@/lib/graphql/region";

const baseProp: Proposition = {
  id: "p-1",
  externalId: "Prop 33",
  title: "Local Rent Control Initiative",
  summary: "Allows cities to adopt rent control on residential property.",
  status: "PENDING",
  electionDate: "2026-11-03T00:00:00Z",
  analysisSummary: "Permits municipal rent caps on residential housing.",
  yesOutcome: "Cities may pass rent control on properties built any year.",
  noOutcome:
    "Existing state law (Costa-Hawkins) continues to limit local rent control.",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const baseItem: RankedProposition = {
  result: {
    propositionId: "p-1",
    relevanceScore: 0.65,
    axisScores: {
      directMaterial: 0.4,
      valuesAlignment: 1.0,
      actionability: 1.0,
      indirectMaterial: 0,
      coalitionSignal: 0,
      counterfactual: 0,
      noveltyRepetition: 0,
    },
    relevanceExplanation: null,
  },
  proposition: baseProp,
};

describe("PropositionBriefingCard", () => {
  it("returns null when the proposition row is missing (e.g. fan-out fetch failed)", () => {
    const { container } = render(
      <PropositionBriefingCard
        item={{ result: baseItem.result, proposition: null }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the title as a link to the proposition detail page", () => {
    render(<PropositionBriefingCard item={baseItem} />);
    const link = screen.getByRole("link", {
      name: /local rent control initiative/i,
    });
    expect(link).toHaveAttribute("href", "/region/propositions/p-1");
  });

  it("renders the externalId and election date in the metadata line", () => {
    render(<PropositionBriefingCard item={baseItem} />);
    expect(screen.getByText(/Prop 33/)).toBeInTheDocument();
    // i18n key uses {{date}} — we just assert the year appears so the
    // test isn't locale-brittle.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("prefers analysisSummary over the raw summary when both exist", () => {
    render(<PropositionBriefingCard item={baseItem} />);
    expect(
      screen.getByText(/permits municipal rent caps/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Allows cities to adopt rent control/i),
    ).not.toBeInTheDocument();
  });

  it("falls back to summary when analysisSummary is absent", () => {
    render(
      <PropositionBriefingCard
        item={{
          ...baseItem,
          proposition: { ...baseProp, analysisSummary: undefined },
        }}
      />,
    );
    expect(
      screen.getByText(/Allows cities to adopt rent control/i),
    ).toBeInTheDocument();
  });

  it("renders the yes/no outcome dl when either side carries text", () => {
    render(<PropositionBriefingCard item={baseItem} />);
    expect(
      screen.getByText(/cities may pass rent control/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Costa-Hawkins.*continues to limit/i),
    ).toBeInTheDocument();
  });

  it("hides the outcome dl when both yes/no are absent", () => {
    render(
      <PropositionBriefingCard
        item={{
          ...baseItem,
          proposition: {
            ...baseProp,
            yesOutcome: undefined,
            noOutcome: undefined,
          },
        }}
      />,
    );
    // No "If yes" / "If no" labels render.
    expect(screen.queryByText(/^If yes$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^If no$/i)).not.toBeInTheDocument();
  });

  it("does NOT render endorsement chips in Phase 1 (regression guard for scope)", () => {
    render(<PropositionBriefingCard item={baseItem} />);
    // Endorsement copy uses "endorse" / "Sierra Club" / "NRA" patterns
    // per the issue spec; none of those should appear in Phase 1.
    expect(screen.queryByText(/sierra club/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/endors/i)).not.toBeInTheDocument();
  });

  it("exposes data-testid + data-proposition-id for e2e selectors", () => {
    render(<PropositionBriefingCard item={baseItem} />);
    const card = screen.getByTestId("proposition-briefing-card");
    expect(card).toHaveAttribute("data-proposition-id", "p-1");
  });

  it("renders the relevance chip", () => {
    render(<PropositionBriefingCard item={baseItem} />);
    // Composite 0.65 → 65%
    expect(screen.getByText(/65%/)).toBeInTheDocument();
  });
});
