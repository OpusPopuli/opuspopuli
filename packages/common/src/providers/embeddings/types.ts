/**
 * Embeddings Types and Interfaces
 *
 * Strategy Pattern for embedding generation.
 * Supports swapping between OpenAI, Ollama, FastEmbed, etc.
 */

/**
 * Configuration for text chunking
 */
export interface ChunkingConfig {
  chunkSize: number;
  chunkOverlap: number;
}

/**
 * Result of embedding generation
 */
export interface EmbeddingResult {
  texts: string[]; // Text chunks
  embeddings: number[][]; // Vector embeddings for each chunk
  model: string; // Model used for embedding
  dimensions: number; // Vector dimensions
}

/**
 * Strategy interface for embedding providers
 */
export interface IEmbeddingProvider {
  /**
   * Generate embeddings for multiple text chunks
   */
  embedDocuments(texts: string[]): Promise<number[][]>;

  /**
   * Generate embedding for a single query
   */
  embedQuery(query: string): Promise<number[]>;

  /**
   * Get the model name
   */
  getModelName(): string;

  /**
   * Get embedding dimensions
   */
  getDimensions(): number;

  /**
   * Provider name for logging
   */
  getName(): string;

  /**
   * Fail at startup if the provider cannot actually serve embeddings.
   *
   * Optional because "ready" means nothing for an in-process provider: it
   * downloads its model on first use, so an absent model is a slow first call,
   * not a misconfiguration. A remote provider is different — a model that was
   * never pulled is a DEPLOY mistake that will never self-heal, and without
   * this it surfaces only as a per-row failure at embed time, behind a healthy
   * health check.
   *
   * Implementations must distinguish "reachable but not configured correctly"
   * from "unreachable". The first should throw; the second should not, because
   * a daemon that is briefly down recovers on its own and the circuit breaker
   * already handles it — turning that into a refusal to boot converts a
   * transient blip into a crash loop.
   */
  assertReady?(): Promise<void>;
}

/**
 * Exception thrown when embedding fails
 */
export class EmbeddingError extends Error {
  constructor(
    public provider: string,
    public originalError: Error,
  ) {
    super(`Embedding failed in ${provider}: ${originalError.message}`);
    this.name = "EmbeddingError";
  }
}
