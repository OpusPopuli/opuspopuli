/**
 * Section-heading grounding — are the headings the model emits the document's
 * own, or its own invention?
 *
 * `analysisSections` is a table of contents for a measure, and the prompt is
 * explicit about what a heading must be:
 *
 *   > heading … **MUST be a verbatim substring of FullText** when the measure
 *   > has its own headings — the consumer locates the section by
 *   > string-matching the heading against FullText.
 *
 * So an ungrounded heading is not merely vague. It breaks the consumer's
 * locator, and the section silently fails to anchor.
 *
 * ── Why this is a grounding metric and not a completeness one ────────────
 *
 * `generation-eval` deliberately refuses to score field completeness, because
 * a 3.4B model once topped the scoreboard by fabricating the fiscal impact.
 * The same trap applies here: "more sections" is trivially gamed by inventing
 * them. Grounding is not, because an invented heading is ungrounded by
 * construction — a model cannot buy a better score with more output.
 *
 * ── Measured on the live corpus, 2026-10-12 ──────────────────────────────
 *
 *   olmo-3.1:32b-instruct     225 of 402 headings grounded   56.0%
 *   nemotron-3.5-lightning     45 of 163 headings grounded   27.6%
 *
 * The nemotron figure has a specific cause, which `exampleEchoes` names: the
 * prompt's OUTPUT FORMAT block illustrates the field with
 * `"Findings and Declarations"` and `"Operative Provisions"`, and **51 of 71
 * measures came back with exactly that pair** — the example copied rather than
 * the document read. A rate alone would have said "worse"; this says why.
 */

/** A section as the model emits it. */
export interface EmittedSection {
  heading: string;
  startOffset?: number;
  endOffset?: number;
}

/**
 * The headings the prompt's OUTPUT FORMAT example uses.
 *
 * Kept here as data rather than folded into the grounding check because they
 * are not wrong in themselves — a measure really can have a "Findings and
 * Declarations" section. What is diagnostic is the whole emitted list being
 * this pair, on measure after measure whose text contains neither phrase.
 */
const EXAMPLE_HEADINGS = ["Findings and Declarations", "Operative Provisions"];

export interface SectioningResult {
  sections: number;
  grounded: number;
  /** grounded / sections. 1 when the output emitted no sections at all. */
  rate: number;
  /** Emitted headings that match the prompt's example verbatim. */
  exampleEchoes: string[];
  /**
   * True when the emitted list is the prompt's example and nothing else.
   * The signature of a model treating the illustration as the answer.
   */
  looksCopiedFromExample: boolean;
  /**
   * Whether the source carries headings of its own.
   *
   * The prompt permits a synthetic heading when the measure has none, so a low
   * `rate` on a heading-less document is compliant rather than a defect.
   * Reported alongside the rate so the two are never conflated.
   */
  sourceHasHeadings: boolean;
}

/**
 * A numbered section LABEL, as Californian legislative drafting writes them.
 *
 * Cannot be anchored to a line start, because `full_text` carries **no
 * newlines at all** — the extraction stores one flowed string. A line-anchored
 * pattern matched 0 of 125 live measures while reporting itself as working,
 * which is the shape of failure this harness exists to catch.
 *
 * Requiring `<number>.` followed by whitespace is what separates a heading
 * from a citation. The corpus is full of cross-references like
 * "Article XIIIA, Section 1(b)(3)" — a bare `SECTION` match counts those and
 * calls 121 of 125 documents sectioned; this counts 104, and rejects the
 * parenthesised forms.
 *
 * Deliberately conservative either way: reporting `sourceHasHeadings: false`
 * on a document with unusual headings is better than demanding verbatim
 * grounding the prompt excused.
 */
const SOURCE_HEADING = /\b(?:SECTION|SEC\.)\s+\d+[A-Za-z]?\.\s/i;

/** Collapse whitespace so a heading wrapped across lines still matches. */
const normalise = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

export function scoreSectioning(
  sections: readonly EmittedSection[],
  fullText: string,
): SectioningResult {
  const haystack = normalise(fullText);
  const headings = sections
    .map((section) => section.heading)
    .filter((heading): heading is string => typeof heading === "string")
    .filter((heading) => heading.trim().length > 0);

  const grounded = headings.filter((heading) =>
    haystack.includes(normalise(heading)),
  );

  const exampleEchoes = headings.filter((heading) =>
    EXAMPLE_HEADINGS.some(
      (example) => normalise(example) === normalise(heading),
    ),
  );

  return {
    sections: headings.length,
    grounded: grounded.length,
    rate: headings.length === 0 ? 1 : grounded.length / headings.length,
    exampleEchoes,
    // Every emitted heading is an example heading, and the example has two —
    // so a single "Findings and Declarations" on a measure that really has one
    // is not flagged.
    looksCopiedFromExample:
      headings.length === EXAMPLE_HEADINGS.length &&
      exampleEchoes.length === headings.length,
    sourceHasHeadings: SOURCE_HEADING.test(fullText),
  };
}
