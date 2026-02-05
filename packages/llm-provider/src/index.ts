/**
 * @opuspopuli/llm-provider
 *
 * LLM provider implementations for the QCKSTRT platform.
 * Currently supports Ollama for self-hosted, open-source inference.
 */

// Re-export types from common
export {
  ILLMProvider,
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  LLMError,
} from "@opuspopuli/common";

// Provider implementations
export {
  OllamaLLMProvider,
  OllamaConfig,
} from "./providers/ollama.provider.js";

// NestJS module
export { LLMModule } from "./llm.module.js";
