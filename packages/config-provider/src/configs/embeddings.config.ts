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
    // The model card's `search_document:` / `search_query:` prefixes. Off by
    // default because they were measured, not assumed: 8/8 correct both ways
    // on the proposition corpus, mean margin 0.160 prefixed vs 0.168
    // unprefixed — within noise (#1156, 2026-09-10). Configurable so the
    // question can be re-opened by the eval harness rather than by argument.
    taskPrefixes: process.env.EMBEDDINGS_OLLAMA_TASK_PREFIXES === "true",
    // Texts per /api/embed call. Batching measured ~5x faster than the
    // per-call endpoint it replaced (672ms vs 3393ms over 64 corpus-shaped
    // texts, warm); the bound keeps a thousands-of-rows backfill from becoming
    // one unmeasured request.
    batchSize: Number.parseInt(
      process.env.EMBEDDINGS_OLLAMA_BATCH_SIZE || "64",
      10,
    ),
  },
  xenova: {
    model: process.env.EMBEDDINGS_XENOVA_MODEL || "Xenova/all-MiniLM-L6-v2",
  },
}));
