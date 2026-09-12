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
    // The zero-setup path, and it stays the DEFAULT on purpose: a fresh clone
    // has to run without an Ollama server and a 957 MB model pull. Production
    // selects ollama explicitly.
    //
    // bge-base-en-v1.5, not all-MiniLM-L6-v2, because after the #1156 cutover
    // EMBEDDING_DIMENSIONS is 768 and every selectable provider must produce
    // that width — MiniLM's 384 would trip the startup assertion.
    //
    // Chosen by measurement over the real proposition corpus, not by width
    // alone (eval-harness, 2026-09-11):
    //
    //                                        overall        EN            ES
    //   bge-base-en-v1.5                   21/22 .977   13/14 m=.112  8/8 m=.061
    //   all-mpnet-base-v2                  17/22 .850   13/14 m=.210  4/8 m=.033
    //   paraphrase-multilingual-mpnet-v2   18/22 .902   10/14 m=.163  8/8 m=.211
    //
    // bge matches nomic's top-1 and MRR exactly. Its Spanish MARGIN is thin at
    // 0.061 — nomic clears by 0.223 — so its ES successes are closer to lucky
    // than to robust, which is precisely the critique that disqualified MiniLM
    // (0.036). Stated plainly because a fallback whose Spanish quietly degrades
    // is worse than one documented as weaker: THE ZERO-SETUP PATH IS NOT ES
    // PARITY. Run the region on ollama + nomic for that.
    model: process.env.EMBEDDINGS_XENOVA_MODEL || "Xenova/bge-base-en-v1.5",
  },
}));
