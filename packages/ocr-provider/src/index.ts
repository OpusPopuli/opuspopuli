// Re-export types from common
export {
  IOcrProvider,
  OcrInput,
  OcrResult,
  OcrTextBlock,
  OcrBoundingBox,
  OcrError,
  UnsupportedMimeTypeError,
  OcrPreprocessingMetadata,
} from "@opuspopuli/common";

// Provider implementations
export { TesseractOcrProvider } from "./providers/tesseract.provider.js";

// Service and module
export { OcrService } from "./ocr.service.js";
export { OcrModule, OcrModuleConfig } from "./ocr.module.js";

// Preprocessing
export {
  ImagePreprocessor,
  PreprocessingConfig,
  PreprocessingStep,
  PreprocessingStepType,
  PreprocessingStepOptions,
  PreprocessingPreset,
  PreprocessingResult,
  PreprocessingMetadata,
  PREPROCESSING_PRESETS,
  getPipelineForPreset,
  createConfigFromPreset,
  DEFAULT_PREPROCESSING_CONFIG,
  DISABLED_PREPROCESSING_CONFIG,
  detectSkewAngle,
  needsDeskew,
} from "./preprocessing/index.js";
