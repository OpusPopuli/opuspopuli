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
    // v2-moe, NOT plain `nomic-embed-text` (which is v1.5). The two are
    // different models, and v1.5 is not a fallback: measured over the real
    // 64-proposition corpus it scored 0/14 top-1 (MRR 0.108) because every
    // AG ballot title shares the same boilerplate and v1.5's similarity
    // space saturates on it — corpus pairwise cosine mean 0.942, i.e. every
    // measure looks like every other. See packages/eval-harness.
    model:
      process.env.EMBEDDINGS_OLLAMA_MODEL || "nomic-embed-text-v2-moe:latest",
  },
  xenova: {
    model: process.env.EMBEDDINGS_XENOVA_MODEL || "Xenova/all-MiniLM-L6-v2",
  },
}));
