import { Injectable, Logger } from "@nestjs/common";
import {
  IVectorDBProvider,
  IVectorDocument,
  VectorDBError,
} from "@opuspopuli/common";
import { IRawQueryClient } from "../types.js";

/**
 * PostgreSQL pgvector Vector Database Provider
 *
 * Uses PostgreSQL with the pgvector extension for vector storage and similarity search.
 * This consolidates the database architecture by using the same PostgreSQL instance
 * for both relational and vector data.
 *
 * Prerequisites:
 * 1. PostgreSQL 12+ with pgvector extension installed
 * 2. Run: CREATE EXTENSION IF NOT EXISTS vector;
 *
 * Pros:
 * - Single database for all data (simpler architecture)
 * - ACID transactions with vector operations
 * - Familiar PostgreSQL tooling and backup strategies
 * - Integrates with existing Supabase/PostgreSQL setup
 *
 * Cons:
 * - May not scale as well as dedicated vector DBs for very large datasets
 * - Requires pgvector extension installation
 */
@Injectable()
export class PgVectorProvider implements IVectorDBProvider {
  private readonly logger = new Logger(PgVectorProvider.name);
  private dimensions: number;
  private tableName: string;

  constructor(
    private readonly client: IRawQueryClient,
    private readonly collectionName: string,
    dimensions: number = 384, // Default for Xenova/all-MiniLM-L6-v2
  ) {
    this.dimensions = dimensions;
    // Sanitize collection name for use as table name
    this.tableName = `${collectionName.replace(/[^a-zA-Z0-9_]/g, "_")}_vectors`;

    this.logger.log(
      `PgVector provider initialized with table: ${this.tableName}, dimensions: ${dimensions}`,
    );
  }

  getName(): string {
    return "PgVector";
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async initialize(): Promise<void> {
    try {
      this.logger.log(`Initializing pgvector table: ${this.tableName}`);

      // Ensure pgvector extension is enabled
      await this.client.$executeRawUnsafe(
        `CREATE EXTENSION IF NOT EXISTS vector`,
      );

      // Create the embeddings table if it doesn't exist
      await this.client.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${this.tableName}" (
          id VARCHAR(255) PRIMARY KEY,
          document_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          embedding vector(${this.dimensions}) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // Create indexes for efficient querying
      // Using ivfflat for approximate nearest neighbor search
      await this.client.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "${this.tableName}_embedding_idx"
        ON "${this.tableName}"
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      await this.client.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "${this.tableName}_document_id_idx"
        ON "${this.tableName}" (document_id)
      `);

      await this.client.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "${this.tableName}_user_id_idx"
        ON "${this.tableName}" (user_id)
      `);

      this.logger.log(
        `PgVector table "${this.tableName}" initialized successfully`,
      );
    } catch (error) {
      this.logger.error("Failed to initialize pgvector table:", error);
      throw new VectorDBError(this.getName(), "initialize", error as Error);
    }
  }

  async createEmbeddings(
    userId: string,
    documentId: string,
    embeddings: number[][],
    content: string[],
  ): Promise<boolean> {
    try {
      this.logger.log(
        `Creating ${embeddings.length} embeddings for document ${documentId}`,
      );

      // Process in batches to avoid parameter limits
      const batchSize = 100;
      for (let i = 0; i < embeddings.length; i += batchSize) {
        const endIdx = Math.min(i + batchSize, embeddings.length);

        this.logger.log(
          `Adding batch ${Math.floor(i / batchSize) + 1}: ${endIdx - i} embeddings`,
        );

        // Build batch insert with proper escaping
        const values: string[] = [];
        const params: (string | number)[] = [];
        let paramIndex = 1;

        for (let j = i; j < endIdx; j++) {
          const id = `${documentId}-${j}`;
          const embeddingStr = `[${embeddings[j].join(",")}]`;

          values.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}::vector)`,
          );
          params.push(id, documentId, userId, content[j], embeddingStr);
          paramIndex += 5;
        }

        await this.client.$executeRawUnsafe(
          `
          INSERT INTO "${this.tableName}" (id, document_id, user_id, content, embedding)
          VALUES ${values.join(", ")}
          ON CONFLICT (id) DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            created_at = NOW()
        `,
          ...params,
        );
      }

      this.logger.log(
        `Successfully added ${embeddings.length} embeddings for document ${documentId}`,
      );

      return true;
    } catch (error) {
      this.logger.error("Error creating embeddings in pgvector:", error);
      throw new VectorDBError(
        this.getName(),
        "createEmbeddings",
        error as Error,
      );
    }
  }

  async queryEmbeddings(
    queryEmbedding: number[],
    userId: string,
    nResults: number = 5,
  ): Promise<IVectorDocument[]> {
    try {
      this.logger.log(`Querying pgvector for top ${nResults} results`);

      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      // Use cosine distance for similarity search
      // pgvector uses <=> for cosine distance (lower is more similar)
      const results = await this.client.$queryRawUnsafe<{
        id: string;
        document_id: string;
        user_id: string;
        content: string;
        embedding_text: string;
        similarity: number;
      }>(
        `
        SELECT
          id,
          document_id,
          user_id,
          content,
          embedding::text as embedding_text,
          1 - (embedding <=> $1::vector) as similarity
        FROM "${this.tableName}"
        WHERE user_id = $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `,
        embeddingStr,
        userId,
        nResults,
      );

      // Transform results into IVectorDocument format
      const documents: IVectorDocument[] = results.map((row) => ({
        id: row.id,
        embedding: this.parseEmbedding(row.embedding_text),
        metadata: {
          source: row.document_id,
          userId: row.user_id,
        },
        content: row.content,
        score: row.similarity,
      }));

      this.logger.log(`Found ${documents.length} matching documents`);
      return documents;
    } catch (error) {
      this.logger.error("Error querying embeddings from pgvector:", error);
      throw new VectorDBError(
        this.getName(),
        "queryEmbeddings",
        error as Error,
      );
    }
  }

  async deleteEmbeddingsByDocumentId(documentId: string): Promise<void> {
    try {
      this.logger.log(`Deleting embeddings for document ${documentId}`);

      await this.client.$executeRawUnsafe(
        `DELETE FROM "${this.tableName}" WHERE document_id = $1`,
        documentId,
      );

      this.logger.log(`Deleted embeddings for document ${documentId}`);
    } catch (error) {
      this.logger.error("Error deleting embeddings from pgvector:", error);
      throw new VectorDBError(
        this.getName(),
        "deleteEmbeddingsByDocumentId",
        error as Error,
      );
    }
  }

  async deleteEmbeddingById(id: string): Promise<void> {
    try {
      this.logger.log(`Deleting embedding ${id}`);

      await this.client.$executeRawUnsafe(
        `DELETE FROM "${this.tableName}" WHERE id = $1`,
        id,
      );

      this.logger.log(`Deleted embedding ${id}`);
    } catch (error) {
      this.logger.error("Error deleting embedding from pgvector:", error);
      throw new VectorDBError(
        this.getName(),
        "deleteEmbeddingById",
        error as Error,
      );
    }
  }

  /**
   * Parse embedding string from PostgreSQL vector type
   * Format: "[0.1,0.2,0.3,...]"
   */
  private parseEmbedding(embeddingText: string): number[] {
    try {
      // Remove brackets and split by comma
      const cleaned = embeddingText.replace(/(^\[)|(\]$)/g, "");
      return cleaned.split(",").map((v) => Number.parseFloat(v.trim()));
    } catch {
      return [];
    }
  }
}
