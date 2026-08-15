import "reflect-metadata";
import { XenovaEmbeddingProvider } from "../src/providers/xenova.provider";
import { EmbeddingError } from "@opuspopuli/common";

// Mock @xenova/transformers
const mockPipeline = jest.fn();
jest.mock("@xenova/transformers", () => ({
  pipeline: (...args: any[]) => mockPipeline(...args),
}));

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe("XenovaEmbeddingProvider", () => {
  let provider: XenovaEmbeddingProvider;
  let mockPipelineFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPipelineFn = jest.fn();
    mockPipeline.mockResolvedValue(mockPipelineFn);
    provider = new XenovaEmbeddingProvider();
  });

  describe("constructor", () => {
    it("should initialize with default model", () => {
      expect(provider.getName()).toBe("Xenova");
      expect(provider.getModelName()).toBe("Xenova/all-MiniLM-L6-v2");
      expect(provider.getDimensions()).toBe(384);
    });

    it("should set correct dimensions for mpnet-base model", () => {
      const mpnetProvider = new XenovaEmbeddingProvider(
        "Xenova/all-mpnet-base-v2",
      );
      expect(mpnetProvider.getDimensions()).toBe(768);
    });

    it("should set correct dimensions for bge-small model", () => {
      const bgeProvider = new XenovaEmbeddingProvider(
        "Xenova/bge-small-en-v1.5",
      );
      expect(bgeProvider.getDimensions()).toBe(384);
    });

    it("should set correct dimensions for bge-base model", () => {
      const bgeProvider = new XenovaEmbeddingProvider(
        "Xenova/bge-base-en-v1.5",
      );
      expect(bgeProvider.getDimensions()).toBe(768);
    });

    // The fallback arm of getDimensionsForModel. An unrecognised model must
    // still yield a usable dimension rather than undefined — a vector of the
    // wrong width fails at insert time, far from the cause.
    it("falls back to 384 dimensions for an unrecognised model", () => {
      const unknown = new XenovaEmbeddingProvider("Xenova/some-future-model");
      expect(unknown.getDimensions()).toBe(384);
      expect(unknown.getModelName()).toBe("Xenova/some-future-model");
    });
  });

  describe("embedQuery", () => {
    it("should embed a query successfully", async () => {
      const mockEmbedding = new Float32Array([0.1, 0.2, 0.3]);
      mockPipelineFn.mockResolvedValue({ data: mockEmbedding });

      const result = await provider.embedQuery("test query");

      expect(result).toEqual([0.1, 0.2, 0.3].map((v) => expect.closeTo(v, 5)));
      expect(mockPipeline).toHaveBeenCalledWith(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
      expect(mockPipelineFn).toHaveBeenCalledWith("test query", {
        pooling: "mean",
        normalize: true,
      });
    });

    it("should initialize pipeline only once", async () => {
      mockPipelineFn.mockResolvedValue({ data: new Float32Array([0.1]) });

      await provider.embedQuery("query1");
      await provider.embedQuery("query2");

      expect(mockPipeline).toHaveBeenCalledTimes(1);
    });

    it("should throw EmbeddingError on pipeline failure", async () => {
      mockPipelineFn.mockRejectedValue(new Error("Pipeline error"));

      await expect(provider.embedQuery("test")).rejects.toThrow(EmbeddingError);
    });
  });

  describe("embedDocuments", () => {
    it("should embed multiple documents", async () => {
      mockPipelineFn
        .mockResolvedValueOnce({ data: new Float32Array([0.1, 0.2]) })
        .mockResolvedValueOnce({ data: new Float32Array([0.3, 0.4]) });

      const result = await provider.embedDocuments(["doc1", "doc2"]);

      expect(result).toHaveLength(2);
      expect(mockPipelineFn).toHaveBeenCalledTimes(2);
    });

    // Batching only becomes observable above the batch size of 32; every
    // other test here passes two documents, so the second iteration of the
    // loop and its progress branch were never executed.
    it("embeds across multiple batches when given more than one batch", async () => {
      const texts = Array.from({ length: 40 }, (_, i) => `doc${i}`);
      mockPipelineFn.mockResolvedValue({ data: new Float32Array([0.1, 0.2]) });

      const result = await provider.embedDocuments(texts);

      expect(result).toHaveLength(40);
      expect(mockPipelineFn).toHaveBeenCalledTimes(40);
    });

    it("returns an empty array for no documents without calling the model", async () => {
      const result = await provider.embedDocuments([]);

      expect(result).toEqual([]);
      expect(mockPipelineFn).not.toHaveBeenCalled();
    });

    it("should throw EmbeddingError when embedding fails", async () => {
      mockPipelineFn
        .mockResolvedValueOnce({ data: new Float32Array([0.1]) })
        .mockRejectedValueOnce(new Error("Failed"));

      await expect(provider.embedDocuments(["doc1", "doc2"])).rejects.toThrow(
        EmbeddingError,
      );
    });
  });

  describe("initialization error", () => {
    it("should throw when Transformers.js fails to load", async () => {
      mockPipeline.mockRejectedValue(new Error("Module not found"));

      const newProvider = new XenovaEmbeddingProvider();

      await expect(newProvider.embedQuery("test")).rejects.toThrow(
        /Xenova initialization failed/,
      );
    });
  });
});
