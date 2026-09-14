/**
 * Whether an OCR extraction is good enough to act on — per engine (#1050).
 *
 * ── Why this cannot be one number ────────────────────────────────────────
 *
 * `documents.ocr_confidence` holds different quantities depending on which
 * engine wrote it, and they are not comparable. Measured on the same petition,
 * 2026-09-13:
 *
 *   Tesseract, a real scan       native confidence 42   readability 82.4
 *   qwen2.5vl:7b on the node     no native confidence   readability 96.5
 *
 * Tesseract's number is a mean of per-glyph recognition confidences. A
 * vision-language model has no such thing — it emits tokens, not scored
 * glyphs — so its column holds a readability proxy instead. Judging that proxy
 * against a threshold calibrated for per-glyph means is a category error, and
 * it would silently pass or fail scans for reasons nobody could reconstruct.
 *
 * ── What the vision floor is actually for ────────────────────────────────
 *
 * NOT a quality gate. For the vision path, quality is settled downstream by
 * retrieval margin — which is a direct measurement of "did this text find the
 * right measure", and strictly better evidence than any proxy computed from
 * the text alone.
 *
 * This floor exists to catch the ways a VLM FAILS: a repetition loop, a
 * refusal, a truncated or empty response. Those produce text that scores far
 * below anything a real transcription does, which is why 60 sits so far under
 * the 96.5 observed on a good read. Set it near that observation and the first
 * slightly-worse photograph gets thrown away for no reason — the same mistake
 * that made the Tesseract gates reject four of five genuine petitions tonight.
 */

/** Tesseract per-glyph mean below which text is treated as noise. */
export const MIN_ANALYZABLE_OCR_CONFIDENCE = 40;

/** Tesseract per-glyph mean below which retrieval is not attempted. */
export const MIN_RETRIEVAL_OCR_CONFIDENCE = 70;

/**
 * Readability floor for vision-model output. A failure detector, not a quality
 * bar — see above. Deliberately far below the 96.5 a good read scores.
 */
export const MIN_VISION_READABILITY = 60;

/** True when the provider string names a vision-language engine. */
export function isVisionProvider(provider: string | null | undefined): boolean {
  return typeof provider === 'string' && provider.startsWith('vision:');
}

/**
 * The floor this document's score must clear to be worth analyzing.
 *
 * A null provider means a pre-#1050 row, which can only have come from
 * Tesseract — so the Tesseract floor is the correct answer for it, not a
 * missing-data special case.
 */
export function analyzableFloor(provider: string | null | undefined): number {
  return isVisionProvider(provider)
    ? MIN_VISION_READABILITY
    : MIN_ANALYZABLE_OCR_CONFIDENCE;
}

/**
 * The floor this document's score must clear before retrieval is attempted.
 *
 * For vision output this is the SAME failure floor as analysis, deliberately.
 * There is no second, stricter bar: if the model produced a real
 * transcription, retrieval is exactly the measurement that should decide
 * whether it matches, and refusing to run it is how tonight's scan reached
 * "we couldn't confirm this" without ever having compared anything.
 */
export function retrievalFloor(provider: string | null | undefined): number {
  return isVisionProvider(provider)
    ? MIN_VISION_READABILITY
    : MIN_RETRIEVAL_OCR_CONFIDENCE;
}
