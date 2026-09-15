/**
 * Numeric grounding — does every figure the model emits appear in the source?
 *
 * Two models in the 2026-09-10 run invented numbers outright: a 3.4B granite
 * build wrote "$1.2 million in new state revenue annually" about a measure
 * whose text contains no `$` at all, and `olmo-3:7b-instruct` produced a "67%"
 * that is nowhere in its source. Everything at or above 9B stayed grounded,
 * which is where #1142's floor on model size comes from.
 *
 * A fabricated dollar figure in a civic analysis is the worst failure this
 * platform has, because it is the most quotable part of the output and the
 * part a reader is least able to check. So this scorer is deliberately blunt:
 * a figure is grounded if it can be found in the source, and fabricated
 * otherwise. There is no partial credit.
 *
 * It is also a prototype of #1209's numeric-consistency validator, which is
 * why the matching rules live here as data rather than inline regexes — the
 * pipeline will need the same rules, and they should be lifted, not rewritten.
 */

/** A number as it appears in generated text, with enough context to judge it. */
export interface EmittedFigure {
  /** Exactly as written, e.g. "$1.2 million", "67%", "2,500". */
  raw: string;
  kind: "currency" | "percentage" | "quantity";
  /** Normalized numeric value; NaN when the figure has no parseable value. */
  value: number;
  /** Character offset in the generated text. */
  at: number;
}

export interface GroundingResult {
  figures: EmittedFigure[];
  grounded: EmittedFigure[];
  fabricated: EmittedFigure[];
  /** grounded / figures, or 1 when the output emitted no figures at all. */
  rate: number;
}

/**
 * Years, section numbers and enumerations are not claims about magnitude.
 *
 * "Section 3", "Article XIII", "2026" and "(a)(1)" are structural references.
 * Scoring them as ungrounded magnitudes would bury the signal that matters —
 * an invented dollar amount — under dozens of false positives, and would make
 * the metric read as broken rather than as strict.
 */
const STRUCTURAL_CONTEXT =
  /\b(section|sec\.|article|chapter|subdivision|paragraph|clause|title|proposition|measure|initiative|act of|code)\s*$/i;

const CURRENCY =
  /\$\s?[\d,]+(?:\.\d+)?(?:\s*(?:billion|million|thousand|bn|m|k))?/gi;
// No trailing \b after the `%`: `%` is not a word character, so a boundary
// assertion there only matches when a word character follows — which makes
// "12%," and "12% of" fail to match at all.
const PERCENTAGE = /\b\d+(?:\.\d+)?\s?(?:%|percent\b)/gi;
const QUANTITY = /\b\d[\d,]*(?:\.\d+)?\s*(?:billion|million|thousand)\b/gi;

const MULTIPLIER: Record<string, number> = {
  billion: 1e9,
  bn: 1e9,
  million: 1e6,
  m: 1e6,
  thousand: 1e3,
  k: 1e3,
};

/** Parse "$1.2 million" / "67%" / "2,500" into a comparable number. */
export function numericValue(raw: string): number {
  const digits = raw.match(/[\d,]+(?:\.\d+)?/);
  if (!digits) return Number.NaN;
  const base = Number.parseFloat(digits[0].replace(/,/g, ""));
  if (Number.isNaN(base)) return Number.NaN;
  const unit = raw.toLowerCase().match(/(billion|million|thousand|bn|m|k)\b/);
  return unit ? base * MULTIPLIER[unit[1]] : base;
}

function collect(
  text: string,
  pattern: RegExp,
  kind: EmittedFigure["kind"],
): EmittedFigure[] {
  const out: EmittedFigure[] = [];
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    // A bare quantity preceded by "Section"/"Article" is a reference, not a
    // magnitude. Currency and percentages are never structural.
    if (kind === "quantity" && STRUCTURAL_CONTEXT.test(text.slice(0, at))) {
      continue;
    }
    out.push({ raw: m[0].trim(), kind, value: numericValue(m[0]), at });
  }
  return out;
}

export function extractFigures(text: string): EmittedFigure[] {
  const figures = [
    ...collect(text, CURRENCY, "currency"),
    ...collect(text, PERCENTAGE, "percentage"),
    ...collect(text, QUANTITY, "quantity"),
  ];
  // A currency match like "$1.2 million" also matches QUANTITY at a later
  // offset. Keep the currency reading: it is the stronger claim, and counting
  // it twice would let one fabrication register as two.
  const byOffset = new Map<number, EmittedFigure>();
  for (const f of figures.sort((a, b) => a.at - b.at)) {
    const overlapping = [...byOffset.values()].find(
      (e) => f.at >= e.at && f.at < e.at + e.raw.length,
    );
    if (overlapping) continue;
    byOffset.set(f.at, f);
  }
  return [...byOffset.values()].sort((a, b) => a.at - b.at);
}

/**
 * Is this figure present in the source?
 *
 * Matching is on VALUE, not on spelling: a source that says "$1,200,000"
 * grounds an output that says "$1.2 million". Requiring a literal string match
 * would score correct paraphrase as fabrication, which is the opposite of what
 * this measures. Percentages must match another percentage, and currency
 * another currency, so "67%" is not grounded by an unrelated "67" in a section
 * number.
 */
export function isGrounded(figure: EmittedFigure, source: string): boolean {
  if (Number.isNaN(figure.value)) return false;

  const sourceFigures = extractFigures(source);
  return sourceFigures.some((s) => {
    if (s.kind !== figure.kind) return false;
    if (Number.isNaN(s.value)) return false;
    // Exact on value. Currency written to different precision ("$1.2 million"
    // vs "$1,200,000") normalizes to the same number, so no tolerance is
    // needed — and a tolerance is exactly how a wrong number sneaks through.
    return s.value === figure.value;
  });
}

export function scoreGrounding(
  generated: string,
  source: string,
): GroundingResult {
  const figures = extractFigures(generated);
  const grounded: EmittedFigure[] = [];
  const fabricated: EmittedFigure[] = [];

  for (const f of figures) {
    (isGrounded(f, source) ? grounded : fabricated).push(f);
  }

  return {
    figures,
    grounded,
    fabricated,
    // No figures is not a failure — an analysis of a measure with no numbers
    // SHOULD contain no numbers. Scoring it 0 would push models to invent
    // some, which is the trap #1142 documents for field completeness.
    rate: figures.length === 0 ? 1 : grounded.length / figures.length,
  };
}
