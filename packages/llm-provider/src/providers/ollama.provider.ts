import { Injectable, Logger } from "@nestjs/common";
import {
  ILLMProvider,
  ChatMessage,
  GenerateOptions,
  GenerateResult,
  LLMError,
  CircuitBreakerManager,
  createCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIGS,
  CircuitBreakerHealth,
} from "@opuspopuli/common";

/**
 * Total tokens for a call, from Ollama's separate prompt/completion counts.
 *
 * Returns undefined when Ollama reported neither, so "no telemetry" stays
 * distinguishable from "a call that genuinely used zero tokens" — recording a
 * spurious 0 would quietly understate spend in exactly the aggregate queries
 * this instrumentation exists to answer.
 */
/**
 * Characters per token used only to ESTIMATE how much prompt we sent.
 *
 * Deliberately coarse. Real tokenizers differ by 20-50% across model families
 * — measured on the same bill, one model reported 149% of this estimate and
 * another 84% — so this can never be a precise check. It does not need to be:
 * the failure it catches is an order of magnitude away, not a few percent.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Below this share of the estimated prompt, assume the prompt was cut.
 *
 * Measured 2026-09-23 across 15 bill runs: genuine full reads landed between
 * 84% and 149% of the estimate, while two truncated runs landed at **15%**.
 * Nothing observed sits between 15% and 84%, so 0.5 separates them with a
 * wide margin in both directions — it will not fire on a tokenizer that
 * merely disagrees, and it cannot miss a `num_ctx` cut.
 */
export const MIN_PROMPT_COVERAGE = 0.5;

/**
 * Did the model read materially less than we sent it?
 *
 * Ollama enforces `num_ctx` by silently truncating the prompt: no error, no
 * flag, and a well-formed answer about the part it read. On a 451 KB bill two
 * models reported `prompt_eval_count = 16386` — the 16,384 window plus two —
 * against ~112,000 tokens of input, and both returned valid JSON describing
 * the first 15% of the document. Output that is wrong in this way is worse
 * than output that fails, because nothing downstream can tell.
 */
function detectPromptTruncation(
  promptChars: number | undefined,
  promptEvalCount: number | undefined,
): { promptTruncated?: boolean; promptTokensEstimated?: number } {
  if (!promptChars || !promptEvalCount) return {};
  const estimated = Math.ceil(promptChars / CHARS_PER_TOKEN_ESTIMATE);
  return {
    promptTokensEstimated: estimated,
    promptTruncated: promptEvalCount < estimated * MIN_PROMPT_COVERAGE,
  };
}

/**
 * Map Ollama's usage fields onto the GenerateResult telemetry shape.
 *
 * One place on purpose: the generate and chat paths return identical
 * telemetry, and two hand-maintained copies is how the input count went
 * unread in one of them for months.
 */
function tokenTelemetry(
  data: {
    eval_count?: number;
    prompt_eval_count?: number;
    done?: boolean;
    done_reason?: string;
  },
  promptChars?: number,
): {
  tokensUsed?: number;
  tokensIn?: number;
  tokensOut?: number;
  finishReason: "stop" | "length";
  promptTruncated?: boolean;
  promptTokensEstimated?: number;
} {
  return {
    tokensUsed: sumTokens(data.prompt_eval_count, data.eval_count),
    tokensIn: data.prompt_eval_count || undefined,
    tokensOut: data.eval_count || undefined,
    finishReason: mapFinishReason(data.done, data.done_reason),
    ...detectPromptTruncation(promptChars, data.prompt_eval_count),
  };
}

/**
 * Ollama reports WHY it stopped in `done_reason`; `done` only says THAT it
 * stopped (opuspopuli#1085).
 *
 * The previous mapping was `data.done ? "stop" : "length"`, which cannot ever
 * return "length" on a non-streaming call — `done` is true whenever generation
 * completed, including when it completed because it hit `num_predict`. So
 * every caller was told "the model finished on its own", always.
 *
 * That is not a cosmetic bug. Two proposition analyses failed for months
 * against a 2000-token output budget; the failure looked like a model
 * ignoring the JSON format, because the one field that would have said
 * "truncated" reported "stop". Raising the budget fixed both immediately.
 *
 * `done_reason` is absent on older Ollama builds, so fall back to the old
 * behaviour rather than guessing "length" — a wrong "truncated" verdict sends
 * the next reader hunting a budget that was never the problem.
 */
function mapFinishReason(
  done?: boolean,
  doneReason?: string,
): "stop" | "length" {
  if (doneReason === "length") return "length";
  if (doneReason === "stop") return "stop";
  return done ? "stop" : "length";
}

function sumTokens(
  promptTokens?: number,
  completionTokens?: number,
): number | undefined {
  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }
  return (promptTokens ?? 0) + (completionTokens ?? 0);
}

/**
 * Custom fetch function type for HTTP connection pooling support
 */
export type FetchFunction = (
  url: string | URL,
  options?: RequestInit,
) => Promise<Response>;

/**
 * Ollama configuration
 */
export interface OllamaConfig {
  url: string; // Ollama server URL
  model: string; // Model name (e.g., 'qwen3.5:9b', 'qwen3.5:35b', 'mistral')
  /**
   * Overall request timeout in milliseconds
   * Default: 60000 (60 seconds)
   */
  requestTimeoutMs?: number;
  /**
   * Timeout between streaming chunks in milliseconds
   * Default: 30000 (30 seconds)
   */
  chunkTimeoutMs?: number;
  /**
   * Custom fetch function for HTTP connection pooling
   * If not provided, uses native fetch (which respects global dispatcher)
   */
  fetchFn?: FetchFunction;
  /**
   * Context window to request, in tokens (`num_ctx`).
   *
   * Left unset, Ollama applies the build's own default — and that default
   * differs between builds of the SAME model. Measured 2026-09-23 on a 451 KB
   * bill (~112,878 estimated tokens):
   *
   *     lightning MLX,  unset            107,298 tokens read  (95%)
   *     lightning GGUF, unset             16,386 tokens read  (15%)
   *     lightning GGUF, num_ctx 32768     16,386 tokens read  (15%)
   *     lightning GGUF, num_ctx 131072   107,298 tokens read  (95%)
   *
   * Note the third row: a plausible value is not a safe one, and being wrong
   * is SILENT — the model returns well-formed output describing the fragment
   * it read. `promptTruncated` on the result detects the condition; this is
   * how a deployment avoids it.
   *
   * An earlier revision of this provider sized the window per call. That was
   * reverted: at the 6.6K-token civics prompts it was tested on, `num_ctx`
   * measurably changed nothing (three seeds, both arms identical), and the
   * inference did not survive repetition. It matters at 112K, not at 6.6K, so
   * this is an explicit deployment setting rather than a computed one.
   */
  contextTokens?: number;
}

/**
 * Default timeout values
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 60000; // 60 seconds
const DEFAULT_CHUNK_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Ollama LLM Provider (OSS, Local)
 *
 * Uses Ollama for local LLM inference with full privacy.
 * Runs models entirely on your machine with GPU acceleration.
 *
 * Setup:
 * 1. Install Ollama: https://ollama.ai
 * 2. Pull a model: ollama pull qwen3.5:9b
 * 3. Run server: ollama serve (default port 11434)
 *
 * Recommended Models:
 * - qwen3.5:9b (9B) - Dev default, 256K context, Apache 2.0
 * - qwen3.5:35b (35B) - Prod default, 256K context, Apache 2.0
 * - mistral (7B) - Alternative, excellent JSON output
 *
 * Pros:
 * - 100% local (no API calls, full privacy)
 * - GPU acceleration (fast on decent hardware)
 * - Free (no API costs)
 * - Many models available
 * - Native streaming support
 *
 * Cons:
 * - Requires local GPU for good performance
 * - Need to download models (GBs)
 * - Slower than cloud APIs on CPU-only
 */
@Injectable()
export class OllamaLLMProvider implements ILLMProvider {
  private readonly logger = new Logger(OllamaLLMProvider.name);
  private readonly circuitBreaker: CircuitBreakerManager;
  private readonly requestTimeoutMs: number;
  private readonly contextTokens?: number;
  private readonly chunkTimeoutMs: number;
  private readonly fetchFn: FetchFunction;

  constructor(private readonly config: OllamaConfig) {
    // Initialize timeout values from config or defaults
    this.contextTokens = config.contextTokens;
    this.requestTimeoutMs =
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.chunkTimeoutMs = config.chunkTimeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS;

    // Use custom fetch function if provided, otherwise use native fetch
    // Native fetch respects global dispatcher set via setGlobalHttpPool()
    this.fetchFn = config.fetchFn ?? fetch;

    this.logger.log(
      `Ollama LLM provider initialized: ${config.model} at ${config.url} ` +
        `(request timeout: ${this.requestTimeoutMs}ms, chunk timeout: ${this.chunkTimeoutMs}ms)`,
    );

    // Initialize circuit breaker for Ollama calls
    this.circuitBreaker = createCircuitBreaker(DEFAULT_CIRCUIT_CONFIGS.ollama);

    // Log circuit state changes
    this.circuitBreaker.addListener((event) => {
      switch (event) {
        case "break":
          this.logger.warn(
            `Circuit breaker OPENED for Ollama - service unavailable`,
          );
          break;
        case "reset":
          this.logger.log(
            `Circuit breaker RESET for Ollama - service recovered`,
          );
          break;
        case "half_open":
          this.logger.log(
            `Circuit breaker HALF-OPEN for Ollama - testing recovery`,
          );
          break;
      }
    });
  }

  getName(): string {
    return "Ollama";
  }

  getModelName(): string {
    return this.config.model;
  }

  /**
   * Content digest of the weights behind `config.model`.
   *
   * Read from `/api/tags`, NOT `/api/show` — the digest lives on the manifest
   * listing and `show` does not return it. Resolved at most once per process:
   * the weights behind a tag can only change via `ollama pull`, which does not
   * happen mid-run, and paying an HTTP round-trip per generation to learn a
   * value that cannot move would be a poor trade.
   *
   * Returns `undefined` rather than throwing. A provenance stamp is not worth
   * failing a generation over — the caller records "unknown", which is an
   * honest statement, where a thrown error would lose the output entirely.
   */
  private modelDigest: string | undefined | null = null;

  async getModelDigest(): Promise<string | undefined> {
    if (this.modelDigest !== null) return this.modelDigest;

    try {
      const response = await this.fetchWithTimeout(
        `${this.config.url}/api/tags`,
        { method: "GET" },
        this.requestTimeoutMs,
        "getModelDigest",
      );
      const body = (await response.json()) as {
        models?: Array<{ name?: string; digest?: string }>;
      };
      const match = body.models?.find((m) => m.name === this.config.model);
      // Normalise: ollama has used both `sha256:` and `sha256-` prefixes.
      this.modelDigest = match?.digest
        ? match.digest.replace(/^sha256[:-]/, "")
        : undefined;
    } catch (error) {
      this.logger.warn(
        `Could not resolve model digest for ${this.config.model}; ` +
          `provenance will record it as unknown: ${(error as Error).message}`,
      );
      this.modelDigest = undefined;
    }

    return this.modelDigest;
  }

  /**
   * Execute a fetch with an AbortController timeout, mapping AbortErrors
   * to a LLMError. Shared by generate() and chat() to avoid duplicating
   * the identical controller/timeout/clearTimeout block.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    operation: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        this.logger.error(`Ollama ${operation} timed out after ${timeoutMs}ms`);
        throw new LLMError(
          this.getName(),
          operation,
          new Error(
            `Request timed out after ${timeoutMs}ms. Is Ollama running? Try: ollama serve`,
          ),
        );
      }
      throw error;
    }
  }

  async generate(
    prompt: string,
    options?: GenerateOptions,
  ): Promise<GenerateResult> {
    // Per-call timeout override (e.g., civics-glossary needs 20+
    // min where bio gen needs 2; see GenerateOptions.requestTimeoutMs).
    // Falls back to the constructor-configured default. Hoisted out
    // of the try so the AbortError catch can reference it for the
    // logged + thrown error message.
    const effectiveTimeoutMs =
      options?.requestTimeoutMs ?? this.requestTimeoutMs;

    // Wrap the call with circuit breaker protection
    return this.circuitBreaker.execute(async () => {
      try {
        this.logger.log(
          `Generating completion with Ollama/${this.config.model} (${prompt.length} chars, timeout ${effectiveTimeoutMs}ms)`,
        );

        const response = await this.fetchWithTimeout(
          `${this.config.url}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: this.config.model,
              prompt,
              stream: false,
              think: options?.think ?? false,
              options: this.samplingOptions(options),
            }),
          },
          effectiveTimeoutMs,
          "generate",
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as {
          response?: string;
          eval_count?: number;
          // Ollama reports prompt tokens separately and always has — this
          // was simply never read, so every stored `tokens_in` is NULL.
          prompt_eval_count?: number;
          eval_duration?: number; // nanoseconds spent generating tokens
          done?: boolean;
          done_reason?: string; // "stop" | "length" — WHY it stopped (#1085)
        };

        // Log generation throughput. Output volume (tokens), not context
        // window or reasoning, is what governs latency here — surfacing
        // tokens + tok/s makes perf regressions visible in one line
        // instead of an ad-hoc benchmark. See #872.
        const tokens = data.eval_count ?? 0;
        const tokPerSec =
          data.eval_duration && data.eval_duration > 0
            ? ((tokens * 1e9) / data.eval_duration).toFixed(1)
            : "n/a";
        this.logger.log(
          `Generated ${data.response?.length || 0} chars ` +
            `(${tokens} tokens, ${tokPerSec} tok/s) with Ollama`,
        );

        const result = {
          text: data.response || "",
          ...tokenTelemetry(data, prompt.length),
        };
        this.warnIfPromptTruncated(result, prompt.length);
        return result;
      } catch (error) {
        if (error instanceof LLMError) throw error;
        this.logger.error("Ollama generation failed:", error);
        throw new LLMError(this.getName(), "generate", error as Error);
      }
    });
  }

  async *generateStream(
    prompt: string,
    options?: GenerateOptions,
  ): AsyncGenerator<string, void, unknown> {
    const timeoutManager = this.createStreamingTimeoutManager();

    try {
      this.logger.log(`Streaming completion with Ollama/${this.config.model}`);

      // Set overall request timeout
      timeoutManager.startOverallTimeout();

      const response = await this.fetchFn(`${this.config.url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: timeoutManager.controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          stream: true,
          think: options?.think ?? false,
          options: this.samplingOptions(options),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      yield* this.processStreamResponse(response, timeoutManager);
    } catch (error) {
      timeoutManager.clearAll();
      this.handleStreamError(error);
    }
  }

  /**
   * Creates a timeout manager for streaming requests
   */
  private createStreamingTimeoutManager() {
    const controller = new AbortController();
    let overallTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let chunkTimeoutId: ReturnType<typeof setTimeout> | undefined;

    return {
      controller,
      startOverallTimeout: () => {
        overallTimeoutId = setTimeout(() => {
          this.logger.error(
            `Ollama streaming request timed out after ${this.requestTimeoutMs}ms`,
          );
          controller.abort();
        }, this.requestTimeoutMs);
      },
      resetChunkTimeout: () => {
        if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
        chunkTimeoutId = setTimeout(() => {
          this.logger.error(
            `Ollama streaming chunk timed out after ${this.chunkTimeoutMs}ms`,
          );
          controller.abort();
        }, this.chunkTimeoutMs);
      },
      clearAll: () => {
        if (overallTimeoutId) clearTimeout(overallTimeoutId);
        if (chunkTimeoutId) clearTimeout(chunkTimeoutId);
      },
    };
  }

  /**
   * Process streaming response and yield chunks
   */
  private async *processStreamResponse(
    response: Response,
    timeoutManager: ReturnType<typeof this.createStreamingTimeoutManager>,
  ): AsyncGenerator<string, void, unknown> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    timeoutManager.resetChunkTimeout();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        timeoutManager.resetChunkTimeout();
        yield* this.parseStreamChunk(decoder.decode(value));
      }
    } finally {
      timeoutManager.clearAll();
    }
  }

  /**
   * Parse a streaming chunk and yield response tokens
   */
  private *parseStreamChunk(chunk: string): Generator<string, void, unknown> {
    const lines = chunk.split("\n").filter((line) => line.trim());
    for (const line of lines) {
      try {
        const json = JSON.parse(line) as { response?: string };
        if (json.response) {
          yield json.response;
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  /**
   * The `options` every request carries.
   *
   * One builder rather than three copies — this block was duplicated across
   * the streaming, non-streaming and chat paths, which is how `num_ctx` could
   * have been added to one and missed in the others.
   *
   * `num_ctx` is included only when a deployment sets it. Omitted, Ollama
   * applies the build's own default, which differs between builds of the same
   * model and silently truncates long prompts — see {@link OllamaConfig.contextTokens}.
   */
  private samplingOptions(options?: GenerateOptions): Record<string, unknown> {
    return {
      // `||` throughout, which is what all three copies used. `??` would be
      // the better rule — it honours an explicit `temperature: 0` instead of
      // turning determinism into 0.7 — but changing it here would make a
      // de-duplication commit silently alter sampling on three paths at once.
      // Behaviour-preserving now; worth fixing deliberately, on its own.
      num_predict: options?.maxTokens || 512,
      temperature: options?.temperature || 0.7,
      top_p: options?.topP || 0.95,
      top_k: options?.topK || 40,
      // Only when there is something to stop on.
      //
      // The three originals disagreed here, so there is no option that
      // preserves all of them: chat omitted `stop`, generate and stream sent
      // `stop: []`. Omitting is chat's behaviour and the safer one — Ollama
      // merges request options over the model's own, so an explicit `[]`
      // REPLACES a Modelfile's stop list and lets a model run past its
      // end-of-turn inventing a reply. No caller in the repo sets
      // `stopSequences` today, so nothing observable changes either way.
      ...(options?.stopSequences?.length
        ? { stop: options.stopSequences }
        : {}),
      ...(this.contextTokens ? { num_ctx: this.contextTokens } : {}),
    };
  }

  /**
   * Say so, loudly, when the model read only part of what we sent.
   *
   * At `warn` rather than `debug` because the output is not obviously wrong:
   * it is a fluent, well-formed answer about a fragment. A civic summary that
   * silently describes the first 15% of a bill is exactly what this platform
   * exists not to publish, and this number is the only signal that it did.
   */
  private warnIfPromptTruncated(
    result: {
      promptTruncated?: boolean;
      tokensIn?: number;
      promptTokensEstimated?: number;
    },
    promptChars: number,
  ): void {
    if (!result.promptTruncated) return;
    const pct = result.promptTokensEstimated
      ? Math.round(
          (100 * (result.tokensIn ?? 0)) / result.promptTokensEstimated,
        )
      : 0;
    this.logger.warn(
      `PROMPT TRUNCATED by ${this.config.model}: read ${result.tokensIn} of ` +
        `~${result.promptTokensEstimated} estimated tokens (${pct}%) from ` +
        `${promptChars} characters. The response describes only the part that ` +
        `was read. Raise num_ctx for this model, or chunk the input — do not ` +
        `store this output as a summary of the whole document.`,
    );
  }

  /**
   * Handle streaming errors with appropriate error messages
   */
  private handleStreamError(error: unknown): never {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LLMError(
        this.getName(),
        "generateStream",
        new Error(
          `Streaming request timed out. Is Ollama running? Try: ollama serve`,
        ),
      );
    }

    this.logger.error("Ollama streaming failed:", error);
    throw new LLMError(this.getName(), "generateStream", error as Error);
  }

  async chat(
    messages: ChatMessage[],
    options?: GenerateOptions,
  ): Promise<GenerateResult> {
    // Wrap the call with circuit breaker protection
    return this.circuitBreaker.execute(async () => {
      try {
        this.logger.log(
          `Chat completion with Ollama/${this.config.model} (${messages.length} messages)`,
        );

        const response = await this.fetchWithTimeout(
          `${this.config.url}/api/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: this.config.model,
              messages: messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
              })),
              stream: false,
              think: options?.think ?? false,
              options: this.samplingOptions(options),
            }),
          },
          this.requestTimeoutMs,
          "chat",
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as {
          message?: { content?: string };
          eval_count?: number;
          prompt_eval_count?: number;
          done?: boolean;
          done_reason?: string; // "stop" | "length" — WHY it stopped (#1085)
        };

        // Measured over the WHOLE conversation: /api/chat fills the window
        // with every message, so sizing on the last turn alone would miss a cut.
        const chatChars = messages.reduce((n, m) => n + m.content.length, 0);
        const result = {
          text: data.message?.content || "",
          ...tokenTelemetry(data, chatChars),
        };
        this.warnIfPromptTruncated(result, chatChars);
        return result;
      } catch (error) {
        if (error instanceof LLMError) throw error;
        this.logger.error("Ollama chat failed:", error);
        throw new LLMError(this.getName(), "chat", error as Error);
      }
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama server is running and circuit breaker is healthy
      if (!this.circuitBreaker.isHealthy()) {
        return false;
      }
      const response = await this.fetchFn(`${this.config.url}/api/tags`);
      return response.ok;
    } catch (error) {
      this.logger.error("Ollama availability check failed:", error);
      return false;
    }
  }

  /**
   * Get circuit breaker health status
   */
  getCircuitBreakerHealth(): CircuitBreakerHealth {
    return this.circuitBreaker.getHealth();
  }
}
