/**
 * @opuspopuli/embeddings-provider
 *
 * Embeddings provider implementations for the QCKSTRT platform.
 * Supports Xenova (in-process) and Ollama (local server) providers.
 */

// Re-export types from common
export {
  IEmbeddingProvider,
  ChunkingConfig,
  EmbeddingResult,
  EmbeddingError,
} from "@opuspopuli/common";

// Provider implementations
export { XenovaEmbeddingProvider } from "./providers/xenova.provider.js";
export { OllamaEmbeddingProvider } from "./providers/ollama.provider.js";

// Service and module
export { EmbeddingsService } from "./embeddings.service.js";
export { EmbeddingsModule } from "./embeddings.module.js";
