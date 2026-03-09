import { registerAs } from "@nestjs/config";

/**
 * Embeddings Configuration
 *
 * Maps EMBEDDINGS_* environment variables to nested config.
 */
export const embeddingsConfig = registerAs("embeddings", () => ({
  provider: process.env.EMBEDDINGS_PROVIDER || "xenova",
  chunkSize: Number.parseInt(process.env.EMBEDDINGS_CHUNK_SIZE || "1000", 10),
  chunkOverlap: Number.parseInt(
    process.env.EMBEDDINGS_CHUNK_OVERLAP || "200",
    10,
  ),
  ollama: {
    url: process.env.EMBEDDINGS_OLLAMA_URL || "http://localhost:11434",
    model: process.env.EMBEDDINGS_OLLAMA_MODEL || "nomic-embed-text",
  },
  xenova: {
    model: process.env.EMBEDDINGS_XENOVA_MODEL || "Xenova/all-MiniLM-L6-v2",
  },
}));
