import { ApiIngestHandler } from "../src/handlers/api-ingest.handler";
import type { DomainMapperService } from "../src/mapping/domain-mapper.service";
import {
  DataType,
  type DataSourceConfig,
  type ExtractionResult,
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
    url: "https://api.example.com/v1/items",
    dataType: DataType.CAMPAIGN_FINANCE,
    contentGoal: "Extract items",
    sourceType: "api",
    api: {
      resultsPath: "results",
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

function mockFetchResponse(
  body: Record<string, unknown>,
  ok = true,
  status = 200,
) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Internal Server Error",
    json: jest.fn().mockResolvedValue(body),
  };
}

describe("ApiIngestHandler", () => {
  let handler: ApiIngestHandler;
  let mapper: jest.Mocked<DomainMapperService>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mapper = createMockMapper();
    handler = new ApiIngestHandler(mapper);
    originalFetch = global.fetch;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("execute — successful single-page response", () => {
    it("should fetch items and map them through the domain mapper", async () => {
      const items = [
        { externalId: "C1", name: "Committee 1" },
        { externalId: "C2", name: "Committee 2" },
      ];

      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: items }),
      );

      const result = await handler.execute(createSource(), "california");

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mapper.map).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute — HTTP error", () => {
    it("should return success: false with error message", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({}, false, 500),
      );

      const result = await handler.execute(createSource(), "california");

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("500")]),
      );
      expect(result.items).toEqual([]);
    });
  });

  describe("execute — offset pagination", () => {
    it("should fetch multiple pages until items < limit", async () => {
      const page1 = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
      }));
      const page2 = Array.from({ length: 5 }, (_, i) => ({
        id: `item-${10 + i}`,
      }));

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFetchResponse({ results: page1 }))
        .mockResolvedValueOnce(mockFetchResponse({ results: page2 }));

      const source = createSource({
        api: {
          resultsPath: "results",
          pagination: {
            type: "offset",
            limit: 10,
            pageParam: "offset",
            limitParam: "per_page",
          },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.items).toHaveLength(15);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("execute — cursor pagination", () => {
    it("should extract cursor from FEC-style response and stop when no cursor", async () => {
      const page1Items = [{ id: "1" }, { id: "2" }];
      const page2Items = [{ id: "3" }];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(
          mockFetchResponse({
            results: page1Items,
            pagination: {
              last_indexes: { last_index: "cursor-abc" },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse({
            results: page2Items,
            pagination: { last_indexes: {} },
          }),
        );

      const source = createSource({
        api: {
          resultsPath: "results",
          pagination: {
            type: "cursor",
            limit: 100,
          },
        },
      });

      const result = await handler.execute(source, "california");

      expect(result.items).toHaveLength(3);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("execute — page pagination at MAX_PAGES", () => {
    it("should stop at MAX_PAGES (10) and add a warning", async () => {
      // Always return full pages to trigger MAX_PAGES
      (global.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve(
          mockFetchResponse({
            results: Array.from({ length: 100 }, (_, i) => ({ id: `${i}` })),
          }),
        ),
      );

      const source = createSource({
        api: {
          resultsPath: "results",
          pagination: {
            type: "page",
            limit: 100,
            pageParam: "page",
            limitParam: "per_page",
          },
        },
      });

      const result = await handler.execute(source, "california");

      expect(global.fetch).toHaveBeenCalledTimes(10);
      // Warnings should contain the max page limit warning
      expect(mapper.map).toHaveBeenCalledWith(
        expect.objectContaining({
          warnings: expect.arrayContaining([
            expect.stringContaining("max page limit"),
          ]),
        }),
        source,
      );
    });
  });

  describe("buildPageUrl", () => {
    it("should add queryParams and API key to URL", async () => {
      const envKey = "TEST_API_KEY_12345";
      process.env.FEC_API_KEY = envKey;

      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: [] }),
      );

      const source = createSource({
        api: {
          resultsPath: "results",
          queryParams: {
            sort: "-date",
            is_individual: "true",
          },
          apiKeyEnvVar: "FEC_API_KEY",
          apiKeyHeader: "api_key",
        },
      });

      await handler.execute(source, "california");

      const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      const url = new URL(fetchUrl);
      expect(url.searchParams.get("sort")).toBe("-date");
      expect(url.searchParams.get("is_individual")).toBe("true");
      expect(url.searchParams.get("api_key")).toBe(envKey);

      delete process.env.FEC_API_KEY;
    });

    it("should add offset pagination params correctly", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: [] }),
      );

      const source = createSource({
        api: {
          resultsPath: "results",
          pagination: {
            type: "offset",
            limit: 50,
            pageParam: "offset",
            limitParam: "per_page",
          },
        },
      });

      await handler.execute(source, "california");

      const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      const url = new URL(fetchUrl);
      expect(url.searchParams.get("per_page")).toBe("50");
      expect(url.searchParams.get("offset")).toBe("0");
    });
  });

  describe("extractItems", () => {
    it("should navigate dot-separated resultsPath", async () => {
      const items = [{ id: "1" }];
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ data: { items } }),
      );

      const source = createSource({
        api: { resultsPath: "data.items" },
      });

      const result = await handler.execute(source, "california");

      expect(result.items).toHaveLength(1);
    });

    it("should return empty array for missing path", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ data: {} }),
      );

      const source = createSource({
        api: { resultsPath: "data.items.nested" },
      });

      const result = await handler.execute(source, "california");

      expect(result.items).toEqual([]);
    });
  });

  describe("inferSourceSystem", () => {
    it("should inject fec sourceSystem for FEC category", async () => {
      const items = [{ id: "1" }];
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: items }),
      );

      const source = createSource({ category: "fec-contributions" });

      await handler.execute(source, "california");

      const rawResult = mapper.map.mock.calls[0][0];
      expect(rawResult.items[0].sourceSystem).toBe("fec");
    });

    it("should inject cal_access sourceSystem for CAL-ACCESS category", async () => {
      const items = [{ id: "1" }];
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: items }),
      );

      const source = createSource({ category: "cal-access-contributions" });

      await handler.execute(source, "california");

      const rawResult = mapper.map.mock.calls[0][0];
      expect(rawResult.items[0].sourceSystem).toBe("cal_access");
    });

    it("should not inject sourceSystem for unknown category", async () => {
      const items = [{ id: "1" }];
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: items }),
      );

      const source = createSource({ category: "other" });

      await handler.execute(source, "california");

      const rawResult = mapper.map.mock.calls[0][0];
      expect(rawResult.items[0].sourceSystem).toBeUndefined();
    });
  });

  describe("resolveApiKey", () => {
    it("should read API key from environment variable", async () => {
      process.env.MY_API_KEY = "secret-key";

      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: [] }),
      );

      const source = createSource({
        api: {
          resultsPath: "results",
          apiKeyEnvVar: "MY_API_KEY",
          apiKeyHeader: "api_key",
        },
      });

      await handler.execute(source, "california");

      const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(fetchUrl).toContain("secret-key");

      delete process.env.MY_API_KEY;
    });

    it("should not add api_key param when env var is not set", async () => {
      delete process.env.NONEXISTENT_KEY;

      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: [] }),
      );

      const source = createSource({
        api: {
          resultsPath: "results",
          apiKeyEnvVar: "NONEXISTENT_KEY",
          apiKeyHeader: "api_key",
        },
      });

      await handler.execute(source, "california");

      const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      const url = new URL(fetchUrl);
      expect(url.searchParams.has("api_key")).toBe(false);
    });
  });

  describe("execute — no pagination config", () => {
    it("should fetch a single page when pagination is not configured", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: [{ id: "1" }] }),
      );

      const result = await handler.execute(createSource(), "california");

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(1);
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
});
