import { registerAs } from '@nestjs/config';

/**
 * OCR Configuration
 *
 * Maps OCR_* environment variables to nested config.
 * Used by documents service for text extraction from images.
 *
 * Environment Variables:
 * - OCR_PROVIDER: 'tesseract' (default)
 * - OCR_LANGUAGES: comma-separated ISO 639-3 codes (default: 'eng')
 * - OCR_PREPROCESSING_ENABLED: 'true'/'false' (default: 'true')
 * - OCR_PREPROCESSING_PRESET: 'fast'/'balanced'/'quality' (default: 'balanced')
 */
export default registerAs('ocr', () => ({
  // Provider selection: 'tesseract' (default)
  provider: process.env.OCR_PROVIDER || 'tesseract',

  // Languages for OCR recognition (comma-separated ISO 639-3 codes)
  languages: process.env.OCR_LANGUAGES || 'eng',

  // Image preprocessing configuration
  preprocessing: {
    // Enable/disable preprocessing pipeline
    enabled: process.env.OCR_PREPROCESSING_ENABLED !== 'false',

    // Preset: 'fast', 'balanced', or 'quality'
    // - fast: grayscale + threshold (~50-100ms)
    // - balanced: grayscale + resize + deskew + threshold + sharpen (~100-200ms)
    // - quality: all 8 steps (~200-400ms)
    preset: process.env.OCR_PREPROCESSING_PRESET || 'balanced',
  },
}));
