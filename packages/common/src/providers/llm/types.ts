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
  /**
   * Total tokens billed for this call — input plus output.
   *
   * Kept as the headline number because cost gates work on the sum. Prefer
   * `tokensIn` / `tokensOut` when attributing spend: for extraction-shaped
   * workloads input dominates output by an order of magnitude or more, so a
   * total alone tells you almost nothing about where the cost went.
   */
  tokensUsed?: number;
  /**
   * Prompt (input) tokens.
   *
   * Previously discarded entirely. Every relevance cache row in production
   * has a NULL `tokens_in`, which made it impossible to answer what
   * inference actually costs — the recorded figures covered only the small
   * half of each call.
   */
  tokensIn?: number;
  /** Completion (output) tokens. */
  tokensOut?: number;
  finishReason?: "stop" | "length" | "error";
  /**
   * True when the model appears to have read only part of the prompt (#1319).
   *
   * Ollama applies `num_ctx` by silently cutting the prompt — no error, no
   * warning, and a perfectly well-formed answer about the fragment it did
   * read. Measured 2026-09-23 on a 451 KB bill: two models reported
   * `prompt_eval_count` of **16,386** against ~112,000 tokens of input — the
   * 16,384 window plus two — and both returned valid JSON summarising the
   * first 15% of the document as though it were the whole thing.
   *
   * That is the most dangerous failure shape this platform has: not an error,
   * not empty output, but a confident summary of a fragment that nothing
   * downstream can distinguish from a complete one.
   */
  promptTruncated?: boolean;
  /**
   * Prompt tokens the caller expected, against which {@link tokensIn} was
   * compared. Rough — tokenizers differ by 20-50% between model families —
   * which is why the detection threshold is deliberately loose.
   */
  promptTokensEstimated?: number;
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
   * Content digest of the weights currently behind `getModelName()`.
   *
   * A tag is not a pin. `ollama pull` can replace the weights behind an
   * unchanged tag, so "which model produced this output" is unanswerable from
   * the name alone — including retrospectively, for outputs already stored
   * (#1281, M1 scope item 5).
   *
   * That is not hypothetical precision: claim anchoring measured 24.8% on
   * `olmo-3:7b-instruct` and 52.9% on `olmo-3.1:32b-instruct` (#1212).
   * Comparisons like that only mean something if the weights behind each tag
   * are identified.
   *
   * Returns `undefined` when the provider cannot determine it. Callers must
   * record that as "unknown" rather than omitting the field — a missing
   * digest and an unrecorded one are different claims.
   */
  getModelDigest(): Promise<string | undefined>;

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
