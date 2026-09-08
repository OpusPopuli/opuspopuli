/**
 * SnippetText (#1154) — renders ts_headline output by splitting on the
 * ⟪⟫ sentinels into React text nodes. The load-bearing property is the
 * SAFETY one: snippet payloads are scraped source text and may contain
 * HTML; it must render as literal text, never as markup.
 */

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { SnippetText } from "@/components/search/SnippetText";
import { SNIPPET_START, SNIPPET_END } from "@/lib/graphql/region";

const wrap = (s: string) => `${SNIPPET_START}${s}${SNIPPET_END}`;

describe("SnippetText", () => {
  it("wraps marked segments in <mark> and leaves the rest as text", () => {
    const { container } = render(
      <SnippetText
        text={`requires ${wrap("wildfire")} hardening and ${wrap("insurance")} discounts`}
      />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveTextContent("wildfire");
    expect(marks[1]).toHaveTextContent("insurance");
    expect(container).toHaveTextContent(
      "requires wildfire hardening and insurance discounts",
    );
  });

  it("renders HTML in the payload as literal text, never markup", () => {
    const { container } = render(
      <SnippetText
        text={`before <img src=x onerror=alert(1)> ${wrap("<script>evil()</script>")} after`}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // The angle-bracket text survives as visible text inside the mark.
    expect(container.querySelector("mark")).toHaveTextContent(
      "<script>evil()</script>",
    );
    expect(screen.getByText(/before/)).toBeInTheDocument();
  });

  it("degrades an unbalanced start marker to plain text", () => {
    const { container } = render(
      <SnippetText text={`broken ${SNIPPET_START}no end here`} />,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container).toHaveTextContent("broken no end here");
  });

  it("handles a snippet that begins with a marked segment", () => {
    const { container } = render(
      <SnippetText text={`${wrap("Housing")} element updates`} />,
    );
    const mark = container.querySelector("mark");
    expect(mark).toHaveTextContent("Housing");
    expect(container).toHaveTextContent("Housing element updates");
  });
});
