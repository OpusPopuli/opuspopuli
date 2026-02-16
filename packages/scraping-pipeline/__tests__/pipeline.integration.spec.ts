/**
 * Scraping Pipeline Integration Tests
 *
 * Wires up real services (ManifestExtractor, DomainMapper, SelfHealing,
 * BulkDownloadHandler, ApiIngestHandler) with mocked external dependencies
 * (ExtractionProvider for HTTP, StructuralAnalyzer for AI, ManifestStore for DB).
 *
 * Purpose: Verify end-to-end pipeline orchestration with real parsing/extraction
 * logic but no external dependencies (no HTTP, no AI, no DB).
 */
import { ScrapingPipelineService } from "../src/pipeline/pipeline.service";
import { ManifestExtractorService } from "../src/extraction/manifest-extractor.service";
import { DomainMapperService } from "../src/mapping/domain-mapper.service";
import { SelfHealingService } from "../src/healing/self-healing.service";
import { BulkDownloadHandler } from "../src/handlers/bulk-download.handler";
import { ApiIngestHandler } from "../src/handlers/api-ingest.handler";
import type { StructuralAnalyzerService } from "../src/analysis/structural-analyzer.service";
import type { ManifestStoreService } from "../src/manifest/manifest-store.service";
import type { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { computeStructureHash } from "../src/analysis/structure-hasher";
import {
  DataType,
  type StructuralManifest,
  type DataSourceConfig,
} from "@opuspopuli/common";

// NestJS decorators are NOT mocked — they work as no-ops in direct instantiation.
// This allows the full import chain (including ExtractionProvider types) to load.

// ==========================================
// Test HTML content and manifest
// ==========================================

// HTML includes all fields needed for Proposition Zod schema:
// externalId (required), title (required), summary (optional)
const TEST_HTML = `
<html><body>
  <div class="items">
    <div class="item">
      <span class="id">prop-001</span>
      <span class="title">Proposition 1</span>
      <span class="summary">First proposition summary</span>
    </div>
    <div class="item">
      <span class="id">prop-002</span>
      <span class="title">Proposition 2</span>
      <span class="summary">Second proposition summary</span>
    </div>
  </div>
</body></html>
`;

const STRUCTURE_HASH = computeStructureHash(TEST_HTML);

function createManifest(
  overrides: Partial<StructuralManifest> = {},
): StructuralManifest {
  return {
    id: "manifest-integration-1",
    regionId: "california",
    sourceUrl: "https://example.com/propositions",
    dataType: DataType.PROPOSITIONS,
    version: 1,
    structureHash: STRUCTURE_HASH,
    promptHash: "prompt-hash-1",
    extractionRules: {
      containerSelector: ".items",
      itemSelector: ".item",
      fieldMappings: [
        {
          fieldName: "externalId",
          selector: ".id",
          extractionMethod: "text",
          required: true,
        },
        {
          fieldName: "title",
          selector: ".title",
          extractionMethod: "text",
          required: true,
        },
        {
          fieldName: "summary",
          selector: ".summary",
          extractionMethod: "text",
          required: false,
        },
      ],
    },
    confidence: 0.9,
    successCount: 10,
    failureCount: 0,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://example.com/propositions",
    dataType: DataType.PROPOSITIONS,
    contentGoal: "Extract ballot propositions",
    ...overrides,
  };
}

// ==========================================
// Helper to convert string to ArrayBuffer
// ==========================================

function toArrayBuffer(str: string): ArrayBuffer {
  const buf = Buffer.from(str, "utf-8");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("Pipeline Integration Tests", () => {
  // Real services
  let extractor: ManifestExtractorService;
  let mapper: DomainMapperService;
  let healing: SelfHealingService;
  let bulkDownload: BulkDownloadHandler;
  let apiIngest: ApiIngestHandler;

  // Mocked external dependencies
  let mockExtraction: jest.Mocked<ExtractionProvider>;
  let mockAnalyzer: jest.Mocked<StructuralAnalyzerService>;
  let mockStore: jest.Mocked<ManifestStoreService>;

  // Pipeline under test
  let pipeline: ScrapingPipelineService;

  beforeEach(() => {
    // Instantiate real services
    extractor = new ManifestExtractorService();
    mapper = new DomainMapperService();
    healing = new SelfHealingService();
    bulkDownload = new BulkDownloadHandler(mapper);
    apiIngest = new ApiIngestHandler(mapper);

    // Mock external dependencies
    mockExtraction = {
      fetchWithRetry: jest.fn().mockResolvedValue({
        content: TEST_HTML,
        url: "https://example.com/propositions",
        statusCode: 200,
        cached: false,
      }),
    } as unknown as jest.Mocked<ExtractionProvider>;

    mockAnalyzer = {
      analyze: jest.fn().mockResolvedValue(createManifest()),
      getCurrentPromptHash: jest.fn().mockResolvedValue("prompt-hash-1"),
    } as unknown as jest.Mocked<StructuralAnalyzerService>;

    mockStore = {
      findLatest: jest.fn().mockResolvedValue(createManifest()),
      save: jest.fn().mockImplementation(async (m) => m),
      incrementSuccess: jest.fn().mockResolvedValue(undefined),
      incrementFailure: jest.fn().mockResolvedValue(undefined),
      markChecked: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ManifestStoreService>;

    // Wire up the pipeline with real services + mocked externals
    pipeline = new ScrapingPipelineService(
      mockExtraction,
      mockAnalyzer,
      mockStore,
      extractor,
      mapper,
      healing,
      bulkDownload,
      apiIngest,
    );
  });

  // ==========================================
  // HTML SCRAPING FLOW
  // ==========================================

  describe("HTML scraping flow (real extractor + mapper, mocked HTTP + AI)", () => {
    it("should extract items from HTML using cached manifest and map to domain output", async () => {
      const result = await pipeline.execute(createSource(), "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);

      // Verify real extraction + domain mapping — items should have Proposition fields
      const item = result.items[0] as Record<string, unknown>;
      expect(item.externalId).toBe("prop-001");
      expect(item.title).toBe("Proposition 1");
      expect(item.summary).toBe("First proposition summary");

      // Manifest was cached — analyzer should NOT have been called
      expect(mockAnalyzer.analyze).not.toHaveBeenCalled();
      expect(mockStore.incrementSuccess).toHaveBeenCalled();
    });

    it("should reuse cached manifest when structure hash matches", async () => {
      await pipeline.execute(createSource(), "california");

      // Analyzer should never be called when manifest matches
      expect(mockAnalyzer.analyze).not.toHaveBeenCalled();
      expect(mockStore.findLatest).toHaveBeenCalled();
      expect(mockStore.markChecked).toHaveBeenCalled();
    });

    it("should run AI analysis when no manifest exists and extract items", async () => {
      mockStore.findLatest.mockResolvedValue(undefined);

      const result = await pipeline.execute(createSource(), "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      // Analyzer should be called to create new manifest
      expect(mockAnalyzer.analyze).toHaveBeenCalled();
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  // ==========================================
  // BULK DOWNLOAD FLOW
  // ==========================================

  describe("Bulk download flow (real handler + mapper, mocked HTTP)", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should download CSV, parse rows, and map through domain mapper", async () => {
      // CSV with all fields required by ContributionSchema:
      // externalId, committeeId, donorName, amount, date, sourceSystem
      const csvContent = [
        "TRAN_ID,CMTE_ID,NAME,AMOUNT,DATE",
        "CONTRIB-001,C001,Jane Doe,500.00,01/15/2025",
        "CONTRIB-002,C002,John Smith,1000.00,02/20/2025",
      ].join("\n");

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(csvContent)),
      });

      const source = createSource({
        sourceType: "bulk_download",
        dataType: DataType.CAMPAIGN_FINANCE,
        category: "cal-access-contributions",
        bulk: {
          format: "csv",
          columnMappings: {
            TRAN_ID: "externalId",
            CMTE_ID: "committeeId",
            NAME: "donorName",
            AMOUNT: "amount",
            DATE: "date",
          },
        },
      });

      const result = await pipeline.execute(source, "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);

      const items = result.items as Record<string, unknown>[];
      expect(items[0].externalId).toBe("CONTRIB-001");
      expect(items[0].committeeId).toBe("C001");
      expect(items[0].donorName).toBe("Jane Doe");
      expect(items[0].amount).toBe(500);

      // Should NOT call HTML extraction pipeline
      expect(mockExtraction.fetchWithRetry).not.toHaveBeenCalled();
      expect(mockAnalyzer.analyze).not.toHaveBeenCalled();
    });

    it("should apply filter criteria to exclude non-matching rows", async () => {
      const csvContent = [
        "TRAN_ID,CMTE_ID,NAME,STATE,AMOUNT,DATE",
        "C-001,C001,Jane,CA,500,01/15/2025",
        "C-002,C002,John,NY,1000,02/20/2025",
        "C-003,C003,Bob,CA,750,03/10/2025",
      ].join("\n");

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(csvContent)),
      });

      const source = createSource({
        sourceType: "bulk_download",
        dataType: DataType.CAMPAIGN_FINANCE,
        category: "cal-access-contributions",
        bulk: {
          format: "csv",
          columnMappings: {
            TRAN_ID: "externalId",
            CMTE_ID: "committeeId",
            NAME: "donorName",
            AMOUNT: "amount",
            DATE: "date",
          },
          filters: { STATE: "CA" },
        },
      });

      const result = await pipeline.execute(source, "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);

      const items = result.items as Record<string, unknown>[];
      expect(items[0].externalId).toBe("C-001");
      expect(items[1].externalId).toBe("C-003");
    });

    it("should parse TSV format correctly", async () => {
      const tsvContent = [
        "TRAN_ID\tCMTE_ID\tNAME\tAMOUNT\tDATE",
        "TSV-001\tC001\tJane\t500\t01/15/2025",
      ].join("\n");

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(tsvContent)),
      });

      const source = createSource({
        sourceType: "bulk_download",
        dataType: DataType.CAMPAIGN_FINANCE,
        category: "cal-access-contributions",
        bulk: {
          format: "tsv",
          columnMappings: {
            TRAN_ID: "externalId",
            CMTE_ID: "committeeId",
            NAME: "donorName",
            AMOUNT: "amount",
            DATE: "date",
          },
        },
      });

      const result = await pipeline.execute(source, "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      const items = result.items as Record<string, unknown>[];
      expect(items[0].committeeId).toBe("C001");
      expect(items[0].amount).toBe(500);
    });
  });

  // ==========================================
  // API INGEST FLOW
  // ==========================================

  describe("API ingest flow (real handler + mapper, mocked HTTP)", () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("should fetch JSON API and map results through domain mapper", async () => {
      // API response with all fields required by CommitteeSchema:
      // externalId, name, type, sourceSystem
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: jest.fn().mockResolvedValue({
          results: [
            {
              externalId: "COMM-001",
              name: "Citizens for Progress",
              type: "pac",
              sourceSystem: "cal_access",
              status: "active",
            },
            {
              externalId: "COMM-002",
              name: "Campaign for Change",
              type: "candidate",
              sourceSystem: "cal_access",
              candidateName: "Jane Smith",
            },
          ],
        }),
      });

      const source = createSource({
        url: "https://api.example.com/v1/committees",
        sourceType: "api",
        dataType: DataType.CAMPAIGN_FINANCE,
        category: "committee",
        api: {
          resultsPath: "results",
        },
      });

      const result = await pipeline.execute(source, "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);

      const items = result.items as Record<string, unknown>[];
      expect(items[0].externalId).toBe("COMM-001");
      expect(items[0].name).toBe("Citizens for Progress");
      expect(items[1].candidateName).toBe("Jane Smith");

      // Should NOT call HTML extraction pipeline
      expect(mockExtraction.fetchWithRetry).not.toHaveBeenCalled();
    });

    it("should handle paginated API responses", async () => {
      // Paginated response with FEC-style pagination
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          json: jest.fn().mockResolvedValue({
            results: [
              {
                externalId: "COMM-001",
                name: "Committee A",
                type: "pac",
                sourceSystem: "fec",
              },
              {
                externalId: "COMM-002",
                name: "Committee B",
                type: "pac",
                sourceSystem: "fec",
              },
            ],
            pagination: {
              last_indexes: { last_index: "cursor-abc" },
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          json: jest.fn().mockResolvedValue({
            results: [
              {
                externalId: "COMM-003",
                name: "Committee C",
                type: "pac",
                sourceSystem: "fec",
              },
            ],
            pagination: {},
          }),
        });

      global.fetch = fetchMock;

      const source = createSource({
        url: "https://api.example.com/v1/committees",
        sourceType: "api",
        dataType: DataType.CAMPAIGN_FINANCE,
        category: "committee",
        api: {
          resultsPath: "results",
          pagination: {
            type: "cursor",
            limit: 2,
          },
        },
      });

      const result = await pipeline.execute(source, "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
