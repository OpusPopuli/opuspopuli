import {
  analyzableFloor,
  retrievalFloor,
  isVisionProvider,
  MIN_ANALYZABLE_OCR_CONFIDENCE,
  MIN_RETRIEVAL_OCR_CONFIDENCE,
  MIN_VISION_READABILITY,
} from './ocr-quality';

/**
 * #1050. These thresholds decide whether a citizen's petition scan is read at
 * all, and the bug they exist to prevent is silent: a threshold calibrated for
 * one engine applied to another passes or fails scans for reasons nobody can
 * reconstruct afterwards.
 */
describe('OCR quality floors', () => {
  describe('isVisionProvider', () => {
    it('recognises the vision provider by its model-qualified name', () => {
      expect(isVisionProvider('vision:qwen2.5vl:7b')).toBe(true);
    });

    it('does not mistake Tesseract for a vision engine', () => {
      expect(isVisionProvider('Tesseract')).toBe(false);
      expect(isVisionProvider('tesseract.js')).toBe(false);
    });

    /**
     * Rows written before #1050 have no provider recorded, and they can only
     * have come from Tesseract — so null must resolve to the Tesseract floor,
     * not be treated as unknown.
     */
    it('treats an unrecorded provider as Tesseract', () => {
      expect(isVisionProvider(null)).toBe(false);
      expect(isVisionProvider(undefined)).toBe(false);
    });
  });

  describe('analyzableFloor', () => {
    it('applies the Tesseract floor to Tesseract and to legacy rows', () => {
      expect(analyzableFloor('Tesseract')).toBe(MIN_ANALYZABLE_OCR_CONFIDENCE);
      expect(analyzableFloor(null)).toBe(MIN_ANALYZABLE_OCR_CONFIDENCE);
    });

    it('applies the readability floor to vision output', () => {
      expect(analyzableFloor('vision:qwen2.5vl:7b')).toBe(
        MIN_VISION_READABILITY,
      );
    });
  });

  describe('retrievalFloor', () => {
    it('keeps the 70 per-glyph floor for Tesseract', () => {
      expect(retrievalFloor('Tesseract')).toBe(MIN_RETRIEVAL_OCR_CONFIDENCE);
      expect(retrievalFloor(null)).toBe(MIN_RETRIEVAL_OCR_CONFIDENCE);
    });

    /**
     * The regression this is really guarding. Applying 70 to a vision score is
     * the exact failure seen in production 2026-09-13: a scan the LLM read
     * correctly was skipped before retrieval ran, and the user was told we
     * could not confirm it against the filed record — having never compared
     * anything. For vision, retrieval IS the quality measurement, so it must
     * not be gated behind a proxy for itself.
     */
    it('does not apply the Tesseract 70 to vision output', () => {
      expect(retrievalFloor('vision:qwen2.5vl:7b')).toBe(
        MIN_VISION_READABILITY,
      );
      expect(retrievalFloor('vision:qwen2.5vl:7b')).toBeLessThan(
        MIN_RETRIEVAL_OCR_CONFIDENCE,
      );
    });
  });

  /**
   * Measured on the node, 2026-09-13, same petition:
   *   qwen2.5vl:7b good read   readability 96.5
   *   Tesseract real scan      native confidence 42, readability 82.4
   *
   * The floor must sit far below a good read, so an ordinary-but-worse
   * photograph is not discarded, while still catching the ways a VLM fails
   * outright (repetition loop, refusal, truncation).
   */
  describe('the vision floor against measured values', () => {
    const GOOD_VLM_READ = 96.5;

    it('passes a real vision transcription with margin to spare', () => {
      expect(GOOD_VLM_READ).toBeGreaterThan(MIN_VISION_READABILITY + 30);
    });

    it('is not set so high that a worse photograph is thrown away', () => {
      // The Tesseract gates rejected 4 of 5 genuine petitions tonight by
      // sitting too close to the observed values. Do not repeat it here.
      expect(MIN_VISION_READABILITY).toBeLessThan(GOOD_VLM_READ - 25);
    });
  });
});
