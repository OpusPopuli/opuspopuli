import { Injectable, Logger } from "@nestjs/common";
import { IEmbeddingProvider, EmbeddingError } from "@opuspopuli/common";

/**
 * Xenova Embedding Provider (OSS, In-Process)
 *
 * Uses Xenova/Transformers.js for fully in-process embedding generation.
 * No external services required - runs entirely in Node.js.
 *
 * Models: Xenova/bge-base-en-v1.5 (default, 768d), Xenova/all-mpnet-base-v2
 * (768d). The 384d models (all-MiniLM-L6-v2, bge-small-en-v1.5) no longer fit
 * the schema — see EMBEDDING_DIMENSIONS in @opuspopuli/common.
 *
 * Setup:
 * 1. npm install @xenova/transformers
 * 2. First run will download model (~110MB for bge-base-en-v1.5)
 * 3. Models are cached locally for subsequent runs
 *
 * Advantages:
 * - No external services needed (unlike Ollama)
 * - Fast inference for small batches
 * - Models auto-download and cache
 * - Cross-platform (works anywhere Node.js runs)
 *
 * Trade-offs:
 * - Slower than GPU-accelerated Ollama for large batches
 * - Limited to ONNX-compatible models
 * - Higher memory usage (model loaded in-process)
 */
@Injectable()
export class XenovaEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(XenovaEmbeddingProvider.name);
  private model: string;
  private dimensions: number;
  private pipeline: unknown;
  private initialized = false;

  constructor(model?: string) {
    // bge-base-en-v1.5 (768 dimensions, ~110MB).
    //
    // Was all-MiniLM-L6-v2 at 384. After the #1156 cutover EMBEDDING_DIMENSIONS
    // is 768 and every selectable provider must produce that width, so MiniLM
    // would now trip the startup assertion rather than quietly working.
    //
    // This default must stay in step with `embeddings.xenova.model` in
    // config-provider. Two defaults for one model is how the Ollama provider
    // ended up disagreeing with its own config (#1231), and a divergence here
    // is invisible: whichever construction path a caller happens to use wins,
    // and the fixture generator uses this one.
    this.model = model || "Xenova/bge-base-en-v1.5";

    // Set dimensions based on model
    // Common models:
    // - Xenova/all-MiniLM-L6-v2: 384 dimensions
    // - Xenova/bge-small-en-v1.5: 384 dimensions
    // - Xenova/all-mpnet-base-v2: 768 dimensions
    this.dimensions = this.getDimensionsForModel(this.model);

    this.logger.log(
      `Initializing Xenova embeddings with model: ${this.model} (${this.dimensions}d)`,
    );
  }

  private getDimensionsForModel(model: string): number {
    if (model.includes("mpnet-base")) return 768;
    if (model.includes("MiniLM-L6")) return 384;
    if (model.includes("bge-small")) return 384;
    if (model.includes("bge-base")) return 768;
    return 384; // Default
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      this.logger.log("Loading Transformers.js pipeline...");

      // Dynamic import to avoid bundling issues
      const { pipeline } = await import("@xenova/transformers");

      // Initialize the feature extraction pipeline
      // On first run, this will download the model
      this.pipeline = await pipeline("feature-extraction", this.model);

      this.initialized = true;
      this.logger.log("Xenova pipeline initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Xenova pipeline:", error);
      throw new Error(
        `Xenova initialization failed: ${(error as Error).message}. Ensure @xenova/transformers is installed.`,
      );
    }
  }

  getName(): string {
    return "Xenova";
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    try {
      await this.ensureInitialized();

      this.logger.log(`Embedding ${texts.length} documents with Xenova`);

      const embeddings: number[][] = [];

      // Process in batches for better performance
      const batchSize = 32;
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);

        for (const text of batch) {
          const embedding = await this.embed(text);
          embeddings.push(embedding);
        }

        if (i + batchSize < texts.length) {
          this.logger.log(
            `Embedded ${i + batch.length}/${texts.length} documents`,
          );
        }
      }

      this.logger.log(`Successfully embedded ${texts.length} documents`);
      return embeddings;
    } catch (error) {
      this.logger.error("Xenova document embedding failed:", error);
      throw new EmbeddingError(this.getName(), error as Error);
    }
  }

  async embedQuery(query: string): Promise<number[]> {
    try {
      await this.ensureInitialized();

      this.logger.log("Embedding query with Xenova");
      return await this.embed(query);
    } catch (error) {
      this.logger.error("Xenova query embedding failed:", error);
      throw new EmbeddingError(this.getName(), error as Error);
    }
  }

  private async embed(text: string): Promise<number[]> {
    // Generate embedding using the pipeline
    const pipelineFn = this.pipeline as (
      text: string,
      options: { pooling: string; normalize: boolean },
    ) => Promise<{ data: ArrayLike<number> }>;

    const output = await pipelineFn(text, {
      pooling: "mean", // Mean pooling
      normalize: true, // L2 normalization
    });

    // Convert to regular array
    const embedding = Array.from(output.data) as number[];

    return embedding;
  }
}
