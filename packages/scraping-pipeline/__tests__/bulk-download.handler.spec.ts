import { BulkDownloadHandler } from "../src/handlers/bulk-download.handler";
import type { DomainMapperService } from "../src/mapping/domain-mapper.service";
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

// Mock AdmZip
const mockGetData = jest.fn();
const mockGetEntries = jest.fn();
jest.mock("adm-zip", () => {
  return jest.fn().mockImplementation(() => ({
    getEntries: mockGetEntries,
  }));
});

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
 * Convert a string to a clean ArrayBuffer.
 * Buffer.from(str).buffer returns the shared pool buffer which is too large,
 * so we need to slice it to the exact byte range.
 */
function toArrayBuffer(str: string): ArrayBuffer {
  const buf = Buffer.from(str, "utf-8");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("BulkDownloadHandler", () => {
  let handler: BulkDownloadHandler;
  let mapper: jest.Mocked<DomainMapperService>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mapper = createMockMapper();
    handler = new BulkDownloadHandler(mapper);
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    mockGetEntries.mockReset();
    mockGetData.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("execute — successful CSV download", () => {
    it("should download CSV, parse rows, apply column mappings, and map through domain mapper", async () => {
      const csvContent =
        "CMTE_ID,NAME,AMOUNT\nC001,Jane Doe,500\nC002,John Smith,1000";

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(csvContent)),
      });

      const result = await handler.execute(createSource(), "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(mapper.map).toHaveBeenCalledTimes(1);

      // Verify mapped field names
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
      (global.fetch as jest.Mock).mockResolvedValue({
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

  describe("extractFromZip — file found by exact name", () => {
    it("should extract file matching exact filePattern from ZIP", async () => {
      const csvContent = "CMTE_ID|NAME|AMOUNT\nC001|Jane|500";

      mockGetData.mockReturnValue(Buffer.from(csvContent));
      mockGetEntries.mockReturnValue([
        {
          entryName: "itcont.txt",
          isDirectory: false,
          header: { size: csvContent.length },
          getData: mockGetData,
        },
      ]);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer("zip")),
      });

      const source = createSource({
        bulk: {
          format: "zip_csv",
          filePattern: "itcont.txt",
          delimiter: "|",
          columnMappings: { CMTE_ID: "committeeId" },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.success).toBe(true);
    });
  });

  describe("extractFromZip — case-insensitive match", () => {
    it("should find file by case-insensitive match", async () => {
      const csvContent = "CMTE_ID\nC001";

      mockGetData.mockReturnValue(Buffer.from(csvContent));
      mockGetEntries.mockReturnValue([
        {
          entryName: "ITCONT.TXT",
          isDirectory: false,
          header: { size: csvContent.length },
          getData: mockGetData,
        },
      ]);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer("zip")),
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
  });

  describe("extractFromZip — file not found", () => {
    it("should return error when filePattern not found in ZIP", async () => {
      mockGetEntries.mockReturnValue([
        {
          entryName: "other-file.csv",
          isDirectory: false,
        },
      ]);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer("zip")),
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
  });

  describe("extractFromZip — no filePattern for ZIP", () => {
    it("should return error when no filePattern provided for ZIP format", async () => {
      mockGetEntries.mockReturnValue([]);

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer("zip")),
      });

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

  describe("parseDelimited — pipe delimiter with column mappings", () => {
    it("should parse pipe-delimited content and apply column mappings", async () => {
      const content = "CMTE_ID|NAME|STATE\nC001|Jane|CA\nC002|John|NY";

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

      // Map a column that doesn't exist in the CSV
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
      (global.fetch as jest.Mock).mockRejectedValue(
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

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(toArrayBuffer(content)),
      });

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
});
