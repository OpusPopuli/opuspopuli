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

  describe("execute — field remapping", () => {
    it("should remap API response fields using fieldMappings", async () => {
      const items = [
        {
          committee_id: "C00123",
          contributor_name: "Jane Doe",
          contribution_receipt_amount: 500,
          sub_id: "12345",
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: items }),
      );

      const source = createSource({
        category: "FEC Contributions",
        api: {
          resultsPath: "results",
          fieldMappings: {
            committee_id: "committeeId",
            contributor_name: "donorName",
            contribution_receipt_amount: "amount",
            sub_id: "externalId",
          },
        },
      });

      await handler.execute(source, "federal");

      const rawResult = mapper.map.mock.calls[0][0];
      expect(rawResult.items[0]).toMatchObject({
        committeeId: "C00123",
        donorName: "Jane Doe",
        amount: 500,
        externalId: "12345",
      });
      // Original keys should be removed
      expect(rawResult.items[0].committee_id).toBeUndefined();
      expect(rawResult.items[0].contributor_name).toBeUndefined();
    });

    it("should not remap when fieldMappings is not configured", async () => {
      const items = [{ committee_id: "C00123" }];

      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: items }),
      );

      await handler.execute(createSource(), "federal");

      const rawResult = mapper.map.mock.calls[0][0];
      expect(rawResult.items[0].committee_id).toBe("C00123");
    });

    it("should skip remapping for keys not present in the record", async () => {
      const items = [{ name: "Test" }];

      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: items }),
      );

      const source = createSource({
        api: {
          resultsPath: "results",
          fieldMappings: { nonexistent_field: "mapped" },
        },
      });

      await handler.execute(source, "federal");

      const rawResult = mapper.map.mock.calls[0][0];
      expect(rawResult.items[0]).toEqual({ name: "Test" });
    });
  });

  describe("execute — cursor pagination with all last_indexes", () => {
    it("should send all cursor values from last_indexes on next page", async () => {
      const page1 = [{ id: "1" }];

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(
          mockFetchResponse({
            results: page1,
            pagination: {
              last_indexes: {
                last_index: "abc123",
                last_contribution_receipt_date: "2025-01-01",
                sort_null_only: "true",
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          mockFetchResponse({
            results: [],
          }),
        );

      const source = createSource({
        api: {
          resultsPath: "results",
          pagination: { type: "cursor", limit: 100 },
        },
      });

      await handler.execute(source, "federal");

      // Second fetch should include all cursor params
      const secondUrl = new URL((global.fetch as jest.Mock).mock.calls[1][0]);
      expect(secondUrl.searchParams.get("last_index")).toBe("abc123");
      expect(secondUrl.searchParams.get("last_contribution_receipt_date")).toBe(
        "2025-01-01",
      );
      expect(secondUrl.searchParams.get("sort_null_only")).toBe("true");
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

  describe("envelope-free responses (#1162)", () => {
    // Legistar's Web API returns a bare array with no wrapper object. The
    // dot-path walker returned [] for these, so the source silently yielded
    // nothing.
    const EVENTS = [
      { EventId: 1598, EventBodyName: "Board of Supervisors" },
      { EventId: 1599, EventBodyName: "Board of Supervisors" },
    ];

    it("treats a top-level array as the item list", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse(EVENTS as never),
      );

      const result = await handler.execute(
        createSource({ api: { resultsPath: "$" } }),
        "california-sonoma",
      );

      expect(result.items).toHaveLength(2);
    });

    it("accepts a bare array even when resultsPath is left at its default", async () => {
      // A config author who omits resultsPath for an envelope-free API should
      // get their data, not a silent zero.
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse(EVENTS as never),
      );

      const result = await handler.execute(
        createSource({ api: {} }),
        "california-sonoma",
      );

      expect(result.items).toHaveLength(2);
    });

    it("still reads the envelope when the body is an object", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse({ results: [{ id: 1 }] }),
      );

      const result = await handler.execute(createSource(), "california");

      expect(result.items).toHaveLength(1);
    });
  });

  describe("composite fields (#1162)", () => {
    it("builds a field from two response fields, after renaming", async () => {
      // Legistar splits a meeting across EventDate + EventTime; a flat rename
      // cannot recombine them.
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse([
          {
            EventId: 1598,
            EventDate: "2026-09-03T00:00:00",
            EventTime: "2:45 PM",
          },
        ] as never),
      );

      const result = await handler.execute(
        createSource({
          api: {
            resultsPath: "$",
            fieldMappings: { EventId: "externalId" },
            compositeFields: { scheduledAt: "{EventDate:date} {EventTime}" },
          },
        }),
        "california-sonoma",
      );

      const item = result.items[0] as Record<string, unknown>;
      expect(item.scheduledAt).toBe("2026-09-03 2:45 PM");
    });

    it("resolves templates against POST-rename field names", async () => {
      // Ordering is load-bearing: the real Sonoma config builds
      // title from {body}, which only exists after EventBodyName is renamed.
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse([
          {
            EventBodyName: "Board of Supervisors",
            EventDate: "2026-09-03T00:00:00",
          },
        ] as never),
      );

      const result = await handler.execute(
        createSource({
          api: {
            resultsPath: "$",
            fieldMappings: { EventBodyName: "body" },
            compositeFields: { title: "{body} — {EventDate:date}" },
          },
        }),
        "california-sonoma",
      );

      expect((result.items[0] as Record<string, unknown>).title).toBe(
        "Board of Supervisors — 2026-09-03",
      );
    });

    it("reads a naive timestamp in the configured zone, not the server's", async () => {
      // Containers run UTC. Without the zone, "2:45 PM" becomes 14:45Z and
      // every Sonoma meeting displays 7 hours early.
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse([
          { EventDate: "2026-09-03T00:00:00", EventTime: "2:45 PM" },
        ] as never),
      );

      const result = await handler.execute(
        createSource({
          api: {
            resultsPath: "$",
            compositeFields: {
              scheduledAt: {
                template: "{EventDate:date} {EventTime}",
                timezone: "America/Los_Angeles",
              },
            },
          },
        }),
        "california-sonoma",
      );

      // 2:45 PM PDT === 21:45 UTC, whatever zone this test runs in.
      expect((result.items[0] as Record<string, unknown>).scheduledAt).toBe(
        "2026-09-03T21:45:00.000Z",
      );
    });

    it("deletes a stale value when the composite fails", async () => {
      // A fallback rename under the same key must not survive a failed
      // composite — that would smuggle through the half-built value the
      // all-or-nothing rule exists to reject.
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse([
          { EventDate: "2026-09-03T00:00:00", Fallback: "stale-value" },
        ] as never),
      );

      const result = await handler.execute(
        createSource({
          api: {
            resultsPath: "$",
            fieldMappings: { Fallback: "scheduledAt" },
            compositeFields: { scheduledAt: "{EventDate:date} {EventTime}" },
          },
        }),
        "california-sonoma",
      );

      expect(result.items[0]).not.toHaveProperty("scheduledAt");
      expect(
        result.warnings.some((w) =>
          w.includes('Composite field "scheduledAt"'),
        ),
      ).toBe(true);
    });

    it("omits the field when a referenced field is missing", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockFetchResponse([
          { EventId: 1599, EventDate: "2026-09-03T00:00:00" },
        ] as never),
      );

      const result = await handler.execute(
        createSource({
          api: {
            resultsPath: "$",
            compositeFields: { scheduledAt: "{EventDate:date} {EventTime}" },
          },
        }),
        "california-sonoma",
      );

      // Half a timestamp is worse than none — downstream Zod reports a clean
      // required-field miss instead of accepting "2026-09-03 ".
      expect(result.items[0]).not.toHaveProperty("scheduledAt");
    });
  });

  describe("configurable page cap (#1162)", () => {
    it("honours pagination.maxPages and warns when it truncates", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockFetchResponse({ results: [{ id: 1 }, { id: 2 }] }),
      );

      const result = await handler.execute(
        createSource({
          api: {
            resultsPath: "results",
            pagination: {
              type: "offset",
              pageParam: "$skip",
              limitParam: "$top",
              limit: 2,
              maxPages: 3,
            },
          },
        }),
        "california-sonoma",
      );

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.items).toHaveLength(6);
      expect(
        result.warnings.some((w) => w.includes("max page limit (3)")),
      ).toBe(true);
    });

    it("maps OData $skip/$top onto offset pagination", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockFetchResponse({ results: [{ id: 1 }] }))
        .mockResolvedValueOnce(mockFetchResponse({ results: [] }));

      await handler.execute(
        createSource({
          api: {
            resultsPath: "results",
            pagination: {
              type: "offset",
              pageParam: "$skip",
              limitParam: "$top",
              limit: 100,
            },
          },
        }),
        "california-sonoma",
      );

      const firstUrl = String((global.fetch as jest.Mock).mock.calls[0][0]);
      expect(firstUrl).toContain("%24top=100");
      expect(firstUrl).toContain("%24skip=0");
    });
  });
});
