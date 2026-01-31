// Re-export types from common
export {
  IOcrProvider,
  OcrInput,
  OcrResult,
  OcrTextBlock,
  OcrBoundingBox,
  OcrError,
  UnsupportedMimeTypeError,
} from "@qckstrt/common";

// Provider implementations
export { TesseractOcrProvider } from "./providers/tesseract.provider.js";

// Service and module
export { OcrService } from "./ocr.service.js";
export { OcrModule, OcrModuleConfig } from "./ocr.module.js";
