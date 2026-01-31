import { registerAs } from '@nestjs/config';

/**
 * OCR Configuration
 *
 * Maps OCR_* environment variables to nested config.
 * Used by documents service for text extraction from images.
 */
export default registerAs('ocr', () => ({
  // Provider selection: 'tesseract' (default)
  provider: process.env.OCR_PROVIDER || 'tesseract',

  // Languages for OCR recognition (comma-separated ISO 639-3 codes)
  languages: process.env.OCR_LANGUAGES || 'eng',
}));
