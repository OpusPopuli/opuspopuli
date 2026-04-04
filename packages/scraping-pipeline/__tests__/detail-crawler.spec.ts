import { DetailCrawlerService } from "../src/crawling/detail-crawler.service";

// Use type-only import — real ExtractionProvider needs NestJS DI
type ExtractionProvider = {
  fetchWithRetry: (
    url: string,
  ) => Promise<{ content: string; fromCache: boolean }>;
};
import {
  DataType,
  type DataSourceConfig,
  type RawExtractionResult,
  type ILLMProvider,
} from "@opuspopuli/common";

// Mock NestJS decorators
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Optional: () => () => {},
  Inject: () => () => {},
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

// Mock extraction provider module to avoid NestJS DI issues
jest.mock("@opuspopuli/extraction-provider", () => ({
  ExtractionProvider: jest.fn(),
}));

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://example.com/propositions",
    dataType: DataType.PROPOSITIONS,
    contentGoal: "Extract ballot measures with full text",
    ...overrides,
  };
}

function createRawResult(
  items: Record<string, unknown>[],
): RawExtractionResult {
  return {
    items,
    success: items.length > 0,
    warnings: [],
    errors: [],
  };
}

function createMockExtraction(): jest.Mocked<ExtractionProvider> {
  return {
    fetchWithRetry: jest.fn().mockResolvedValue({
      content:
        "<html><body><main><p>Full bill text here about water policy reform.</p></main></body></html>",
      fromCache: false,
    }),
  } as unknown as jest.Mocked<ExtractionProvider>;
}

function createMockLlm(): jest.Mocked<ILLMProvider> {
  return {
    generate: jest.fn().mockResolvedValue({
      text: '["fullText"]',
      tokensUsed: 50,
    }),
    getName: jest.fn().mockReturnValue("mock"),
    getModelName: jest.fn().mockReturnValue("mock-model"),
  } as unknown as jest.Mocked<ILLMProvider>;
}

describe("DetailCrawlerService", () => {
  let crawler: DetailCrawlerService;
  let mockExtraction: jest.Mocked<ExtractionProvider>;
  let mockLlm: jest.Mocked<ILLMProvider>;

  beforeEach(() => {
    mockExtraction = createMockExtraction();
    mockLlm = createMockLlm();
    crawler = new DetailCrawlerService(mockExtraction as any);
  });

  describe("enrichItems", () => {
    it("should fetch detail pages and merge content into items", async () => {
      const rawResult = createRawResult([
        {
          externalId: "prop-1",
          title: "Water Policy",
          detailUrl: "https://example.com/prop/1",
        },
        {
          externalId: "prop-2",
          title: "Education Act",
          detailUrl: "https://example.com/prop/2",
        },
      ]);

      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      expect(result.items[0].fullText).toContain("Full bill text");
      expect(result.items[1].fullText).toContain("Full bill text");
      expect(mockExtraction.fetchWithRetry).toHaveBeenCalledTimes(2);
      expect(mockLlm.generate).toHaveBeenCalledTimes(1); // AI called once only
    });

    it("should pass through items without detailUrl unchanged", async () => {
      const rawResult = createRawResult([
        { externalId: "prop-1", title: "No Detail Link" },
      ]);

      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      expect(result.items[0]).toEqual({
        externalId: "prop-1",
        title: "No Detail Link",
      });
      expect(mockExtraction.fetchWithRetry).not.toHaveBeenCalled();
    });

    it("should handle mixed items (some with detailUrl, some without)", async () => {
      const rawResult = createRawResult([
        {
          externalId: "prop-1",
          title: "Has Link",
          detailUrl: "https://example.com/1",
        },
        { externalId: "prop-2", title: "No Link" },
      ]);

      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      expect(result.items[0].fullText).toBeDefined();
      expect(result.items[1].fullText).toBeUndefined();
    });

    it("should handle detail page fetch failure gracefully (soft failure)", async () => {
      mockExtraction.fetchWithRetry.mockRejectedValue(
        new Error("Connection timeout"),
      );

      const rawResult = createRawResult([
        {
          externalId: "prop-1",
          title: "Test",
          detailUrl: "https://example.com/1",
        },
      ]);

      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      // Item should still be present (with listing data only)
      expect(result.items[0].externalId).toBe("prop-1");
      expect(result.items[0].fullText).toBeUndefined();
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("Connection timeout")]),
      );
    });

    it("should use default content fields when AI derivation fails", async () => {
      mockLlm.generate.mockRejectedValue(new Error("LLM unavailable"));

      const rawResult = createRawResult([
        {
          externalId: "prop-1",
          title: "Test",
          detailUrl: "https://example.com/1",
        },
      ]);

      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      // Should still extract using default fields
      expect(result.items[0].fullText).toBeDefined();
    });

    it("should not overwrite existing item fields with detail content", async () => {
      const rawResult = createRawResult([
        {
          externalId: "prop-1",
          title: "Original Title",
          fullText: "Already has full text",
          detailUrl: "https://example.com/1",
        },
      ]);

      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      // Existing fullText should NOT be overwritten
      expect(result.items[0].fullText).toBe("Already has full text");
    });

    it("should warn when items exceed MAX_DETAIL_PAGES limit", async () => {
      // Create 55 items — exceeds the 50 limit
      const items = Array.from({ length: 55 }, (_, i) => ({
        externalId: `prop-${i}`,
        title: `Prop ${i}`,
        detailUrl: `https://example.com/${i}`,
      }));

      const rawResult = createRawResult(items);

      // Don't await the full run — just check the warning is added
      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Only enriching first 50"),
        ]),
      );
    }, 60000);

    it("should derive correct default fields per data type", async () => {
      mockLlm.generate.mockRejectedValue(new Error("fail"));

      // Test meetings
      const meetingResult = createRawResult([
        { externalId: "m-1", detailUrl: "https://example.com/m/1" },
      ]);
      await crawler.enrichItems(
        meetingResult,
        createSource({ dataType: DataType.MEETINGS }),
        mockLlm,
      );
      expect(meetingResult.items[0].minutes).toBeDefined();

      // Test representatives
      mockExtraction.fetchWithRetry.mockResolvedValue({
        content:
          "<html><body><main><p>Bio content here.</p></main></body></html>",
        fromCache: false,
      } as any);

      const repResult = createRawResult([
        { externalId: "r-1", detailUrl: "https://example.com/r/1" },
      ]);
      await crawler.enrichItems(
        repResult,
        createSource({ dataType: DataType.REPRESENTATIVES }),
        mockLlm,
      );
      expect(repResult.items[0].bio).toBeDefined();
    });

    it("should detect PDF detail pages and extract text content", async () => {
      // Mock extraction with PDF detection support
      mockExtraction.fetchWithRetry.mockResolvedValue({
        content: "%PDF-1.4 simulated pdf content about water policy",
        fromCache: false,
      } as any);

      // Add extractPdfText to mock
      (mockExtraction as any).extractPdfText = jest
        .fn()
        .mockResolvedValue("Full text of the water policy reform bill.");

      const rawResult = createRawResult([
        {
          externalId: "prop-1",
          title: "Water Policy",
          detailUrl:
            "https://elections.cdn.sos.ca.gov/ballot-measures/pdf/sb-42.pdf",
        },
      ]);

      const result = await crawler.enrichItems(
        rawResult,
        createSource(),
        mockLlm,
      );

      expect(result.items[0].fullText).toBe(
        "Full text of the water policy reform bill.",
      );
      expect((mockExtraction as any).extractPdfText).toHaveBeenCalled();
    });

    it("should detect PDF by content prefix even without .pdf extension", async () => {
      mockExtraction.fetchWithRetry.mockResolvedValue({
        content: "%PDF-1.7 some binary pdf data",
        fromCache: false,
      } as any);

      (mockExtraction as any).extractPdfText = jest
        .fn()
        .mockResolvedValue("Extracted PDF text content.");

      const rawResult = createRawResult([
        {
          externalId: "prop-1",
          title: "Test",
          detailUrl: "https://example.com/document/12345",
        },
      ]);

      await crawler.enrichItems(rawResult, createSource(), mockLlm);

      expect(rawResult.items[0].fullText).toBe("Extracted PDF text content.");
    });
  });
});
