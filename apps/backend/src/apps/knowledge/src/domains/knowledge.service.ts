import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmbeddingsService } from '@opuspopuli/embeddings-provider';
import { IVectorDBProvider } from '@opuspopuli/vectordb-provider';
import { ILLMProvider } from '@opuspopuli/llm-provider';
import { PromptClientService } from '@opuspopuli/prompt-client';
import {
  SearchResult,
  PaginatedSearchResults,
} from './models/search-result.model';

/**
 * Knowledge Service
 *
 * Handles semantic search and RAG (Retrieval-Augmented Generation) operations.
 * Uses pluggable providers for vector database and LLM.
 */
@Injectable()
export class KnowledgeService {
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
  async answerQuery(userId: string, query: string): Promise<string> {
    try {
      // Step 1: Retrieve relevant context via semantic search
      const contextChunks = await this.semanticSearch(userId, query, 3);

      this.logger.log(
        `Retrieved ${contextChunks.length} context chunks for RAG`,
      );

      if (contextChunks.length === 0) {
        return 'I could not find any relevant information to answer your question.';
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
        maxTokens: 500,
        temperature: 0.3,
        topP: 0.9,
      });

      this.logger.log(
        `Generated answer: ${result.text.length} chars (${result.tokensUsed || 'unknown'} tokens)`,
      );

      return result.text;
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
      this.logger.error('Error in semantic search:', error);
      return [];
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
