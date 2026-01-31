import { Logger } from "@nestjs/common";
import { createWorker, Worker } from "tesseract.js";
import {
  IOcrProvider,
  OcrInput,
  OcrResult,
  OcrTextBlock,
  OcrError,
  UnsupportedMimeTypeError,
} from "@qckstrt/common";

/**
 * Tesseract.js OCR Provider
 *
 * Uses Tesseract.js for fully in-process OCR.
 * No external services required - runs entirely in Node.js.
 *
 * Advantages:
 * - No external services needed
 * - Free and open source
 * - Works offline
 * - Supports 100+ languages
 *
 * Trade-offs:
 * - Slower than cloud services for large batches
 * - Higher memory usage (worker loaded in-process)
 * - Lower accuracy than cloud ML services on complex documents
 */
export class TesseractOcrProvider implements IOcrProvider {
  private readonly logger = new Logger(TesseractOcrProvider.name);
  private worker: Worker | null = null;
  private initialized = false;
  private readonly languages: string[];

  private static readonly SUPPORTED_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/bmp",
    "image/gif",
    "image/tiff",
  ];

  constructor(languages: string[] = ["eng"]) {
    this.languages = languages;
    this.logger.log(
      `Initializing Tesseract OCR with languages: ${languages.join(", ")}`,
    );
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized && this.worker) return;

    try {
      this.logger.log("Creating Tesseract worker...");
      this.worker = await createWorker(this.languages.join("+"));
      this.initialized = true;
      this.logger.log("Tesseract worker initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Tesseract worker:", error);
      throw new OcrError(this.getName(), error as Error);
    }
  }

  getName(): string {
    return "Tesseract";
  }

  getSupportedLanguages(): string[] {
    return this.languages;
  }

  supports(input: OcrInput): boolean {
    return input.type === "buffer" || input.type === "base64";
  }

  supportsMimeType(mimeType: string): boolean {
    return TesseractOcrProvider.SUPPORTED_MIME_TYPES.includes(
      mimeType.toLowerCase(),
    );
  }

  async extractText(input: OcrInput): Promise<OcrResult> {
    const startTime = Date.now();

    try {
      await this.ensureInitialized();

      let imageData: Buffer;
      let mimeType: string;

      if (input.type === "buffer") {
        mimeType = input.mimeType;
        if (!this.supportsMimeType(mimeType)) {
          throw new UnsupportedMimeTypeError(mimeType, this.getName());
        }
        imageData = input.buffer;
      } else if (input.type === "base64") {
        mimeType = input.mimeType;
        if (!this.supportsMimeType(mimeType)) {
          throw new UnsupportedMimeTypeError(mimeType, this.getName());
        }
        imageData = Buffer.from(input.data, "base64");
      } else {
        throw new Error(`Input type not supported`);
      }

      this.logger.log(
        `Performing OCR on ${mimeType} image (${imageData.length} bytes)...`,
      );
      const result = await this.worker!.recognize(imageData);

      // Map words to text blocks with bounding boxes (pixel coordinates)
      const blocks: OcrTextBlock[] = result.data.words.map((word) => ({
        text: word.text,
        confidence: word.confidence,
        boundingBox: {
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0,
        },
      }));

      const processingTimeMs = Date.now() - startTime;

      this.logger.log(
        `OCR completed: ${result.data.text.length} chars, ${result.data.confidence.toFixed(1)}% confidence, ${processingTimeMs}ms`,
      );

      return {
        text: result.data.text,
        blocks,
        confidence: result.data.confidence,
        provider: this.getName(),
        processingTimeMs,
      };
    } catch (error) {
      if (
        error instanceof OcrError ||
        error instanceof UnsupportedMimeTypeError
      ) {
        throw error;
      }
      this.logger.error("OCR extraction failed:", error);
      throw new OcrError(this.getName(), error as Error);
    }
  }

  /**
   * Cleanup: terminate the worker when done
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      this.logger.log("Tesseract worker terminated");
    }
  }
}
