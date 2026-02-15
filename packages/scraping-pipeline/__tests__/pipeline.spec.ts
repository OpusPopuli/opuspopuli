import { ScrapingPipelineService } from "../src/pipeline/pipeline.service";
import type { StructuralAnalyzerService } from "../src/analysis/structural-analyzer.service";
import type { ManifestStoreService } from "../src/manifest/manifest-store.service";
import type { ManifestExtractorService } from "../src/extraction/manifest-extractor.service";
import type { DomainMapperService } from "../src/mapping/domain-mapper.service";
import type { SelfHealingService } from "../src/healing/self-healing.service";
import type { BulkDownloadHandler } from "../src/handlers/bulk-download.handler";
import type { ApiIngestHandler } from "../src/handlers/api-ingest.handler";
import type { ExtractionProvider } from "@opuspopuli/extraction-provider";
import { computeStructureHash } from "../src/analysis/structure-hasher";
import {
  DataType,
  type StructuralManifest,
  type DataSourceConfig,
} from "@opuspopuli/common";

const SIMPLE_HTML =
  "<html><body><div class='container'><div class='item'><span class='name'>Test</span></div></div></body></html>";

// Pre-compute the actual structure hash so ManifestComparator.compare returns canReuse=true
const STRUCTURE_HASH = computeStructureHash(SIMPLE_HTML);

function createManifest(
  overrides: Partial<StructuralManifest> = {},
): StructuralManifest {
  return {
    id: "manifest-1",
    regionId: "california",
    sourceUrl: "https://example.com",
    dataType: DataType.PROPOSITIONS,
    version: 1,
    structureHash: STRUCTURE_HASH,
    promptHash: "prompt-hash",
    extractionRules: {
      containerSelector: ".container",
      itemSelector: ".item",
      fieldMappings: [
        {
          fieldName: "name",
          selector: ".name",
          extractionMethod: "text",
          required: true,
        },
      ],
    },
    confidence: 0.8,
    successCount: 5,
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
    url: "https://example.com",
    dataType: DataType.PROPOSITIONS,
    contentGoal: "Extract data",
    ...overrides,
  };
}

describe("ScrapingPipelineService", () => {
  let pipeline: ScrapingPipelineService;
  let mockExtraction: jest.Mocked<ExtractionProvider>;
  let mockAnalyzer: jest.Mocked<StructuralAnalyzerService>;
  let mockStore: jest.Mocked<ManifestStoreService>;
  let mockExtractor: jest.Mocked<ManifestExtractorService>;
  let mockMapper: jest.Mocked<DomainMapperService>;
  let mockHealing: jest.Mocked<SelfHealingService>;

  beforeEach(() => {
    mockExtraction = {
      fetchWithRetry: jest.fn().mockResolvedValue({
        content: SIMPLE_HTML,
        url: "https://example.com",
        statusCode: 200,
        cached: false,
      }),
    } as unknown as jest.Mocked<ExtractionProvider>;

    mockAnalyzer = {
      analyze: jest.fn().mockResolvedValue(createManifest()),
      getCurrentPromptHash: jest.fn().mockResolvedValue("prompt-hash"),
    } as unknown as jest.Mocked<StructuralAnalyzerService>;

    mockStore = {
      findLatest: jest.fn().mockResolvedValue(createManifest()),
      save: jest.fn().mockImplementation(async (m) => m),
      incrementSuccess: jest.fn().mockResolvedValue(undefined),
      incrementFailure: jest.fn().mockResolvedValue(undefined),
      markChecked: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ManifestStoreService>;

    mockExtractor = {
      extract: jest.fn().mockReturnValue({
        items: [{ name: "Test" }],
        success: true,
        warnings: [],
        errors: [],
      }),
    } as unknown as jest.Mocked<ManifestExtractorService>;

    mockMapper = {
      map: jest.fn().mockReturnValue({
        items: [{ externalId: "1", title: "Test" }],
        manifestVersion: 0,
        success: true,
        warnings: [],
        errors: [],
        extractionTimeMs: 1,
      }),
    } as unknown as jest.Mocked<DomainMapperService>;

    mockHealing = {
      evaluate: jest.fn().mockReturnValue({
        shouldHeal: false,
        reason: "Extraction passed validation",
        validation: { valid: true, issues: [] },
      }),
    } as unknown as jest.Mocked<SelfHealingService>;

    pipeline = new ScrapingPipelineService(
      mockExtraction,
      mockAnalyzer,
      mockStore,
      mockExtractor,
      mockMapper,
      mockHealing,
      {} as unknown as BulkDownloadHandler,
      {} as unknown as ApiIngestHandler,
    );
  });

  describe("execute with cached manifest", () => {
    it("should reuse cached manifest when hashes match", async () => {
      const result = await pipeline.execute(createSource(), "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(mockAnalyzer.analyze).not.toHaveBeenCalled();
      expect(mockStore.incrementSuccess).toHaveBeenCalledWith("manifest-1");
      expect(mockStore.markChecked).toHaveBeenCalledWith("manifest-1");
    });

    it("should fetch HTML via extraction provider", async () => {
      await pipeline.execute(createSource(), "california");

      expect(mockExtraction.fetchWithRetry).toHaveBeenCalledWith(
        "https://example.com",
      );
    });

    it("should pass source URL as baseUrl to extractor", async () => {
      await pipeline.execute(createSource(), "california");

      expect(mockExtractor.extract).toHaveBeenCalledWith(
        SIMPLE_HTML,
        expect.any(Object),
        "https://example.com",
      );
    });

    it("should set manifestVersion on the result", async () => {
      const result = await pipeline.execute(createSource(), "california");

      expect(result.manifestVersion).toBe(1);
    });
  });

  describe("execute with no existing manifest", () => {
    beforeEach(() => {
      mockStore.findLatest.mockResolvedValue(undefined);
    });

    it("should run AI analysis when no manifest exists", async () => {
      await pipeline.execute(createSource(), "california");

      expect(mockAnalyzer.analyze).toHaveBeenCalledWith(
        SIMPLE_HTML,
        createSource(),
      );
      expect(mockStore.save).toHaveBeenCalled();
    });

    it("should set version to 1 for first manifest", async () => {
      await pipeline.execute(createSource(), "california");

      const savedManifest = mockStore.save.mock.calls[0][0];
      expect(savedManifest.version).toBe(1);
      expect(savedManifest.regionId).toBe("california");
    });
  });

  describe("self-healing flow", () => {
    it("should re-analyze when healing is triggered", async () => {
      mockHealing.evaluate
        .mockReturnValueOnce({
          shouldHeal: true,
          reason: "Zero items extracted",
          validation: {
            valid: false,
            issues: [{ severity: "error", message: "Zero items extracted" }],
          },
        })
        .mockReturnValueOnce({
          shouldHeal: false,
          reason: "Extraction passed validation",
          validation: { valid: true, issues: [] },
        });

      const newManifest = createManifest({ id: "manifest-2", version: 2 });
      mockAnalyzer.analyze.mockResolvedValue(newManifest);

      await pipeline.execute(createSource(), "california");

      // Should re-analyze
      expect(mockAnalyzer.analyze).toHaveBeenCalled();
      // Should save the new manifest
      expect(mockStore.save).toHaveBeenCalled();
      // Should re-extract with new manifest
      expect(mockExtractor.extract).toHaveBeenCalledTimes(2);
      // Should record success on new manifest
      expect(mockStore.incrementSuccess).toHaveBeenCalledWith("manifest-2");
    });

    it("should record failure when healing also fails", async () => {
      mockHealing.evaluate
        .mockReturnValueOnce({
          shouldHeal: true,
          reason: "Zero items extracted",
          validation: {
            valid: false,
            issues: [{ severity: "error", message: "Zero items extracted" }],
          },
        })
        .mockReturnValueOnce({
          shouldHeal: true,
          reason: "Still failing",
          validation: {
            valid: false,
            issues: [{ severity: "error", message: "Still zero" }],
          },
        });

      const newManifest = createManifest({ id: "manifest-healed" });
      mockAnalyzer.analyze.mockResolvedValue(newManifest);

      await pipeline.execute(createSource(), "california");

      expect(mockStore.incrementFailure).toHaveBeenCalledWith(
        "manifest-healed",
      );
    });
  });

  describe("manifest version increment", () => {
    it("should increment version when re-deriving manifest", async () => {
      const existingManifest = createManifest({
        version: 3,
        structureHash: "old-hash",
      });
      mockStore.findLatest.mockResolvedValue(existingManifest);

      // Force cache miss by changing prompt hash
      mockAnalyzer.getCurrentPromptHash.mockResolvedValue("different-prompt");

      await pipeline.execute(createSource(), "california");

      const savedManifest = mockStore.save.mock.calls[0][0];
      expect(savedManifest.version).toBe(4);
    });
  });

  describe("sourceType routing", () => {
    let mockBulkDownload: jest.Mocked<BulkDownloadHandler>;
    let mockApiIngest: jest.Mocked<ApiIngestHandler>;

    beforeEach(() => {
      mockBulkDownload = {
        execute: jest.fn().mockResolvedValue({
          items: [{ committeeId: "C001" }],
          manifestVersion: 0,
          success: true,
          warnings: [],
          errors: [],
          extractionTimeMs: 50,
        }),
      } as unknown as jest.Mocked<BulkDownloadHandler>;

      mockApiIngest = {
        execute: jest.fn().mockResolvedValue({
          items: [{ committeeId: "C002" }],
          manifestVersion: 0,
          success: true,
          warnings: [],
          errors: [],
          extractionTimeMs: 50,
        }),
      } as unknown as jest.Mocked<ApiIngestHandler>;

      pipeline = new ScrapingPipelineService(
        mockExtraction,
        mockAnalyzer,
        mockStore,
        mockExtractor,
        mockMapper,
        mockHealing,
        mockBulkDownload,
        mockApiIngest,
      );
    });

    it("should route sourceType: 'bulk_download' to BulkDownloadHandler", async () => {
      const source = createSource({
        sourceType: "bulk_download",
        bulk: {
          format: "csv",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      const result = await pipeline.execute(source, "california");

      expect(mockBulkDownload.execute).toHaveBeenCalledWith(
        source,
        "california",
      );
      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      // Should NOT call extraction provider or analyzer
      expect(mockExtraction.fetchWithRetry).not.toHaveBeenCalled();
      expect(mockAnalyzer.analyze).not.toHaveBeenCalled();
    });

    it("should route sourceType: 'api' to ApiIngestHandler", async () => {
      const source = createSource({
        sourceType: "api",
        api: {
          resultsPath: "results",
          pagination: { type: "cursor", limit: 100 },
        },
      });

      const result = await pipeline.execute(source, "california");

      expect(mockApiIngest.execute).toHaveBeenCalledWith(source, "california");
      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(mockExtraction.fetchWithRetry).not.toHaveBeenCalled();
    });

    it("should route sourceType: undefined to HTML scraping pipeline", async () => {
      const source = createSource(); // no sourceType

      await pipeline.execute(source, "california");

      expect(mockExtraction.fetchWithRetry).toHaveBeenCalled();
      expect(mockBulkDownload.execute).not.toHaveBeenCalled();
      expect(mockApiIngest.execute).not.toHaveBeenCalled();
    });

    it("should return error when bulk_download source missing 'bulk' config", async () => {
      const source = createSource({ sourceType: "bulk_download" });
      // Remove bulk config
      delete source.bulk;

      const result = await pipeline.execute(source, "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("missing 'bulk' configuration"),
        ]),
      );
      expect(mockBulkDownload.execute).not.toHaveBeenCalled();
    });

    it("should return error when api source missing 'api' config", async () => {
      const source = createSource({ sourceType: "api" });
      // Remove api config
      delete source.api;

      const result = await pipeline.execute(source, "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("missing 'api' configuration"),
        ]),
      );
      expect(mockApiIngest.execute).not.toHaveBeenCalled();
    });
  });
});
