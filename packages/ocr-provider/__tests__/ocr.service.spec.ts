import "reflect-metadata";
import { OcrService } from "../src/ocr.service";
import { IOcrProvider, OcrError, OcrResult } from "@opuspopuli/common";
import { ImagePreprocessor } from "../src/preprocessing/image-preprocessor";
import { PreprocessingResult } from "../src/preprocessing/types";

// Mock NestJS Logger and decorators
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  OnModuleDestroy: () => (target: any) => target,
  Optional: () => () => undefined,
}));

// Mock ImagePreprocessor
jest.mock("../src/preprocessing/image-preprocessor");

describe("OcrService", () => {
  let service: OcrService;
  let mockProvider: jest.Mocked<IOcrProvider>;
  let mockPreprocessor: jest.Mocked<ImagePreprocessor>;

  const mockResult: OcrResult = {
    text: "Hello World",
    blocks: [
      { text: "Hello", confidence: 95 },
      { text: "World", confidence: 93 },
    ],
    confidence: 94,
    provider: "MockProvider",
    processingTimeMs: 100,
  };

  beforeEach(() => {
    mockProvider = {
      extractText: jest.fn().mockResolvedValue(mockResult),
      supports: jest.fn().mockReturnValue(true),
      supportsMimeType: jest.fn().mockReturnValue(true),
      getName: jest.fn().mockReturnValue("MockProvider"),
      getSupportedLanguages: jest.fn().mockReturnValue(["eng"]),
    };

    service = new OcrService(mockProvider);
  });

  describe("extractText", () => {
    it("should call provider extractText", async () => {
      const input = {
        type: "buffer" as const,
        buffer: Buffer.from("test"),
        mimeType: "image/png",
      };

      const result = await service.extractText(input);

      expect(mockProvider.extractText).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockResult);
    });

    it("should throw OcrError when input not supported", async () => {
      mockProvider.supports.mockReturnValue(false);

      const input = {
        type: "buffer" as const,
        buffer: Buffer.from("test"),
        mimeType: "image/png",
      };

      await expect(service.extractText(input)).rejects.toThrow(OcrError);
    });
  });

  describe("extractFromBase64", () => {
    it("should extract text from base64 data", async () => {
      const result = await service.extractFromBase64(
        Buffer.from("test").toString("base64"),
        "image/png",
      );

      expect(mockProvider.extractText).toHaveBeenCalledWith({
        type: "base64",
        data: expect.any(String),
        mimeType: "image/png",
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe("extractFromBuffer", () => {
    it("should extract text from buffer", async () => {
      const buffer = Buffer.from("test");

      const result = await service.extractFromBuffer(buffer, "image/jpeg");

      expect(mockProvider.extractText).toHaveBeenCalledWith({
        type: "buffer",
        buffer,
        mimeType: "image/jpeg",
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe("supportsMimeType", () => {
    it("should delegate to provider", () => {
      mockProvider.supportsMimeType.mockReturnValue(true);
      expect(service.supportsMimeType("image/png")).toBe(true);

      mockProvider.supportsMimeType.mockReturnValue(false);
      expect(service.supportsMimeType("video/mp4")).toBe(false);
    });
  });

  describe("getProviderInfo", () => {
    it("should return provider information", () => {
      const info = service.getProviderInfo();

      expect(info.name).toBe("MockProvider");
      expect(info.supportedLanguages).toEqual(["eng"]);
    });
  });

  describe("onModuleDestroy", () => {
    it("should call terminate on provider if available", async () => {
      const mockTerminate = jest.fn().mockResolvedValue(undefined);
      (mockProvider as any).terminate = mockTerminate;

      await service.onModuleDestroy();

      expect(mockTerminate).toHaveBeenCalled();
    });

    it("should not throw if terminate not available", async () => {
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe("with preprocessing", () => {
    const preprocessedBuffer = Buffer.from("preprocessed");
    const mockPreprocessingResult: PreprocessingResult = {
      buffer: preprocessedBuffer,
      mimeType: "image/png",
      metadata: {
        enabled: true,
        stepsApplied: ["grayscale", "sharpen"],
        processingTimeMs: 50,
        originalSizeBytes: 100,
        processedSizeBytes: 120,
        rotationDegrees: 2.5,
      },
    };

    beforeEach(() => {
      mockPreprocessor = {
        shouldPreprocess: jest.fn().mockReturnValue(true),
        preprocess: jest.fn().mockResolvedValue(mockPreprocessingResult),
      } as unknown as jest.Mocked<ImagePreprocessor>;

      service = new OcrService(mockProvider, mockPreprocessor);
    });

    it("should preprocess buffer input before OCR", async () => {
      const inputBuffer = Buffer.from("test image");
      const input = {
        type: "buffer" as const,
        buffer: inputBuffer,
        mimeType: "image/jpeg",
      };

      const result = await service.extractText(input);

      expect(mockPreprocessor.shouldPreprocess).toHaveBeenCalled();
      expect(mockPreprocessor.preprocess).toHaveBeenCalledWith(
        inputBuffer,
        "image/jpeg",
      );
      expect(mockProvider.extractText).toHaveBeenCalledWith({
        type: "buffer",
        buffer: preprocessedBuffer,
        mimeType: "image/png",
      });
      expect(result.preprocessingMetadata).toEqual({
        enabled: true,
        stepsApplied: ["grayscale", "sharpen"],
        processingTimeMs: 50,
        originalSizeBytes: 100,
        processedSizeBytes: 120,
        rotationDegrees: 2.5,
      });
    });

    it("should preprocess base64 input before OCR", async () => {
      const originalData = "test image data";
      const base64Data = Buffer.from(originalData).toString("base64");
      const input = {
        type: "base64" as const,
        data: base64Data,
        mimeType: "image/png",
      };

      const result = await service.extractText(input);

      expect(mockPreprocessor.shouldPreprocess).toHaveBeenCalled();
      expect(mockPreprocessor.preprocess).toHaveBeenCalledWith(
        Buffer.from(base64Data, "base64"),
        "image/png",
      );
      expect(result.preprocessingMetadata).toBeDefined();
    });

    it("should skip preprocessing when shouldPreprocess returns false", async () => {
      mockPreprocessor.shouldPreprocess.mockReturnValue(false);

      const input = {
        type: "buffer" as const,
        buffer: Buffer.from("test"),
        mimeType: "image/png",
      };

      const result = await service.extractText(input);

      expect(mockPreprocessor.shouldPreprocess).toHaveBeenCalled();
      expect(mockPreprocessor.preprocess).not.toHaveBeenCalled();
      expect(result.preprocessingMetadata).toBeUndefined();
    });

    it("should report preprocessing enabled in provider info", () => {
      const info = service.getProviderInfo();

      expect(info.preprocessingEnabled).toBe(true);
    });

    it("should report preprocessing disabled when shouldPreprocess is false", () => {
      mockPreprocessor.shouldPreprocess.mockReturnValue(false);

      const info = service.getProviderInfo();

      expect(info.preprocessingEnabled).toBe(false);
    });
  });
});
