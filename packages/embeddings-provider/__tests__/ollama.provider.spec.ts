import "reflect-metadata";
import { OllamaEmbeddingProvider } from "../src/providers/ollama.provider";
import { EmbeddingError } from "@opuspopuli/common";

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

/** An /api/embed success response carrying `vectors` in input order. */
const embedResponse = (vectors: number[][]) => ({
  ok: true,
  json: () => Promise.resolve({ embeddings: vectors }),
});

const bodyOf = (callIndex: number) =>
  JSON.parse(mockFetch.mock.calls[callIndex][1].body);

describe("OllamaEmbeddingProvider", () => {
  let provider: OllamaEmbeddingProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OllamaEmbeddingProvider(
      "http://localhost:11434",
      "nomic-embed-text-v2-moe:latest",
    );
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      const defaultProvider = new OllamaEmbeddingProvider();
      expect(defaultProvider.getName()).toBe("Ollama");
      // Guards the default, not just the plumbing: plain `nomic-embed-text`
      // is v1.5 and measures 0/14 on our corpus (eval-harness). A silent
      // revert to it would degrade retrieval with nothing erroring.
      expect(defaultProvider.getModelName()).toBe(
        "nomic-embed-text-v2-moe:latest",
      );
      expect(defaultProvider.getDimensions()).toBe(768);
    });

    it("should use custom values", () => {
      const customProvider = new OllamaEmbeddingProvider(
        "http://custom:8080",
        "mxbai-embed-large",
      );
      expect(customProvider.getModelName()).toBe("mxbai-embed-large");
      expect(customProvider.getDimensions()).toBe(1024);
    });

    // The regression the dimension ternary carried: it compared the model name
    // for equality, so the *tagged* form of a 1024-wide model fell through to
    // the 768 default and mis-declared its own width, silently.
    it("should resolve dimensions for a tagged model name", () => {
      const tagged = new OllamaEmbeddingProvider(
        undefined,
        "mxbai-embed-large:latest",
      );
      expect(tagged.getDimensions()).toBe(1024);
    });

    it("should throw on an unknown model rather than guess a width", () => {
      expect(
        () => new OllamaEmbeddingProvider(undefined, "some-new-embedder"),
      ).toThrow(/Unknown embedding model/);
    });

    it("should reject a batch size below 1", () => {
      expect(
        () =>
          new OllamaEmbeddingProvider(undefined, undefined, undefined, {
            batchSize: 0,
          }),
      ).toThrow(/batchSize/);
    });

    // NaN fails every comparison, so a `< 1` guard passes it through — and
    // then `i += NaN` never enters the batching loop and embedDocuments
    // returns [] having embedded nothing, silently. An unparseable
    // EMBEDDINGS_OLLAMA_BATCH_SIZE is exactly how NaN gets here.
    it("should reject a NaN batch size rather than embed nothing", () => {
      expect(
        () =>
          new OllamaEmbeddingProvider(undefined, undefined, undefined, {
            batchSize: Number.NaN,
          }),
      ).toThrow(/batchSize/);
    });
  });

  describe("embedQuery", () => {
    it("should embed a query successfully", async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValueOnce(embedResponse([mockEmbedding]));

      const result = await provider.embedQuery("test query");

      expect(result).toEqual(mockEmbedding);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/embed",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect(bodyOf(0).input).toEqual(["test query"]);
    });

    it("should throw EmbeddingError on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      await expect(provider.embedQuery("test query")).rejects.toThrow(
        EmbeddingError,
      );
    });

    it("should throw EmbeddingError on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(provider.embedQuery("test query")).rejects.toThrow(
        EmbeddingError,
      );
    });
  });

  describe("embedDocuments", () => {
    // The point of the batched endpoint: N texts, one model invocation.
    // Measured warm against real Ollama, 64 corpus-shaped texts: 672ms
    // batched vs 3393ms per-call, ~5x (roadmap §1.2 recorded 6.3x).
    it("should embed a batch in a single call, preserving order", async () => {
      const vectors = [
        [0.1, 0.2],
        [0.3, 0.4],
        [0.5, 0.6],
      ];
      mockFetch.mockResolvedValueOnce(embedResponse(vectors));

      const result = await provider.embedDocuments(["doc1", "doc2", "doc3"]);

      expect(result).toEqual(vectors);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(bodyOf(0).input).toEqual(["doc1", "doc2", "doc3"]);
    });

    it("should split work into batches of the configured size", async () => {
      const batched = new OllamaEmbeddingProvider(
        undefined,
        undefined,
        undefined,
        { batchSize: 2 },
      );
      mockFetch
        .mockResolvedValueOnce(embedResponse([[0.1], [0.2]]))
        .mockResolvedValueOnce(embedResponse([[0.3], [0.4]]))
        .mockResolvedValueOnce(embedResponse([[0.5]]));

      const result = await batched.embedDocuments(["a", "b", "c", "d", "e"]);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual([[0.1], [0.2], [0.3], [0.4], [0.5]]);
      expect(bodyOf(2).input).toEqual(["e"]);
    });

    it("should not call Ollama for an empty batch", async () => {
      await expect(provider.embedDocuments([])).resolves.toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // A short response would be zipped back onto rows by index, writing one
    // row's vector onto another. Undetectable after the fact, so it fails here.
    it("should throw when the response count does not match the input", async () => {
      mockFetch.mockResolvedValueOnce(embedResponse([[0.1, 0.2]]));

      await expect(provider.embedDocuments(["doc1", "doc2"])).rejects.toThrow(
        EmbeddingError,
      );
    });

    it("should throw EmbeddingError when the batch fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Error"),
      });

      await expect(provider.embedDocuments(["doc1", "doc2"])).rejects.toThrow(
        EmbeddingError,
      );
    });
  });

  describe("task prefixes", () => {
    it("should send raw text by default", async () => {
      mockFetch.mockResolvedValueOnce(embedResponse([[0.1]]));
      await provider.embedDocuments(["a measure about voter ID"]);

      expect(bodyOf(0).input).toEqual(["a measure about voter ID"]);
    });

    it("should apply asymmetric prefixes when enabled", async () => {
      const prefixed = new OllamaEmbeddingProvider(
        undefined,
        undefined,
        undefined,
        { taskPrefixes: true },
      );

      mockFetch.mockResolvedValueOnce(embedResponse([[0.1]]));
      await prefixed.embedDocuments(["a measure about voter ID"]);
      expect(bodyOf(0).input).toEqual([
        "search_document: a measure about voter ID",
      ]);

      mockFetch.mockResolvedValueOnce(embedResponse([[0.2]]));
      await prefixed.embedQuery("requisitos de identificacion");
      expect(bodyOf(1).input).toEqual([
        "search_query: requisitos de identificacion",
      ]);
    });
  });

  describe("circuit breaker", () => {
    it("should provide circuit breaker health", () => {
      const health = provider.getCircuitBreakerHealth();

      expect(health).toBeDefined();
      expect(health.serviceName).toBe("Ollama");
      expect(health.state).toBe("closed");
      expect(health.isHealthy).toBe(true);
      expect(health.failureCount).toBe(0);
    });

    it("should track failures", async () => {
      // Simulate consecutive failures
      mockFetch.mockRejectedValue(new Error("Network error"));

      for (let i = 0; i < 3; i++) {
        await provider.embedQuery(`test-${i}`).catch(() => {});
      }

      const health = provider.getCircuitBreakerHealth();
      expect(health.failureCount).toBeGreaterThan(0);
    });

    it("should reset failure count on success", async () => {
      // First fail a few times
      mockFetch.mockRejectedValue(new Error("Network error"));
      await provider.embedQuery("fail").catch(() => {});
      await provider.embedQuery("fail2").catch(() => {});

      // Then succeed
      mockFetch.mockResolvedValueOnce(embedResponse([[0.1, 0.2]]));

      await provider.embedQuery("success");

      const health = provider.getCircuitBreakerHealth();
      expect(health.failureCount).toBe(0);
    });
  });
});
