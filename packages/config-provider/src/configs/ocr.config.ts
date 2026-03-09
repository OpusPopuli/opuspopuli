import { registerAs } from "@nestjs/config";

/**
 * OCR Configuration
 *
 * Maps OCR_* environment variables to nested config.
 */
export const ocrConfig = registerAs("ocr", () => ({
  provider: process.env.OCR_PROVIDER || "tesseract",
  languages: process.env.OCR_LANGUAGES || "eng",
  preprocessing: {
    enabled: process.env.OCR_PREPROCESSING_ENABLED !== "false",
    preset: process.env.OCR_PREPROCESSING_PRESET || "balanced",
  },
}));
