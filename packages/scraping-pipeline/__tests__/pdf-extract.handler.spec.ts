import { PdfExtractHandler } from "../src/handlers/pdf-extract.handler";
import type { DomainMapperService } from "../src/mapping/domain-mapper.service";
import { TextExtractorService } from "../src/extraction/text-extractor.service";
import {
  DataType,
  type DataSourceConfig,
  type TextExtractionRuleSet,
} from "@opuspopuli/common";

// Mock NestJS decorators
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://example.com/schedule.pdf",
    dataType: DataType.MEETINGS,
    contentGoal: "Extract committee meetings",
    sourceType: "pdf",
    hints: ["Each meeting has a committee name, date, and room"],
    ...overrides,
  };
}

function createMockMapper(): jest.Mocked<DomainMapperService> {
  return {
    map: jest.fn().mockImplementation((raw, _source) => ({
      items: raw.items,
      manifestVersion: 0,
      success: raw.items.length > 0,
      warnings: raw.warnings,
      errors: raw.errors,
      extractionTimeMs: 1,
    })),
  } as unknown as jest.Mocked<DomainMapperService>;
}

const validRules: TextExtractionRuleSet = {
  itemDelimiter: "\\n\\n",
  fieldMappings: [
    { fieldName: "title", pattern: "Committee:\\s*(.+)", required: true },
    { fieldName: "scheduledAt", pattern: "Date:\\s*(.+)", required: true },
  ],
  analysisNotes: "Simple text format",
};

describe("PdfExtractHandler", () => {
  let handler: PdfExtractHandler;
  let mapper: jest.Mocked<DomainMapperService>;
  let textExtractor: TextExtractorService;

  beforeEach(() => {
    mapper = createMockMapper();
    textExtractor = new TextExtractorService();
    handler = new PdfExtractHandler(mapper, textExtractor);
  });

  describe("execute — successful extraction", () => {
    it("should extract items from PDF text using AI-generated rules", async () => {
      const pdfText =
        "Committee: Budget\nDate: April 5\n\nCommittee: Education\nDate: April 6";

      const mockLlm = {
        generate: jest.fn().mockResolvedValue({
          text: JSON.stringify(validRules),
          tokensUsed: 100,
        }),
      };

      const mockPdfExtractor = jest.fn().mockResolvedValue(pdfText);

      const result = await handler.execute(
        createSource(),
        "california",
        mockLlm,
        mockPdfExtractor,
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(mockPdfExtractor).toHaveBeenCalledWith(
        "https://example.com/schedule.pdf",
      );
      expect(mockLlm.generate).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute — gateway page with followPdfLink", () => {
    it("should follow PDF link from gateway page", async () => {
      const gatewayHtml = `
        <html><body>
          <a href="/files/schedule.PDF">Download PDF</a>
        </body></html>
      `;

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(gatewayHtml),
      });

      const mockLlm = {
        generate: jest.fn().mockResolvedValue({
          text: JSON.stringify(validRules),
          tokensUsed: 50,
        }),
      };

      const mockPdfExtractor = jest
        .fn()
        .mockResolvedValue("Committee: Budget\nDate: April 5");

      const source = createSource({
        url: "https://example.com/publications",
        pdf: { followPdfLink: true },
      });

      const result = await handler.execute(
        source,
        "california",
        mockLlm,
        mockPdfExtractor,
      );

      expect(mockPdfExtractor).toHaveBeenCalledWith(
        "https://example.com/files/schedule.PDF",
      );
      expect(result.success).toBe(true);

      global.fetch = originalFetch;
    });
  });

  describe("execute — error handling", () => {
    it("should return error when PDF text is empty", async () => {
      const mockLlm = { generate: jest.fn() };
      const mockPdfExtractor = jest.fn().mockResolvedValue("");

      const result = await handler.execute(
        createSource(),
        "california",
        mockLlm,
        mockPdfExtractor,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        "PDF text extraction returned empty content",
      );
      expect(mockLlm.generate).not.toHaveBeenCalled();
    });

    it("should return error when AI produces invalid rules", async () => {
      const mockLlm = {
        generate: jest.fn().mockResolvedValue({
          text: "not valid json",
          tokensUsed: 50,
        }),
      };
      const mockPdfExtractor = jest.fn().mockResolvedValue("some pdf text");

      const result = await handler.execute(
        createSource(),
        "california",
        mockLlm,
        mockPdfExtractor,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        "AI failed to produce valid text extraction rules",
      );
    });

    it("should return error when PDF download fails", async () => {
      const mockLlm = { generate: jest.fn() };
      const mockPdfExtractor = jest
        .fn()
        .mockRejectedValue(new Error("Download failed"));

      const result = await handler.execute(
        createSource(),
        "california",
        mockLlm,
        mockPdfExtractor,
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Download failed");
    });

    it("should handle AI returning rules with markdown fences", async () => {
      const pdfText = "Committee: Budget\nDate: April 5";
      const mockLlm = {
        generate: jest.fn().mockResolvedValue({
          text: "```json\n" + JSON.stringify(validRules) + "\n```",
          tokensUsed: 100,
        }),
      };
      const mockPdfExtractor = jest.fn().mockResolvedValue(pdfText);

      const result = await handler.execute(
        createSource(),
        "california",
        mockLlm,
        mockPdfExtractor,
      );

      expect(result.success).toBe(true);
    });
  });
});
