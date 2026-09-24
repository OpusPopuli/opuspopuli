/**
 * @opuspopuli/llm-provider
 *
 * LLM provider implementations for the Opus Populi platform.
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
  // Exported so the eval harness measures truncation by the SAME rule the
  // provider enforces it by. Two copies of the threshold would let the harness
  // bless a window the provider flags as truncated.
  CHARS_PER_TOKEN_ESTIMATE,
  MIN_PROMPT_COVERAGE,
} from "./providers/ollama.provider.js";

// Context-window validation, shared with the eval harness so `--num-ctx` is
// held to the same rule as the deployed setting.
export {
  resolveContextTokens,
  contextTokensWarning,
  MIN_CONTEXT_TOKENS,
} from "./context-tokens.js";

// NestJS module
export { LLMModule } from "./llm.module.js";
