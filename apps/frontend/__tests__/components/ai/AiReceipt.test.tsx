import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";

import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { AiReceipt } from "@/components/ai/AiReceipt";
import type { AiProvenance } from "@/lib/graphql/region";

/**
 * The receipt under every generated passage (#1450). The two promises tested
 * here are the ones a reader relies on: a missing field reads "Not
 * recorded" rather than vanishing, and text no model wrote is never
 * described as model output.
 */

const full: AiProvenance = {
  kind: "AI",
  promptHash:
    "d8cec07ff987ef2345f1f1d2948a3763667d0f695956d7f5243e609961d0e36d",
  promptVersion: "v4",
  llmModel: "nemotron-3.5-lightning:30b-a3b",
  llmDigest: "e7a64ff15fb174c4",
  generatedAt: "2026-10-12T19:51:57.574Z",
  sourceUrl:
    "https://www.oag.ca.gov/system/files/initiatives/pdfs/25-0040A1.pdf",
  sourceFetchedAt: "2026-09-22T18:13:42.663Z",
};

/** The value cell next to a label in the receipt's definition list. */
function valueOf(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling as HTMLElement;
}

describe("AiReceipt", () => {
  it("renders nothing without a receipt", () => {
    const { container } = render(<AiReceipt provenance={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed behind 'How this was made'", () => {
    render(<AiReceipt provenance={full} />);
    const summary = screen.getByText("How this was made");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it("shows every part of a complete receipt", () => {
    render(<AiReceipt provenance={full} />);
    expect(valueOf("Made by")).toHaveTextContent("An AI model");

    const source = within(valueOf("Source")).getByRole("link");
    expect(source).toHaveAttribute("href", full.sourceUrl);
    expect(source).toHaveTextContent("oag.ca.gov");
    expect(valueOf("Source")).toHaveTextContent("retrieved Sep 22, 2026");

    expect(valueOf("Model")).toHaveTextContent(
      "nemotron-3.5-lightning:30b-a3b",
    );
    expect(valueOf("Model")).toHaveTextContent("Exact build: e7a64ff15fb174c4");

    const prompt = within(valueOf("Instructions (prompt)")).getByRole("link");
    expect(prompt).toHaveAttribute(
      "href",
      `/transparency/prompts/${full.promptHash}`,
    );
    expect(prompt).toHaveTextContent("Version v4 · d8cec07f");
    // The visible text is part of the accessible name (WCAG 2.5.3).
    expect(prompt).toHaveAccessibleName(
      "Read the exact prompt: Version v4 · d8cec07f",
    );

    expect(valueOf("Generated")).toHaveTextContent("Oct 12, 2026");
  });

  it("says 'Not recorded' for each missing field rather than hiding it", () => {
    // 4,239 bill summaries on UAT predate provenance recording.
    render(<AiReceipt provenance={{ kind: "AI" }} />);
    for (const label of [
      "Source",
      "Model",
      "Instructions (prompt)",
      "Generated",
    ]) {
      expect(valueOf(label)).toHaveTextContent("Not recorded");
    }
  });

  it("names a source version where there is no URL", () => {
    render(
      <AiReceipt provenance={{ kind: "AI", sourceRef: "20250ACR4099INT" }} />,
    );
    expect(valueOf("Source")).toHaveTextContent("Version 20250ACR4099INT");
  });

  it("says what the text was made from when it was not a document", () => {
    render(
      <AiReceipt
        provenance={{ kind: "AI", promptHash: full.promptHash }}
        madeFrom="Our record of this member"
      />,
    );
    expect(valueOf("Source")).toHaveTextContent("Our record of this member");
  });

  it("prefers the named source over the page's description", () => {
    render(<AiReceipt provenance={full} madeFrom="Our records" />);
    expect(valueOf("Source")).not.toHaveTextContent("Our records");
  });

  it.each([
    ["SCRAPED" as const, "Copied word for word from the official source"],
    ["MANUAL" as const, "A person"],
  ])("never names a model or prompt for %s text", (kind, origin) => {
    render(<AiReceipt provenance={{ ...full, kind }} />);
    expect(valueOf("Made by")).toHaveTextContent(origin);
    expect(screen.queryByText("Model", { selector: "dt" })).toBeNull();
    expect(
      screen.queryByText("Instructions (prompt)", { selector: "dt" }),
    ).toBeNull();
    expect(screen.queryByText("Generated", { selector: "dt" })).toBeNull();
  });

  it("dates deterministic text but names no model for it", () => {
    render(
      <AiReceipt
        provenance={{ kind: "DETERMINISTIC", generatedAt: full.generatedAt }}
      />,
    );
    expect(valueOf("Made by")).toHaveTextContent(
      "Our records, with no AI model",
    );
    expect(valueOf("Generated")).toHaveTextContent("Oct 12, 2026");
    expect(screen.queryByText("Model", { selector: "dt" })).toBeNull();
  });

  it("shows a prompt fingerprint even when the version is unrecorded", () => {
    render(<AiReceipt provenance={{ ...full, promptVersion: null }} />);
    expect(
      within(valueOf("Instructions (prompt)")).getByRole("link"),
    ).toHaveTextContent(/^Read the exact prompt: d8cec07f$/);
  });

  it.each(["not a url", "data:text/html,hi", "mailto:x@example.gov"])(
    "never offers %p as a link",
    (sourceUrl) => {
      render(<AiReceipt provenance={{ kind: "AI", sourceUrl }} />);
      expect(within(valueOf("Source")).queryByRole("link")).toBeNull();
      expect(valueOf("Source")).toHaveTextContent("Not recorded");
    },
  );

  it("tells screen-reader users the source opens a new tab", () => {
    render(<AiReceipt provenance={full} />);
    expect(within(valueOf("Source")).getByRole("link")).toHaveAccessibleName(
      "oag.ca.gov/system/files/initiatives/pdfs/25-0040A1.pdf (opens in a new tab)",
    );
  });

  it("reads an unparseable date as not recorded instead of crashing", () => {
    render(<AiReceipt provenance={{ ...full, generatedAt: "not-a-date" }} />);
    expect(valueOf("Generated")).toHaveTextContent("Not recorded");
  });

  it("shows every row of an UNKNOWN receipt as not recorded", () => {
    render(<AiReceipt provenance={{ kind: "UNKNOWN" }} />);
    for (const label of [
      "Source",
      "Model",
      "Instructions (prompt)",
      "Generated",
    ]) {
      expect(valueOf(label)).toHaveTextContent("Not recorded");
    }
  });
});

describe("AiGeneratedBadge", () => {
  it("says AI-generated by default", () => {
    render(<AiGeneratedBadge />);
    expect(
      screen.getByText("AI-generated · may contain errors"),
    ).toBeInTheDocument();
  });

  it.each([
    ["DETERMINISTIC" as const, "Generated from records"],
    ["SCRAPED" as const, "Official text"],
    ["MANUAL" as const, "Written by a person"],
    ["UNKNOWN" as const, "Origin not recorded"],
  ])("never says AI for %s text", (kind, label) => {
    render(<AiGeneratedBadge kind={kind} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("AI-generated · may contain errors")).toBeNull();
  });
});

describe("AiReceipt source link text", () => {
  it("names the page, not just the site, so sources on one site differ", () => {
    render(
      <AiReceipt
        provenance={{
          kind: "AI",
          sourceUrl: "https://www.sos.ca.gov/elections/ballot-measures",
        }}
      />,
    );
    expect(screen.getByRole("link")).toHaveTextContent(
      "sos.ca.gov/elections/ballot-measures",
    );
  });

  it("shortens a long address", () => {
    render(
      <AiReceipt
        provenance={{
          kind: "AI",
          sourceUrl: `https://example.gov/${"a".repeat(80)}`,
        }}
      />,
    );
    expect(screen.getByRole("link").textContent).toMatch(
      /^example\.gov\/…\/a{39}…/,
    );
  });

  it("keeps a path it cannot decode rather than crashing", () => {
    render(
      <AiReceipt
        provenance={{
          kind: "AI",
          sourceUrl: "https://example.gov/bad%E0%A4%A",
        }}
      />,
    );
    expect(screen.getByRole("link")).toHaveTextContent(
      "example.gov/bad%E0%A4%A",
    );
  });

  it("keeps the last segment, where pages on one site differ", () => {
    render(
      <AiReceipt
        provenance={{
          kind: "AI",
          sourceUrl:
            "https://www.sos.ca.gov/elections/ballot-measures/initiative-and-referendum-faqs",
        }}
      />,
    );
    expect(screen.getByRole("link")).toHaveTextContent(
      "sos.ca.gov/…/initiative-and-referendum-faqs",
    );
  });

  it("strips invisible bidi controls that could disguise a link", () => {
    render(
      <AiReceipt
        provenance={{
          kind: "AI",
          sourceUrl: "https://example.gov/doc%E2%80%AEfdp.exe",
        }}
      />,
    );
    expect(screen.getByRole("link").textContent).toMatch(
      /^example\.gov\/docfdp\.exe/,
    );
  });
});
