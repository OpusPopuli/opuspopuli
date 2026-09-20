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

// Content-byte helpers. Exported because a consumer that re-derives text from
// archived bytes must decode them EXACTLY as the fetch path did before hashing
// (#1276) — a second implementation would drift, and the hash check that makes
// re-derivation trustworthy would start failing for no visible reason.
export { decodeUtf8, hashContentBytes } from "./utils/content-bytes.js";
