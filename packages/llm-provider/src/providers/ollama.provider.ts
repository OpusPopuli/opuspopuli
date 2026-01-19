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
} from "@qckstrt/common";

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
  model: string; // Model name (e.g., 'llama3.2', 'mistral', 'falcon')
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
 * 2. Pull a model: ollama pull llama3.2
 * 3. Run server: ollama serve (default port 11434)
 *
 * Recommended Models:
 * - llama3.2 (3B) - Fast, good quality, runs on laptop
 * - mistral (7B) - Excellent quality, moderate speed
 * - falcon (7B) - Alternative to Mistral
 * - llama3.1 (8B) - Latest Llama, great performance
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
  private readonly chunkTimeoutMs: number;
  private readonly fetchFn: FetchFunction;

  constructor(private readonly config: OllamaConfig) {
    // Initialize timeout values from config or defaults
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

  async generate(
    prompt: string,
    options?: GenerateOptions,
  ): Promise<GenerateResult> {
    // Wrap the call with circuit breaker protection
    return this.circuitBreaker.execute(async () => {
      try {
        this.logger.log(
          `Generating completion with Ollama/${this.config.model} (${prompt.length} chars)`,
        );

        // Add timeout to prevent hanging if Ollama isn't responding
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.requestTimeoutMs,
        );

        const response = await this.fetchFn(`${this.config.url}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            stream: false,
            options: {
              num_predict: options?.maxTokens || 512,
              temperature: options?.temperature || 0.7,
              top_p: options?.topP || 0.95,
              top_k: options?.topK || 40,
              stop: options?.stopSequences || [],
            },
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as {
          response?: string;
          eval_count?: number;
          done?: boolean;
        };

        this.logger.log(
          `Generated ${data.response?.length || 0} chars with Ollama`,
        );

        return {
          text: data.response || "",
          tokensUsed: data.eval_count || undefined,
          finishReason: data.done ? "stop" : "length",
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          this.logger.error(
            `Ollama generation timed out after ${this.requestTimeoutMs}ms`,
          );
          throw new LLMError(
            this.getName(),
            "generate",
            new Error(
              `Request timed out after ${this.requestTimeoutMs}ms. Is Ollama running? Try: ollama serve`,
            ),
          );
        }
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
          options: {
            num_predict: options?.maxTokens || 512,
            temperature: options?.temperature || 0.7,
            top_p: options?.topP || 0.95,
            top_k: options?.topK || 40,
            stop: options?.stopSequences || [],
          },
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

        // Add timeout to prevent hanging if Ollama isn't responding
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.requestTimeoutMs,
        );

        const response = await this.fetchFn(`${this.config.url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.config.model,
            messages: messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
            stream: false,
            options: {
              num_predict: options?.maxTokens || 512,
              temperature: options?.temperature || 0.7,
              top_p: options?.topP || 0.95,
              top_k: options?.topK || 40,
            },
          }),
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as {
          message?: { content?: string };
          eval_count?: number;
          done?: boolean;
        };

        return {
          text: data.message?.content || "",
          tokensUsed: data.eval_count || undefined,
          finishReason: data.done ? "stop" : "length",
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          this.logger.error(
            `Ollama chat timed out after ${this.requestTimeoutMs}ms`,
          );
          throw new LLMError(
            this.getName(),
            "chat",
            new Error(
              `Request timed out after ${this.requestTimeoutMs}ms. Is Ollama running? Try: ollama serve`,
            ),
          );
        }
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
