import "reflect-metadata";
import {
  OllamaLLMProvider,
  OllamaConfig,
} from "../src/providers/ollama.provider";
import { LLMError } from "@qckstrt/common";

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

  describe("generate", () => {
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
