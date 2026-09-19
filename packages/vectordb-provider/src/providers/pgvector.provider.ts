import { EMBEDDING_DIMENSIONS } from "@opuspopuli/common";
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
    // 768 since the #1156 cutover. The old 384 default named MiniLM, which no
    // selectable provider produces any more — a fallback that fires would
    // create a table the running model cannot insert into.
    dimensions: number = EMBEDDING_DIMENSIONS,
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
          -- Which model produced this vector (#1289). Without it a model
          -- swap leaves a corpus whose mixed state cannot even be detected,
          -- let alone excluded from a ranking.
          embedding_model VARCHAR(80),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // This table is created by the provider rather than by a migration, so
      // a deployment that already ran an older version has one without the
      // column. Nullable and added separately: existing rows genuinely do
      // not know which model produced them, and a default would assert
      // otherwise.
      await this.client.$executeRawUnsafe(`
        ALTER TABLE "${this.tableName}"
        ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(80)
      `);

      // HNSW, not IVFFlat (#1150).
      //
      // IVFFlat trains its centroids from the rows present WHEN THE INDEX IS
      // BUILT. This runs at service init, against a table created moments
      // earlier — so the index was always trained on zero rows and stayed
      // degenerate until someone rebuilt it, which nothing does. Recall
      // silently suffers; nothing errors.
      //
      // That is the exact failure the propositions migration
      // (20260828000000_proposition_embeddings) chose HNSW to avoid; the
      // knowledge path never got the same treatment. HNSW builds
      // incrementally and is correct on an empty table.
      await this.client.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "${this.tableName}_embedding_hnsw_idx"
        ON "${this.tableName}"
        USING hnsw (embedding vector_cosine_ops)
      `);

      // Retire the degenerate IVFFlat index from installs that predate the
      // switch. Dropped only AFTER the replacement exists, so no query is
      // ever left without an index to use.
      await this.client.$executeRawUnsafe(`
        DROP INDEX IF EXISTS "${this.tableName}_embedding_idx"
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
    embeddingModel: string,
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
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}::vector, $${paramIndex + 5})`,
          );
          params.push(
            id,
            documentId,
            userId,
            content[j],
            embeddingStr,
            embeddingModel,
          );
          paramIndex += 6;
        }

        await this.client.$executeRawUnsafe(
          `
          INSERT INTO "${this.tableName}" (id, document_id, user_id, content, embedding, embedding_model)
          VALUES ${values.join(", ")}
          ON CONFLICT (id) DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            embedding_model = EXCLUDED.embedding_model,
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
    embeddingModel?: string,
  ): Promise<IVectorDocument[]> {
    try {
      this.logger.log(`Querying pgvector for top ${nResults} results`);

      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      // Rank only within one model's vector space when the caller names one
      // (#1289).
      //
      // Cosine distance between vectors from two different models is a number,
      // not a measurement: the spaces are unrelated, so the nearest row is
      // arbitrary while looking exactly like a real match. Omitting the model
      // preserves the old behaviour for any caller that has not been updated,
      // which is a ranking that cannot be trusted across a model change.
      //
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
          AND ($4::text IS NULL OR embedding_model = $4)
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `,
        embeddingStr,
        userId,
        nResults,
        embeddingModel ?? null,
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
