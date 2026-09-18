/**
 * ClaimAttribution renders the footnote marker that lets a reader check an
 * AI-derived claim against the measure text — the concrete form of "don't
 * take our word for it".
 *
 * Before #1212 its tooltip read "See source passage (chars 1432–1587)": a
 * hardcoded English string (contrary to the repo's i18n rule) exposing
 * character offsets the model had asserted and that were correct about 2% of
 * the time. Offsets are now derived by locating a verbatim quote, so the
 * reader can be shown the passage itself.
 */

import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import "@testing-library/jest-dom";

import { ClaimAttribution } from "@/components/region/ClaimAttribution";
import type { PropositionAnalysisClaim } from "@/lib/graphql/region";

expect.extend(toHaveNoViolations);

const claim = (
  over: Partial<PropositionAnalysisClaim> = {},
): PropositionAnalysisClaim => ({
  claim: "Raises the gas tax by three cents",
  field: "keyProvisions",
  sourceStart: 10,
  sourceEnd: 60,
  ...over,
});

describe("ClaimAttribution", () => {
  it("names the cited passage, not a pair of character offsets", async () => {
    render(
      <ClaimAttribution
        claims={[
          claim({
            sourceQuote: "the tax is increased by three cents",
            verified: true,
          }),
        ]}
        onNavigateToSource={jest.fn()}
      />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveAccessibleName(/the tax is increased by three cents/);
    // The old behaviour must not come back: offsets are an implementation
    // detail a voter cannot check anything against.
    expect(button).not.toHaveAccessibleName(/chars\s*\d+/);
  });

  it("falls back to a generic label for analyses predating the quote contract", async () => {
    render(
      <ClaimAttribution claims={[claim()]} onNavigateToSource={jest.fn()} />,
    );
    const button = screen.getByRole("button");
    // Still translated, still not offsets.
    expect(button).toHaveAccessibleName(/cited passage/i);
    expect(button).not.toHaveAccessibleName(/chars\s*\d+/);
  });

  it("truncates a long quote rather than pushing an essay into a tooltip", async () => {
    const long = "A".repeat(400);
    render(
      <ClaimAttribution
        claims={[claim({ sourceQuote: long, verified: true })]}
        onNavigateToSource={jest.fn()}
      />,
    );
    const name = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(name.length).toBeLessThan(long.length);
    expect(name).toContain("…");
  });

  it("renders nothing when there are no claims", () => {
    const { container } = render(
      <ClaimAttribution claims={[]} onNavigateToSource={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("has no WCAG 2.2 AA violations", async () => {
    const { container } = render(
      <ClaimAttribution
        claims={[
          claim({
            sourceQuote: "the tax is increased by three cents",
            verified: true,
          }),
        ]}
        onNavigateToSource={jest.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
