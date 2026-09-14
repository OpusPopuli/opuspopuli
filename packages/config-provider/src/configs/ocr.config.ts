import { registerAs } from "@nestjs/config";

/**
 * OCR Configuration
 *
 * Maps OCR_* environment variables to nested config.
 */
export const ocrConfig = registerAs("ocr", () => ({
  provider: process.env.OCR_PROVIDER || "tesseract",
  languages: process.env.OCR_LANGUAGES || "eng",
  vision: {
    /**
     * Pinned SEPARATELY from LLM_MODEL, deliberately (#1050).
     *
     * Inference is moving to a US-provenance model (OLMo) with no vision
     * capability. Reusing LLM_MODEL here would mean petition OCR silently
     * breaking on the day that switch lands. Keeping it distinct also confines
     * the Qwen-derived model to one declared job, in one auditable value.
     */
    model: process.env.OCR_VISION_MODEL || "qwen2.5vl:7b",
    url: process.env.OCR_VISION_URL || "http://localhost:11434",
    timeoutMs: Number(process.env.OCR_VISION_TIMEOUT_MS ?? 120_000),
  },
  preprocessing: {
    enabled: process.env.OCR_PREPROCESSING_ENABLED !== "false",
    preset: process.env.OCR_PREPROCESSING_PRESET || "balanced",
  },
}));
