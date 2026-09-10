import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import { IVectorDBProvider } from '@opuspopuli/vectordb-provider';
import { ILLMProvider } from '@opuspopuli/llm-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';
import {
  SearchResult,
  PaginatedSearchResults,
} from './models/search-result.model';
import { QueryResult } from './models/query-result.model';

function parseRagResponse(text: string): QueryResult {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped) as unknown;
    const p = parsed as Record<string, unknown>;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof p.answer === 'string' &&
      Array.isArray(p.sourcedFrom) &&
      (p.sourcedFrom as unknown[]).every((s) => typeof s === 'string')
    ) {
      return {
        answer: p.answer as string,
        sourcedFrom: p.sourcedFrom as string[],
      };
    }
  } catch {
    // fall through — treat unparseable output as plain-text answer
  }
  return { answer: stripped, sourcedFrom: [] };
}

/**
 * Knowledge Service
 *
 * Handles semantic search and RAG (Retrieval-Augmented Generation) operations.
 * Uses pluggable providers for vector database and LLM.
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name, {
    timestamp: true,
  });

  constructor(
    @Inject() private embeddingsService: EmbeddingsService,
    @Inject('VECTOR_DB_PROVIDER') private vectorDB: IVectorDBProvider,
    @Inject('LLM_PROVIDER') private llm: ILLMProvider,
    private readonly promptClient: PromptClientService,
  ) {
    this.logger.log(
      `KnowledgeService initialized with vector DB: ${this.vectorDB.getName()}, LLM: ${this.llm.getName()}/${this.llm.getModelName()}`,
    );
  }

  /**
   * Fail at boot if the embeddings provider and the vector store disagree
   * about vector width (#1150).
   *
   * `VECTORDB_DIMENSIONS` is read independently of `EMBEDDINGS_PROVIDER`, so
   * the two can be configured apart. When they are, the failure is a runtime
   * insert error buried per-document, or a silently empty retrieval — the
   * vector(1536)-vs-384 incident that prompted the region path's identical
   * assertion (#1074, proposition-embedding.service.ts). The knowledge path
   * never got one.
   *
   * A boot failure is the correct blast radius: a mismatch means every
   * embedding written from now on is unusable, and nothing downstream can
   * detect that.
   */
  onModuleInit(): void {
    const providerWidth = this.embeddingsService.getProviderInfo().dimensions;
    const storeWidth = this.vectorDB.getDimensions();

    if (providerWidth !== storeWidth) {
      throw new Error(
        `Embeddings provider produces ${providerWidth}-dimension vectors but ` +
          `the vector store expects ${storeWidth}. Align VECTORDB_DIMENSIONS ` +
          `with the configured EMBEDDINGS_PROVIDER; changing model width ` +
          `requires re-embedding the corpus, not just a config edit.`,
      );
    }
  }

  /**
   * Store document embeddings in vector database
   */
  async indexDocument(
    userId: string,
    documentId: string,
    text: string,
  ): Promise<void> {
    this.logger.log(
      `Indexing document ${documentId} for user ${userId} (${text.length} chars)`,
    );

    try {
      // Generate embeddings for the document
      const result = await this.embeddingsService.getEmbeddingsForText(text);

      // Store in vector database (using injected provider)
      await this.vectorDB.createEmbeddings(
        userId,
        documentId,
        result.embeddings,
        result.texts,
      );

      this.logger.log(
        `Indexed ${result.texts.length} chunks for document ${documentId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to index document ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Answer a query using RAG (Retrieval-Augmented Generation)
   *
   * Process:
   * 1. Perform semantic search to retrieve relevant context
   * 2. Build prompt with context and user query
   * 3. Generate answer using LLM
   */
  async answerQuery(userId: string, query: string): Promise<QueryResult> {
    try {
      // Step 1: Retrieve relevant context via semantic search
      const contextChunks = await this.semanticSearch(userId, query, 3);

      this.logger.log(
        `Retrieved ${contextChunks.length} context chunks for RAG`,
      );

      if (contextChunks.length === 0) {
        return {
          answer:
            'I could not find any relevant information to answer your question.',
          sourcedFrom: [],
        };
      }

      // Step 2: Get RAG prompt from database templates
      const context = contextChunks.join('\n\n');
      const { promptText } = await this.promptClient.getRAGPrompt({
        context,
        query,
      });

      this.logger.log(
        `Generating answer with ${this.llm.getName()}/${this.llm.getModelName()}`,
      );

      // Step 3: Generate answer with LLM
      // Lower temperature (0.3) for more factual, consistent responses
      const result = await this.llm.generate(promptText, {
        maxTokens: 600,
        temperature: 0.3,
        topP: 0.9,
      });

      this.logger.log(
        `Generated answer: ${result.text.length} chars (${result.tokensUsed || 'unknown'} tokens)`,
      );

      return parseRagResponse(result.text);
    } catch (error) {
      this.logger.error('RAG answer generation failed:', error);
      throw error;
    }
  }

  /**
   * Search for relevant text chunks with pagination
   */
  async searchText(
    userId: string,
    query: string,
    skip: number = 0,
    take: number = 10,
  ): Promise<PaginatedSearchResults> {
    // Fetch more than needed to determine hasMore
    const fetchCount = skip + take + 1;
    const allResults = await this.semanticSearchWithMetadata(
      userId,
      query,
      fetchCount,
    );

    const paginatedResults = allResults.slice(skip, skip + take);
    const hasMore = allResults.length > skip + take;

    this.logger.log(
      `Found ${paginatedResults.length} relevant chunks (total: ${allResults.length}, hasMore: ${hasMore})`,
    );

    return {
      results: paginatedResults,
      total: allResults.length > fetchCount ? fetchCount : allResults.length,
      hasMore,
    };
  }

  /**
   * Perform semantic search using embeddings (returns text only for RAG)
   */
  private async semanticSearch(
    userId: string,
    query: string,
    count: number = 3,
  ): Promise<string[]> {
    const results = await this.semanticSearchWithMetadata(userId, query, count);
    return results.map((result) => result.content);
  }

  /**
   * Perform semantic search with full metadata
   */
  private async semanticSearchWithMetadata(
    userId: string,
    query: string,
    count: number = 3,
  ): Promise<SearchResult[]> {
    try {
      // Get query embedding
      const queryEmbedding =
        await this.embeddingsService.getEmbeddingsForQuery(query);

      // Query vector database for similar documents
      const results = await this.vectorDB.queryEmbeddings(
        queryEmbedding,
        userId,
        count,
      );

      this.logger.log(`Semantic search returned ${results.length} results`);

      // Transform to SearchResult format
      return results.map((result) => ({
        content: result.content,
        documentId: result.metadata.source,
        score: result.score ?? 0,
      }));
    } catch (error) {
      // Deliberately rethrown, not swallowed (#1150).
      //
      // Returning [] here made a retrieval FAILURE indistinguishable from a
      // genuine no-hit, and the caller then told the user "I could not find
      // any relevant information to answer your question" — which is false.
      // It did not look: the embeddings provider was down, or the vector
      // query errored. Telling someone their question has no answer in the
      // corpus, when the corpus was never consulted, is the worst failure
      // mode a civic-information tool has.
      //
      // Both callers surface it correctly: answerQuery rethrows, searchText
      // has no catch. Same rule the region search service follows.
      this.logger.error(
        `Semantic search failed for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Delete document embeddings from vector database
   */
  async deleteDocumentEmbeddings(
    userId: string,
    documentId: string,
  ): Promise<void> {
    this.logger.log(`Deleting embeddings for document ${documentId}`);

    try {
      await this.vectorDB.deleteEmbeddingsByDocumentId(documentId);
      this.logger.log(`Deleted embeddings for document ${documentId}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete embeddings for document ${documentId}:`,
        error,
      );
      throw error;
    }
  }
}
