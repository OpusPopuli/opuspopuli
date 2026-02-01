/**
 * Preprocessing Presets
 *
 * Predefined configurations for different use cases.
 * - fast: Minimal preprocessing for good quality images (~50-100ms)
 * - balanced: Moderate preprocessing for typical documents (~100-200ms)
 * - quality: Full preprocessing for challenging images (~200-400ms)
 */

import {
  PreprocessingConfig,
  PreprocessingStep,
  PreprocessingPreset,
} from "./types";

/**
 * Fast preset: Minimal preprocessing
 * Best for: Good quality scans, already-digital documents
 * Steps: grayscale + adaptive threshold
 * Latency: ~50-100ms
 */
const FAST_PIPELINE: PreprocessingStep[] = [
  { type: "grayscale", enabled: true },
  { type: "adaptiveThreshold", enabled: true },
];

/**
 * Balanced preset: Moderate preprocessing
 * Best for: Typical mobile camera captures, office documents
 * Steps: grayscale + resize + deskew + adaptive threshold + sharpen
 * Latency: ~100-200ms
 */
const BALANCED_PIPELINE: PreprocessingStep[] = [
  { type: "grayscale", enabled: true },
  {
    type: "resize",
    enabled: true,
    options: { targetDpi: 300, maxDimension: 4000 },
  },
  { type: "deskew", enabled: true, options: { maxDeskewAngle: 15 } },
  { type: "adaptiveThreshold", enabled: true },
  { type: "sharpen", enabled: true, options: { sharpenSigma: 1.0 } },
];

/**
 * Quality preset: Full preprocessing pipeline
 * Best for: Poor lighting, shadows, heavily skewed documents
 * Steps: All 8 preprocessing steps
 * Latency: ~200-400ms
 */
const QUALITY_PIPELINE: PreprocessingStep[] = [
  { type: "grayscale", enabled: true },
  {
    type: "resize",
    enabled: true,
    options: { targetDpi: 300, maxDimension: 4000 },
  },
  { type: "deskew", enabled: true, options: { maxDeskewAngle: 15 } },
  { type: "shadowRemoval", enabled: true },
  { type: "adaptiveThreshold", enabled: true },
  {
    type: "noiseReduction",
    enabled: true,
    options: { noiseReductionStrength: 3 },
  },
  { type: "sharpen", enabled: true, options: { sharpenSigma: 1.2 } },
  { type: "cropToBorders", enabled: true },
];

/**
 * Map of preset names to their pipeline configurations
 */
export const PREPROCESSING_PRESETS: Record<
  PreprocessingPreset,
  PreprocessingStep[]
> = {
  fast: FAST_PIPELINE,
  balanced: BALANCED_PIPELINE,
  quality: QUALITY_PIPELINE,
  custom: [], // Empty - user provides their own pipeline
};

/**
 * Get the pipeline for a given preset
 */
export function getPipelineForPreset(
  preset: PreprocessingPreset,
): PreprocessingStep[] {
  return PREPROCESSING_PRESETS[preset] || BALANCED_PIPELINE;
}

/**
 * Create a preprocessing config from a preset
 */
export function createConfigFromPreset(
  preset: PreprocessingPreset,
  enabled: boolean = true,
): PreprocessingConfig {
  return {
    enabled,
    preset,
    pipeline: getPipelineForPreset(preset),
  };
}

/**
 * Default preprocessing configuration
 */
export const DEFAULT_PREPROCESSING_CONFIG: PreprocessingConfig = {
  enabled: true,
  preset: "balanced",
  pipeline: BALANCED_PIPELINE,
};

/**
 * Disabled preprocessing configuration
 */
export const DISABLED_PREPROCESSING_CONFIG: PreprocessingConfig = {
  enabled: false,
  preset: "balanced",
  pipeline: [],
};
