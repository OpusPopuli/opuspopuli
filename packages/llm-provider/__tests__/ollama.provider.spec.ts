import "reflect-metadata";
import {
  OllamaLLMProvider,
  OllamaConfig,
} from "../src/providers/ollama.provider";
import { LLMError } from "@opuspopuli/common";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe("OllamaLLMProvider", () => {
  let provider: OllamaLLMProvider;
  const config: OllamaConfig = {
    url: "http://localhost:11434",
    model: "llama3.2",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OllamaLLMProvider(config);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider.getName()).toBe("Ollama");
      expect(provider.getModelName()).toBe("llama3.2");
    });

    it("should use default timeout values when not specified", () => {
      const defaultProvider = new OllamaLLMProvider({
        url: "http://localhost:11434",
        model: "llama3.2",
      });
      expect(defaultProvider).toBeDefined();
    });

    it("should accept custom timeout values", () => {
      const customProvider = new OllamaLLMProvider({
        url: "http://localhost:11434",
        model: "llama3.2",
        requestTimeoutMs: 120000,
        chunkTimeoutMs: 60000,
      });
      expect(customProvider).toBeDefined();
    });
  });

  describe("finishReason (#1085)", () => {
    /**
     * `done` says THAT generation stopped; `done_reason` says WHY. The old
     * mapping was `done ? "stop" : "length"`, which can never report "length"
     * on a non-streaming call — so a response cut off at `num_predict` claimed
     * the model had finished on its own.
     *
     * That cost months: two proposition analyses failed against a 2000-token
     * budget and the failure looked like a model ignoring its output format,
     * because the one field that would have said "truncated" said "stop".
     */
    it('reports "length" when Ollama says it ran out of budget', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: "half an obje",
            done: true,
            done_reason: "length",
            eval_count: 2000,
            prompt_eval_count: 20000,
          }),
      });

      const result = await provider.generate("Test prompt");

      // `done` is true here — the old mapping would have said "stop".
      expect(result.finishReason).toBe("length");
      expect(result.tokensOut).toBe(2000);
    });

    it('reports "stop" when Ollama says it finished on its own', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: "a complete answer",
            done: true,
            done_reason: "stop",
            eval_count: 42,
            prompt_eval_count: 100,
          }),
      });

      const result = await provider.generate("Test prompt");
      expect(result.finishReason).toBe("stop");
    });

    it("falls back to the old behaviour when done_reason is absent", async () => {
      // Older Ollama builds omit it. Guessing "length" there would send the
      // next reader hunting a budget that was never the problem.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: "text",
            done: true,
            eval_count: 10,
            prompt_eval_count: 10,
          }),
      });

      const result = await provider.generate("Test prompt");
      expect(result.finishReason).toBe("stop");
    });
  });

  /**
   * The SAME model in two builds reads a 451 KB bill completely or reads 15%
   * of it, depending on `num_ctx`. And 32768 reads exactly as little as no
   * setting at all, so a plausible value is not a safe one — which is why
   * this is an explicit deployment setting rather than a computed guess.
   */
  describe("context window (#1319)", () => {
    const optionsOf = () => JSON.parse(mockFetch.mock.calls[0][1].body).options;
    const ok = () => ({
      ok: true,
      json: () => Promise.resolve({ response: "{}", done: true }),
    });

    it("omits num_ctx entirely when unconfigured", async () => {
      mockFetch.mockResolvedValueOnce(ok());

      await provider.generate("short");

      // Absent means "use the build's default" — a real choice, and the one
      // the MLX build gets right without help.
      expect(optionsOf().num_ctx).toBeUndefined();
    });

    it("sends the configured window on every request", async () => {
      const sized = new OllamaLLMProvider({ ...config, contextTokens: 131072 });
      mockFetch.mockResolvedValueOnce(ok());

      await sized.generate("short");

      expect(optionsOf().num_ctx).toBe(131072);
    });

    /**
     * All three paths, because the point of one shared `samplingOptions` is
     * that a setting cannot reach one path and miss the others — and asserting
     * only `generate()` is how that guarantee would rot unnoticed. `num_ctx`
     * was absent from all three before #1319 for exactly this reason.
     */
    it("sends the window on the chat path", async () => {
      const sized = new OllamaLLMProvider({ ...config, contextTokens: 131072 });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            message: { content: "hi" },
            done: true,
            done_reason: "stop",
          }),
      });

      await sized.chat([{ role: "user", content: "Hello" }]);

      expect(optionsOf().num_ctx).toBe(131072);
    });

    it("sends the window on the streaming path", async () => {
      const sized = new OllamaLLMProvider({ ...config, contextTokens: 131072 });
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"response":"Hello"}\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      for await (const _token of sized.generateStream("short")) {
        // Drained only so the request is actually issued.
      }

      expect(optionsOf().num_ctx).toBe(131072);
    });

    /**
     * A window this small is a typo, not a choice — `parseInt("128k")` is 128.
     * `resolveContextTokens` rejects it before construction (see
     * context-tokens.spec.ts); the provider's own guard is truthiness, so 0 is
     * treated as unset while a hand-constructed small value is forwarded. This
     * pins that split so neither half is mistaken for the other's job.
     */
    it("treats a zero window as unset", async () => {
      const zero = new OllamaLLMProvider({ ...config, contextTokens: 0 });
      mockFetch.mockResolvedValueOnce(ok());

      await zero.generate("short");

      expect(optionsOf().num_ctx).toBeUndefined();
    });
  });

  describe("sampling options", () => {
    const optionsOf = () => JSON.parse(mockFetch.mock.calls[0][1].body).options;
    const ok = () => ({
      ok: true,
      json: () => Promise.resolve({ response: "{}", done: true }),
    });

    /**
     * `stop` is omitted rather than sent empty. Ollama merges request options
     * over the model's own, so `stop: []` REPLACES a Modelfile's stop list and
     * a model can run past its end-of-turn inventing a reply.
     */
    it("omits stop when no sequences are given", async () => {
      mockFetch.mockResolvedValueOnce(ok());

      await provider.generate("short");

      expect(optionsOf()).not.toHaveProperty("stop");
    });

    it("sends stop when sequences are given", async () => {
      mockFetch.mockResolvedValueOnce(ok());

      await provider.generate("short", { stopSequences: ["\n\n"] });

      expect(optionsOf().stop).toEqual(["\n\n"]);
    });

    it("applies the documented sampling defaults", async () => {
      mockFetch.mockResolvedValueOnce(ok());

      await provider.generate("short");

      const options = optionsOf();
      expect(options.num_predict).toBe(512);
      expect(options.temperature).toBe(0.7);
      expect(options.top_p).toBe(0.95);
      expect(options.top_k).toBe(40);
    });
  });

  /**
   * Ollama enforces `num_ctx` by silently cutting the prompt: no error, no
   * flag, and a fluent answer about the fragment it read.
   *
   * Measured 2026-09-23 on a 451 KB bill — two different models reported
   * `prompt_eval_count = 16386` against ~112,000 tokens of input (the 16,384
   * window plus two) and both returned VALID JSON summarising the first 15%
   * of the document. Valid output describing the wrong thing is worse than a
   * failure, because nothing downstream can tell.
   */
  describe("prompt truncation (#1319)", () => {
    const reply = (promptEval: number) => ({
      ok: true,
      json: () =>
        Promise.resolve({
          response: '{"ok":true}',
          prompt_eval_count: promptEval,
          eval_count: 40,
          done: true,
          done_reason: "stop",
        }),
    });

    it("flags the real 451 KB bill signature", async () => {
      mockFetch.mockResolvedValueOnce(reply(16386));

      // ~112k estimated tokens; the model reports having read 16,386.
      const result = await provider.generate("x".repeat(451512));

      expect(result.promptTruncated).toBe(true);
      expect(result.tokensIn).toBe(16386);
    });

    it("does not flag a tokenizer that merely disagrees with the estimate", async () => {
      // Observed range on genuine full reads was 84%-149% of the estimate;
      // firing there would make the warning noise and get it ignored.
      mockFetch.mockResolvedValueOnce(reply(2400));

      const result = await provider.generate("y".repeat(11633));

      expect(result.promptTruncated).toBe(false);
    });

    it("does not flag a model that reads MORE tokens than estimated", async () => {
      mockFetch.mockResolvedValueOnce(reply(4320));

      const result = await provider.generate("z".repeat(11633));

      expect(result.promptTruncated).toBe(false);
    });

    it("stays silent when Ollama reports no input count", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: "hi", done: true }),
      });

      // "No telemetry" must not masquerade as "truncated".
      const result = await provider.generate("a".repeat(400000));

      expect(result.promptTruncated).toBeUndefined();
    });
  });

  describe("generate", () => {
    it("reports input and output tokens separately", async () => {
      // Ollama has always returned prompt_eval_count; it went unread, so
      // every stored tokens_in was NULL and inference spend could not be
      // attributed. tokensUsed becomes the SUM -- for extraction-shaped
      // prompts input dominates output, so eval_count alone understated
      // real usage several-fold.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: "short answer",
            prompt_eval_count: 900,
            eval_count: 60,
            done: true,
          }),
      });

      const result = await provider.generate("long extraction prompt");

      expect(result.tokensIn).toBe(900);
      expect(result.tokensOut).toBe(60);
      expect(result.tokensUsed).toBe(960);
    });

    it("keeps telemetry undefined when Ollama reports nothing", async () => {
      // "No telemetry" must stay distinguishable from "zero tokens" -- a
      // spurious 0 would quietly understate spend in the aggregates this
      // instrumentation exists to feed.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: "hi", done: true }),
      });

      const result = await provider.generate("Test prompt");

      expect(result.tokensUsed).toBeUndefined();
      expect(result.tokensIn).toBeUndefined();
      expect(result.tokensOut).toBeUndefined();
    });

    it("should generate text successfully", async () => {
      const mockResponse = {
        response: "Generated text response",
        eval_count: 50,
        done: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.generate("Test prompt");

      expect(result.text).toBe("Generated text response");
      expect(result.tokensUsed).toBe(50);
      expect(result.finishReason).toBe("stop");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("logs generation throughput as tokens + tok/s (#872)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            response: "hello world",
            eval_count: 100,
            eval_duration: 2_000_000_000, // 2s in ns → 50 tok/s
            done: true,
          }),
      });

      await provider.generate("Test prompt");

      const { Logger } = jest.requireMock("@nestjs/common");
      const results = (Logger as jest.Mock).mock.results as unknown as Array<{
        value: { log: jest.Mock };
      }>;
      const logged = results
        .flatMap((r) => r.value.log.mock.calls)
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(logged).toContain("100 tokens");
      expect(logged).toContain("50.0 tok/s");
    });

    it("reports tok/s as n/a when the model omits eval_duration (#872)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ response: "hi", eval_count: 5, done: true }),
      });

      await provider.generate("Test prompt");

      const { Logger } = jest.requireMock("@nestjs/common");
      const results = (Logger as jest.Mock).mock.results as unknown as Array<{
        value: { log: jest.Mock };
      }>;
      const logged = results
        .flatMap((r) => r.value.log.mock.calls)
        .map((c: unknown[]) => String(c[0]))
        .join("\n");
      expect(logged).toContain("n/a tok/s");
    });

    it("should pass generation options", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: "test", done: true }),
      });

      await provider.generate("Test prompt", {
        maxTokens: 100,
        temperature: 0.5,
        topP: 0.9,
        topK: 50,
        stopSequences: ["END"],
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.options.num_predict).toBe(100);
      expect(callBody.options.temperature).toBe(0.5);
      expect(callBody.options.top_p).toBe(0.9);
      expect(callBody.options.top_k).toBe(50);
      expect(callBody.options.stop).toEqual(["END"]);
    });

    it("should throw LLMError on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(provider.generate("Test prompt")).rejects.toThrow(LLMError);
    });

    it("should throw LLMError on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(provider.generate("Test prompt")).rejects.toThrow(LLMError);
    });

    it("should throw LLMError with timeout message on AbortError", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      try {
        await provider.generate("Test prompt");
        fail("Expected LLMError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        expect((error as LLMError).originalError.message).toMatch(/timed out/i);
      }
    });

    it("should include AbortSignal in fetch request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ response: "test", done: true }),
      });

      await provider.generate("Test prompt");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  describe("chat", () => {
    it("should send chat messages successfully", async () => {
      const mockResponse = {
        message: { content: "Chat response" },
        eval_count: 30,
        done: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await provider.chat([
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ]);

      expect(result.text).toBe("Chat response");
      expect(result.tokensUsed).toBe(30);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/chat",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    it("should throw LLMError on chat failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });

      await expect(
        provider.chat([{ role: "user", content: "Hello" }]),
      ).rejects.toThrow(LLMError);
    });

    it("should throw LLMError with timeout message on AbortError", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      try {
        await provider.chat([{ role: "user", content: "Hello" }]);
        fail("Expected LLMError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        expect((error as LLMError).originalError.message).toMatch(/timed out/i);
      }
    });

    it("should include AbortSignal in fetch request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            message: { content: "response" },
            done: true,
          }),
      });

      await provider.chat([{ role: "user", content: "Hello" }]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  describe("isAvailable", () => {
    it("should return true when Ollama is available", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/api/tags");
    });

    it("should return false when Ollama is not available", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it("should return false on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe("generateStream", () => {
    it("should yield tokens from stream", async () => {
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              '{"response":"Hello"}\n{"response":" World"}\n',
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const tokens: string[] = [];
      for await (const token of provider.generateStream("Test prompt")) {
        tokens.push(token);
      }

      expect(tokens).toEqual(["Hello", " World"]);
    });

    it("should throw LLMError on stream failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
      });

      const generator = provider.generateStream("Test prompt");

      await expect(generator.next()).rejects.toThrow(LLMError);
    });

    it("should throw LLMError when body is not readable", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const generator = provider.generateStream("Test prompt");

      await expect(generator.next()).rejects.toThrow(LLMError);
    });

    it("should skip malformed JSON lines in stream", async () => {
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              '{"response":"Hello"}\nmalformed json\n{"response":" World"}\n',
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const tokens: string[] = [];
      for await (const token of provider.generateStream("Test prompt")) {
        tokens.push(token);
      }

      // Should only yield valid JSON responses, skipping malformed line
      expect(tokens).toEqual(["Hello", " World"]);
    });

    it("should skip JSON without response field in stream", async () => {
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              '{"response":"Hello"}\n{"done":true}\n{"response":" World"}\n',
            ),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const tokens: string[] = [];
      for await (const token of provider.generateStream("Test prompt")) {
        tokens.push(token);
      }

      // Should only yield JSON with response field
      expect(tokens).toEqual(["Hello", " World"]);
    });

    it("should handle empty chunks in stream", async () => {
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode("\n\n"),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"response":"Hello"}\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      const tokens: string[] = [];
      for await (const token of provider.generateStream("Test prompt")) {
        tokens.push(token);
      }

      expect(tokens).toEqual(["Hello"]);
    });

    it("should include AbortSignal in fetch request", async () => {
      const mockReader = {
        read: jest.fn().mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _token of provider.generateStream("Test prompt")) {
        // consume generator
      }

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("should throw LLMError with timeout message on AbortError", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValueOnce(abortError);

      const generator = provider.generateStream("Test prompt");

      try {
        await generator.next();
        fail("Expected LLMError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LLMError);
        expect((error as LLMError).originalError.message).toMatch(/timed out/i);
      }
    });
  });
});
