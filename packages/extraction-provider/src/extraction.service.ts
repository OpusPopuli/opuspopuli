import { Injectable, Logger } from "@nestjs/common";
import {
  ITextExtractor,
  TextExtractionInput,
  TextExtractionResult,
  NoExtractorFoundError,
} from "@opuspopuli/common";

/**
 * Text Extraction Service
 *
 * Uses Strategy Pattern + Dependency Injection to select the appropriate
 * extractor based on input type.
 *
 * Extractors are injected via constructor, making it easy to:
 * - Add new extractors
 * - Swap implementations
 * - Test with mocks
 */
@Injectable()
export class TextExtractionService {
  private readonly logger = new Logger(TextExtractionService.name);

  constructor(
    // DI: All available extractors are injected
    private readonly extractors: ITextExtractor[],
  ) {
    this.logger.log(
      `Initialized with ${extractors.length} extractors: ${extractors.map((e) => e.getName()).join(", ")}`,
    );
  }

  /**
   * Extract text from any supported input
   *
   * Strategy Pattern: Dynamically selects the right extractor based on input type
   */
  async extractText(input: TextExtractionInput): Promise<TextExtractionResult> {
    this.logger.log(`Extracting text from ${input.type} input`);

    // Find first extractor that supports this input
    const extractor = this.extractors.find((e) => e.supports(input));

    if (!extractor) {
      this.logger.error(`No extractor found for input type: ${input.type}`);
      throw new NoExtractorFoundError(input.type);
    }

    this.logger.log(`Using ${extractor.getName()} for extraction`);

    // Delegate to the selected extractor
    return extractor.extractText(input);
  }

  /**
   * Get list of supported input types
   */
  getSupportedTypes(): string[] {
    const types = new Set<string>();

    // Test each extractor with dummy inputs
    const testInputs: TextExtractionInput[] = [
      { type: "url", url: "", userId: "" },
      { type: "storage", bucket: "", key: "", userId: "" },
      { type: "file", buffer: Buffer.from(""), mimeType: "", userId: "" },
    ];

    testInputs.forEach((input) => {
      if (this.extractors.some((e) => e.supports(input))) {
        types.add(input.type);
      }
    });

    return Array.from(types);
  }
}
