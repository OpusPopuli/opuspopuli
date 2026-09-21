import { registerAs } from "@nestjs/config";

/**
 * LLM Configuration
 *
 * Maps LLM_* environment variables to nested config.
 *
 * ## Two jobs, two models (#1212 eval session, roadmap §6.4)
 *
 * Inference splits into two workloads with genuinely different requirements,
 * and a single pin cannot serve both:
 *
 * - **Analysis / synthesis** — proposition analysis, minutes summaries, bios,
 *   RAG. Accuracy-bound: the task is copying a passage verbatim and declining
 *   when the source does not support a claim. Measured on `olmo-3.1:32b-instruct`
 *   at 57% claim anchoring against the 7B's 28%, 96% operative-law citation
 *   against 88%, and correct abstention on every measure where the 7B
 *   fabricated a fiscal impact. Costs ~550 s/measure and ~21.4 GB resident.
 *
 * - **Ingestion** — structural analysis, civics extraction, detail crawling,
 *   PDF extraction. Throughput-bound and run across far more documents, where
 *   what matters is reliable JSON rather than verbatim fidelity.
 *   `olmo-3:7b-instruct` returned 10/10 valid JSON with zero fabricated
 *   figures at ~52 s/measure and ~4.5 GB.
 *
 * The ingestion values **fall back to the shared ones**, so this is inert
 * until it is configured — the split costs nothing to carry and nothing
 * changes for a deployment that does not use it.
 *
 * The URL is separate as well as the model, deliberately. The two models are
 * intended to end up on different machines (7B on the Mini, 32B on the
 * Studio); until then they share one endpoint, and that is a config value
 * rather than another code change. `OCR_VISION_MODEL`/`OCR_VISION_URL` set the
 * same precedent for the same reason (#1050).
 *
 * **Running both on one host is the condition that produced the 550 s
 * figure.** Throughput degraded from 2m17s to 11m46s per measure *within a
 * single run* under memory pressure, and 21.4 GB + 4.5 GB resident together is
 * exactly that. `OLLAMA_MAX_LOADED_MODELS` and keep-alive behaviour matter
 * more than these pins do while the two share a machine.
 */
export const llmConfig = registerAs("llm", () => ({
  url: process.env.LLM_URL || "http://localhost:11434",
  model: process.env.LLM_MODEL || "mistral",
  ollama: {
    url:
      process.env.LLM_OLLAMA_URL ||
      process.env.LLM_URL ||
      "http://localhost:11434",
    model: process.env.LLM_OLLAMA_MODEL || process.env.LLM_MODEL || "mistral",
  },
  /**
   * The ingestion lane. Falls back to the analysis values at every level, so
   * an unset deployment behaves exactly as it did before the split.
   */
  ingestion: {
    url:
      process.env.LLM_INGESTION_URL ||
      process.env.LLM_OLLAMA_URL ||
      process.env.LLM_URL ||
      "http://localhost:11434",
    model:
      process.env.LLM_INGESTION_MODEL ||
      process.env.LLM_OLLAMA_MODEL ||
      process.env.LLM_MODEL ||
      "mistral",
  },
}));
