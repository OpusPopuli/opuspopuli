import "reflect-metadata";
import { PgVectorProvider } from "../src/providers/pgvector.provider";
import { VectorDBError } from "@opuspopuli/common";
import { DataSource, QueryRunner } from "typeorm";

// Mock TypeORM
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockCreateQueryRunner = jest.fn();

jest.mock("typeorm", () => ({
  DataSource: jest.fn().mockImplementation(() => ({
    createQueryRunner: mockCreateQueryRunner,
    initialize: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: unknown) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe("PgVectorProvider", () => {
  let provider: PgVectorProvider;
  let mockDataSource: DataSource;
  let mockQueryRunner: Partial<QueryRunner>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQueryRunner = {
      connect: mockConnect.mockResolvedValue(undefined),
      query: mockQuery,
      release: mockRelease,
    };

    mockCreateQueryRunner.mockReturnValue(mockQueryRunner);

    mockDataSource = new DataSource({
      type: "postgres",
      host: "localhost",
      database: "test",
    });

    provider = new PgVectorProvider(mockDataSource, "test_embeddings", 384);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider.getName()).toBe("PgVector");
      expect(provider.getDimensions()).toBe(384);
    });

    it("should use default dimensions when not provided", () => {
      const defaultProvider = new PgVectorProvider(
        mockDataSource,
        "test_embeddings",
      );
      expect(defaultProvider.getDimensions()).toBe(384);
    });

    it("should sanitize collection name for table name", () => {
      const specialProvider = new PgVectorProvider(
        mockDataSource,
        "test-collection.name",
        384,
      );
      expect(specialProvider.getName()).toBe("PgVector");
    });
  });

  describe("initialize", () => {
    it("should create table and indexes", async () => {
      mockQuery.mockResolvedValue(undefined);

      await provider.initialize();

      expect(mockConnect).toHaveBeenCalled();
      // Should create extension
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("CREATE EXTENSION IF NOT EXISTS vector"),
      );
      // Should create table
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS"),
      );
      // Should create indexes
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("CREATE INDEX IF NOT EXISTS"),
      );
    });

    it("should throw VectorDBError on failure", async () => {
      mockConnect.mockRejectedValue(new Error("Connection failed"));

      await expect(provider.initialize()).rejects.toThrow(VectorDBError);
    });
  });

  describe("createEmbeddings", () => {
    beforeEach(async () => {
      mockQuery.mockResolvedValue(undefined);
      await provider.initialize();
      mockQuery.mockClear();
    });

    it("should insert embeddings into table", async () => {
      mockQuery.mockResolvedValue(undefined);

      const result = await provider.createEmbeddings(
        "user-1",
        "doc-1",
        [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        ["content 1", "content 2"],
      );

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO"),
        expect.arrayContaining([
          "doc-1-0",
          "doc-1",
          "user-1",
          "content 1",
          "[0.1,0.2]",
          "doc-1-1",
          "doc-1",
          "user-1",
          "content 2",
          "[0.3,0.4]",
        ]),
      );
    });

    it("should batch large embeddings", async () => {
      mockQuery.mockResolvedValue(undefined);

      // Create 150 embeddings to test batching (batch size is 100)
      const embeddings = Array(150).fill([0.1, 0.2]);
      const contents = Array(150).fill("content");

      await provider.createEmbeddings("user-1", "doc-1", embeddings, contents);

      // Should be called twice (100 + 50)
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it("should throw VectorDBError when not initialized", async () => {
      const uninitializedProvider = new PgVectorProvider(
        mockDataSource,
        "test_embeddings",
      );

      await expect(
        uninitializedProvider.createEmbeddings(
          "user-1",
          "doc-1",
          [[0.1]],
          ["content"],
        ),
      ).rejects.toThrow(VectorDBError);
    });

    it("should throw VectorDBError on insert failure", async () => {
      mockQuery.mockRejectedValue(new Error("Insert failed"));

      await expect(
        provider.createEmbeddings("user-1", "doc-1", [[0.1]], ["content"]),
      ).rejects.toThrow(VectorDBError);
    });
  });

  describe("queryEmbeddings", () => {
    beforeEach(async () => {
      mockQuery.mockResolvedValue(undefined);
      await provider.initialize();
      mockQuery.mockClear();
    });

    it("should query embeddings and return documents", async () => {
      mockQuery.mockResolvedValue([
        {
          id: "doc-1-0",
          document_id: "doc-1",
          user_id: "user-1",
          content: "content 1",
          embedding_text: "[0.1,0.2]",
          similarity: 0.95,
        },
        {
          id: "doc-1-1",
          document_id: "doc-1",
          user_id: "user-1",
          content: "content 2",
          embedding_text: "[0.3,0.4]",
          similarity: 0.85,
        },
      ]);

      const results = await provider.queryEmbeddings([0.1, 0.2], "user-1", 5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY embedding"),
        ["[0.1,0.2]", "user-1", 5],
      );
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: "doc-1-0",
        embedding: [0.1, 0.2],
        metadata: { source: "doc-1", userId: "user-1" },
        content: "content 1",
        score: 0.95,
      });
    });

    it("should return empty array when no results", async () => {
      mockQuery.mockResolvedValue([]);

      const results = await provider.queryEmbeddings([0.1], "user-1", 5);

      expect(results).toEqual([]);
    });

    it("should throw VectorDBError when not initialized", async () => {
      const uninitializedProvider = new PgVectorProvider(
        mockDataSource,
        "test_embeddings",
      );

      await expect(
        uninitializedProvider.queryEmbeddings([0.1], "user-1", 5),
      ).rejects.toThrow(VectorDBError);
    });

    it("should throw VectorDBError on query failure", async () => {
      mockQuery.mockRejectedValue(new Error("Query failed"));

      await expect(
        provider.queryEmbeddings([0.1], "user-1", 5),
      ).rejects.toThrow(VectorDBError);
    });
  });

  describe("deleteEmbeddingsByDocumentId", () => {
    beforeEach(async () => {
      mockQuery.mockResolvedValue(undefined);
      await provider.initialize();
      mockQuery.mockClear();
    });

    it("should delete embeddings by document id", async () => {
      mockQuery.mockResolvedValue(undefined);

      await provider.deleteEmbeddingsByDocumentId("doc-1");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM"),
        ["doc-1"],
      );
    });

    it("should throw VectorDBError when not initialized", async () => {
      const uninitializedProvider = new PgVectorProvider(
        mockDataSource,
        "test_embeddings",
      );

      await expect(
        uninitializedProvider.deleteEmbeddingsByDocumentId("doc-1"),
      ).rejects.toThrow(VectorDBError);
    });

    it("should throw VectorDBError on delete failure", async () => {
      mockQuery.mockRejectedValue(new Error("Delete failed"));

      await expect(
        provider.deleteEmbeddingsByDocumentId("doc-1"),
      ).rejects.toThrow(VectorDBError);
    });
  });

  describe("deleteEmbeddingById", () => {
    beforeEach(async () => {
      mockQuery.mockResolvedValue(undefined);
      await provider.initialize();
      mockQuery.mockClear();
    });

    it("should delete embedding by id", async () => {
      mockQuery.mockResolvedValue(undefined);

      await provider.deleteEmbeddingById("doc-1-0");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM"),
        ["doc-1-0"],
      );
    });

    it("should throw VectorDBError when not initialized", async () => {
      const uninitializedProvider = new PgVectorProvider(
        mockDataSource,
        "test_embeddings",
      );

      await expect(
        uninitializedProvider.deleteEmbeddingById("doc-1-0"),
      ).rejects.toThrow(VectorDBError);
    });

    it("should throw VectorDBError on delete failure", async () => {
      mockQuery.mockRejectedValue(new Error("Delete failed"));

      await expect(provider.deleteEmbeddingById("doc-1-0")).rejects.toThrow(
        VectorDBError,
      );
    });
  });
});
