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
 * Ollama configuration
 */
export interface OllamaConfig {
  url: string; // Ollama server URL
  model: string; // Model name (e.g., 'llama3.2', 'mistral', 'falcon')
}

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

  constructor(private readonly config: OllamaConfig) {
    this.logger.log(
      `Ollama LLM provider initialized: ${config.model} at ${config.url}`,
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
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

        const response = await fetch(`${this.config.url}/api/generate`, {
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
          this.logger.error("Ollama generation timed out after 60 seconds");
          throw new LLMError(
            this.getName(),
            "generate",
            new Error(
              "Request timed out. Is Ollama running? Try: ollama serve",
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
    try {
      this.logger.log(`Streaming completion with Ollama/${this.config.model}`);

      const response = await fetch(`${this.config.url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
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
    } catch (error) {
      this.logger.error("Ollama streaming failed:", error);
      throw new LLMError(this.getName(), "generateStream", error as Error);
    }
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

        const response = await fetch(`${this.config.url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      const response = await fetch(`${this.config.url}/api/tags`);
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
