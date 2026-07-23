import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ConcernsBadge } from "@/components/region/ConcernsBadge";
import type { MinutesSummaryClaim } from "@/lib/graphql/region";

function claim(over: Partial<MinutesSummaryClaim>): MinutesSummaryClaim {
  return {
    kind: "DECISION",
    title: "t",
    detail: "d",
    citation: {},
    billRefs: [],
    ...over,
  };
}

function renderBadge(claims?: MinutesSummaryClaim[]) {
  return render(<ConcernsBadge claims={claims} />);
}

describe("ConcernsBadge (#932)", () => {
  it("renders nothing when there are no concern/controversy claims", () => {
    const { container } = renderBadge([claim({ kind: "DECISION" })]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for undefined claims", () => {
    const { container } = renderBadge(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts only concern + controversy claims", () => {
    renderBadge([
      claim({ kind: "DECISION" }),
      claim({ kind: "CONCERN", severity: "LOW" }),
      claim({ kind: "CONTROVERSY", severity: "MEDIUM" }),
      claim({ kind: "PUBLIC_COMMENT" }),
    ]);
    expect(screen.getByText("2 concerns")).toBeInTheDocument();
  });

  it("uses the singular label for a single concern", () => {
    renderBadge([claim({ kind: "CONCERN", severity: "LOW" })]);
    expect(screen.getByText("1 concern")).toBeInTheDocument();
  });

  it("colours to the highest severity present (HIGH → red)", () => {
    renderBadge([
      claim({ kind: "CONCERN", severity: "LOW" }),
      claim({ kind: "CONTROVERSY", severity: "HIGH" }),
    ]);
    const badge = screen.getByText("2 concerns");
    expect(badge).toHaveClass("bg-red-100", "text-red-800");
  });

  it("defaults a missing severity to LOW when picking the colour", () => {
    renderBadge([claim({ kind: "CONCERN" })]);
    const badge = screen.getByText("1 concern");
    expect(badge).toHaveClass("bg-green-100", "text-green-800");
  });
});
