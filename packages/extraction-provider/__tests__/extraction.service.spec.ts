import "reflect-metadata";
import { TextExtractionService } from "../src/extraction.service";
import {
  ITextExtractor,
  TextExtractionInput,
  TextExtractionResult,
  NoExtractorFoundError,
} from "@opuspopuli/common";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe("TextExtractionService", () => {
  let service: TextExtractionService;
  let mockUrlExtractor: jest.Mocked<ITextExtractor>;
  let mockS3Extractor: jest.Mocked<ITextExtractor>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUrlExtractor = {
      getName: jest.fn().mockReturnValue("URLExtractor"),
      supports: jest.fn((input) => input.type === "url"),
      extractText: jest.fn(),
    };

    mockS3Extractor = {
      getName: jest.fn().mockReturnValue("S3Extractor"),
      supports: jest.fn((input) => input.type === "storage"),
      extractText: jest.fn(),
    };

    service = new TextExtractionService([mockUrlExtractor, mockS3Extractor]);
  });

  describe("constructor", () => {
    it("should initialize with extractors", () => {
      expect(mockUrlExtractor.getName).toHaveBeenCalled();
      expect(mockS3Extractor.getName).toHaveBeenCalled();
    });
  });

  describe("extractText", () => {
    it("should delegate to URL extractor for url input", async () => {
      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };
      const expectedResult: TextExtractionResult = {
        text: "Extracted text",
        metadata: {
          source: "https://example.com",
          extractedAt: new Date(),
          extractor: "URLExtractor",
        },
      };

      mockUrlExtractor.extractText.mockResolvedValue(expectedResult);

      const result = await service.extractText(input);

      expect(mockUrlExtractor.supports).toHaveBeenCalledWith(input);
      expect(mockUrlExtractor.extractText).toHaveBeenCalledWith(input);
      expect(result).toEqual(expectedResult);
    });

    it("should delegate to S3 extractor for s3 input", async () => {
      const input: TextExtractionInput = {
        type: "storage",
        bucket: "bucket",
        key: "key",
        userId: "user-1",
      };
      const expectedResult: TextExtractionResult = {
        text: "S3 text",
        metadata: {
          source: "s3://bucket/key",
          extractedAt: new Date(),
          extractor: "S3Extractor",
        },
      };

      mockS3Extractor.extractText.mockResolvedValue(expectedResult);

      const result = await service.extractText(input);

      expect(mockS3Extractor.supports).toHaveBeenCalledWith(input);
      expect(mockS3Extractor.extractText).toHaveBeenCalledWith(input);
      expect(result).toEqual(expectedResult);
    });

    it("should throw NoExtractorFoundError when no extractor supports input", async () => {
      const input: TextExtractionInput = {
        type: "file",
        buffer: Buffer.from(""),
        mimeType: "text/plain",
        userId: "user-1",
      };

      await expect(service.extractText(input)).rejects.toThrow(
        NoExtractorFoundError,
      );
    });

    it("should use first matching extractor", async () => {
      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };
      const expectedResult: TextExtractionResult = {
        text: "text",
        metadata: {
          source: "",
          extractedAt: new Date(),
          extractor: "URLExtractor",
        },
      };

      mockUrlExtractor.extractText.mockResolvedValue(expectedResult);

      await service.extractText(input);

      // Should only call the first extractor that supports the input
      expect(mockUrlExtractor.extractText).toHaveBeenCalled();
      expect(mockS3Extractor.extractText).not.toHaveBeenCalled();
    });
  });

  describe("getSupportedTypes", () => {
    it("should return supported types", () => {
      const types = service.getSupportedTypes();

      expect(types).toContain("url");
      expect(types).toContain("storage");
      expect(types).not.toContain("file");
    });

    it("should return empty array when no extractors support any type", () => {
      const emptyService = new TextExtractionService([]);
      const types = emptyService.getSupportedTypes();

      expect(types).toEqual([]);
    });
  });
});
