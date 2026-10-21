import * as cheerio from "cheerio";
import { elementText } from "../src/crawling/detail-crawler.service.js";

/**
 * Regression guard for the fused-word defect (#1382 follow-up).
 *
 * cheerio's `.text()` concatenates descendant text nodes with no separator,
 * so block boundaries disappear. Measured on 20 scraped Senate bios: 7
 * carried at least one fused pair. Reverting `elementText` to `.text()` must
 * fail these.
 */
describe("elementText", () => {
  const first = (html: string) => {
    const $ = cheerio.load(html);
    return $("#t").first();
  };

  it("keeps a heading and the paragraph after it apart", () => {
    // ".text()" yields "SenatorJesse Arreguín" — the real failure.
    const el = first(
      '<div id="t"><h2>Senator</h2><p>Jesse Arreguín represents District 7.</p></div>',
    );

    expect(elementText(el)).toBe(
      "Senator Jesse Arreguín represents District 7.",
    );
  });

  it("keeps a sentence end apart from the next block", () => {
    // ".text()" yields "Grove.The" — the second observed shape.
    const el = first(
      '<div id="t"><p>Shannon Grove.</p><p>The committee met Tuesday.</p></div>',
    );

    expect(elementText(el)).toBe("Shannon Grove. The committee met Tuesday.");
  });

  it("separates list items", () => {
    const el = first('<ul id="t"><li>Budget</li><li>Health</li></ul>');

    expect(elementText(el)).toBe("Budget Health");
  });

  it("collapses the whitespace the converter introduces", () => {
    const el = first('<div id="t"><p>One</p>\n\n   <p>Two</p></div>');

    expect(elementText(el)).toBe("One Two");
  });

  it("falls back to text() for a leaf with no inner markup", () => {
    const el = first('<span id="t">22</span>');

    expect(elementText(el)).toBe("22");
  });

  it("returns empty for an empty element rather than throwing", () => {
    expect(elementText(first('<div id="t"></div>'))).toBe("");
  });
});
