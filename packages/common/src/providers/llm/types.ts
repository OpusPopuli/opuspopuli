/**
 * LLM (Language Model) Types and Interfaces
 *
 * Strategy Pattern for language model inference.
 * Supports swapping between Ollama (Qwen 3.5), llama.cpp, etc.
 */

/**
 * Chat message for multi-turn conversations
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Generation options for text completion
 */
export interface GenerateOptions {
  maxTokens?: number; // Max tokens to generate
  temperature?: number; // Randomness (0.0 = deterministic, 1.0 = creative)
  topP?: number; // Nucleus sampling threshold
  topK?: number; // Top-K sampling
  stopSequences?: string[]; // Stop generation at these strings
  stream?: boolean; // Stream response token-by-token
  think?: boolean; // Enable model thinking/reasoning (Qwen 3.5). Default: false
  /**
   * Per-call request timeout override in milliseconds. When set,
   * supersedes the provider's constructor-configured timeout for
   * this single `generate()` invocation. Lets caller-side configs
   * tune timeouts per content type (e.g., civics-glossary
   * extraction routinely needs 15-20 min on qwen3.5:9b, while
   * proposition-analysis finishes in 2 min on the same hardware —
   * a single global default doesn't fit both well).
   */
  requestTimeoutMs?: number;
}

/**
 * Generation result
 */
export interface GenerateResult {
  text: string;
  tokensUsed?: number;
  finishReason?: "stop" | "length" | "error";
}

/**
 * Strategy interface for LLM providers
 */
export interface ILLMProvider {
  /**
   * Get the provider name for logging
   */
  getName(): string;

  /**
   * Get the model name/identifier
   */
  getModelName(): string;

  /**
   * Generate text completion from a prompt
   */
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;

  /**
   * Stream text completion token-by-token
   * Returns an async generator that yields tokens as they're generated
   */
  generateStream(
    prompt: string,
    options?: GenerateOptions,
  ): AsyncGenerator<string, void, unknown>;

  /**
   * Chat completion for multi-turn conversations
   * Convenience method that formats messages into a prompt
   */
  chat(
    messages: ChatMessage[],
    options?: GenerateOptions,
  ): Promise<GenerateResult>;

  /**
   * Check if provider is available (for health checks)
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Exception thrown when LLM operations fail
 */
export class LLMError extends Error {
  constructor(
    public provider: string,
    public operation: string,
    public originalError: Error,
  ) {
    super(
      `LLM operation '${operation}' failed in ${provider}: ${originalError.message}`,
    );
    this.name = "LLMError";
  }
}
