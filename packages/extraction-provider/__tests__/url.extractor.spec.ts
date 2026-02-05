import "reflect-metadata";
import { URLExtractor } from "../src/extractors/url.extractor";
import { ExtractionError, TextExtractionInput } from "@opuspopuli/common";
import { ExtractionProvider } from "../src/extraction.provider";
import { FetchError } from "../src/types";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Inject: () => () => undefined,
  Optional: () => () => undefined,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe("URLExtractor", () => {
  let extractor: URLExtractor;
  let mockExtractionProvider: jest.Mocked<ExtractionProvider>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock ExtractionProvider
    mockExtractionProvider = {
      fetchUrl: jest.fn(),
      fetchWithRetry: jest.fn(),
      extractPdfText: jest.fn(),
      selectElements: jest.fn(),
      parseHtml: jest.fn(),
      getCacheStats: jest.fn(),
      clearCache: jest.fn(),
      resetRateLimiter: jest.fn(),
      onModuleDestroy: jest.fn(),
    } as unknown as jest.Mocked<ExtractionProvider>;

    extractor = new URLExtractor(mockExtractionProvider);
  });

  describe("getName", () => {
    it("should return URLExtractor", () => {
      expect(extractor.getName()).toBe("URLExtractor");
    });
  });

  describe("supports", () => {
    it("should return true for url input type", () => {
      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };
      expect(extractor.supports(input)).toBe(true);
    });

    it("should return false for s3 input type", () => {
      const input: TextExtractionInput = {
        type: "s3",
        bucket: "bucket",
        key: "key",
        userId: "user-1",
      };
      expect(extractor.supports(input)).toBe(false);
    });

    it("should return false for file input type", () => {
      const input: TextExtractionInput = {
        type: "file",
        buffer: Buffer.from(""),
        mimeType: "text/plain",
        userId: "user-1",
      };
      expect(extractor.supports(input)).toBe(false);
    });
  });

  describe("extractText", () => {
    it("should extract text from URL successfully", async () => {
      const htmlContent = `
        <html>
          <head><title>Test</title></head>
          <body>
            <script>console.log('test');</script>
            <style>.test { color: red; }</style>
            <p>Hello World</p>
          </body>
        </html>
      `;

      mockExtractionProvider.fetchUrl.mockResolvedValueOnce({
        content: htmlContent,
        statusCode: 200,
        contentType: "text/html",
        fromCache: false,
      });

      // Create a real cheerio instance for parseHtml
      const cheerio = await import("cheerio");
      mockExtractionProvider.parseHtml.mockImplementation((html: string) =>
        cheerio.load(html),
      );

      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };
      const result = await extractor.extractText(input);

      expect(result.text).toContain("Hello World");
      expect(result.text).not.toContain("console.log");
      expect(result.text).not.toContain("color: red");
      expect(result.metadata.source).toBe("https://example.com");
      expect(result.metadata.extractor).toBe("URLExtractor");
      expect(result.metadata.statusCode).toBe(200);
      expect(result.metadata.fromCache).toBe(false);
    });

    it("should throw error for non-url input type", async () => {
      const input: TextExtractionInput = {
        type: "s3",
        bucket: "bucket",
        key: "key",
        userId: "user-1",
      };

      await expect(extractor.extractText(input)).rejects.toThrow(
        "URLExtractor only supports URL inputs",
      );
    });

    it("should throw ExtractionError on fetch error", async () => {
      mockExtractionProvider.fetchUrl.mockRejectedValueOnce(
        new FetchError("https://example.com/notfound", 404, "Not Found"),
      );

      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com/notfound",
        userId: "user-1",
      };

      await expect(extractor.extractText(input)).rejects.toThrow(
        ExtractionError,
      );
    });

    it("should throw ExtractionError on network error", async () => {
      mockExtractionProvider.fetchUrl.mockRejectedValueOnce(
        new Error("Network error"),
      );

      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };

      await expect(extractor.extractText(input)).rejects.toThrow(
        ExtractionError,
      );
    });

    it("should handle pages with no script or style tags", async () => {
      const htmlContent = "<html><body><p>Simple text</p></body></html>";

      mockExtractionProvider.fetchUrl.mockResolvedValueOnce({
        content: htmlContent,
        statusCode: 200,
        contentType: "text/html",
        fromCache: false,
      });

      const cheerio = await import("cheerio");
      mockExtractionProvider.parseHtml.mockImplementation((html: string) =>
        cheerio.load(html),
      );

      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };
      const result = await extractor.extractText(input);

      expect(result.text).toContain("Simple text");
    });

    it("should include fromCache in metadata when result is cached", async () => {
      const htmlContent = "<html><body><p>Cached content</p></body></html>";

      mockExtractionProvider.fetchUrl.mockResolvedValueOnce({
        content: htmlContent,
        statusCode: 200,
        contentType: "text/html",
        fromCache: true,
      });

      const cheerio = await import("cheerio");
      mockExtractionProvider.parseHtml.mockImplementation((html: string) =>
        cheerio.load(html),
      );

      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };
      const result = await extractor.extractText(input);

      expect(result.metadata.fromCache).toBe(true);
    });

    it("should remove noscript tags", async () => {
      const htmlContent = `
        <html>
          <body>
            <noscript>Please enable JavaScript</noscript>
            <p>Main content</p>
          </body>
        </html>
      `;

      mockExtractionProvider.fetchUrl.mockResolvedValueOnce({
        content: htmlContent,
        statusCode: 200,
        contentType: "text/html",
        fromCache: false,
      });

      const cheerio = await import("cheerio");
      mockExtractionProvider.parseHtml.mockImplementation((html: string) =>
        cheerio.load(html),
      );

      const input: TextExtractionInput = {
        type: "url",
        url: "https://example.com",
        userId: "user-1",
      };
      const result = await extractor.extractText(input);

      expect(result.text).toContain("Main content");
      expect(result.text).not.toContain("Please enable JavaScript");
    });
  });
});
