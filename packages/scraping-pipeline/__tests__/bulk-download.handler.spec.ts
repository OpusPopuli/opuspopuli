import { BulkDownloadHandler } from "../src/handlers/bulk-download.handler";
import type { DomainMapperService } from "../src/mapping/domain-mapper.service";
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
    handler = new BulkDownloadHandler(mapper);
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
});
