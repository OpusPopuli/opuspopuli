import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { ActivitySummary } from "@/components/region/ActivitySummary";
import { MinutesSynopsis } from "@/components/region/MinutesSynopsis";
import type { AiProvenance } from "@/lib/graphql/region";

/**
 * The shared generated-text panels carry their receipt (#1450), and their
 * label follows the receipt's kind instead of always saying "AI-generated".
 */

const ai: AiProvenance = {
  kind: "AI",
  promptHash: "ba".repeat(32),
  llmModel: "nemotron-3.5-lightning:30b-a3b",
  generatedAt: "2026-10-27T22:02:18.013Z",
};

describe("ActivitySummary", () => {
  it("carries its receipt, saying it was made from our records", () => {
    render(<ActivitySummary summary="Voted on 12 bills." provenance={ai} />);
    expect(screen.getByText("How this was made")).toBeInTheDocument();
    expect(
      screen.getByText("Our records of recent legislative actions"),
    ).toBeInTheDocument();
  });

  it("labels deterministic text as generated from records, not AI", () => {
    render(
      <ActivitySummary
        summary="Serves on Health."
        provenance={{ kind: "DETERMINISTIC" }}
      />,
    );
    expect(screen.getByText("Generated from records")).toBeInTheDocument();
    expect(screen.queryByText("AI-generated")).toBeNull();
  });

  it("keeps the AI label when no receipt was loaded", () => {
    render(<ActivitySummary summary="Voted on 12 bills." />);
    expect(screen.getByText("AI-generated")).toBeInTheDocument();
    expect(screen.queryByText("How this was made")).toBeNull();
  });
});

describe("MinutesSynopsis", () => {
  it("carries its receipt, naming the minutes document", () => {
    render(
      <MinutesSynopsis
        summary="The board adopted the budget."
        provenance={{
          ...ai,
          sourceUrl: "https://clerk.assembly.ca.gov/files/adj092526.pdf",
        }}
      />,
    );
    expect(screen.getByText("AI-generated")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^clerk\.assembly\.ca\.gov/ }),
    ).toHaveAttribute(
      "href",
      "https://clerk.assembly.ca.gov/files/adj092526.pdf",
    );
  });

  it("renders nothing without a synopsis", () => {
    const { container } = render(
      <MinutesSynopsis summary={null} provenance={ai} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("GET_BILL_SUMMARY_STATUS", () => {
  it("polls the receipt with the summary it describes (#1450)", () => {
    // The section polls this while a summary is written, and Apollo
    // normalises it onto the same Bill — so new text must not arrive
    // without its own receipt and inherit the old run's.
    const { print } = jest.requireActual<typeof import("graphql")>("graphql");
    const { GET_BILL_SUMMARY_STATUS } = jest.requireActual<
      typeof import("@/lib/graphql/region")
    >("@/lib/graphql/region");
    const query = print(GET_BILL_SUMMARY_STATUS);
    expect(query).toMatch(/aiSummary \{/);
    expect(query).toMatch(/aiSummaryProvenance \{[^}]*promptHash/);
  });
});
