import "reflect-metadata";
import { EmbeddingsService } from "../src/embeddings.service";
import { IEmbeddingProvider, ChunkingConfig } from "@opuspopuli/common";

// Mock @langchain/textsplitters
const mockSplitText = jest.fn();
jest.mock("@langchain/textsplitters", () => ({
  RecursiveCharacterTextSplitter: jest.fn().mockImplementation(() => ({
    splitText: mockSplitText,
  })),
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

describe("EmbeddingsService", () => {
  let service: EmbeddingsService;
  let mockProvider: jest.Mocked<IEmbeddingProvider>;
  const chunkingConfig: ChunkingConfig = {
    chunkSize: 1000,
    chunkOverlap: 200,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      getName: jest.fn().mockReturnValue("MockProvider"),
      getModelName: jest.fn().mockReturnValue("mock-model"),
      getDimensions: jest.fn().mockReturnValue(384),
      embedQuery: jest.fn(),
      embedDocuments: jest.fn(),
    };

    service = new EmbeddingsService(mockProvider, chunkingConfig);
  });

  describe("constructor", () => {
    it("should initialize with provider and chunking config", () => {
      expect(mockProvider.getName).toHaveBeenCalled();
      expect(mockProvider.getModelName).toHaveBeenCalled();
      expect(mockProvider.getDimensions).toHaveBeenCalled();
    });
  });

  describe("getEmbeddingsForText", () => {
    it("should chunk text and generate embeddings", async () => {
      const chunks = ["chunk 1", "chunk 2", "chunk 3"];
      const embeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];

      mockSplitText.mockResolvedValue(chunks);
      mockProvider.embedDocuments.mockResolvedValue(embeddings);

      const result = await service.getEmbeddingsForText(
        "Some long text to embed",
      );

      expect(mockSplitText).toHaveBeenCalledWith("Some long text to embed");
      expect(mockProvider.embedDocuments).toHaveBeenCalledWith(chunks);
      expect(result).toEqual({
        texts: chunks,
        embeddings,
        model: "mock-model",
        dimensions: 384,
      });
    });

    it("should handle single chunk", async () => {
      const chunks = ["short text"];
      const embeddings = [[0.1, 0.2, 0.3]];

      mockSplitText.mockResolvedValue(chunks);
      mockProvider.embedDocuments.mockResolvedValue(embeddings);

      const result = await service.getEmbeddingsForText("short text");

      expect(result.texts).toHaveLength(1);
      expect(result.embeddings).toHaveLength(1);
    });

    it("should propagate provider errors", async () => {
      mockSplitText.mockResolvedValue(["chunk"]);
      mockProvider.embedDocuments.mockRejectedValue(
        new Error("Provider error"),
      );

      await expect(service.getEmbeddingsForText("text")).rejects.toThrow(
        "Provider error",
      );
    });
  });

  describe("getEmbeddingsForQuery", () => {
    it("should generate embedding for query", async () => {
      const queryEmbedding = [0.1, 0.2, 0.3];
      mockProvider.embedQuery.mockResolvedValue(queryEmbedding);

      const result = await service.getEmbeddingsForQuery("test query");

      expect(mockProvider.embedQuery).toHaveBeenCalledWith("test query");
      expect(result).toEqual(queryEmbedding);
    });

    it("should propagate provider errors", async () => {
      mockProvider.embedQuery.mockRejectedValue(new Error("Query failed"));

      await expect(service.getEmbeddingsForQuery("test")).rejects.toThrow(
        "Query failed",
      );
    });
  });

  describe("getProviderInfo", () => {
    it("should return provider information", () => {
      const info = service.getProviderInfo();

      expect(info).toEqual({
        name: "MockProvider",
        model: "mock-model",
        dimensions: 384,
        chunkSize: 1000,
        chunkOverlap: 200,
      });
    });
  });
});
