import "reflect-metadata";
import { OcrService } from "../src/ocr.service";
import { IOcrProvider, OcrError, OcrResult } from "@qckstrt/common";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
  OnModuleDestroy: () => (target: any) => target,
}));

describe("OcrService", () => {
  let service: OcrService;
  let mockProvider: jest.Mocked<IOcrProvider>;

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
});
