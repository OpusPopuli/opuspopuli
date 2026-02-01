/**
 * Image Preprocessor
 *
 * Applies a configurable pipeline of image preprocessing steps to improve OCR accuracy.
 * Uses Sharp for high-performance image manipulation.
 */

import { Logger } from "@nestjs/common";
import sharp, { Sharp } from "sharp";
import {
  PreprocessingConfig,
  PreprocessingResult,
  PreprocessingStep,
  PreprocessingStepType,
  ImageInfo,
} from "./types";
import { DEFAULT_PREPROCESSING_CONFIG, getPipelineForPreset } from "./presets";
import { detectSkewAngle } from "./deskew";

/**
 * Image Preprocessor Service
 *
 * Processes images through a configurable pipeline to improve OCR accuracy.
 * Each step can be enabled/disabled and configured independently.
 */
export class ImagePreprocessor {
  private readonly logger = new Logger(ImagePreprocessor.name);
  private readonly config: PreprocessingConfig;
  private readonly pipeline: PreprocessingStep[];

  constructor(config?: Partial<PreprocessingConfig>) {
    // Build config without default pipeline (we'll resolve pipeline separately)
    const { pipeline: _defaultPipeline, ...defaultsWithoutPipeline } =
      DEFAULT_PREPROCESSING_CONFIG;
    this.config = {
      ...defaultsWithoutPipeline,
      ...config,
    } as PreprocessingConfig;

    // Resolve pipeline: explicit pipeline > preset lookup > balanced default
    if (config?.pipeline && config.pipeline.length > 0) {
      // Use explicitly provided pipeline
      this.pipeline = config.pipeline;
    } else if (this.config.preset) {
      // Use preset to determine pipeline
      this.pipeline = getPipelineForPreset(this.config.preset);
    } else {
      // Fall back to balanced preset
      this.pipeline = getPipelineForPreset("balanced");
    }

    this.logger.log(
      `ImagePreprocessor initialized: enabled=${this.config.enabled}, ` +
        `preset=${this.config.preset}, steps=${this.pipeline.filter((s) => s.enabled).length}`,
    );
  }

  /**
   * Check if preprocessing should be performed
   */
  shouldPreprocess(): boolean {
    return this.config.enabled && this.pipeline.some((step) => step.enabled);
  }

  /**
   * Preprocess an image buffer through the configured pipeline
   */
  async preprocess(
    buffer: Buffer,
    mimeType: string,
  ): Promise<PreprocessingResult> {
    const startTime = Date.now();
    const originalSize = buffer.length;
    const stepsApplied: PreprocessingStepType[] = [];
    let rotationDegrees: number | undefined;

    if (!this.config.enabled) {
      return {
        buffer,
        mimeType,
        metadata: {
          enabled: false,
          stepsApplied: [],
          processingTimeMs: 0,
          originalSizeBytes: originalSize,
          processedSizeBytes: originalSize,
        },
      };
    }

    try {
      // Get original image info
      const originalInfo = await this.getImageInfo(buffer);
      this.logger.log(
        `Preprocessing ${originalInfo.width}x${originalInfo.height} ${originalInfo.format} image`,
      );

      // Start with the input buffer
      let image = sharp(buffer);

      // Apply each enabled step in order
      for (const step of this.pipeline) {
        if (!step.enabled) continue;

        const stepStart = Date.now();
        const result = await this.applyStep(image, step, buffer);
        image = result.image;

        if (result.rotationDegrees !== undefined) {
          rotationDegrees = result.rotationDegrees;
        }

        stepsApplied.push(step.type);
        this.logger.debug(`Step ${step.type}: ${Date.now() - stepStart}ms`);
      }

      // Convert to PNG for consistent output (best for OCR)
      const processedBuffer = await image.png().toBuffer();
      const processedInfo = await this.getImageInfo(processedBuffer);

      const processingTimeMs = Date.now() - startTime;
      this.logger.log(
        `Preprocessing complete: ${stepsApplied.join(" -> ")} (${processingTimeMs}ms)`,
      );

      return {
        buffer: processedBuffer,
        mimeType: "image/png",
        metadata: {
          enabled: true,
          stepsApplied,
          processingTimeMs,
          originalSizeBytes: originalSize,
          processedSizeBytes: processedBuffer.length,
          rotationDegrees,
          originalDimensions: {
            width: originalInfo.width,
            height: originalInfo.height,
          },
          processedDimensions: {
            width: processedInfo.width,
            height: processedInfo.height,
          },
        },
      };
    } catch (error) {
      this.logger.error(`Preprocessing failed: ${error}`);
      // Return original buffer on failure
      return {
        buffer,
        mimeType,
        metadata: {
          enabled: true,
          stepsApplied,
          processingTimeMs: Date.now() - startTime,
          originalSizeBytes: originalSize,
          processedSizeBytes: originalSize,
        },
      };
    }
  }

  /**
   * Apply a single preprocessing step
   */
  private async applyStep(
    image: Sharp,
    step: PreprocessingStep,
    originalBuffer: Buffer,
  ): Promise<{ image: Sharp; rotationDegrees?: number }> {
    const options = { ...this.config.globalOptions, ...step.options };

    switch (step.type) {
      case "grayscale":
        return { image: this.applyGrayscale(image) };

      case "resize":
        return { image: await this.applyResize(image, options) };

      case "deskew":
        return await this.applyDeskew(image, originalBuffer, options);

      case "shadowRemoval":
        return { image: await this.applyShadowRemoval(image) };

      case "adaptiveThreshold":
        return { image: await this.applyAdaptiveThreshold(image, options) };

      case "noiseReduction":
        return { image: this.applyNoiseReduction(image, options) };

      case "sharpen":
        return { image: this.applySharpen(image, options) };

      case "cropToBorders":
        return { image: await this.applyCropToBorders(image) };

      default:
        this.logger.warn(`Unknown preprocessing step: ${step.type}`);
        return { image };
    }
  }

  /**
   * Convert image to grayscale
   */
  private applyGrayscale(image: Sharp): Sharp {
    return image.grayscale();
  }

  /**
   * Resize image to optimal DPI for OCR
   */
  private async applyResize(
    image: Sharp,
    options: { targetDpi?: number; maxDimension?: number },
  ): Promise<Sharp> {
    const metadata = await image.metadata();
    const { width, height } = metadata;

    if (!width || !height) return image;

    const maxDim = options.maxDimension || 4000;

    // Only resize if image exceeds max dimension
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      return image.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // If image is too small, upscale slightly for better OCR
    const minDim = 1000;
    if (width < minDim && height < minDim) {
      const scale = minDim / Math.min(width, height);
      return image.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        fit: "inside",
        kernel: "lanczos3",
      });
    }

    return image;
  }

  /**
   * Detect and correct document skew
   */
  private async applyDeskew(
    image: Sharp,
    originalBuffer: Buffer,
    options: { maxDeskewAngle?: number },
  ): Promise<{ image: Sharp; rotationDegrees?: number }> {
    const maxAngle = options.maxDeskewAngle || 15;

    try {
      // Detect skew angle
      const angle = await detectSkewAngle(originalBuffer, maxAngle);

      if (Math.abs(angle) > 0.5) {
        // Only rotate if angle is significant
        this.logger.debug(`Detected skew angle: ${angle.toFixed(2)}°`);
        return {
          image: image.rotate(angle, {
            background: { r: 255, g: 255, b: 255 },
          }),
          rotationDegrees: angle,
        };
      }
    } catch (error) {
      this.logger.debug(`Deskew detection failed: ${error}`);
    }

    return { image };
  }

  /**
   * Remove shadows and normalize lighting
   */
  private async applyShadowRemoval(image: Sharp): Promise<Sharp> {
    // Use normalize to stretch histogram and reduce shadow effects
    // Combined with gamma correction to lift shadows
    return image.normalize().gamma(1.2);
  }

  /**
   * Apply adaptive thresholding for binarization
   */
  private async applyAdaptiveThreshold(
    image: Sharp,
    options: { thresholdValue?: number },
  ): Promise<Sharp> {
    // Sharp doesn't have direct adaptive threshold, so we use
    // normalize + threshold for a similar effect
    const threshold = options.thresholdValue || 128;

    return image.normalize().threshold(threshold);
  }

  /**
   * Reduce noise using median filter
   */
  private applyNoiseReduction(
    image: Sharp,
    options: { noiseReductionStrength?: number },
  ): Sharp {
    const strength = options.noiseReductionStrength || 3;
    // Use median filter for noise reduction
    // Strength maps to filter size (odd numbers: 3, 5, 7)
    const size = Math.min(Math.max(3, strength * 2 - 1), 7);
    return image.median(size);
  }

  /**
   * Sharpen text edges
   */
  private applySharpen(
    image: Sharp,
    options: { sharpenSigma?: number },
  ): Sharp {
    const sigma = options.sharpenSigma || 1.0;
    return image.sharpen({ sigma });
  }

  /**
   * Crop to content borders, removing excess whitespace
   */
  private async applyCropToBorders(image: Sharp): Promise<Sharp> {
    // Trim whitespace with a small threshold
    return image.trim({ threshold: 10 });
  }

  /**
   * Get image information
   */
  private async getImageInfo(buffer: Buffer): Promise<ImageInfo> {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      channels: metadata.channels || 0,
      format: metadata.format || "unknown",
    };
  }
}
