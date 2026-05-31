/**
 * WCAG 2.2 AA Accessibility Tests for the Propositions Briefing
 * section (#771).
 *
 * Scope is the per-card render (PropositionBriefingCard) since the
 * shell + collapse semantics are exhaustively tested in
 * BriefingSection.test.tsx and the full-page a11y is covered by
 * the e2e/briefing.spec.ts axe scan. This file targets the new card
 * surface specifically.
 */

import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import { PropositionBriefingCard } from "@/components/briefing/propositions/PropositionBriefingCard";
import type { RankedProposition } from "@/components/briefing/propositions/usePropositionsBriefing";
import type { Proposition } from "@/lib/graphql/region";

expect.extend(toHaveNoViolations);

const baseProp: Proposition = {
  id: "p-a11y-1",
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
    propositionId: "p-a11y-1",
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

describe("PropositionBriefingCard — WCAG 2.2 AA", () => {
  it("renders with no axe violations in the default state", async () => {
    const { container } = render(<PropositionBriefingCard item={baseItem} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders with no axe violations when yes/no outcomes are absent", async () => {
    const { container } = render(
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
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders with no axe violations when only summary (no analysisSummary) is present", async () => {
    const { container } = render(
      <PropositionBriefingCard
        item={{
          ...baseItem,
          proposition: { ...baseProp, analysisSummary: undefined },
        }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
