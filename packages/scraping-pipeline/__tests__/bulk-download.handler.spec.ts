import { BulkDownloadHandler } from "../src/handlers/bulk-download.handler";
import type { DomainMapperService } from "../src/mapping/domain-mapper.service";
import type { ExecutionTrackerService } from "../src/pipeline/execution-tracker.service";
import { Readable } from "node:stream";
import {
  DataType,
  type DataSourceConfig,
  type BulkDownloadConfig,
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

// yauzl is NOT mocked — the ZIP integration tests use real yauzl extraction

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://example.com/data.csv",
    dataType: DataType.CAMPAIGN_FINANCE,
    contentGoal: "Extract campaign finance",
    sourceType: "bulk_download",
    bulk: {
      format: "csv",
      columnMappings: {
        CMTE_ID: "committeeId",
        NAME: "donorName",
        AMOUNT: "amount",
      },
    },
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

/**
 * Create a mock fetch response with a readable stream body.
 * The new handler uses response.body (stream) instead of arrayBuffer().
 */
function mockStreamResponse(content: string, ok = true, status = 200) {
  const stream = new Readable({
    read() {
      this.push(Buffer.from(content));
      this.push(null);
    },
  });

  return {
    ok,
    status,
    statusText: ok ? "OK" : "Not Found",
    body: stream,
  };
}

describe("BulkDownloadHandler", () => {
  let handler: BulkDownloadHandler;
  let mapper: jest.Mocked<DomainMapperService>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mapper = createMockMapper();
    handler = new BulkDownloadHandler(mapper, null);
    originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("execute — successful CSV download", () => {
    it("should download CSV, parse rows, apply column mappings, and map through domain mapper", async () => {
      const csvContent =
        "CMTE_ID,NAME,AMOUNT\nC001,Jane Doe,500\nC002,John Smith,1000";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(csvContent),
      );

      const result = await handler.execute(createSource(), "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(mapper.map).toHaveBeenCalledTimes(1);

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({
        committeeId: "C001",
        donorName: "Jane Doe",
        amount: "500",
      });
      expect(rawItems[1]).toMatchObject({
        committeeId: "C002",
        donorName: "John Smith",
        amount: "1000",
      });
    });
  });

  describe("execute — HTTP error", () => {
    it("should return success: false with error message", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await handler.execute(createSource(), "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("404")]),
      );
    });
  });

  describe("execute — no response body", () => {
    it("should return error when response has no body", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      });

      const result = await handler.execute(createSource(), "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("no body")]),
      );
    });
  });

  describe("parseDelimited — pipe delimiter with column mappings", () => {
    it("should parse pipe-delimited content and apply column mappings", async () => {
      const content = "CMTE_ID|NAME|STATE\nC001|Jane|CA\nC002|John|NY";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "csv",
          delimiter: "|",
          columnMappings: {
            CMTE_ID: "committeeId",
            NAME: "donorName",
            STATE: "donorState",
          },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.items).toHaveLength(2);
      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({
        committeeId: "C001",
        donorName: "Jane",
        donorState: "CA",
      });
    });
  });

  describe("parseDelimited — applies filters", () => {
    it("should skip rows that don't match filter criteria", async () => {
      const content =
        "CMTE_ID,NAME,STATE\nC001,Jane,CA\nC002,John,NY\nC003,Bob,CA";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "csv",
          columnMappings: {
            CMTE_ID: "committeeId",
            NAME: "donorName",
          },
          filters: { STATE: "CA" },
        },
      });

      const result = await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems).toHaveLength(2);
      expect(rawItems[0]).toMatchObject({ committeeId: "C001" });
      expect(rawItems[1]).toMatchObject({ committeeId: "C003" });
    });
  });

  describe("parseDelimited — skips empty lines", () => {
    it("should skip empty lines in the content", async () => {
      const content = "CMTE_ID,NAME\nC001,Jane\n\n\nC002,John\n";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "csv",
          columnMappings: { CMTE_ID: "committeeId", NAME: "donorName" },
        },
      });

      const result = await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems).toHaveLength(2);
    });
  });

  describe("getDelimiter", () => {
    it("should use config delimiter when provided", async () => {
      const content = "CMTE_ID|NAME\nC001|Jane";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "csv",
          delimiter: "|",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({ committeeId: "C001" });
    });

    it("should default to tab for TSV format", async () => {
      const content = "CMTE_ID\tNAME\nC001\tJane";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "tsv",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({ committeeId: "C001" });
    });

    it("should default to comma for CSV format", async () => {
      const content = "CMTE_ID,NAME\nC001,Jane";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "csv",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({ committeeId: "C001" });
    });
  });

  describe("inferSourceSystem", () => {
    it("should inject cal_access sourceSystem for cal-access category", async () => {
      const content = "CMTE_ID,NAME\nC001,Jane";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        category: "cal-access-contributions",
        bulk: {
          format: "csv",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0].sourceSystem).toBe("cal_access");
    });

    it("should inject fec sourceSystem for FEC category", async () => {
      const content = "CMTE_ID,NAME\nC001,Jane";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        category: "fec-individual-contributions",
        bulk: {
          format: "csv",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0].sourceSystem).toBe("fec");
    });
  });

  describe("parseDelimited — warns on missing column headers", () => {
    it("should still parse available columns when some headers are missing", async () => {
      const content = "CMTE_ID,NAME\nC001,Jane";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "csv",
          columnMappings: {
            CMTE_ID: "committeeId",
            NONEXISTENT: "missing",
          },
        },
      });

      const result = await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({ committeeId: "C001" });
      expect(rawItems[0].missing).toBeUndefined();
    });
  });

  describe("execute — network error", () => {
    it("should return error result when fetch throws", async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValue(
        new TypeError("Failed to fetch"),
      );

      const result = await handler.execute(createSource(), "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("Failed to fetch")]),
      );
    });
  });

  describe("execute — headerLines skip", () => {
    it("should skip specified number of header lines", async () => {
      const content = "# Comment line\nCMTE_ID,NAME\nC001,Jane";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );

      const source = createSource({
        bulk: {
          format: "csv",
          headerLines: 1,
          columnMappings: { CMTE_ID: "committeeId", NAME: "donorName" },
        },
      });

      await handler.execute(source, "california");

      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems).toHaveLength(1);
      expect(rawItems[0]).toMatchObject({ committeeId: "C001" });
    });
  });

  describe("execute — ZIP without filePattern", () => {
    it("should return error when no filePattern provided for ZIP format", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse("dummy"),
      );

      const source = createSource({
        bulk: {
          format: "zip_csv",
          columnMappings: { CMTE_ID: "committeeId" },
        } as BulkDownloadConfig,
      });

      const result = await handler.execute(source, "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("filePattern")]),
      );
    });
  });

  describe("execute — real ZIP extraction (integration)", () => {
    // These tests use adm-zip to create real ZIP test fixtures,
    // then verify the streaming yauzl extraction path end-to-end.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require("adm-zip");

    function createZipStream(fileName: string, content: string): Readable {
      const zip = new AdmZip();
      zip.addFile(fileName, Buffer.from(content));
      const zipBuffer = zip.toBuffer();

      return new Readable({
        read() {
          this.push(zipBuffer);
          this.push(null);
        },
      });
    }

    it("should extract and parse a CSV file from a real ZIP", async () => {
      const csvContent = "CMTE_ID,NAME,AMOUNT\nC001,Jane,500\nC002,John,1000";

      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        body: createZipStream("data.csv", csvContent),
      });

      const source = createSource({
        bulk: {
          format: "zip_csv",
          filePattern: "data.csv",
          columnMappings: {
            CMTE_ID: "committeeId",
            NAME: "donorName",
            AMOUNT: "amount",
          },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({
        committeeId: "C001",
        donorName: "Jane",
        amount: "500",
      });
    });

    it("should find file by case-insensitive match in ZIP", async () => {
      const csvContent = "CMTE_ID\nC001";

      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        body: createZipStream("ITCONT.TXT", csvContent),
      });

      const source = createSource({
        bulk: {
          format: "zip_csv",
          filePattern: "itcont.txt",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.success).toBe(true);
    });

    it("should return error when file not found in ZIP", async () => {
      const csvContent = "CMTE_ID\nC001";

      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        body: createZipStream("other-file.csv", csvContent),
      });

      const source = createSource({
        bulk: {
          format: "zip_csv",
          filePattern: "itcont.txt",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("not found in ZIP")]),
      );
    });

    it("should parse pipe-delimited TSV from ZIP", async () => {
      const tsvContent = "CMTE_ID|NAME\nC001|Jane";

      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        body: createZipStream("data.tsv", tsvContent),
      });

      const source = createSource({
        bulk: {
          format: "zip_tsv",
          filePattern: "data.tsv",
          delimiter: "|",
          columnMappings: { CMTE_ID: "committeeId", NAME: "donorName" },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.success).toBe(true);
      const rawItems = mapper.map.mock.calls[0][0].items;
      expect(rawItems[0]).toMatchObject({
        committeeId: "C001",
        donorName: "Jane",
      });
    });
  });

  describe("batch mode (onBatch callback)", () => {
    it("should flush records via onBatch callback instead of accumulating", async () => {
      const csvContent =
        "CMTE_ID,NAME,AMOUNT\nC001,Alice,100\nC002,Bob,200\nC003,Carol,300";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(csvContent),
      );

      const batches: Record<string, unknown>[][] = [];
      const onBatch = jest.fn(async (items: Record<string, unknown>[]) => {
        batches.push([...items]);
      });

      const source = createSource({
        bulk: {
          format: "csv",
          columnMappings: { CMTE_ID: "committeeId", NAME: "donorName" },
          batchSize: 2,
        },
      });

      const result = await handler.execute(source, "california", onBatch);

      // Items should NOT be accumulated in the result
      expect(result.items).toHaveLength(0);
      expect(result.success).toBe(true);
      expect(result.itemCount).toBe(3);

      // onBatch called with batches of 2, then remainder of 1
      expect(onBatch).toHaveBeenCalledTimes(2);
      expect(batches[0]).toHaveLength(2);
      expect(batches[1]).toHaveLength(1);
    });

    it("should return items normally when no onBatch is provided", async () => {
      const csvContent = "CMTE_ID,NAME,AMOUNT\nC001,Alice,100\nC002,Bob,200";

      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(csvContent),
      );

      const source = createSource();
      const result = await handler.execute(source, "california");

      expect(result.items).toHaveLength(2);
      expect(result.itemCount).toBeUndefined();
    });
  });

  describe("idempotency (execution tracking)", () => {
    // 5 rows, batchSize=2 → 3 batches: [0,1], [2,3], [4]
    const csvContent =
      "CMTE_ID,NAME\nC001,Alice\nC002,Bob\nC003,Carol\nC004,Dave\nC005,Eve";

    function createTracker(
      appliedBatches: Set<number> = new Set(),
    ): jest.Mocked<ExecutionTrackerService> {
      return {
        isEnabled: true,
        startExecution: jest.fn().mockResolvedValue({
          executionId: "exec-test",
          appliedBatches,
        }),
        recordBatch: jest.fn().mockResolvedValue(true),
        finalizeExecution: jest.fn().mockResolvedValue(undefined),
      } as unknown as jest.Mocked<ExecutionTrackerService>;
    }

    function createBatchSource() {
      return createSource({
        bulk: {
          format: "csv",
          columnMappings: { CMTE_ID: "committeeId", NAME: "donorName" },
          batchSize: 2,
        },
      });
    }

    beforeEach(() => {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(csvContent),
      );
    });

    it("should call onBatch for all batches when none are pre-applied", async () => {
      const tracker = createTracker(new Set());
      handler = new BulkDownloadHandler(mapper, tracker);

      const onBatch = jest.fn().mockResolvedValue(undefined);
      const result = await handler.execute(
        createBatchSource(),
        "california",
        onBatch,
        "job-1",
      );

      expect(onBatch).toHaveBeenCalledTimes(3);
      expect(result.itemCount).toBe(5);
      expect(tracker.startExecution).toHaveBeenCalledWith({
        pipelineJobId: "job-1",
        regionId: "california",
        // Identity carries a per-source discriminator beyond the URL (#984).
        sourceUrl: expect.stringContaining("https://example.com/data.csv"),
        dataType: "campaign_finance",
      });
      expect(tracker.recordBatch).toHaveBeenCalledTimes(3);
      expect(tracker.finalizeExecution).toHaveBeenCalledWith(
        "exec-test",
        true,
        expect.objectContaining({ itemsExtracted: 5 }),
      );
    });

    it("should skip already-applied batches and only call onBatch for new ones (crash-and-retry)", async () => {
      // Simulate: batches 0 and 1 applied in a prior run, batch 2 is new
      const tracker = createTracker(new Set([0, 1]));
      handler = new BulkDownloadHandler(mapper, tracker);

      const onBatch = jest.fn().mockResolvedValue(undefined);
      await handler.execute(
        createBatchSource(),
        "california",
        onBatch,
        "job-1",
      );

      // Only batch 2 (the 5th row) should fire onBatch
      expect(onBatch).toHaveBeenCalledTimes(1);
      // recordBatch called only for the new batch
      expect(tracker.recordBatch).toHaveBeenCalledTimes(1);
      expect(tracker.recordBatch).toHaveBeenCalledWith("exec-test", 2, 1);
    });

    it("should not call onBatch at all when all batches are pre-applied", async () => {
      const tracker = createTracker(new Set([0, 1, 2]));
      handler = new BulkDownloadHandler(mapper, tracker);

      const onBatch = jest.fn().mockResolvedValue(undefined);
      const result = await handler.execute(
        createBatchSource(),
        "california",
        onBatch,
        "job-1",
      );

      expect(onBatch).not.toHaveBeenCalled();
      expect(tracker.recordBatch).not.toHaveBeenCalled();
      expect(result.itemCount).toBe(0);
    });

    it("should finalize as failed and still call finalizeExecution when onBatch throws", async () => {
      const tracker = createTracker(new Set());
      handler = new BulkDownloadHandler(mapper, tracker);

      const onBatch = jest.fn().mockRejectedValue(new Error("DB write failed"));
      // The outer catch returns buildFailureResult, but finalizeExecution fires in the inner finally
      await handler.execute(
        createBatchSource(),
        "california",
        onBatch,
        "job-1",
      );

      expect(tracker.finalizeExecution).toHaveBeenCalledWith(
        "exec-test",
        false,
        expect.objectContaining({ itemsExtracted: 0 }),
      );
    });

    it("should not track when pipelineJobId is absent", async () => {
      const tracker = createTracker();
      handler = new BulkDownloadHandler(mapper, tracker);

      const onBatch = jest.fn().mockResolvedValue(undefined);
      // No pipelineJobId → tracker should not be engaged
      await handler.execute(createBatchSource(), "california", onBatch);

      expect(tracker.startExecution).not.toHaveBeenCalled();
      expect(tracker.recordBatch).not.toHaveBeenCalled();
      expect(tracker.finalizeExecution).not.toHaveBeenCalled();
      // But onBatch should still fire normally
      expect(onBatch).toHaveBeenCalledTimes(3);
    });

    it("should not track when tracker is null", async () => {
      handler = new BulkDownloadHandler(mapper, null);

      const onBatch = jest.fn().mockResolvedValue(undefined);
      const result = await handler.execute(
        createBatchSource(),
        "california",
        onBatch,
        "job-1",
      );

      expect(onBatch).toHaveBeenCalledTimes(3);
      expect(result.itemCount).toBe(5);
    });

    // #950: multiple bulk sources share one archive URL (all CAL-ACCESS
    // tables come from dbwebexport.zip). The execution identity must include
    // the extracted filePattern, else same-URL sources collide on one
    // checkpoint and every source after the first skips its whole stream.
    function createArchiveSource(filePattern: string, category = "Receipts") {
      return createSource({
        url: "https://example.com/dbwebexport.zip",
        category,
        bulk: {
          format: "csv", // filePattern drives the tracked identity regardless of format
          filePattern,
          columnMappings: { CMTE_ID: "committeeId", NAME: "donorName" },
          batchSize: 2,
        },
      });
    }

    it("encodes filePattern into the tracked identity for shared-archive sources (#950)", async () => {
      const tracker = createTracker(new Set());
      handler = new BulkDownloadHandler(mapper, tracker);

      await handler.execute(
        createArchiveSource("RCPT_CD.TSV"),
        "california",
        jest.fn().mockResolvedValue(undefined),
        "job-1",
      );

      expect(tracker.startExecution).toHaveBeenCalledWith({
        pipelineJobId: "job-1",
        regionId: "california",
        sourceUrl: "https://example.com/dbwebexport.zip#RCPT_CD.TSV#Receipts",
        dataType: "campaign_finance",
      });
    });

    it("gives same-URL sources distinct tracked identities so neither skips the other's batches (#950)", async () => {
      const tracker = createTracker(new Set());
      handler = new BulkDownloadHandler(mapper, tracker);

      // Fresh stream per call — a stream is consumed once, and this test
      // runs two executes.
      (globalThis.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve(mockStreamResponse(csvContent)),
      );

      const onBatch = jest.fn().mockResolvedValue(undefined);
      // Two files from the SAME archive URL — the exact CAL-ACCESS shape.
      await handler.execute(
        createArchiveSource("RCPT_CD.TSV"),
        "california",
        onBatch,
        "job-1",
      );
      await handler.execute(
        createArchiveSource("CVR_CAMPAIGN_DISCLOSURE_CD.TSV"),
        "california",
        onBatch,
        "job-1",
      );

      const trackedUrls = tracker.startExecution.mock.calls.map(
        (c) => (c[0] as { sourceUrl: string }).sourceUrl,
      );
      expect(trackedUrls).toEqual([
        "https://example.com/dbwebexport.zip#RCPT_CD.TSV#Receipts",
        "https://example.com/dbwebexport.zip#CVR_CAMPAIGN_DISCLOSURE_CD.TSV#Receipts",
      ]);
      // Both sources fully ingested (3 batches each) — no cross-source skip.
      expect(onBatch).toHaveBeenCalledTimes(6);
    });

    // #984: #950's filePattern discriminator is not enough. Two sources can
    // read the SAME file from the SAME archive for different purposes —
    // california.json reads CVR_CAMPAIGN_DISCLOSURE_CD.TSV once for Form 496
    // IE cover pages and once for the committee roster. Those collided on one
    // execution row and the second skipped its whole stream, silently.
    it("gives same-file sources distinct identities when only their purpose differs (#984)", async () => {
      const tracker = createTracker(new Set());
      handler = new BulkDownloadHandler(mapper, tracker);
      (globalThis.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve(mockStreamResponse(csvContent)),
      );

      const onBatch = jest.fn().mockResolvedValue(undefined);
      const file = "CVR_CAMPAIGN_DISCLOSURE_CD.TSV";
      await handler.execute(
        createArchiveSource(file, "CAL-ACCESS IE Cover Pages"),
        "california",
        onBatch,
        "job-1",
      );
      await handler.execute(
        createArchiveSource(file, "CAL-ACCESS Committees"),
        "california",
        onBatch,
        "job-1",
      );

      const trackedUrls = tracker.startExecution.mock.calls.map(
        (c) => (c[0] as { sourceUrl: string }).sourceUrl,
      );
      expect(new Set(trackedUrls).size).toBe(2);
      expect(trackedUrls).toEqual([
        `https://example.com/dbwebexport.zip#${file}#CAL-ACCESS IE Cover Pages`,
        `https://example.com/dbwebexport.zip#${file}#CAL-ACCESS Committees`,
      ]);
      // Neither source skipped the other's batches.
      expect(onBatch).toHaveBeenCalledTimes(6);
    });

    it("falls back to a contentGoal digest when a source has no category (#984)", async () => {
      const tracker = createTracker(new Set());
      handler = new BulkDownloadHandler(mapper, tracker);
      (globalThis.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve(mockStreamResponse(csvContent)),
      );

      const onBatch = jest.fn().mockResolvedValue(undefined);
      const base = {
        url: "https://example.com/dbwebexport.zip",
        bulk: {
          format: "csv" as const,
          filePattern: "CVR.TSV",
          columnMappings: { CMTE_ID: "committeeId", NAME: "donorName" },
          batchSize: 2,
        },
      };
      // contentGoal is required by DataSourceConfig and necessarily differs
      // between two sources over one file, so it backstops category.
      await handler.execute(
        createSource({ ...base, contentGoal: "Extract IE cover pages" }),
        "california",
        onBatch,
        "job-1",
      );
      await handler.execute(
        createSource({ ...base, contentGoal: "Extract the committee roster" }),
        "california",
        onBatch,
        "job-1",
      );

      const trackedUrls = tracker.startExecution.mock.calls.map(
        (c) => (c[0] as { sourceUrl: string }).sourceUrl,
      );
      expect(new Set(trackedUrls).size).toBe(2);
      expect(onBatch).toHaveBeenCalledTimes(6);
    });

    it("keeps the identity bounded when a category is very long (#984)", async () => {
      const tracker = createTracker(new Set());
      handler = new BulkDownloadHandler(mapper, tracker);

      // source_url is VarChar(1000) — an unbounded category would throw on
      // insert and take the whole sync down.
      await handler.execute(
        createArchiveSource("RCPT_CD.TSV", "X".repeat(5000)),
        "california",
        jest.fn().mockResolvedValue(undefined),
        "job-1",
      );

      const { sourceUrl } = tracker.startExecution.mock
        .calls[0][0] as unknown as { sourceUrl: string };
      expect(sourceUrl.length).toBeLessThan(1000);
      expect(sourceUrl).toContain("RCPT_CD.TSV");
    });
  });

  describe("compositeKey externalId (#980)", () => {
    /** Mirrors CAL-ACCESS RCPT_CD, where TRAN_ID alone repeats across filings. */
    function createCompositeSource(
      compositeKey: string[] | undefined,
      columnMappings: Record<string, string> = {
        TRAN_ID: "externalId",
        AMOUNT: "amount",
      },
    ): DataSourceConfig {
      return createSource({
        bulk: {
          format: "csv",
          columnMappings,
          compositeKey,
        } as BulkDownloadConfig,
      });
    }

    async function rawItemsFor(content: string, source: DataSourceConfig) {
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse(content),
      );
      await handler.execute(source, "california");
      return mapper.map.mock.calls[0][0].items as Array<
        Record<string, unknown>
      >;
    }

    it("joins the configured columns in order", async () => {
      const items = await rawItemsFor(
        "FILING_ID,AMEND_ID,LINE_ITEM,TRAN_ID,AMOUNT\n2801843,0,7,ABC123,500",
        createCompositeSource([
          "FILING_ID",
          "AMEND_ID",
          "LINE_ITEM",
          "TRAN_ID",
        ]),
      );

      expect(items[0].externalId).toBe("2801843:0:7:ABC123");
    });

    it("keeps rows distinct when TRAN_ID repeats across filings", async () => {
      // The bug this exists to prevent: both rows upsert onto one externalId,
      // so the second silently overwrites the first.
      const items = await rawItemsFor(
        "FILING_ID,AMEND_ID,LINE_ITEM,TRAN_ID,AMOUNT\n" +
          "2801843,0,7,ABC123,500\n" +
          "2801999,0,7,ABC123,750",
        createCompositeSource([
          "FILING_ID",
          "AMEND_ID",
          "LINE_ITEM",
          "TRAN_ID",
        ]),
      );

      expect(items).toHaveLength(2);
      expect(items[0].externalId).not.toBe(items[1].externalId);
    });

    it("preserves empty cells as empty segments so positions never shift", async () => {
      const items = await rawItemsFor(
        "FILING_ID,AMEND_ID,LINE_ITEM,TRAN_ID,AMOUNT\n2801843,,7,ABC123,500",
        createCompositeSource([
          "FILING_ID",
          "AMEND_ID",
          "LINE_ITEM",
          "TRAN_ID",
        ]),
      );

      // Not "2801843:7:ABC123" — that would collide with a row whose AMEND_ID
      // is 7 and LINE_ITEM is ABC123.
      expect(items[0].externalId).toBe("2801843::7:ABC123");
    });

    it("takes precedence over an externalId in columnMappings", async () => {
      const items = await rawItemsFor(
        "FILING_ID,LINE_ITEM,TRAN_ID,AMOUNT\n2801843,7,ABC123,500",
        createCompositeSource(["FILING_ID", "LINE_ITEM"]),
      );

      expect(items[0].externalId).toBe("2801843:7");
    });

    it("leaves externalId to columnMappings when not configured", async () => {
      const items = await rawItemsFor(
        "FILING_ID,LINE_ITEM,TRAN_ID,AMOUNT\n2801843,7,ABC123,500",
        createCompositeSource(undefined),
      );

      expect(items[0].externalId).toBe("ABC123");
    });

    it("throws when a key column is missing from the headers", async () => {
      // Warning-and-continuing would shorten the key for every row and collapse
      // distinct records onto one externalId — silent, total data loss.
      (globalThis.fetch as jest.Mock).mockResolvedValue(
        mockStreamResponse("FILING_ID,AMOUNT\n2801843,500"),
      );

      const result = await handler.execute(
        createCompositeSource(["FILING_ID", "TRAN_ID"]),
        "california",
      );

      expect(result.success).toBe(false);
      expect(result.errors.join(" ")).toContain("TRAN_ID");
    });

    it("drops a row whose key segments are all empty", async () => {
      const items = await rawItemsFor(
        "FILING_ID,TRAN_ID,AMOUNT\n2801843,ABC123,500\n,,750",
        createCompositeSource(["FILING_ID", "TRAN_ID"]),
      );

      expect(items).toHaveLength(1);
      expect(items[0].externalId).toBe("2801843:ABC123");
    });
  });
});
