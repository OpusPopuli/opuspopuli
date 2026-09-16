/**
 * OCR divergence — a dumb second reader as a check on a clever first one.
 *
 * The petition scanner reads a photographed document with a vision model. A VLM
 * is far better at this than Tesseract — Tesseract matched **0 of 5** real
 * production scans in the retrieval leg — but it is better in a way that
 * carries a specific risk: it *understands* the page. It can paraphrase,
 * normalise, summarise, and in principle omit. Tesseract cannot. It has no
 * model of what the page means, so it cannot decide that part of it is
 * uninteresting.
 *
 * That asymmetry is the whole idea behind E-24: run both, and treat a large
 * divergence as a signal that the clever reader did something the dumb one
 * did not. Not because Tesseract is right — it usually is not — but because
 * **a token Tesseract saw and the VLM did not reproduce is a token that was on
 * the page**.
 *
 * ## The two directions are not the same failure
 *
 *   - **VLM-missing** — content Tesseract read that the VLM did not emit.
 *     Candidate *omission*. This is the direction the guard exists for.
 *   - **VLM-only** — content the VLM emitted that Tesseract did not read.
 *     Mostly the VLM being better, plus its known paraphrasing (it wrote
 *     "EXTRACTION" for "ESTABLISHES" and "address" for "driver's license" on
 *     real scans). Expected, and NOT evidence of fabrication on its own.
 *
 * Reporting one blended "similarity" number would merge a fabrication signal
 * with a quality signal and measure neither.
 *
 * ## Tesseract's noise floor is the hard part
 *
 * Tesseract on a photograph produces real tokens mixed with garbage. So a raw
 * missing-token count is dominated by Tesseract's own failures, not the VLM's.
 * The mitigations are to compare only tokens that look like words, and to
 * report the rate rather than a count — and, crucially, to **calibrate against
 * a known-good pair** before any threshold is trusted.
 */

export interface DivergenceResult {
  tesseractTokens: number;
  vlmTokens: number;
  /** Content words in both. */
  shared: number;
  /** Read by Tesseract, absent from the VLM. Candidate omission. */
  vlmMissing: string[];
  /** Emitted by the VLM, absent from Tesseract. Mostly VLM quality. */
  vlmOnly: string[];
  /** vlmMissing / tesseract content tokens. The guard's signal. */
  omissionRate: number;
  /** Jaccard over content words. Reported, not gated on. */
  overlap: number;
  /** vlm length / tesseract length. A VLM that summarised reads well below 1. */
  lengthRatio: number;
}

/**
 * Tokens that plausibly came off the page rather than out of Tesseract's
 * imagination. Four characters and alphabetic — short strings and digit soup
 * are where Tesseract's noise concentrates, and including them would drown the
 * signal in the reader we trust least.
 */
export function contentTokens(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .split(/[^a-zá-úñü]+/i)
      .filter((t) => t.length >= 4),
  );
}

export function scoreDivergence(
  tesseract: string,
  vlm: string,
): DivergenceResult {
  const t = contentTokens(tesseract);
  const v = contentTokens(vlm);

  const vlmMissing = [...t].filter((x) => !v.has(x));
  const vlmOnly = [...v].filter((x) => !t.has(x));
  const shared = [...t].filter((x) => v.has(x)).length;
  const union = new Set([...t, ...v]).size;

  return {
    tesseractTokens: t.size,
    vlmTokens: v.size,
    shared,
    vlmMissing,
    vlmOnly,
    omissionRate:
      t.size === 0 ? 0 : Number((vlmMissing.length / t.size).toFixed(3)),
    overlap: union === 0 ? 1 : Number((shared / union).toFixed(3)),
    lengthRatio:
      tesseract.length === 0
        ? 1
        : Number((vlm.length / tesseract.length).toFixed(3)),
  };
}

export interface DivergenceCalibration {
  /** Omission rates observed on pairs believed good. */
  samples: number[];
  baselineMean: number;
  baselineMax: number;
  /** Where a threshold could sit, if there were enough samples to set one. */
  suggestedThreshold: number | null;
  usable: boolean;
  note: string;
}

/**
 * How many known-good pairs it takes before a threshold means anything.
 *
 * Set high deliberately. A guard calibrated on two images of one document would
 * encode that document, and a threshold that fires on everything else is worse
 * than no guard: it would be switched off within a week and remembered as
 * having been tried.
 */
export const MIN_CALIBRATION_SAMPLES = 10;

export function calibrateDivergence(samples: number[]): DivergenceCalibration {
  if (samples.length === 0) {
    return {
      samples,
      baselineMean: 0,
      baselineMax: 0,
      suggestedThreshold: null,
      usable: false,
      note: "No pairs measured — nothing to calibrate against.",
    };
  }

  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  const max = Math.max(...samples);
  const usable = samples.length >= MIN_CALIBRATION_SAMPLES;

  return {
    samples,
    baselineMean: Number(mean.toFixed(3)),
    baselineMax: Number(max.toFixed(3)),
    // Only offered once there is enough evidence to offer it.
    suggestedThreshold: usable ? Number((max * 1.25).toFixed(3)) : null,
    usable,
    note: usable
      ? `Baseline omission rate over ${samples.length} known-good pairs: mean ${mean.toFixed(3)}, max ${max.toFixed(3)}. A guard could fire above ${(max * 1.25).toFixed(3)}.`
      : `Only ${samples.length} pair(s) measured; ${MIN_CALIBRATION_SAMPLES} are needed before a threshold means anything. ` +
        `A guard calibrated on this little would encode these specific images, fire on everything else, and be switched off within a week — worse than no guard, because it would be remembered as having been tried.`,
  };
}
