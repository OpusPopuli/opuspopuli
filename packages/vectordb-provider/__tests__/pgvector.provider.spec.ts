import { PgVectorProvider } from "../src/providers/pgvector.provider";
import { VectorDBError } from "@opuspopuli/common";
import { IRawQueryClient } from "../src/types";

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
  let mockClient: jest.Mocked<IRawQueryClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    provider = new PgVectorProvider(mockClient, "test_embeddings", 384);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider.getName()).toBe("PgVector");
      expect(provider.getDimensions()).toBe(384);
    });

    it("should use default dimensions when not provided", () => {
      const defaultProvider = new PgVectorProvider(
        mockClient,
        "test_embeddings",
      );
      // 768 since the #1156 cutover: no selectable provider emits 384
      // any more, so a fallback to it would create a table the running
      // model cannot insert into (#1289).
      expect(defaultProvider.getDimensions()).toBe(768);
    });

    it("should sanitize collection name for table name", () => {
      const specialProvider = new PgVectorProvider(
        mockClient,
        "test-collection.name",
        384,
      );
      expect(specialProvider.getName()).toBe("PgVector");
    });
  });

  describe("initialize", () => {
    it("should create table and indexes", async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);

      await provider.initialize();

      // Should create extension
      expect(mockClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("CREATE EXTENSION IF NOT EXISTS vector"),
      );
      // Should create table
      expect(mockClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS"),
      );
      // Should create indexes
      expect(mockClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("CREATE INDEX IF NOT EXISTS"),
      );
    });

    it("should throw VectorDBError on failure", async () => {
      mockClient.$executeRawUnsafe.mockRejectedValue(
        new Error("Connection failed"),
      );

      await expect(provider.initialize()).rejects.toThrow(VectorDBError);
    });
  });

  describe("createEmbeddings", () => {
    beforeEach(async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);
      await provider.initialize();
      mockClient.$executeRawUnsafe.mockClear();
    });

    it("should insert embeddings into table", async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);

      const result = await provider.createEmbeddings(
        "user-1",
        "doc-1",
        [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        ["content 1", "content 2"],
        "nomic-embed-text-v2-moe:latest",
      );

      expect(result).toBe(true);
      expect(mockClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO"),
        "doc-1-0",
        "doc-1",
        "user-1",
        "content 1",
        "[0.1,0.2]",
        "nomic-embed-text-v2-moe:latest",
        "doc-1-1",
        "doc-1",
        "user-1",
        "content 2",
        "[0.3,0.4]",
        "nomic-embed-text-v2-moe:latest",
      );
    });

    it("should batch large embeddings", async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);

      // Create 150 embeddings to test batching (batch size is 100)
      const embeddings = Array(150).fill([0.1, 0.2]);
      const contents = Array(150).fill("content");

      await provider.createEmbeddings(
        "user-1",
        "doc-1",
        embeddings,
        contents,
        "nomic-embed-text-v2-moe:latest",
      );

      // Should be called twice (100 + 50)
      expect(mockClient.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it("should throw VectorDBError on insert failure", async () => {
      mockClient.$executeRawUnsafe.mockRejectedValue(
        new Error("Insert failed"),
      );

      await expect(
        provider.createEmbeddings("user-1", "doc-1", [[0.1]], ["content"], "m"),
      ).rejects.toThrow(VectorDBError);
    });
  });

  describe("queryEmbeddings", () => {
    beforeEach(async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);
      await provider.initialize();
      mockClient.$executeRawUnsafe.mockClear();
    });

    it("should query embeddings and return documents", async () => {
      mockClient.$queryRawUnsafe.mockResolvedValue([
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

      expect(mockClient.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY embedding"),
        "[0.1,0.2]",
        "user-1",
        5,
        // Null when the caller names no model: the filter is a no-op and the
        // ranking spans whatever models the corpus holds, which is the old
        // behaviour preserved for callers not yet updated (#1289).
        null,
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
      mockClient.$queryRawUnsafe.mockResolvedValue([]);

      const results = await provider.queryEmbeddings([0.1], "user-1", 5);

      expect(results).toEqual([]);
    });

    it("should throw VectorDBError on query failure", async () => {
      mockClient.$queryRawUnsafe.mockRejectedValue(new Error("Query failed"));

      await expect(
        provider.queryEmbeddings([0.1], "user-1", 5),
      ).rejects.toThrow(VectorDBError);
    });

    it("ranks only within the named model's space (#1289)", async () => {
      mockClient.$queryRawUnsafe.mockResolvedValue([]);

      await provider.queryEmbeddings(
        [0.1, 0.2],
        "user-1",
        5,
        "nomic-embed-text-v2-moe:latest",
      );

      // Cosine distance between two models' vectors is a number, not a
      // measurement. Without the filter the nearest row is arbitrary while
      // looking exactly like a real match.
      const [sql, , , , model] = mockClient.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain("embedding_model = $4");
      expect(model).toBe("nomic-embed-text-v2-moe:latest");
    });

    it("records the model that produced each vector (#1289)", async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(1);

      await provider.createEmbeddings(
        "user-1",
        "doc-1",
        [[0.1, 0.2]],
        ["content"],
        "nomic-embed-text-v2-moe:latest",
      );

      // A store with no model column cannot even detect a mixed corpus, let
      // alone exclude one from a ranking — and it cannot be retrofitted
      // honestly once it holds rows.
      const [sql, ...params] = mockClient.$executeRawUnsafe.mock.calls.at(-1)!;
      expect(sql).toContain("embedding_model");
      expect(params).toContain("nomic-embed-text-v2-moe:latest");
    });
  });

  describe("deleteEmbeddingsByDocumentId", () => {
    beforeEach(async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);
      await provider.initialize();
      mockClient.$executeRawUnsafe.mockClear();
    });

    it("should delete embeddings by document id", async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);

      await provider.deleteEmbeddingsByDocumentId("doc-1");

      expect(mockClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM"),
        "doc-1",
      );
    });

    it("should throw VectorDBError on delete failure", async () => {
      mockClient.$executeRawUnsafe.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(
        provider.deleteEmbeddingsByDocumentId("doc-1"),
      ).rejects.toThrow(VectorDBError);
    });
  });

  describe("deleteEmbeddingById", () => {
    beforeEach(async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);
      await provider.initialize();
      mockClient.$executeRawUnsafe.mockClear();
    });

    it("should delete embedding by id", async () => {
      mockClient.$executeRawUnsafe.mockResolvedValue(0);

      await provider.deleteEmbeddingById("doc-1-0");

      expect(mockClient.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM"),
        "doc-1-0",
      );
    });

    it("should throw VectorDBError on delete failure", async () => {
      mockClient.$executeRawUnsafe.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(provider.deleteEmbeddingById("doc-1-0")).rejects.toThrow(
        VectorDBError,
      );
    });
  });
});
