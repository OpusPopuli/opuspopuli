/**
 * WCAG 2.2 AA for the AI-output receipt and its badge (#1450), in both the
 * collapsed and opened states and for every kind of output.
 */

import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { axe } from "@/__tests__/utils/a11y-utils";
import { AiGeneratedBadge } from "@/components/ai/AiGeneratedBadge";
import { AiReceipt } from "@/components/ai/AiReceipt";
import type { AiProvenance } from "@/lib/graphql/region";

const full: AiProvenance = {
  kind: "AI",
  promptHash:
    "d8cec07ff987ef2345f1f1d2948a3763667d0f695956d7f5243e609961d0e36d",
  promptVersion: "v4",
  llmModel: "nemotron-3.5-lightning:30b-a3b",
  llmDigest: "e7a64ff15fb174c4",
  generatedAt: "2026-10-12T19:51:57.574Z",
  sourceUrl: "https://oag.ca.gov/initiatives/25-0040A1.pdf",
  sourceFetchedAt: "2026-09-22T18:13:42.663Z",
};

describe("AI receipt accessibility", () => {
  it.each([
    ["a complete AI receipt", full],
    ["an AI receipt with nothing recorded", { kind: "AI" } as AiProvenance],
    [
      "official text",
      { kind: "SCRAPED", sourceUrl: full.sourceUrl } as AiProvenance,
    ],
    [
      "deterministic text",
      { kind: "DETERMINISTIC", generatedAt: full.generatedAt } as AiProvenance,
    ],
  ])("has no violations for %s, open", async (_name, provenance) => {
    const { container } = render(<AiReceipt provenance={provenance} />);
    container.querySelector("details")?.setAttribute("open", "");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations collapsed", async () => {
    const { container } = render(<AiReceipt provenance={full} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(["AI", "DETERMINISTIC", "SCRAPED", "MANUAL", "UNKNOWN"] as const)(
    "badge has no violations for %s",
    async (kind) => {
      const { container } = render(<AiGeneratedBadge kind={kind} />);
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
