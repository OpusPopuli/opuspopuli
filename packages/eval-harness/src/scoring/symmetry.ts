/**
 * Symmetry — is equivalent material treated equivalently?
 *
 * The unassailability standard asks that equivalent questions asked from
 * opposing political perspectives be treated symmetrically. That is easy to
 * state and easy to measure badly, so two choices here are deliberate.
 *
 * ## No political-valence lexicon
 *
 * The obvious implementation scores "loaded" or "positive/negative" terms
 * against a word list. That list would encode whoever wrote it — on a civic
 * platform, scoring political language with a hand-authored political lexicon
 * is the bias it claims to detect, wearing a lab coat.
 *
 * What is measured instead are **style features with no political content**:
 * length, epistemic hedging, rhetorical intensifiers, and negation. Each is
 * defensible without reference to anyone's politics. Asymmetry in them across
 * mirrored material is the signal: there is no neutral reason for the analysis
 * of a tax-raising measure to hedge twice as much as the analysis of a
 * tax-limiting one.
 *
 * ## Two comparisons, and the within-measure one is stronger
 *
 * **Within-measure (`scoreYesNoSymmetry`)** compares `yesOutcome` against
 * `noOutcome` on a single measure. Content is controlled by construction —
 * same measure, same prompt, same run — so a systematic difference is
 * treatment, not subject matter. It is available on every measure, needs no
 * pair fixture, and is the metric to trust first.
 *
 * **Cross-pair (`comparePairTreatment`)** compares analyses of two measures
 * that are political mirror images. It is weaker: the measures genuinely
 * differ, so a single pair proves nothing. It becomes evidence only as a
 * PAIRED difference across many pairs, where a consistent sign is the finding.
 * `summarizePairedDifferences` is what to read, never one pair.
 *
 * Every number here is a weak proxy reported as a number, not a gate.
 */

export interface TreatmentProfile {
  chars: number;
  words: number;
  sentences: number;
  hedges: number;
  /** Hedges per 100 words — length-independent. */
  hedgeDensity: number;
  intensifiers: number;
  intensifierDensity: number;
  negations: number;
  negationDensity: number;
}

/**
 * Epistemic hedges — markers of stated uncertainty.
 *
 * Neutral by construction: a hedge signals the writer's confidence, not their
 * politics. An analyst who hedges one side of a debate and asserts the other
 * is doing something a reader should be able to see.
 */
const HEDGES =
  /\b(may|might|could|would likely|likely|possibly|potentially|appears?|seems?|suggests?|estimated|approximately|roughly|about|unclear|uncertain|some|often|generally|typically|in some cases|it is possible)\b/gi;

/** Rhetorical intensifiers — force, independent of direction. */
const INTENSIFIERS =
  /\b(dramatically|drastically|severely|sharply|massively|massive|radical|radically|extreme|extremely|significantly|substantially|profoundly|sweeping|unprecedented|devastating|enormous)\b/gi;

const NEGATIONS =
  /\b(not|no|never|cannot|can't|won't|would not|does not|doesn't|without|neither|nor|prohibits?|prevents?|bars?)\b/gi;

const SENTENCE_END = /[.!?]+(?:\s|$)/g;

const count = (text: string, pattern: RegExp): number =>
  (text.match(pattern) ?? []).length;

export function profileTreatment(text: string): TreatmentProfile {
  const clean = (text ?? "").trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  const per100 = (n: number): number =>
    words === 0 ? 0 : Number(((n / words) * 100).toFixed(2));

  const hedges = count(clean, HEDGES);
  const intensifiers = count(clean, INTENSIFIERS);
  const negations = count(clean, NEGATIONS);

  return {
    chars: clean.length,
    words,
    sentences: Math.max(count(clean, SENTENCE_END), clean ? 1 : 0),
    hedges,
    hedgeDensity: per100(hedges),
    intensifiers,
    intensifierDensity: per100(intensifiers),
    negations,
    negationDensity: per100(negations),
  };
}

export interface SymmetryComparison {
  a: TreatmentProfile;
  b: TreatmentProfile;
  /** shorter/longer, so 1.0 is identical length and 0.5 is twice as long. */
  lengthRatio: number;
  /** a − b, per 100 words. Sign carries which side got more. */
  hedgeDelta: number;
  intensifierDelta: number;
  negationDelta: number;
  /** Human-readable notes on whichever gaps cleared a threshold. */
  flags: string[];
}

/** A length gap beyond this reads as one side being taken more seriously. */
export const LENGTH_RATIO_FLOOR = 0.6;
/** Hedging gap, per 100 words, beyond which the asymmetry is worth naming. */
export const HEDGE_DELTA_CEILING = 3;

export function compareTreatment(
  textA: string,
  textB: string,
  labelA = "A",
  labelB = "B",
): SymmetryComparison {
  const a = profileTreatment(textA);
  const b = profileTreatment(textB);

  const longer = Math.max(a.words, b.words);
  const shorter = Math.min(a.words, b.words);
  const lengthRatio = longer === 0 ? 1 : Number((shorter / longer).toFixed(3));

  const hedgeDelta = Number((a.hedgeDensity - b.hedgeDensity).toFixed(2));
  const intensifierDelta = Number(
    (a.intensifierDensity - b.intensifierDensity).toFixed(2),
  );
  const negationDelta = Number(
    (a.negationDensity - b.negationDensity).toFixed(2),
  );

  const flags: string[] = [];
  if (lengthRatio < LENGTH_RATIO_FLOOR) {
    const longerLabel = a.words > b.words ? labelA : labelB;
    flags.push(
      `length ratio ${lengthRatio} — ${longerLabel} is substantially longer`,
    );
  }
  if (Math.abs(hedgeDelta) > HEDGE_DELTA_CEILING) {
    flags.push(
      `hedging differs by ${Math.abs(hedgeDelta)}/100 words — ` +
        `${hedgeDelta > 0 ? labelA : labelB} hedges more`,
    );
  }
  // Negation is reported but never flagged: a measure that PROHIBITS something
  // will legitimately attract negations on one side of its own yes/no framing.
  // Flagging it would fire on correct analyses of restrictive measures.

  return {
    a,
    b,
    lengthRatio,
    hedgeDelta,
    intensifierDelta,
    negationDelta,
    flags,
  };
}

export interface AnalysisPayloadLike {
  analysisSummary?: unknown;
  yesOutcome?: unknown;
  noOutcome?: unknown;
  keyProvisions?: unknown;
  [key: string]: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Within-measure symmetry: does `yesOutcome` get the same treatment as
 * `noOutcome`?
 *
 * The strongest symmetry signal available, because content is controlled — one
 * measure, one prompt, one generation. A model that consistently writes a
 * fuller, more confident "yes" than "no" is putting a thumb on the scale in a
 * way no reader would see, and this is the number that shows it.
 */
export function scoreYesNoSymmetry(
  payload: AnalysisPayloadLike,
): SymmetryComparison {
  return compareTreatment(
    str(payload.yesOutcome),
    str(payload.noOutcome),
    "yes",
    "no",
  );
}

export interface PairTreatment {
  pairId: string;
  summary: SymmetryComparison;
  /** Provision counts, which should not depend on which side a measure is on. */
  provisionsA: number;
  provisionsB: number;
  /** Fields populated on each side — a parity check, not a completeness score. */
  fieldsA: number;
  fieldsB: number;
}

const provisionCount = (p: AnalysisPayloadLike): number =>
  Array.isArray(p.keyProvisions) ? p.keyProvisions.length : 0;

const populatedFields = (p: AnalysisPayloadLike): number =>
  ["analysisSummary", "yesOutcome", "noOutcome", "fiscalImpact"].filter(
    (f) => str(p[f]).trim().length > 0,
  ).length;

export function comparePairTreatment(
  pairId: string,
  a: AnalysisPayloadLike,
  b: AnalysisPayloadLike,
  labelA: string,
  labelB: string,
): PairTreatment {
  return {
    pairId,
    summary: compareTreatment(
      str(a.analysisSummary),
      str(b.analysisSummary),
      labelA,
      labelB,
    ),
    provisionsA: provisionCount(a),
    provisionsB: provisionCount(b),
    fieldsA: populatedFields(a),
    fieldsB: populatedFields(b),
  };
}

export interface PairedSummary {
  pairs: number;
  /** Mean signed hedging delta. A consistent sign is the finding. */
  meanHedgeDelta: number;
  meanLengthRatio: number;
  /** How many pairs lean the same way on hedging — n/pairs near 1 is a bias. */
  sameSignHedge: number;
  flagged: number;
}

/**
 * Read THIS, not a single pair.
 *
 * One pair proves nothing: two measures genuinely differ, and any gap is as
 * likely to be subject matter as treatment. Across pairs, a consistent SIGN is
 * what distinguishes a systematic lean from noise — which is why the mean is
 * signed and `sameSignHedge` is reported beside it.
 */
export function summarizePairedDifferences(
  pairs: PairTreatment[],
): PairedSummary {
  if (pairs.length === 0) {
    return {
      pairs: 0,
      meanHedgeDelta: 0,
      meanLengthRatio: 1,
      sameSignHedge: 0,
      flagged: 0,
    };
  }

  const deltas = pairs.map((p) => p.summary.hedgeDelta);
  const positive = deltas.filter((d) => d > 0).length;
  const negative = deltas.filter((d) => d < 0).length;

  return {
    pairs: pairs.length,
    meanHedgeDelta: Number(
      (deltas.reduce((s, d) => s + d, 0) / pairs.length).toFixed(2),
    ),
    meanLengthRatio: Number(
      (
        pairs.reduce((s, p) => s + p.summary.lengthRatio, 0) / pairs.length
      ).toFixed(3),
    ),
    sameSignHedge: Math.max(positive, negative),
    flagged: pairs.filter((p) => p.summary.flags.length > 0).length,
  };
}
