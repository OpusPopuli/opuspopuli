import "reflect-metadata";
import { OcrError, UnsupportedMimeTypeError } from "@qckstrt/common";

// Create mock functions at module level for access in tests
const mockRecognize = jest.fn();
const mockTerminate = jest.fn();
const mockCreateWorker = jest.fn();

// Mock tesseract.js - using manual hoisting workaround
jest.mock("tesseract.js", () => {
  return {
    createWorker: (...args: unknown[]) => mockCreateWorker(...args),
  };
});

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: unknown) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

// Import after mocks are set up
import { TesseractOcrProvider } from "../src/providers/tesseract.provider";

describe("TesseractOcrProvider", () => {
  let provider: TesseractOcrProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up the mock worker that createWorker returns
    mockCreateWorker.mockResolvedValue({
      recognize: mockRecognize,
      terminate: mockTerminate,
    });
    provider = new TesseractOcrProvider(["eng"]);
  });

  describe("constructor", () => {
    it("should initialize with default language", () => {
      expect(provider.getName()).toBe("Tesseract");
      expect(provider.getSupportedLanguages()).toEqual(["eng"]);
    });

    it("should initialize with multiple languages", () => {
      const multiLangProvider = new TesseractOcrProvider(["eng", "spa"]);
      expect(multiLangProvider.getSupportedLanguages()).toEqual(["eng", "spa"]);
    });
  });

  describe("supports", () => {
    it("should support buffer input", () => {
      expect(
        provider.supports({
          type: "buffer",
          buffer: Buffer.from(""),
          mimeType: "image/png",
        }),
      ).toBe(true);
    });

    it("should support base64 input", () => {
      expect(
        provider.supports({
          type: "base64",
          data: "",
          mimeType: "image/png",
        }),
      ).toBe(true);
    });
  });

  describe("supportsMimeType", () => {
    it("should support PNG", () => {
      expect(provider.supportsMimeType("image/png")).toBe(true);
    });

    it("should support JPEG", () => {
      expect(provider.supportsMimeType("image/jpeg")).toBe(true);
    });

    it("should support JPG", () => {
      expect(provider.supportsMimeType("image/jpg")).toBe(true);
    });

    it("should support WEBP", () => {
      expect(provider.supportsMimeType("image/webp")).toBe(true);
    });

    it("should not support unsupported types", () => {
      expect(provider.supportsMimeType("video/mp4")).toBe(false);
      expect(provider.supportsMimeType("application/json")).toBe(false);
    });
  });

  describe("extractText", () => {
    const mockRecognizeResult = {
      data: {
        text: "Hello World",
        confidence: 95,
        words: [
          {
            text: "Hello",
            confidence: 96,
            bbox: { x0: 10, y0: 10, x1: 50, y1: 30 },
          },
          {
            text: "World",
            confidence: 94,
            bbox: { x0: 60, y0: 10, x1: 100, y1: 30 },
          },
        ],
      },
    };

    it("should extract text from buffer", async () => {
      mockRecognize.mockResolvedValue(mockRecognizeResult);

      const result = await provider.extractText({
        type: "buffer",
        buffer: Buffer.from("test"),
        mimeType: "image/png",
      });

      expect(result.text).toBe("Hello World");
      expect(result.confidence).toBe(95);
      expect(result.provider).toBe("Tesseract");
      expect(result.blocks).toHaveLength(2);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should extract text from base64", async () => {
      mockRecognize.mockResolvedValue(mockRecognizeResult);

      const result = await provider.extractText({
        type: "base64",
        data: Buffer.from("test").toString("base64"),
        mimeType: "image/jpeg",
      });

      expect(result.text).toBe("Hello World");
      expect(result.confidence).toBe(95);
    });

    it("should throw UnsupportedMimeTypeError for unsupported types", async () => {
      await expect(
        provider.extractText({
          type: "buffer",
          buffer: Buffer.from("test"),
          mimeType: "video/mp4",
        }),
      ).rejects.toThrow(UnsupportedMimeTypeError);
    });

    it("should throw OcrError on recognition failure", async () => {
      mockRecognize.mockRejectedValue(new Error("Recognition failed"));

      await expect(
        provider.extractText({
          type: "buffer",
          buffer: Buffer.from("test"),
          mimeType: "image/png",
        }),
      ).rejects.toThrow(OcrError);
    });

    it("should include bounding boxes in blocks", async () => {
      mockRecognize.mockResolvedValue(mockRecognizeResult);

      const result = await provider.extractText({
        type: "buffer",
        buffer: Buffer.from("test"),
        mimeType: "image/png",
      });

      expect(result.blocks[0].boundingBox).toBeDefined();
      expect(result.blocks[0].boundingBox?.x).toBe(10);
      expect(result.blocks[0].boundingBox?.y).toBe(10);
      expect(result.blocks[0].boundingBox?.width).toBe(40);
      expect(result.blocks[0].boundingBox?.height).toBe(20);
    });
  });

  describe("terminate", () => {
    it("should terminate the worker", async () => {
      // First initialize by calling extractText
      mockRecognize.mockResolvedValue({
        data: { text: "", confidence: 0, words: [] },
      });

      await provider.extractText({
        type: "buffer",
        buffer: Buffer.from("test"),
        mimeType: "image/png",
      });

      await provider.terminate();

      expect(mockTerminate).toHaveBeenCalled();
    });

    it("should be safe to call terminate without initialization", async () => {
      await expect(provider.terminate()).resolves.not.toThrow();
    });
  });
});
