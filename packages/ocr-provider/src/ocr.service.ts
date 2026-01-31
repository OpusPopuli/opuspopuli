import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { IOcrProvider, OcrInput, OcrResult, OcrError } from "@qckstrt/common";

/**
 * OCR Service
 *
 * Wraps OCR provider with additional functionality.
 * Provider can be swapped (Tesseract, Textract, etc.) via DI configuration.
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);

  constructor(private readonly provider: IOcrProvider) {
    this.logger.log(`Initialized with ${provider.getName()} provider`);
  }

  /**
   * Extract text from an image or document
   */
  async extractText(input: OcrInput): Promise<OcrResult> {
    this.logger.log(`Extracting text using ${this.provider.getName()}`);

    if (!this.provider.supports(input)) {
      throw new OcrError(
        this.provider.getName(),
        new Error(`Input type '${input.type}' not supported`),
      );
    }

    return this.provider.extractText(input);
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
    };
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
