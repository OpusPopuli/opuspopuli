/**
 * Calibration — does the model's stated confidence predict anything?
 *
 * The motivating case is in #1142: a Legistar structural manifest that chose a
 * 1–3 row "Upcoming Meetings" widget over the 16-row `gridCalendar`, and
 * reported confidence **0.9**. Wrong, plausible, and self-assured. A confidence
 * field invites exactly one response — gate on it — so the question here is
 * narrow and decision-shaped, asked on behalf of #1209's verification gates:
 *
 *   **If we kept only high-confidence claims, would the survivors be better?**
 *
 * ## Confidence is an ORDINAL, not a number
 *
 * The published prompt asks for `"confidence": "high"` and states the allowed
 * values as `"high" | "medium" | "low"`. Production agrees:
 * `PropositionAnalysisClaim.confidence` is `"high" | "medium" | "low"`, and all
 * 521 claim rows in the dev database carry a string.
 *
 * An earlier revision of this file modelled confidence as a number, binned it
 * at 0.5/0.7/0.8/0.9/0.95 and computed an expected calibration error. Run
 * against real output it reported **0 of 70 claims carrying a confidence
 * value**, because every one of them was the string `"high"`. The metric was
 * measuring its own assumption rather than the contract.
 *
 * So this scores the ordinal that exists. There is no ECE, because computing
 * one would mean inventing numeric values the model never emitted and then
 * measuring the error in numbers of our own devising. What replaces it is
 * blunter and more useful: **the anchoring rate within each confidence level**,
 * and what filtering to each level would actually buy.
 *
 * Numeric confidence is still accepted, for generators that emit one.
 */

export interface ScoredClaim {
  /** `"high" | "medium" | "low"`, or a number. Missing claims are excluded. */
  confidence?: string | number;
  /** Did the citation actually hold? */
  anchored: boolean;
}

export interface CalibrationGroup {
  label: string;
  /** Rank within the ordinal, highest first. */
  rank: number;
  count: number;
  /** Share of all claims carrying a confidence. */
  share: number;
  /** Anchoring rate within this level. */
  accuracy: number;
}

export interface FilterRow {
  /** Keep only claims at this level or above. */
  atLeast: string;
  kept: number;
  keptFraction: number;
  precision: number;
  /** precision − the unfiltered baseline. The only reason to filter. */
  lift: number;
}

export interface CalibrationReport {
  n: number;
  withoutConfidence: number;
  baseline: number;
  /** Levels the model actually used, highest first. */
  groups: CalibrationGroup[];
  /** Distinct levels observed. One means the field carries no information. */
  distinctLevels: number;
  /** accuracy(top level) − accuracy(bottom level). Zero or less is no signal. */
  discrimination: number;
  /** Does accuracy fall as stated confidence falls? */
  monotonic: boolean;
  filters: FilterRow[];
  verdict: string;
}

/** Declared order of the published enum, highest first. */
const ORDINAL = ["high", "medium", "low"];

const round = (x: number, places = 3): number => Number(x.toFixed(places));

/** Rank a label: known enum values by position, numbers by descending value. */
function rankOf(label: string): number {
  const known = ORDINAL.indexOf(label.toLowerCase());
  if (known >= 0) return known;
  const numeric = Number.parseFloat(label);
  // Numeric confidences sort after the named levels, highest first.
  return Number.isNaN(numeric)
    ? ORDINAL.length + 1
    : ORDINAL.length + (1 - numeric);
}

export function scoreCalibration(claims: ScoredClaim[]): CalibrationReport {
  // Claims with no confidence are excluded rather than defaulted: inventing a
  // confidence in order to score confidence measures our own assumption.
  const usable = claims.filter(
    (c) =>
      c.confidence !== undefined &&
      c.confidence !== null &&
      String(c.confidence).trim() !== "",
  );
  const withoutConfidence = claims.length - usable.length;
  const n = usable.length;

  if (n === 0) {
    return {
      n: 0,
      withoutConfidence,
      baseline: 0,
      groups: [],
      distinctLevels: 0,
      discrimination: 0,
      monotonic: false,
      filters: [],
      verdict:
        withoutConfidence > 0
          ? `None of the ${withoutConfidence} claims carried a confidence value. ` +
            "Either the generator does not emit one, or the field is being read " +
            "under the wrong name or type — check the contract before concluding " +
            "anything about the model."
          : "No claims to assess.",
    };
  }

  const labelled = usable.map((c) => ({
    label: String(c.confidence).trim().toLowerCase(),
    anchored: c.anchored,
  }));
  const baseline = labelled.filter((c) => c.anchored).length / n;

  const levels = [...new Set(labelled.map((c) => c.label))].sort(
    (a, b) => rankOf(a) - rankOf(b),
  );

  const groups: CalibrationGroup[] = levels.map((label) => {
    const inGroup = labelled.filter((c) => c.label === label);
    return {
      label,
      rank: rankOf(label),
      count: inGroup.length,
      share: round(inGroup.length / n),
      accuracy: round(
        inGroup.filter((c) => c.anchored).length / inGroup.length,
      ),
    };
  });

  const filters: FilterRow[] = levels.map((label) => {
    const kept = labelled.filter((c) => rankOf(c.label) <= rankOf(label));
    const precision =
      kept.length === 0
        ? 0
        : kept.filter((c) => c.anchored).length / kept.length;
    return {
      atLeast: label,
      kept: kept.length,
      keptFraction: round(kept.length / n),
      precision: round(precision),
      lift: round(precision - baseline),
    };
  });

  const discrimination =
    groups.length < 2
      ? 0
      : groups[0].accuracy - groups[groups.length - 1].accuracy;

  const monotonic = groups.every(
    (g, i) => i === 0 || groups[i - 1].accuracy >= g.accuracy,
  );

  return {
    n,
    withoutConfidence,
    baseline: round(baseline),
    groups,
    distinctLevels: levels.length,
    discrimination: round(discrimination),
    monotonic,
    filters,
    verdict: describeCalibration(
      groups,
      discrimination,
      monotonic,
      baseline,
      n,
    ),
  };
}

/**
 * Below this, the gap between the top and bottom level is too small to act on.
 * Anchoring rates over a few dozen claims move several points on resampling
 * alone — the generation leg showed per-measure anchoring swinging 0% to 27%
 * between identical runs — so a small gap is noise wearing a decimal point.
 */
const MIN_USEFUL_DISCRIMINATION = 0.1;

function describeCalibration(
  groups: CalibrationGroup[],
  discrimination: number,
  monotonic: boolean,
  baseline: number,
  n: number,
): string {
  if (groups.length === 1) {
    const g = groups[0];
    return (
      `Every one of the ${n} claims is marked "${g.label}". Confidence takes a ` +
      `single value, so it carries no information and cannot separate anything ` +
      `— filtering on it would keep all claims or none. Those claims anchor ` +
      `${round(g.accuracy)} of the time, so "${g.label}" means nothing stronger ` +
      `than the baseline. Gating on claim confidence is not available as a ` +
      `strategy for #1209; verification has to check the span.`
    );
  }

  const spread = groups
    .map((g) => `${g.label} ${g.accuracy} (n=${g.count})`)
    .join(", ");

  if (discrimination <= MIN_USEFUL_DISCRIMINATION) {
    return (
      `Stated confidence barely separates correct from incorrect claims — ` +
      `${spread}, a top-to-bottom gap of ${round(discrimination)} over n=${n}. ` +
      `No filter buys enough to justify the claims it discards.`
    );
  }

  const best = filtersBest(groups, baseline);
  return (
    `Confidence does separate claims (${spread}; gap ${round(discrimination)}, ` +
    `n=${n})${monotonic ? "" : ", though accuracy is NOT monotonic in stated confidence"}. ` +
    `${best}`
  );
}

function filtersBest(groups: CalibrationGroup[], baseline: number): string {
  const top = groups[0];
  return (
    `Keeping only "${top.label}" claims would retain ${round(top.share)} of them ` +
    `at an anchoring rate of ${top.accuracy}, against a baseline of ${round(baseline)}.`
  );
}
