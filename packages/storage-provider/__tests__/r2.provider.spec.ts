/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConfigService } from "@nestjs/config";
import { R2StorageProvider } from "../src/providers/r2.provider";
import { StorageError } from "@opuspopuli/common";

// Mock the AWS S3 client
const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    ListObjectsV2Command: jest.fn().mockImplementation((input) => ({
      ...input,
      _type: "ListObjectsV2Command",
    })),
    DeleteObjectCommand: jest.fn().mockImplementation((input) => ({
      ...input,
      _type: "DeleteObjectCommand",
    })),
    HeadObjectCommand: jest.fn().mockImplementation((input) => ({
      ...input,
      _type: "HeadObjectCommand",
    })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({
      ...input,
      _type: "GetObjectCommand",
    })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({
      ...input,
      _type: "PutObjectCommand",
    })),
  };
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest
    .fn()
    .mockResolvedValue("https://signed-url.example.com/presigned"),
}));

describe("R2StorageProvider", () => {
  let provider: R2StorageProvider;
  let configService: ConfigService;

  const createConfigService = (
    overrides: Record<string, string | undefined> = {},
  ) => {
    const config: Record<string, string | undefined> = {
      "r2.accountId": "test-account-id",
      "r2.accessKeyId": "test-access-key",
      "r2.secretAccessKey": "test-secret-key",
      ...overrides,
    };
    return {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    configService = createConfigService();
    provider = new R2StorageProvider(configService);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider).toBeDefined();
      expect(provider.getName()).toBe("R2StorageProvider");
    });

    it("should throw StorageError when accountId is missing", () => {
      const badConfig = createConfigService({
        "r2.accountId": undefined,
      });

      expect(() => new R2StorageProvider(badConfig)).toThrow(StorageError);
    });

    it("should throw StorageError when accessKeyId is missing", () => {
      const badConfig = createConfigService({
        "r2.accessKeyId": undefined,
      });

      expect(() => new R2StorageProvider(badConfig)).toThrow(StorageError);
    });

    it("should throw StorageError when secretAccessKey is missing", () => {
      const badConfig = createConfigService({
        "r2.secretAccessKey": undefined,
      });

      expect(() => new R2StorageProvider(badConfig)).toThrow(StorageError);
    });
  });

  describe("listFiles", () => {
    it("should list files successfully", async () => {
      mockSend.mockResolvedValue({
        Contents: [
          {
            Key: "user1/file1.txt",
            Size: 100,
            LastModified: new Date("2025-01-01T00:00:00Z"),
            ETag: '"abc"',
          },
          {
            Key: "user1/file2.txt",
            Size: 200,
            LastModified: new Date("2025-01-02T00:00:00Z"),
            ETag: '"def"',
          },
        ],
        IsTruncated: false,
      });

      const result = await provider.listFiles("test-bucket", "user1");

      expect(result.files).toHaveLength(2);
      expect(result.files[0].key).toBe("user1/file1.txt");
      expect(result.files[0].size).toBe(100);
      expect(result.isTruncated).toBe(false);
    });

    it("should handle empty results", async () => {
      mockSend.mockResolvedValue({
        Contents: [],
        IsTruncated: false,
      });

      const result = await provider.listFiles("test-bucket", "empty-prefix");

      expect(result.files).toHaveLength(0);
    });

    it("should handle truncated results with continuation token", async () => {
      mockSend.mockResolvedValue({
        Contents: [{ Key: "file.txt", Size: 100 }],
        IsTruncated: true,
        NextContinuationToken: "next-token",
      });

      const result = await provider.listFiles("test-bucket", "prefix");

      expect(result.isTruncated).toBe(true);
      expect(result.continuationToken).toBe("next-token");
    });

    it("should throw StorageError on failure", async () => {
      mockSend.mockRejectedValue(new Error("List failed"));

      await expect(provider.listFiles("test-bucket", "user1")).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe("getSignedUrl", () => {
    it("should get signed URL for download", async () => {
      const url = await provider.getSignedUrl(
        "test-bucket",
        "user1/file.txt",
        false,
      );

      expect(url).toBe("https://signed-url.example.com/presigned");
    });

    it("should get signed URL for upload", async () => {
      const url = await provider.getSignedUrl(
        "test-bucket",
        "user1/file.txt",
        true,
      );

      expect(url).toBe("https://signed-url.example.com/presigned");
    });

    it("should use custom expiration", async () => {
      const { getSignedUrl: mockGetSignedUrl } =
        require("@aws-sdk/s3-request-presigner") as any;

      await provider.getSignedUrl("test-bucket", "user1/file.txt", false, {
        expiresIn: 7200,
      });

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 7200 },
      );
    });

    it("should throw StorageError on failure", async () => {
      const { getSignedUrl: mockGetSignedUrl } =
        require("@aws-sdk/s3-request-presigner") as any;
      mockGetSignedUrl.mockRejectedValueOnce(new Error("Signed URL failed"));

      await expect(
        provider.getSignedUrl("test-bucket", "user1/file.txt", false),
      ).rejects.toThrow(StorageError);
    });
  });

  describe("deleteFile", () => {
    it("should delete file successfully", async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.deleteFile("test-bucket", "user1/file.txt");

      expect(result).toBe(true);
    });

    it("should throw StorageError on failure", async () => {
      mockSend.mockRejectedValue(new Error("Delete failed"));

      await expect(
        provider.deleteFile("test-bucket", "user1/file.txt"),
      ).rejects.toThrow(StorageError);
    });
  });

  describe("exists", () => {
    it("should return true if file exists", async () => {
      mockSend.mockResolvedValue({
        ContentLength: 1024,
      });

      const result = await provider.exists("test-bucket", "user1/file.txt");

      expect(result).toBe(true);
    });

    it("should return false if file does not exist", async () => {
      const notFoundError = new Error("Not Found");
      (notFoundError as any).name = "NotFound";
      mockSend.mockRejectedValue(notFoundError);

      const result = await provider.exists(
        "test-bucket",
        "user1/nonexistent.txt",
      );

      expect(result).toBe(false);
    });

    it("should throw StorageError on unexpected failure", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));

      await expect(
        provider.exists("test-bucket", "user1/file.txt"),
      ).rejects.toThrow(StorageError);
    });
  });

  describe("getMetadata", () => {
    it("should return file metadata", async () => {
      mockSend.mockResolvedValue({
        ContentLength: 1024,
        LastModified: new Date("2025-01-01T00:00:00Z"),
        ETag: '"abc123"',
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
      const notFoundError = new Error("Not Found");
      (notFoundError as any).name = "NotFound";
      mockSend.mockRejectedValue(notFoundError);

      const result = await provider.getMetadata(
        "test-bucket",
        "user1/nonexistent.txt",
      );

      expect(result).toBeNull();
    });

    it("should throw StorageError on unexpected failure", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));

      await expect(
        provider.getMetadata("test-bucket", "user1/file.txt"),
      ).rejects.toThrow(StorageError);
    });
  });
});
