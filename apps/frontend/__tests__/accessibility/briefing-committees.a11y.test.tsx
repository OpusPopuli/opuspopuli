/**
 * WCAG 2.2 AA Accessibility Tests for the Committees Briefing
 * section (opuspopuli#836 follow-up to #770).
 *
 * Scope is the per-card render (CommitteeBriefingCard) since the
 * shell + collapse semantics are exhaustively tested in
 * BriefingSection.test.tsx and the full-page a11y is covered by
 * the e2e/briefing.spec.ts axe scan. This file targets the new card
 * surface specifically.
 */

import { fireEvent, render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import { CommitteeBriefingCard } from "@/components/briefing/committees/CommitteeBriefingCard";
import type { CommitteeBriefingItem } from "@/lib/graphql/personalized-committees";

expect.extend(toHaveNoViolations);

const baseItem: CommitteeBriefingItem = {
  id: "c-a11y-1",
  externalId: "assembly:judiciary",
  name: "Assembly Judiciary Committee",
  chamber: "Assembly",
  memberCount: 13,
  description: "Reviews civil and criminal procedure legislation.",
  url: null,
  relevanceExplanation:
    "Reviews legislation matching your housing-topic interests across renter protections and tenancy law.",
};

describe("CommitteeBriefingCard — WCAG 2.2 AA", () => {
  it("renders with no axe violations in the collapsed (default) state", async () => {
    const { container } = render(<CommitteeBriefingCard item={baseItem} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders with no axe violations in the expanded why-this disclosure state", async () => {
    const { container, getByRole } = render(
      <CommitteeBriefingCard item={baseItem} />,
    );
    fireEvent.click(
      getByRole("button", { name: /why is this on my briefing/i }),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
