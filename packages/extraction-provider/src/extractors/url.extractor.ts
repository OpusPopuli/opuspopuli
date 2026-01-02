import { Injectable, Logger } from "@nestjs/common";
import {
  ITextExtractor,
  TextExtractionInput,
  TextExtractionResult,
  ExtractionError,
} from "@qckstrt/common";

import { ExtractionProvider } from "../extraction.provider.js";

/**
 * URL Text Extractor
 *
 * Extracts text from web pages using ExtractionProvider infrastructure.
 * Benefits from caching, rate limiting, and proper HTML parsing via cheerio.
 *
 * For JS-heavy sites, consider using Playwright or similar.
 */
@Injectable()
export class URLExtractor implements ITextExtractor {
  private readonly logger = new Logger(URLExtractor.name);

  constructor(private readonly extraction: ExtractionProvider) {}

  getName(): string {
    return "URLExtractor";
  }

  supports(input: TextExtractionInput): boolean {
    return input.type === "url";
  }

  async extractText(input: TextExtractionInput): Promise<TextExtractionResult> {
    if (input.type !== "url") {
      throw new Error("URLExtractor only supports URL inputs");
    }

    this.logger.log(`Extracting text from URL: ${input.url}`);

    try {
      // Use ExtractionProvider for fetching with caching and rate limiting
      const result = await this.extraction.fetchUrl(input.url);

      // Use cheerio for proper HTML parsing instead of regex
      const $ = this.extraction.parseHtml(result.content);

      // Remove script and style elements
      $("script, style, noscript").remove();

      // Extract text from body
      const text = $("body").text().replaceAll(/\s+/g, " ").trim();

      return {
        text,
        metadata: {
          source: input.url,
          extractedAt: new Date(),
          extractor: this.getName(),
          statusCode: result.statusCode,
          contentType: result.contentType || "unknown",
          fromCache: result.fromCache,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to extract from URL ${input.url}:`, error);
      throw new ExtractionError(this.getName(), error as Error);
    }
  }
}
