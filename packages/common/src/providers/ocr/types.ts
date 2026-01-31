/**
 * OCR Types and Interfaces
 *
 * Strategy Pattern for Optical Character Recognition.
 * Supports swapping between Tesseract.js, AWS Textract, Google Vision, etc.
 */

/**
 * Input types for OCR operations
 */
export type OcrInput =
  | { type: "buffer"; buffer: Buffer; mimeType: string }
  | { type: "base64"; data: string; mimeType: string };

/**
 * Bounding box for detected text regions (normalized 0-1)
 */
export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Individual text block detected by OCR
 */
export interface OcrTextBlock {
  text: string;
  confidence: number;
  boundingBox?: OcrBoundingBox;
}

/**
 * Result of OCR operation
 */
export interface OcrResult {
  /** Full extracted text (concatenated) */
  text: string;
  /** Individual text blocks with metadata */
  blocks: OcrTextBlock[];
  /** Overall confidence score (0-100) */
  confidence: number;
  /** Provider used for OCR */
  provider: string;
  /** Processing time in milliseconds */
  processingTimeMs: number;
}

/**
 * Strategy interface for OCR providers
 */
export interface IOcrProvider {
  /**
   * Perform OCR on the given input
   */
  extractText(input: OcrInput): Promise<OcrResult>;

  /**
   * Check if this provider supports the given input type
   */
  supports(input: OcrInput): boolean;

  /**
   * Check if this provider supports the given MIME type
   */
  supportsMimeType(mimeType: string): boolean;

  /**
   * Get the provider name
   */
  getName(): string;

  /**
   * Get supported languages (ISO 639-3 codes)
   */
  getSupportedLanguages(): string[];
}

/**
 * Exception thrown when OCR fails
 */
export class OcrError extends Error {
  constructor(
    public provider: string,
    public originalError: Error,
  ) {
    super(`OCR failed in ${provider}: ${originalError.message}`);
    this.name = "OcrError";
  }
}

/**
 * Exception thrown when MIME type is not supported
 */
export class UnsupportedMimeTypeError extends Error {
  constructor(mimeType: string, provider: string) {
    super(`MIME type '${mimeType}' is not supported by ${provider}`);
    this.name = "UnsupportedMimeTypeError";
  }
}
