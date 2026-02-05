import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IEmbeddingProvider, ChunkingConfig } from "@opuspopuli/common";
import { EmbeddingsService } from "./embeddings.service.js";
import { OllamaEmbeddingProvider } from "./providers/ollama.provider.js";
import { XenovaEmbeddingProvider } from "./providers/xenova.provider.js";

/**
 * Embeddings Module
 *
 * Configures Dependency Injection for embedding providers.
 *
 * To swap providers, change the EMBEDDING_PROVIDER factory:
 * - Xenova (default, OSS, in-process, no external services)
 * - Ollama (OSS, local server, GPU-accelerated)
 * - Add your own implementation of IEmbeddingProvider
 */
@Module({
  providers: [
    // Chunking configuration
    {
      provide: "CHUNKING_CONFIG",
      useFactory: (configService: ConfigService): ChunkingConfig => ({
        chunkSize: configService.get<number>("embeddings.chunkSize") || 1000,
        chunkOverlap:
          configService.get<number>("embeddings.chunkOverlap") || 200,
      }),
      inject: [ConfigService],
    },

    // Embedding provider selection
    {
      provide: "EMBEDDING_PROVIDER",
      useFactory: (configService: ConfigService): IEmbeddingProvider => {
        const provider =
          configService.get<string>("embeddings.provider") || "xenova";

        switch (provider.toLowerCase()) {
          case "ollama":
            // OSS: Use local Ollama server
            const ollamaUrl =
              configService.get<string>("embeddings.ollama.url") ||
              "http://localhost:11434";
            const ollamaModel =
              configService.get<string>("embeddings.ollama.model") ||
              "nomic-embed-text";

            return new OllamaEmbeddingProvider(ollamaUrl, ollamaModel);

          case "xenova":
          default:
            // OSS: Use Xenova/Transformers.js (default, runs in-process)
            const xenovaModel =
              configService.get<string>("embeddings.xenova.model") ||
              "Xenova/all-MiniLM-L6-v2";

            return new XenovaEmbeddingProvider(xenovaModel);
        }
      },
      inject: [ConfigService],
    },

    // Main embeddings service
    {
      provide: EmbeddingsService,
      useFactory: (provider: IEmbeddingProvider, config: ChunkingConfig) => {
        return new EmbeddingsService(provider, config);
      },
      inject: ["EMBEDDING_PROVIDER", "CHUNKING_CONFIG"],
    },
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
