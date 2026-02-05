import { Injectable, Logger } from "@nestjs/common";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import {
  IEmbeddingProvider,
  EmbeddingResult,
  ChunkingConfig,
} from "@opuspopuli/common";

/**
 * Embeddings Service
 *
 * Uses Dependency Injection to receive an embedding provider.
 * Provider can be swapped (OpenAI, Ollama, etc.) via DI configuration.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor(
    // DI: Provider is injected (OpenAI, Ollama, etc.)
    private readonly provider: IEmbeddingProvider,
    private readonly chunkingConfig: ChunkingConfig,
  ) {
    this.logger.log(
      `Initialized with ${provider.getName()} provider (model: ${provider.getModelName()}, dimensions: ${provider.getDimensions()})`,
    );

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: chunkingConfig.chunkSize,
      chunkOverlap: chunkingConfig.chunkOverlap,
    });
  }

  /**
   * Generate embeddings for a document
   * Handles chunking automatically
   */
  async getEmbeddingsForText(text: string): Promise<EmbeddingResult> {
    this.logger.log("Generating embeddings for document");

    // Chunk the text
    const chunks = await this.textSplitter.splitText(text);
    this.logger.log(`Split text into ${chunks.length} chunks`);

    // Generate embeddings
    const embeddings = await this.provider.embedDocuments(chunks);

    return {
      texts: chunks,
      embeddings,
      model: this.provider.getModelName(),
      dimensions: this.provider.getDimensions(),
    };
  }

  /**
   * Generate embedding for a query
   */
  async getEmbeddingsForQuery(query: string): Promise<number[]> {
    this.logger.log("Generating embedding for query");
    return this.provider.embedQuery(query);
  }

  /**
   * Get provider information
   */
  getProviderInfo() {
    return {
      name: this.provider.getName(),
      model: this.provider.getModelName(),
      dimensions: this.provider.getDimensions(),
      chunkSize: this.chunkingConfig.chunkSize,
      chunkOverlap: this.chunkingConfig.chunkOverlap,
    };
  }
}
