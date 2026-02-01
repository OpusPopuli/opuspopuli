import { ImagePreprocessor } from "../../src/preprocessing/image-preprocessor";
import {
  PreprocessingConfig,
  PreprocessingStepType,
} from "../../src/preprocessing/types";
import {
  PREPROCESSING_PRESETS,
  DEFAULT_PREPROCESSING_CONFIG,
} from "../../src/preprocessing/presets";
import sharp from "sharp";

describe("ImagePreprocessor", () => {
  // Create a simple test image buffer (100x100 white image)
  const createTestImage = async (
    width = 100,
    height = 100,
    background = { r: 255, g: 255, b: 255 },
  ): Promise<Buffer> => {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background,
      },
    })
      .png()
      .toBuffer();
  };

  describe("constructor", () => {
    it("should initialize with default config", () => {
      const preprocessor = new ImagePreprocessor();
      expect(preprocessor.shouldPreprocess()).toBe(true);
    });

    it("should initialize with custom config", () => {
      const config: Partial<PreprocessingConfig> = {
        enabled: false,
      };
      const preprocessor = new ImagePreprocessor(config);
      expect(preprocessor.shouldPreprocess()).toBe(false);
    });

    it("should use balanced preset by default", () => {
      const preprocessor = new ImagePreprocessor();
      const info = (preprocessor as unknown as { pipeline: { type: string }[] })
        .pipeline;
      expect(info.length).toBe(PREPROCESSING_PRESETS.balanced.length);
    });

    it("should use specified preset", () => {
      const preprocessor = new ImagePreprocessor({ preset: "fast" });
      const info = (preprocessor as unknown as { pipeline: { type: string }[] })
        .pipeline;
      expect(info.length).toBe(PREPROCESSING_PRESETS.fast.length);
    });
  });

  describe("shouldPreprocess", () => {
    it("should return true when enabled with steps", () => {
      const preprocessor = new ImagePreprocessor({ enabled: true });
      expect(preprocessor.shouldPreprocess()).toBe(true);
    });

    it("should return false when disabled", () => {
      const preprocessor = new ImagePreprocessor({ enabled: false });
      expect(preprocessor.shouldPreprocess()).toBe(false);
    });

    it("should return false when no steps are enabled", () => {
      const preprocessor = new ImagePreprocessor({
        enabled: true,
        pipeline: [{ type: "grayscale", enabled: false }],
      });
      expect(preprocessor.shouldPreprocess()).toBe(false);
    });
  });

  describe("preprocess", () => {
    it("should return original buffer when disabled", async () => {
      const preprocessor = new ImagePreprocessor({ enabled: false });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.buffer).toBe(testImage);
      expect(result.metadata.enabled).toBe(false);
      expect(result.metadata.stepsApplied).toHaveLength(0);
    });

    it("should process image with fast preset", async () => {
      const preprocessor = new ImagePreprocessor({ preset: "fast" });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.enabled).toBe(true);
      expect(result.metadata.stepsApplied).toContain("grayscale");
      expect(result.metadata.stepsApplied).toContain("adaptiveThreshold");
      expect(result.mimeType).toBe("image/png");
    });

    it("should process image with balanced preset", async () => {
      const preprocessor = new ImagePreprocessor({ preset: "balanced" });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.enabled).toBe(true);
      expect(result.metadata.stepsApplied.length).toBeGreaterThan(2);
      expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should track original and processed sizes", async () => {
      const preprocessor = new ImagePreprocessor({ preset: "fast" });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.originalSizeBytes).toBe(testImage.length);
      expect(result.metadata.processedSizeBytes).toBeGreaterThan(0);
    });

    it("should track dimensions", async () => {
      const preprocessor = new ImagePreprocessor({ preset: "fast" });
      const testImage = await createTestImage(200, 150);

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.originalDimensions).toEqual({
        width: 200,
        height: 150,
      });
      expect(result.metadata.processedDimensions).toBeDefined();
    });

    it("should handle JPEG input", async () => {
      const preprocessor = new ImagePreprocessor({ preset: "fast" });
      const testImage = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await preprocessor.preprocess(testImage, "image/jpeg");

      expect(result.metadata.enabled).toBe(true);
      // Output should be PNG for consistency
      expect(result.mimeType).toBe("image/png");
    });

    it("should return original on processing error", async () => {
      const preprocessor = new ImagePreprocessor({ preset: "fast" });
      const invalidBuffer = Buffer.from("not an image");

      const result = await preprocessor.preprocess(invalidBuffer, "image/png");

      // Should return original buffer on error
      expect(result.buffer).toBe(invalidBuffer);
    });
  });

  describe("preprocessing steps", () => {
    it("should apply grayscale step", async () => {
      const preprocessor = new ImagePreprocessor({
        enabled: true,
        pipeline: [{ type: "grayscale", enabled: true }],
      });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.stepsApplied).toContain("grayscale");
    });

    it("should apply resize step", async () => {
      const preprocessor = new ImagePreprocessor({
        enabled: true,
        pipeline: [{ type: "resize", enabled: true }],
      });
      // Create a very large image
      const testImage = await createTestImage(5000, 5000);

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.stepsApplied).toContain("resize");
      // Should be resized down
      expect(result.metadata.processedDimensions?.width).toBeLessThanOrEqual(
        4000,
      );
    });

    it("should apply sharpen step", async () => {
      const preprocessor = new ImagePreprocessor({
        enabled: true,
        pipeline: [{ type: "sharpen", enabled: true }],
      });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.stepsApplied).toContain("sharpen");
    });

    it("should apply noiseReduction step", async () => {
      const preprocessor = new ImagePreprocessor({
        enabled: true,
        pipeline: [{ type: "noiseReduction", enabled: true }],
      });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.stepsApplied).toContain("noiseReduction");
    });

    it("should apply adaptiveThreshold step", async () => {
      const preprocessor = new ImagePreprocessor({
        enabled: true,
        pipeline: [{ type: "adaptiveThreshold", enabled: true }],
      });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.stepsApplied).toContain("adaptiveThreshold");
    });

    it("should skip disabled steps", async () => {
      const preprocessor = new ImagePreprocessor({
        enabled: true,
        pipeline: [
          { type: "grayscale", enabled: true },
          { type: "sharpen", enabled: false },
          { type: "adaptiveThreshold", enabled: true },
        ],
      });
      const testImage = await createTestImage();

      const result = await preprocessor.preprocess(testImage, "image/png");

      expect(result.metadata.stepsApplied).toContain("grayscale");
      expect(result.metadata.stepsApplied).not.toContain("sharpen");
      expect(result.metadata.stepsApplied).toContain("adaptiveThreshold");
    });
  });

  describe("presets", () => {
    it("should have fast preset with 2 steps", () => {
      expect(PREPROCESSING_PRESETS.fast.filter((s) => s.enabled)).toHaveLength(
        2,
      );
    });

    it("should have balanced preset with 5 steps", () => {
      expect(
        PREPROCESSING_PRESETS.balanced.filter((s) => s.enabled),
      ).toHaveLength(5);
    });

    it("should have quality preset with 8 steps", () => {
      expect(
        PREPROCESSING_PRESETS.quality.filter((s) => s.enabled),
      ).toHaveLength(8);
    });

    it("should have empty custom preset", () => {
      expect(PREPROCESSING_PRESETS.custom).toHaveLength(0);
    });

    it("default config should use balanced preset", () => {
      expect(DEFAULT_PREPROCESSING_CONFIG.preset).toBe("balanced");
      expect(DEFAULT_PREPROCESSING_CONFIG.enabled).toBe(true);
    });
  });
});
