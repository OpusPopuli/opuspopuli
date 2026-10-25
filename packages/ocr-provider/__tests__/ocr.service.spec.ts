import "reflect-metadata";
import { OcrService } from "../src/ocr.service";
import {
  IOcrProvider,
  type MetricsObserver,
  OcrError,
  OcrResult,
} from "@opuspopuli/common";
import { ImagePreprocessor } from "../src/preprocessing/image-preprocessor";
import { PreprocessingResult } from "../src/preprocessing/types";

// Mock NestJS Logger and decorators
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  // An ALLOWLIST mock: anything the service imports and this omits is
  // `undefined`, and a decorator call on undefined fails the whole suite at
  // load — 13 tests vanished silently when `@Inject` was added, while
  // `Tests: 58 passed` still read green because the suite never ran to
  // contribute a failure.
  Inject: () => () => undefined,
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

    it("includes the engine version when the provider reports one", () => {
      (mockProvider as any).getEngineVersion = () => "5.1.1";

      expect(service.getProviderInfo().engineVersion).toBe("5.1.1");
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
  describe("pipeline stage timing (M1)", () => {
    type Observed = [
      string,
      number,
      Record<string, string> | undefined,
      Record<string, string> | undefined,
    ];
    let observed: Observed[];
    let observer: MetricsObserver;

    const input = {
      type: "buffer" as const,
      buffer: Buffer.from("test"),
      mimeType: "image/png",
    };

    beforeEach(() => {
      observed = [];
      observer = {
        observe: (m, v, l, e) => observed.push([m, v, l, e]),
        increment: jest.fn(),
      };
    });

    it("times the extraction as the `ocr` stage", async () => {
      // Row 8 of the plan compares pdf_parse against ocr; OCR is the CPU
      // lane's dominant cost, which is the whole reason that row exists.
      const measured = new OcrService(mockProvider, undefined, observer);

      await measured.extractText(input);

      expect(observed).toHaveLength(1);
      const [metric, value, labels] = observed[0];
      expect(metric).toBe("pipeline_stage_duration_seconds");
      expect(value).toBeGreaterThanOrEqual(0);
      expect(labels).toStrictEqual({ stage: "ocr", model: "MockProvider" });
    });

    it("measures preprocessing too, not just the provider call", async () => {
      // Deskew, rotate and threshold run on the CPU as well. The question
      // row 8 asks is how long a page takes to BECOME text, not how long
      // Tesseract took once someone else had prepared the image.
      mockPreprocessor = new ImagePreprocessor(
        {},
      ) as jest.Mocked<ImagePreprocessor>;
      mockPreprocessor.shouldPreprocess = jest.fn().mockReturnValue(true);
      mockPreprocessor.preprocess = jest
        .fn()
        .mockImplementation(async (): Promise<PreprocessingResult> => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            buffer: Buffer.from("processed"),
            mimeType: "image/png",
            metadata: {
              enabled: true,
              stepsApplied: ["deskew"],
              processingTimeMs: 20,
              originalSizeBytes: 4,
              processedSizeBytes: 9,
              rotationDegrees: 0,
            },
          };
        });
      const measured = new OcrService(mockProvider, mockPreprocessor, observer);

      await measured.extractText(input);

      expect(mockPreprocessor.preprocess).toHaveBeenCalled();
      expect(observed[0][1]).toBeGreaterThan(0.01);
    });

    it("still measures a failed extraction, and rethrows", async () => {
      // A provider that takes 30s to fail is exactly what the panel is for;
      // dropping it makes a broken stage's p95 look healthy.
      mockProvider.extractText.mockRejectedValue(new Error("tesseract died"));
      const measured = new OcrService(mockProvider, undefined, observer);

      await expect(measured.extractText(input)).rejects.toThrow(
        "tesseract died",
      );

      expect(observed).toHaveLength(1);
      expect(observed[0][2]).toStrictEqual({
        stage: "ocr",
        model: "MockProvider",
      });
    });

    it("extracts identically with no observer bound", async () => {
      // Instrumentation must never be why OCR fails.
      const result = await service.extractText(input);

      expect(result).toEqual(mockResult);
      expect(observed).toHaveLength(0);
    });

    it("counts no items — a page is not the unit the counter tracks", async () => {
      const measured = new OcrService(mockProvider, undefined, observer);

      await measured.extractText(input);

      expect(observer.increment).not.toHaveBeenCalled();
    });
  });
});
