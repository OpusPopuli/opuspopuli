/**
 * Vector Database Types and Interfaces
 *
 * Strategy Pattern for vector database operations.
 * Default implementation uses pgvector (PostgreSQL extension).
 */

/**
 * Vector document stored in the database
 */
export interface IVectorDocument {
  id: string;
  embedding: number[];
  metadata: {
    source: string; // Document ID
    userId: string;
    [key: string]: unknown; // Additional metadata
  };
  content: string; // Text content
  score?: number; // Optional similarity score (0-1, higher is more similar)
}

/**
 * Query result from vector search
 */
export interface IVectorQueryResult {
  documents: IVectorDocument[];
  distances?: number[]; // Optional similarity scores
}

/**
 * Strategy interface for vector database providers
 */
export interface IVectorDBProvider {
  /**
   * Initialize the vector database connection
   */
  initialize(): Promise<void>;

  /**
   * Create/store embeddings for document chunks
   */
  createEmbeddings(
    userId: string,
    documentId: string,
    embeddings: number[][],
    content: string[],
    /**
     * Model that produced these vectors (#1289).
     *
     * Supplied by the caller rather than resolved here: the authoritative
     * value is what the embeddings provider reports at runtime, and deriving
     * it from config in this layer would duplicate the provider-selection
     * logic and let the two drift.
     */
    embeddingModel: string,
  ): Promise<boolean>;

  /**
   * Query similar vectors (semantic search)
   */
  queryEmbeddings(
    queryEmbedding: number[],
    userId: string,
    nResults?: number,
    /**
     * Restrict the search to vectors produced by this model (#1289).
     *
     * Cosine distance between two models' vectors is a number, not a
     * measurement — the spaces are unrelated, so an unfiltered search returns
     * an arbitrary nearest neighbour that looks exactly like a real match.
     * Optional so existing callers keep compiling, but a caller that omits it
     * is asking for a ranking it cannot trust.
     */
    embeddingModel?: string,
  ): Promise<IVectorDocument[]>;

  /**
   * Delete all embeddings for a document
   */
  deleteEmbeddingsByDocumentId(documentId: string): Promise<void>;

  /**
   * Delete a specific embedding by ID
   */
  deleteEmbeddingById(id: string): Promise<void>;

  /**
   * Get the provider name for logging
   */
  getName(): string;

  /**
   * Get the vector dimensions supported by this provider
   */
  getDimensions(): number;
}

/**
 * Exception thrown when vector DB operations fail
 */
export class VectorDBError extends Error {
  constructor(
    public provider: string,
    public operation: string,
    public originalError: Error,
  ) {
    super(
      `Vector DB operation '${operation}' failed in ${provider}: ${originalError.message}`,
    );
    this.name = "VectorDBError";
  }
}
