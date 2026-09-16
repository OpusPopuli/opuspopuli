/**
 * Omission — which of a measure's provisions never made it into the analysis?
 *
 * Every other generation metric here asks whether what the model *said* was
 * right. This asks what it did not say. A summary can be accurate, grounded,
 * correctly abstaining and still leave a voter ignorant of the provision that
 * matters most to them — and nothing else in the harness would notice, because
 * there is no wrong output to point at.
 *
 * ## Matching is by meaning, and the threshold is measured
 *
 * Gold provisions are written in the measure's own register ("no insurer may
 * delay, deny or modify any medical procedure"); the model writes in a voter's
 * ("insurers cannot refuse treatment your doctor recommends"). Exact or
 * keyword matching scores correct paraphrase as omission, which would make the
 * metric worse than useless — it would punish the plain-language rewriting the
 * product exists to do.
 *
 * So matching is by embedding similarity, and the **threshold is derived from
 * the data rather than chosen**. `calibrateThreshold` scores every gold
 * provision against provisions belonging to OTHER measures, which are known
 * non-matches, and puts the cut above that null distribution. A threshold
 * picked by hand would be the author's intuition wearing a decimal point —
 * which is exactly the error the calibration metric in this harness already
 * made once, by modelling a string enum as a number.
 *
 * Similarity is injected rather than imported so the rules are testable
 * without a model, and so the eval layer decides which embedding provider
 * production is actually running.
 */

export interface GoldProvision {
  id: string;
  /** In the measure's own terms. Authored by reading the operative text. */
  text: string;
  /**
   * A provision a voter cannot make an informed choice without. Omitting one
   * is a different failure from dropping a severability clause, and the two
   * are reported separately.
   */
  essential?: boolean;
}

export interface ProvisionMatch {
  id: string;
  text: string;
  essential: boolean;
  recalled: boolean;
  /** Best similarity against anything the model emitted. */
  bestScore: number;
  /** What it matched, when it matched. */
  matchedTo?: string;
}

export interface OmissionScore {
  matches: ProvisionMatch[];
  total: number;
  recalled: number;
  recall: number;
  essentialTotal: number;
  essentialRecalled: number;
  /** The number that matters. Recall over provisions a voter needs. */
  essentialRecall: number;
  threshold: number;
  verdict: string;
}

/** Cosine similarity, injected so the scorer needs no model to be tested. */
export type Similarity = (goldIndex: number, emittedIndex: number) => number;

/**
 * Put the match threshold above the null distribution.
 *
 * `negatives` are similarities between gold provisions and provisions from
 * OTHER measures — known non-matches. The cut goes at the given quantile of
 * that distribution, so "matched" means "more similar than almost anything
 * unrelated", which is a claim the data supports rather than a number chosen
 * because it looked about right.
 */
export function calibrateThreshold(
  negatives: number[],
  quantile = 0.95,
  floor = 0.5,
): { threshold: number; nullMean: number; nullQuantile: number; n: number } {
  if (negatives.length === 0) {
    return { threshold: floor, nullMean: 0, nullQuantile: 0, n: 0 };
  }
  const sorted = [...negatives].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(quantile * sorted.length));
  const nullQuantile = sorted[idx];
  const nullMean = negatives.reduce((s, x) => s + x, 0) / negatives.length;

  return {
    // The floor guards the degenerate case where unrelated provisions already
    // score high — which would mean the embedding cannot separate this corpus
    // at all, and a calibrated threshold would silently pass everything.
    threshold: Math.max(floor, Number(nullQuantile.toFixed(3))),
    nullMean: Number(nullMean.toFixed(3)),
    nullQuantile: Number(nullQuantile.toFixed(3)),
    n: negatives.length,
  };
}

export function scoreOmission(
  gold: GoldProvision[],
  emitted: string[],
  similarity: Similarity,
  threshold: number,
): OmissionScore {
  const matches: ProvisionMatch[] = gold.map((g, gi) => {
    let bestScore = 0;
    let bestIndex = -1;
    for (let ei = 0; ei < emitted.length; ei++) {
      const s = similarity(gi, ei);
      if (s > bestScore) {
        bestScore = s;
        bestIndex = ei;
      }
    }
    const recalled = bestScore >= threshold;
    return {
      id: g.id,
      text: g.text,
      essential: g.essential ?? false,
      recalled,
      bestScore: Number(bestScore.toFixed(3)),
      matchedTo: recalled && bestIndex >= 0 ? emitted[bestIndex] : undefined,
    };
  });

  const essential = matches.filter((m) => m.essential);
  const recalled = matches.filter((m) => m.recalled).length;
  const essentialRecalled = essential.filter((m) => m.recalled).length;

  const rate = (n: number, d: number): number =>
    d === 0 ? 1 : Number((n / d).toFixed(3));

  return {
    matches,
    total: matches.length,
    recalled,
    recall: rate(recalled, matches.length),
    essentialTotal: essential.length,
    essentialRecalled,
    essentialRecall: rate(essentialRecalled, essential.length),
    threshold,
    verdict: describe(
      matches.length,
      recalled,
      essential.length,
      essentialRecalled,
      matches.filter((m) => m.essential && !m.recalled),
    ),
  };
}

function describe(
  total: number,
  recalled: number,
  essentialTotal: number,
  essentialRecalled: number,
  missedEssential: ProvisionMatch[],
): string {
  if (total === 0) return "No gold provisions authored for this measure.";

  const head = `${recalled}/${total} provisions surfaced`;
  if (essentialTotal === 0) return `${head}.`;

  if (missedEssential.length === 0) {
    return `${head}, including all ${essentialTotal} a voter needs.`;
  }

  const examples = missedEssential
    .slice(0, 2)
    .map((m) => `"${m.text.slice(0, 70)}${m.text.length > 70 ? "…" : ""}"`)
    .join("; ");

  return (
    `${head}, but ${missedEssential.length} of ${essentialTotal} ESSENTIAL ` +
    `provisions were dropped — ${examples}. A voter reading this analysis would ` +
    `not know about them, and no other metric here would notice, because there ` +
    `is no wrong output to point at.`
  );
}
