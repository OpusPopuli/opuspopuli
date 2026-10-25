import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import {
  IOcrProvider,
  METRICS_OBSERVER,
  type MetricsObserver,
  OcrInput,
  OcrResult,
  OcrError,
  OcrPreprocessingMetadata,
  PipelineStage,
  withStage,
} from "@opuspopuli/common";
import { ImagePreprocessor } from "./preprocessing/image-preprocessor.js";

/**
 * OCR Service
 *
 * Wraps OCR provider with additional functionality including image preprocessing.
 * Provider can be swapped (Tesseract, Textract, etc.) via DI configuration.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly provider: IOcrProvider,
    @Optional() private readonly preprocessor?: ImagePreprocessor,
    /**
     * Optional. Where OCR timings go (M1,
     * `docs/plans/ingestion-resource-lanes.md` §2, row 8). OCR is the
     * CPU lane's dominant cost, which is the whole reason that row exists.
     */
    @Optional()
    @Inject(METRICS_OBSERVER)
    private readonly metrics?: MetricsObserver,
  ) {
    this.logger.log(
      `Initialized with ${provider.getName()} provider` +
        (preprocessor ? ", preprocessing enabled" : ""),
    );
  }

  /**
   * Extract text from an image or document
   */
  async extractText(input: OcrInput): Promise<OcrResult> {
    // Measured here rather than on the provider: preprocessing (deskew,
    // rotate, threshold) runs on the CPU too, and row 8's question is how
    // long a page takes to become text — not how long Tesseract took once
    // someone else had prepared the image.
    return withStage(
      PipelineStage.Ocr,
      { model: this.provider.getName() },
      () => this.runExtraction(input),
      { observer: this.metrics },
    );
  }

  private async runExtraction(input: OcrInput): Promise<OcrResult> {
    this.logger.log(`Extracting text using ${this.provider.getName()}`);

    if (!this.provider.supports(input)) {
      throw new OcrError(
        this.provider.getName(),
        new Error(`Input type '${input.type}' not supported`),
      );
    }

    // Apply preprocessing if enabled and input is a buffer
    let processedInput = input;
    let preprocessingMetadata: OcrPreprocessingMetadata | undefined;

    if (this.preprocessor?.shouldPreprocess()) {
      const buffer = this.getBufferFromInput(input);
      const mimeType = input.mimeType;

      if (buffer) {
        const result = await this.preprocessor.preprocess(buffer, mimeType);
        processedInput = {
          type: "buffer",
          buffer: result.buffer,
          mimeType: result.mimeType,
        };
        preprocessingMetadata = {
          enabled: result.metadata.enabled,
          stepsApplied: result.metadata.stepsApplied,
          processingTimeMs: result.metadata.processingTimeMs,
          originalSizeBytes: result.metadata.originalSizeBytes,
          processedSizeBytes: result.metadata.processedSizeBytes,
          rotationDegrees: result.metadata.rotationDegrees,
        };
      }
    }

    const ocrResult = await this.provider.extractText(processedInput);

    return {
      ...ocrResult,
      preprocessingMetadata,
    };
  }

  /**
   * Extract text from base64 encoded image
   */
  async extractFromBase64(
    base64: string,
    mimeType: string,
  ): Promise<OcrResult> {
    return this.extractText({
      type: "base64",
      data: base64,
      mimeType,
    });
  }

  /**
   * Extract text from buffer
   */
  async extractFromBuffer(
    buffer: Buffer,
    mimeType: string,
  ): Promise<OcrResult> {
    return this.extractText({
      type: "buffer",
      buffer,
      mimeType,
    });
  }

  /**
   * Check if a MIME type is supported
   */
  supportsMimeType(mimeType: string): boolean {
    return this.provider.supportsMimeType(mimeType);
  }

  /**
   * Get provider information
   */
  getProviderInfo() {
    return {
      name: this.provider.getName(),
      supportedLanguages: this.provider.getSupportedLanguages(),
      preprocessingEnabled: this.preprocessor?.shouldPreprocess() ?? false,
      engineVersion: this.provider.getEngineVersion?.(),
    };
  }

  /**
   * Extract buffer from OcrInput
   */
  private getBufferFromInput(input: OcrInput): Buffer | null {
    if (input.type === "buffer") {
      return input.buffer;
    } else if (input.type === "base64") {
      return Buffer.from(input.data, "base64");
    }
    return null;
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    if (
      "terminate" in this.provider &&
      typeof this.provider.terminate === "function"
    ) {
      await (this.provider as { terminate: () => Promise<void> }).terminate();
    }
  }
}
