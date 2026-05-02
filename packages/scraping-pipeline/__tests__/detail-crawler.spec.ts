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
      text: '{"fullText": "main p"}',
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

    it("should warn when items exceed MAX_DETAIL_PAGES limit", () => {
      // The MAX_DETAIL_PAGES limit is 500. Verify the warning is added
      // by checking rawResult.warnings synchronously after the slice.
      const items = Array.from({ length: 505 }, (_, i) => ({
        externalId: `prop-${i}`,
        title: `Prop ${i}`,
        detailUrl: `https://example.com/${i}`,
      }));

      const rawResult = createRawResult(items);

      // Start enrichment but don't await — we only need the sync warning
      mockExtraction.fetchWithRetry.mockReturnValue(
        new Promise(() => {}), // Never resolves — prevents crawling
      );
      crawler.enrichItems(rawResult, createSource(), mockLlm);

      // Warning is added synchronously before async crawling starts
      expect(rawResult.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Only enriching first 500"),
        ]),
      );
    });

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

    it("should detect PDF detail pages by .pdf extension and use the binary-safe fetchPdfText path", async () => {
      // The .pdf extension shortcuts to fetchPdfText — the old
      // `fetchWithRetry → Buffer.from(content, "binary")` path
      // silently mangled real PDFs (UTF-8 decode is irreversible
      // for non-ASCII bytes). See ExtractionProvider.fetchPdfText.
      (mockExtraction as any).fetchPdfText = jest
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
      expect((mockExtraction as any).fetchPdfText).toHaveBeenCalledWith(
        "https://elections.cdn.sos.ca.gov/ballot-measures/pdf/sb-42.pdf",
      );
      // Should NOT have used the broken text-fetch path
      expect(mockExtraction.fetchWithRetry).not.toHaveBeenCalled();
    });

    it("should detect PDF by content prefix on non-.pdf URLs and refetch as bytes", async () => {
      // For URLs that don't advertise .pdf but turn out to serve a PDF
      // (content-sniffed): the first fetchWithRetry's text body is already
      // mangled, so we re-fetch via fetchPdfText to get clean bytes.
      mockExtraction.fetchWithRetry.mockResolvedValue({
        content: "%PDF-1.7 some binary pdf data",
        fromCache: false,
      } as any);
      (mockExtraction as any).fetchPdfText = jest
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
      // Sniffed PDFs trigger a second fetch as bytes
      expect((mockExtraction as any).fetchPdfText).toHaveBeenCalledWith(
        "https://example.com/document/12345",
      );
    });
  });

  describe("resolveUrl", () => {
    it("should resolve relative URLs against the base URL", () => {
      expect(
        DetailCrawlerService.resolveUrl(
          "/assemblymembers/30",
          "https://www.assembly.ca.gov/assemblymembers",
        ),
      ).toBe("https://www.assembly.ca.gov/assemblymembers/30");
    });

    it("should return absolute URLs unchanged", () => {
      expect(
        DetailCrawlerService.resolveUrl(
          "https://example.com/page",
          "https://other.com",
        ),
      ).toBe("https://example.com/page");
    });

    it("should handle paths relative to the domain root", () => {
      expect(
        DetailCrawlerService.resolveUrl(
          "/senators/district-5",
          "https://www.senate.ca.gov/senators",
        ),
      ).toBe("https://www.senate.ca.gov/senators/district-5");
    });

    it("should return original URL if resolution fails", () => {
      expect(
        DetailCrawlerService.resolveUrl(":::invalid", "also-invalid"),
      ).toBe(":::invalid");
    });
  });

  describe("structured field extraction (detailFields config)", () => {
    it("should use config-declared detailFields instead of AI derivation", async () => {
      const detailHtml = `<html><body>
        <div class="office-card"><h3>Capitol</h3><p class="phone">555-1000</p></div>
        <div class="office-card"><h3>District</h3><p class="phone">555-2000</p></div>
        <a class="website" href="https://example.gov">Website</a>
      </body></html>`;

      mockExtraction.fetchWithRetry.mockResolvedValue({
        content: detailHtml,
        fromCache: false,
      });

      const source = createSource({
        dataType: DataType.REPRESENTATIVES,
        contentGoal: "Extract representatives",
        detailFields: {
          "contactInfo.website": "a.website|attr:href",
          "contactInfo.offices": {
            selector: ".office-card",
            children: {
              name: "h3",
              phone: ".phone",
            },
            multiple: true,
          },
        },
      });

      const rawResult = createRawResult([
        {
          externalId: "rep-1",
          name: "Test Rep",
          detailUrl: "https://example.com/rep/1",
        },
      ]);

      await crawler.enrichItems(rawResult, source, mockLlm);

      // AI should NOT be called when detailFields is provided
      expect(mockLlm.generate).not.toHaveBeenCalled();

      // Structured offices should be extracted
      const contactInfo = rawResult.items[0].contactInfo as Record<
        string,
        unknown
      >;
      expect(contactInfo).toBeDefined();
      expect(contactInfo.website).toBe("https://example.gov");

      const offices = contactInfo.offices as Record<string, string>[];
      expect(offices).toHaveLength(2);
      expect(offices[0]).toEqual({ name: "Capitol", phone: "555-1000" });
      expect(offices[1]).toEqual({ name: "District", phone: "555-2000" });
    });

    it("should handle simple string selectors alongside structured configs", async () => {
      const detailHtml = `<html><body>
        <p class="bio">A great representative.</p>
        <div class="office"><span class="name">Main Office</span><span class="addr">123 Main St</span></div>
      </body></html>`;

      mockExtraction.fetchWithRetry.mockResolvedValue({
        content: detailHtml,
        fromCache: false,
      });

      const source = createSource({
        dataType: DataType.REPRESENTATIVES,
        contentGoal: "Extract representatives",
        detailFields: {
          bio: ".bio",
          "contactInfo.offices": {
            selector: ".office",
            children: { name: ".name", address: ".addr" },
            multiple: true,
          },
        },
      });

      const rawResult = createRawResult([
        {
          externalId: "rep-1",
          name: "Test",
          detailUrl: "https://example.com/1",
        },
      ]);

      await crawler.enrichItems(rawResult, source, mockLlm);

      expect(rawResult.items[0].bio).toBe("A great representative.");
      const contactInfo = rawResult.items[0].contactInfo as Record<
        string,
        unknown
      >;
      const offices = contactInfo.offices as Record<string, string>[];
      expect(offices).toHaveLength(1);
      expect(offices[0]).toEqual({
        name: "Main Office",
        address: "123 Main St",
      });
    });

    it("should support _text child selector to grab full element text", async () => {
      const detailHtml = `<html><body>
        <div class="office">Capitol Office, 1021 O Street, Sacramento, CA 95814; (916) 651-4001</div>
        <div class="office">District Office, 100 Main St, Redding, CA 96001; (530) 224-7001</div>
      </body></html>`;

      mockExtraction.fetchWithRetry.mockResolvedValue({
        content: detailHtml,
        fromCache: false,
      });

      const source = createSource({
        dataType: DataType.REPRESENTATIVES,
        contentGoal: "Extract representatives",
        detailFields: {
          "contactInfo.offices": {
            selector: ".office",
            children: { fullAddress: "_text" },
            multiple: true,
          },
        },
      });

      const rawResult = createRawResult([
        {
          externalId: "rep-1",
          name: "Test",
          detailUrl: "https://example.com/1",
        },
      ]);

      await crawler.enrichItems(rawResult, source, mockLlm);

      const contactInfo = rawResult.items[0].contactInfo as Record<
        string,
        unknown
      >;
      const offices = contactInfo.offices as Record<string, string>[];
      expect(offices).toHaveLength(2);
      expect(offices[0].fullAddress).toContain("Capitol Office");
      expect(offices[1].fullAddress).toContain("District Office");
    });

    it("should support _regex child selector to extract with regex", async () => {
      const detailHtml = `<html><body>
        <div class="office">Capitol 1021 O Street Sacramento, CA 95814 Phone: (916) 651-4001 E-mail: senator@senate.ca.gov</div>
      </body></html>`;

      mockExtraction.fetchWithRetry.mockResolvedValue({
        content: detailHtml,
        fromCache: false,
      });

      const source = createSource({
        dataType: DataType.REPRESENTATIVES,
        contentGoal: "Extract representatives",
        detailFields: {
          "contactInfo.offices": {
            selector: ".office",
            children: {
              phone: "_regex:Phone:\\s*([\\d()\\s-]+)",
              email: "_regex:E-mail:\\s*([\\w.+-]+@[\\w.-]+)",
            },
            multiple: true,
          },
        },
      });

      const rawResult = createRawResult([
        {
          externalId: "rep-1",
          name: "Test",
          detailUrl: "https://example.com/1",
        },
      ]);

      await crawler.enrichItems(rawResult, source, mockLlm);

      const contactInfo = rawResult.items[0].contactInfo as Record<
        string,
        unknown
      >;
      const offices = contactInfo.offices as Record<string, string>[];
      expect(offices).toHaveLength(1);
      expect(offices[0].phone).toBe("(916) 651-4001");
      expect(offices[0].email).toBe("senator@senate.ca.gov");
    });
  });
});
