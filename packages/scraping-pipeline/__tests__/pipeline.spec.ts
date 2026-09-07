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
  let mockLinkDiscovery: { discover: jest.Mock };

  beforeEach(() => {
    mockLinkDiscovery = { discover: jest.fn() };
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
      getNextVersion: jest.fn().mockResolvedValue(2),
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
      evaluateMapping: jest.fn().mockReturnValue({
        shouldHeal: false,
        reason: "Mapping losses within tolerance",
        validation: { valid: true, issues: [] },
      }),
    } as unknown as jest.Mocked<SelfHealingService>;

    pipeline = new ScrapingPipelineService(
      { generate: jest.fn() } as any,
      mockExtraction,
      mockAnalyzer,
      mockStore,
      mockExtractor,
      mockMapper,
      mockHealing,
      {} as unknown as BulkDownloadHandler,
      {} as unknown as ApiIngestHandler,
      {} as any,
      {} as any,
      { enrichItems: jest.fn().mockImplementation((r: any) => r) } as any,
      mockLinkDiscovery as any,
      null,
    );
  });

  describe("execute with cached manifest", () => {
    it("should reuse cached manifest when hashes match", async () => {
      const result = await pipeline.execute(createSource(), "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(mockAnalyzer.analyze).not.toHaveBeenCalled();
      // Records success with the extracted item count as the drift baseline (#911)
      expect(mockStore.incrementSuccess).toHaveBeenCalledWith("manifest-1", 1);
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
      mockStore.getNextVersion.mockResolvedValue(1);
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
      // Should record success on new manifest with its item count baseline
      expect(mockStore.incrementSuccess).toHaveBeenCalledWith("manifest-2", 1);
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

    it("re-analyzes in-run even in async/worker mode on zero-yield (#911)", async () => {
      // Regression: previously the async path (onManifestMissing wired) only
      // enqueued a background refresh and returned the degraded 0-item result,
      // so a stale cached manifest silently zeroed out meetings until a later
      // sync converged. The pipeline must now heal in the same run.
      const onManifestMissing = jest.fn().mockResolvedValue(undefined);
      pipeline = new ScrapingPipelineService(
        { generate: jest.fn() } as any,
        mockExtraction,
        mockAnalyzer,
        mockStore,
        mockExtractor,
        mockMapper,
        mockHealing,
        {} as unknown as BulkDownloadHandler,
        {} as unknown as ApiIngestHandler,
        {} as any,
        {} as any,
        { enrichItems: jest.fn().mockImplementation((r: any) => r) } as any,
        { discover: jest.fn() } as any,
        onManifestMissing,
      );

      // Cache hit (hashes match) whose stale selectors yield 0 items, then a
      // healthy re-extraction after re-analysis.
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
      mockExtractor.extract
        .mockReturnValueOnce({
          items: [],
          success: false,
          warnings: [],
          errors: [],
        })
        .mockReturnValueOnce({
          items: [{ name: "Recovered" }],
          success: true,
          warnings: [],
          errors: [],
        });
      mockAnalyzer.analyze.mockResolvedValue(
        createManifest({ id: "manifest-2", version: 2 }),
      );

      await pipeline.execute(createSource(), "california");

      // Healed in-run: re-analyzed and re-extracted rather than deferring.
      expect(mockAnalyzer.analyze).toHaveBeenCalledTimes(1);
      expect(mockExtractor.extract).toHaveBeenCalledTimes(2);
      expect(mockStore.incrementSuccess).toHaveBeenCalledWith("manifest-2", 1);
    });

    it("passes the stored lastItemCount as the drift baseline (#911)", async () => {
      mockStore.findLatest.mockResolvedValue(
        createManifest({ lastItemCount: 13 }),
      );

      await pipeline.execute(createSource(), "california");

      expect(mockHealing.evaluate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        13,
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
      // New version comes from getNextVersion (MAX across all rows), not
      // from the active manifest's version + 1.
      mockStore.getNextVersion.mockResolvedValue(4);

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
        { generate: jest.fn() } as any,
        mockExtraction,
        mockAnalyzer,
        mockStore,
        mockExtractor,
        mockMapper,
        mockHealing,
        mockBulkDownload,
        mockApiIngest,
        {} as any,
        {} as any,
        { enrichItems: jest.fn().mockImplementation((r: any) => r) } as any,
        { discover: jest.fn() } as any,
        null,
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
        undefined,
        undefined,
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

      expect(mockApiIngest.execute).toHaveBeenCalledWith(
        source,
        "california",
        undefined,
        undefined,
      );
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

  describe("mapping-aware self-healing (#966 W1)", () => {
    it("re-analyzes once when domain mapping rejects a majority of items", async () => {
      // Extraction looks healthy both times…
      mockHealing.evaluate.mockReturnValue({
        shouldHeal: false,
        reason: "Extraction passed validation",
        validation: { valid: true, issues: [] },
      });
      // …but mapping rejects everything on the first pass.
      (mockHealing.evaluateMapping as jest.Mock)
        .mockReturnValueOnce({
          shouldHeal: true,
          reason: "Domain mapping rejected 100% of extracted items",
          validation: {
            valid: false,
            issues: [{ severity: "error", message: "mapping loss" }],
          },
        })
        .mockReturnValue({
          shouldHeal: false,
          reason: "Mapping losses within tolerance",
          validation: { valid: true, issues: [] },
        });
      (mockMapper.map as jest.Mock)
        .mockReturnValueOnce({
          items: [],
          manifestVersion: 0,
          success: false,
          warnings: [],
          errors: [],
          extractionTimeMs: 1,
          selectorFailures: [
            { kind: "schema_reject", missRatio: 1, message: "rejected" },
          ],
        })
        .mockReturnValueOnce({
          items: [{ id: "fixed" }],
          manifestVersion: 0,
          success: true,
          warnings: [],
          errors: [],
          extractionTimeMs: 1,
        });

      const newManifest = createManifest({ id: "manifest-2", version: 2 });
      mockAnalyzer.analyze.mockResolvedValue(newManifest);

      const result = await pipeline.execute(createSource(), "california");

      // Healed via re-analysis and kept the better (remapped) outcome
      expect(mockAnalyzer.analyze).toHaveBeenCalled();
      expect(mockExtractor.extract).toHaveBeenCalledTimes(2);
      expect(result.items).toEqual([{ id: "fixed" }]);
    });

    it("keeps the original result when the mapping-heal remap is not better", async () => {
      mockHealing.evaluate.mockReturnValue({
        shouldHeal: false,
        reason: "Extraction passed validation",
        validation: { valid: true, issues: [] },
      });
      (mockHealing.evaluateMapping as jest.Mock).mockReturnValueOnce({
        shouldHeal: true,
        reason: "Domain mapping rejected 100% of extracted items",
        validation: {
          valid: false,
          issues: [{ severity: "error", message: "mapping loss" }],
        },
      });
      const emptyMapped = {
        items: [],
        manifestVersion: 0,
        success: false,
        warnings: [],
        errors: [],
        extractionTimeMs: 1,
      };
      (mockMapper.map as jest.Mock)
        .mockReturnValueOnce({
          ...emptyMapped,
          selectorFailures: [
            { kind: "schema_reject", missRatio: 1, message: "rejected" },
          ],
        })
        .mockReturnValueOnce(emptyMapped);

      const newManifest = createManifest({ id: "manifest-2", version: 2 });
      mockAnalyzer.analyze.mockResolvedValue(newManifest);

      const result = await pipeline.execute(createSource(), "california");

      expect(result.items).toEqual([]);
      // Original manifest version retained — the failed heal didn't win
      expect(result.manifestVersion).toBe(1);
    });
  });

  describe("linkDiscovery routing (#1164)", () => {
    const LEAF_A = "https://example.com/elections/nov-2026-measures";
    const LEAF_B = "https://example.com/elections/jun-2026-measures";

    function linkDiscoverySource(): DataSourceConfig {
      return createSource({
        linkDiscovery: {
          steps: [{ textPattern: "Measures", select: "all" }],
        },
      });
    }

    it("runs the pipeline once per discovered leaf and aggregates items", async () => {
      mockLinkDiscovery.discover.mockResolvedValue({
        leafUrls: [LEAF_A, LEAF_B],
        warnings: ["step 1: no matching links on https://example.com/old"],
        errors: [],
      });
      // Manifests resolve per leaf URL — return a cache hit for each.
      mockStore.findLatest.mockImplementation(async (_r, sourceUrl) =>
        createManifest({ sourceUrl: sourceUrl as string }),
      );
      (mockMapper.map as jest.Mock)
        .mockReturnValueOnce({
          items: [{ externalId: "measure-a", title: "A" }],
          manifestVersion: 0,
          success: true,
          warnings: [],
          errors: [],
          extractionTimeMs: 1,
        })
        .mockReturnValueOnce({
          items: [{ externalId: "measure-b", title: "B" }],
          manifestVersion: 0,
          success: true,
          warnings: [],
          errors: [],
          extractionTimeMs: 1,
        });

      const result = await pipeline.execute(
        linkDiscoverySource(),
        "california",
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      // Discovery warnings surface on the aggregate result
      expect(result.warnings.some((w) => w.includes("no matching links"))).toBe(
        true,
      );
      // Each leaf was fetched and its manifest looked up under the LEAF url,
      // not the hub url — per-leaf manifest keying.
      expect(mockExtraction.fetchWithRetry).toHaveBeenCalledWith(LEAF_A);
      expect(mockExtraction.fetchWithRetry).toHaveBeenCalledWith(LEAF_B);
      expect(mockStore.findLatest).toHaveBeenCalledWith(
        "california",
        LEAF_A,
        DataType.PROPOSITIONS,
      );
      expect(mockStore.findLatest).toHaveBeenCalledWith(
        "california",
        LEAF_B,
        DataType.PROPOSITIONS,
      );
    });

    it("fails the source loudly when discovery errors (staleness alarm)", async () => {
      mockLinkDiscovery.discover.mockResolvedValue({
        leafUrls: [],
        warnings: [],
        errors: [
          'linkDiscovery step 1 ("Measures") matched no links on any of 1 page(s)',
        ],
      });

      const result = await pipeline.execute(
        linkDiscoverySource(),
        "california",
      );

      expect(result.success).toBe(false);
      expect(result.items).toEqual([]);
      expect(result.errors[0]).toContain("matched no links");
      // No extraction was attempted
      expect(mockExtractor.extract).not.toHaveBeenCalled();
    });

    it("propagates pendingManifestAnalysis when a leaf hits a cold manifest miss", async () => {
      const onManifestMissing = jest.fn().mockResolvedValue(undefined);
      pipeline = new ScrapingPipelineService(
        { generate: jest.fn() } as any,
        mockExtraction,
        mockAnalyzer,
        mockStore,
        mockExtractor,
        mockMapper,
        mockHealing,
        {} as unknown as BulkDownloadHandler,
        {} as unknown as ApiIngestHandler,
        {} as any,
        {} as any,
        { enrichItems: jest.fn().mockImplementation((r: any) => r) } as any,
        mockLinkDiscovery as any,
        onManifestMissing,
      );
      mockLinkDiscovery.discover.mockResolvedValue({
        leafUrls: [LEAF_A],
        warnings: [],
        errors: [],
      });
      // Cold miss on the (new-cycle) leaf: no stored manifest yet.
      mockStore.findLatest.mockResolvedValue(undefined);

      const result = await pipeline.execute(
        linkDiscoverySource(),
        "california",
      );

      expect(result.success).toBe(true);
      expect(result.items).toEqual([]);
      expect(result.pendingManifestAnalysis).toBe(true);
      // Analysis was enqueued for the leaf URL, not the hub URL.
      expect(onManifestMissing).toHaveBeenCalledWith(
        expect.objectContaining({ sourceUrl: LEAF_A }),
      );
    });

    it("keeps other leaves' items when one leaf throws", async () => {
      // A leaf taken down mid-cycle must not discard the measures already
      // extracted from its siblings — the discovery walk soft-fails per page
      // and execution has to match it.
      mockLinkDiscovery.discover.mockResolvedValue({
        leafUrls: [LEAF_A, LEAF_B],
        warnings: [],
        errors: [],
      });
      mockStore.findLatest.mockImplementation(async (_r, sourceUrl) =>
        createManifest({ sourceUrl: sourceUrl as string }),
      );
      (mockExtraction.fetchWithRetry as jest.Mock).mockImplementation(
        async (url: string) => {
          if (url === LEAF_A) throw new Error("HTTP 404");
          return {
            content: SIMPLE_HTML,
            url,
            statusCode: 200,
            cached: false,
          };
        },
      );

      const result = await pipeline.execute(
        linkDiscoverySource(),
        "california",
      );

      // LEAF_B still contributed.
      expect(result.items).toHaveLength(1);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("HTTP 404"))).toBe(true);
      expect(result.errors.some((e) => e.includes(LEAF_A))).toBe(true);
    });

    it("does not consult link discovery for plain html_scrape sources", async () => {
      await pipeline.execute(createSource(), "california");
      expect(mockLinkDiscovery.discover).not.toHaveBeenCalled();
    });
  });
});
