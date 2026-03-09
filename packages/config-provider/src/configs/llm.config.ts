import { registerAs } from "@nestjs/config";

/**
 * LLM Configuration
 *
 * Maps LLM_* environment variables to nested config.
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
}));
