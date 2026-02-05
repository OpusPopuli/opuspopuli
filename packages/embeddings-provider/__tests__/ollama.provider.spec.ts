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

describe("OllamaEmbeddingProvider", () => {
  let provider: OllamaEmbeddingProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OllamaEmbeddingProvider(
      "http://localhost:11434",
      "nomic-embed-text",
    );
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      const defaultProvider = new OllamaEmbeddingProvider();
      expect(defaultProvider.getName()).toBe("Ollama");
      expect(defaultProvider.getModelName()).toBe("nomic-embed-text");
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
  });

  describe("embedQuery", () => {
    it("should embed a query successfully", async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embedding: mockEmbedding }),
      });

      const result = await provider.embedQuery("test query");

      expect(result).toEqual(mockEmbedding);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
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
    it("should embed multiple documents", async () => {
      const mockEmbedding1 = [0.1, 0.2];
      const mockEmbedding2 = [0.3, 0.4];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ embedding: mockEmbedding1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ embedding: mockEmbedding2 }),
        });

      const result = await provider.embedDocuments(["doc1", "doc2"]);

      expect(result).toEqual([mockEmbedding1, mockEmbedding2]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw EmbeddingError when one document fails", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ embedding: [0.1] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Error"),
        });

      await expect(provider.embedDocuments(["doc1", "doc2"])).rejects.toThrow(
        EmbeddingError,
      );
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ embedding: [0.1, 0.2] }),
      });

      await provider.embedQuery("success");

      const health = provider.getCircuitBreakerHealth();
      expect(health.failureCount).toBe(0);
    });
  });
});
