/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConfigService } from "@nestjs/config";
import { SupabaseStorageProvider } from "../src/providers/supabase.provider";
import { StorageError } from "@opuspopuli/common";

// Mock the Supabase client
const mockStorage = {
  from: jest.fn().mockReturnThis(),
  list: jest.fn(),
  createSignedUrl: jest.fn(),
  createSignedUploadUrl: jest.fn(),
  remove: jest.fn(),
};

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn().mockImplementation(() => ({
    storage: mockStorage,
  })),
}));

describe("SupabaseStorageProvider", () => {
  let provider: SupabaseStorageProvider;
  let configService: ConfigService;

  const createConfigService = (
    overrides: Record<string, string | undefined> = {},
  ) => {
    const config: Record<string, string | undefined> = {
      "supabase.url": "http://localhost:8000",
      "supabase.anonKey": "test-anon-key",
      "supabase.serviceRoleKey": "test-service-key",
      ...overrides,
    };
    return {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService = createConfigService();
    provider = new SupabaseStorageProvider(configService);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider).toBeDefined();
      expect(provider.getName()).toBe("SupabaseStorageProvider");
    });

    it("should throw StorageError when config is missing", () => {
      const badConfig = createConfigService({
        "supabase.url": undefined,
        "supabase.anonKey": undefined,
        "supabase.serviceRoleKey": undefined,
      });

      expect(() => new SupabaseStorageProvider(badConfig)).toThrow(
        StorageError,
      );
    });
  });

  describe("listFiles", () => {
    it("should list files successfully", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [
          {
            name: "file1.txt",
            metadata: { size: 100, eTag: '"abc"' },
            updated_at: "2025-01-01T00:00:00Z",
          },
          {
            name: "file2.txt",
            metadata: { size: 200, eTag: '"def"' },
            updated_at: "2025-01-02T00:00:00Z",
          },
        ],
        error: null,
      });

      const result = await provider.listFiles("test-bucket", "user1");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].key).toBe("user1/file1.txt");
      expect(result.files[0].size).toBe(100);
      expect(result.isTruncated).toBe(false);
    });

    it("should handle empty results", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await provider.listFiles("test-bucket", "empty-prefix");

      expect(result.files).toHaveLength(0);
    });

    it("should handle root prefix", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [{ name: "root-file.txt", metadata: {} }],
        error: null,
      });

      const result = await provider.listFiles("test-bucket", "");

      expect(result.files[0].key).toBe("root-file.txt");
    });

    it("should throw StorageError on failure", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: null,
        error: { message: "List failed" },
      });

      await expect(provider.listFiles("test-bucket", "user1")).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe("getSignedUrl", () => {
    it("should get signed URL for download", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.createSignedUrl.mockResolvedValue({
        data: { signedUrl: "https://signed-url.example.com/download" },
        error: null,
      });

      const url = await provider.getSignedUrl(
        "test-bucket",
        "user1/file.txt",
        false,
      );

      expect(url).toBe("https://signed-url.example.com/download");
      expect(mockStorage.createSignedUrl).toHaveBeenCalledWith(
        "user1/file.txt",
        3600,
      );
    });

    it("should get signed URL for upload", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.createSignedUploadUrl.mockResolvedValue({
        data: { signedUrl: "https://signed-url.example.com/upload" },
        error: null,
      });

      const url = await provider.getSignedUrl(
        "test-bucket",
        "user1/file.txt",
        true,
      );

      expect(url).toBe("https://signed-url.example.com/upload");
      expect(mockStorage.createSignedUploadUrl).toHaveBeenCalledWith(
        "user1/file.txt",
      );
    });

    it("should use custom expiration for download", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.createSignedUrl.mockResolvedValue({
        data: { signedUrl: "https://signed-url.example.com" },
        error: null,
      });

      await provider.getSignedUrl("test-bucket", "user1/file.txt", false, {
        expiresIn: 7200,
      });

      expect(mockStorage.createSignedUrl).toHaveBeenCalledWith(
        "user1/file.txt",
        7200,
      );
    });

    it("should throw StorageError on download failure", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.createSignedUrl.mockResolvedValue({
        data: null,
        error: { message: "Signed URL failed" },
      });

      await expect(
        provider.getSignedUrl("test-bucket", "user1/file.txt", false),
      ).rejects.toThrow(StorageError);
    });

    it("should throw StorageError on upload failure", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.createSignedUploadUrl.mockResolvedValue({
        data: null,
        error: { message: "Upload URL failed" },
      });

      await expect(
        provider.getSignedUrl("test-bucket", "user1/file.txt", true),
      ).rejects.toThrow(StorageError);
    });
  });

  describe("deleteFile", () => {
    it("should delete file successfully", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.remove.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await provider.deleteFile("test-bucket", "user1/file.txt");

      expect(result).toBe(true);
      expect(mockStorage.remove).toHaveBeenCalledWith(["user1/file.txt"]);
    });

    it("should throw StorageError on failure", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.remove.mockResolvedValue({
        data: null,
        error: { message: "Delete failed" },
      });

      await expect(
        provider.deleteFile("test-bucket", "user1/file.txt"),
      ).rejects.toThrow(StorageError);
    });
  });

  describe("exists", () => {
    it("should return true if file exists", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [{ name: "file.txt" }],
        error: null,
      });

      const result = await provider.exists("test-bucket", "user1/file.txt");

      expect(result).toBe(true);
    });

    it("should return false if file does not exist", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await provider.exists(
        "test-bucket",
        "user1/nonexistent.txt",
      );

      expect(result).toBe(false);
    });

    it("should handle root-level files", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [{ name: "root-file.txt" }],
        error: null,
      });

      const result = await provider.exists("test-bucket", "root-file.txt");

      expect(result).toBe(true);
    });

    it("should throw StorageError on failure", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: null,
        error: { message: "List failed" },
      });

      await expect(
        provider.exists("test-bucket", "user1/file.txt"),
      ).rejects.toThrow(StorageError);
    });
  });

  describe("getMetadata", () => {
    it("should return file metadata", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [
          {
            name: "file.txt",
            metadata: { size: 1024, eTag: '"abc123"' },
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      });

      const result = await provider.getMetadata(
        "test-bucket",
        "user1/file.txt",
      );

      expect(result).toEqual({
        key: "user1/file.txt",
        size: 1024,
        lastModified: new Date("2025-01-01T00:00:00Z"),
        etag: '"abc123"',
      });
    });

    it("should return null if file does not exist", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await provider.getMetadata(
        "test-bucket",
        "user1/nonexistent.txt",
      );

      expect(result).toBeNull();
    });

    it("should handle root-level files", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: [
          {
            name: "root-file.txt",
            metadata: { size: 512 },
          },
        ],
        error: null,
      });

      const result = await provider.getMetadata("test-bucket", "root-file.txt");

      expect(result?.key).toBe("root-file.txt");
      expect(result?.size).toBe(512);
    });

    it("should throw StorageError on failure", async () => {
      mockStorage.from.mockReturnThis();
      mockStorage.list.mockResolvedValue({
        data: null,
        error: { message: "Metadata failed" },
      });

      await expect(
        provider.getMetadata("test-bucket", "user1/file.txt"),
      ).rejects.toThrow(StorageError);
    });
  });
});
