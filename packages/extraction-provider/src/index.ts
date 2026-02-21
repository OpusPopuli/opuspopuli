/**
 * Text Extraction Provider Package
 *
 * Strategy Pattern + Dependency Injection for text extraction.
 * Supports multiple sources: URLs, local files, object storage, etc.
 */

// Re-export types from common
export {
  ITextExtractor,
  TextExtractionInput,
  TextExtractionResult,
  NoExtractorFoundError,
  ExtractionError,
} from "@opuspopuli/common";

// Provider types
export * from "./types.js";

// Cache utilities
export * from "./cache/index.js";

// Utility functions
export * from "./utils/index.js";

// Main provider
export * from "./extraction.provider.js";

// Extractor implementations
export * from "./extractors/url.extractor.js";

// Service
export * from "./extraction.service.js";

// NestJS Module
export * from "./extraction.module.js";
