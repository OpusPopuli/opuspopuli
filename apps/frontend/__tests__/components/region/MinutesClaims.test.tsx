import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { MinutesClaims } from "@/components/region/MinutesClaims";
import type { MinutesSummaryClaim } from "@/lib/graphql/region";

function renderClaims(claims?: MinutesSummaryClaim[]) {
  return render(<MinutesClaims claims={claims} />);
}

describe("MinutesClaims (#932)", () => {
  it("shows the empty state for no claims", () => {
    renderClaims([]);
    expect(
      screen.getByText(
        "No structured decisions or concerns were extracted for this session.",
      ),
    ).toBeInTheDocument();
  });

  it("renders kind label, severity, title, detail, quote and bill chips", () => {
    renderClaims([
      {
        kind: "CONCERN",
        title: "Raised a fiscal objection",
        detail: "A member flagged unfunded costs.",
        citation: { quote: "the appropriation is unfunded", pageHint: "p. 12" },
        billRefs: ["AB 1234", "SB 9"],
        severity: "HIGH",
      },
    ]);
    expect(screen.getByText("Concern")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Raised a fiscal objection")).toBeInTheDocument();
    expect(
      screen.getByText("A member flagged unfunded costs."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the appropriation is unfunded/),
    ).toBeInTheDocument();
    expect(screen.getByText(/p\. 12/)).toBeInTheDocument();
    expect(screen.getByText("AB 1234")).toBeInTheDocument();
    expect(screen.getByText("SB 9")).toBeInTheDocument();
  });

  it("omits the severity tag when severity is absent", () => {
    renderClaims([
      {
        kind: "DECISION",
        title: "Advanced the bill",
        detail: "",
        citation: {},
        billRefs: [],
      },
    ]);
    expect(screen.getByText("Decision")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
    expect(screen.queryByText("Medium")).not.toBeInTheDocument();
    expect(screen.queryByText("High")).not.toBeInTheDocument();
  });
});
