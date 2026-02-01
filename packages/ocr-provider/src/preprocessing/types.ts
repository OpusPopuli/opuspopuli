/**
 * Image Preprocessing Types
 *
 * Configuration and result types for the OCR image preprocessing pipeline.
 * Preprocessing improves OCR accuracy on challenging images (poor lighting,
 * skewed documents, shadows, etc.).
 */

/**
 * Available preprocessing step types
 */
export type PreprocessingStepType =
  | "grayscale"
  | "resize"
  | "deskew"
  | "shadowRemoval"
  | "adaptiveThreshold"
  | "noiseReduction"
  | "sharpen"
  | "cropToBorders";

/**
 * Configuration for a single preprocessing step
 */
export interface PreprocessingStep {
  /** Step type */
  type: PreprocessingStepType;
  /** Whether this step is enabled */
  enabled: boolean;
  /** Step-specific options */
  options?: PreprocessingStepOptions;
}

/**
 * Options for individual preprocessing steps
 */
export interface PreprocessingStepOptions {
  /** Target DPI for resize step (default: 300) */
  targetDpi?: number;
  /** Maximum dimension in pixels for resize (default: 4000) */
  maxDimension?: number;
  /** Sharpening sigma value (default: 1.0) */
  sharpenSigma?: number;
  /** Threshold value for binarization (default: 128) */
  thresholdValue?: number;
  /** Maximum rotation angle to correct in degrees (default: 15) */
  maxDeskewAngle?: number;
  /** Noise reduction strength 1-10 (default: 3) */
  noiseReductionStrength?: number;
}

/**
 * Preset names for preprocessing configurations
 */
export type PreprocessingPreset = "fast" | "balanced" | "quality" | "custom";

/**
 * Main preprocessing configuration
 */
export interface PreprocessingConfig {
  /** Whether preprocessing is enabled */
  enabled: boolean;
  /** Preset to use (ignored if pipeline is provided) */
  preset?: PreprocessingPreset;
  /** Custom pipeline steps (overrides preset) */
  pipeline?: PreprocessingStep[];
  /** Global options applied to all steps */
  globalOptions?: PreprocessingStepOptions;
}

/**
 * Metadata about preprocessing operations performed
 */
export interface PreprocessingMetadata {
  /** Whether preprocessing was enabled */
  enabled: boolean;
  /** Steps that were applied */
  stepsApplied: PreprocessingStepType[];
  /** Total preprocessing time in milliseconds */
  processingTimeMs: number;
  /** Original image size in bytes */
  originalSizeBytes: number;
  /** Processed image size in bytes */
  processedSizeBytes: number;
  /** Rotation angle applied during deskew (if any) */
  rotationDegrees?: number;
  /** Original image dimensions */
  originalDimensions?: { width: number; height: number };
  /** Processed image dimensions */
  processedDimensions?: { width: number; height: number };
}

/**
 * Result of preprocessing operation
 */
export interface PreprocessingResult {
  /** Processed image buffer */
  buffer: Buffer;
  /** MIME type of processed image (always image/png for consistency) */
  mimeType: string;
  /** Metadata about the preprocessing */
  metadata: PreprocessingMetadata;
}

/**
 * Image info extracted during preprocessing
 */
export interface ImageInfo {
  width: number;
  height: number;
  channels: number;
  format: string;
}
