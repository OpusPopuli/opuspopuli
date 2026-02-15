import { resolveConfigPlaceholders } from "../src/providers/config/config-placeholders";

describe("resolveConfigPlaceholders", () => {
  it("should resolve a placeholder in a flat object", () => {
    const config = { state: "${stateCode}", name: "Federal" };
    const result = resolveConfigPlaceholders(config, { stateCode: "CA" });

    expect(result.state).toBe("CA");
    expect(result.name).toBe("Federal");
  });

  it("should resolve placeholders in deeply nested objects", () => {
    const config = {
      dataSources: [
        {
          api: {
            queryParams: {
              contributor_state: "${stateCode}",
              sort: "-date",
            },
          },
        },
      ],
    };

    const result = resolveConfigPlaceholders(config, { stateCode: "TX" });

    expect(result.dataSources[0].api.queryParams.contributor_state).toBe("TX");
    expect(result.dataSources[0].api.queryParams.sort).toBe("-date");
  });

  it("should resolve placeholders in bulk download filters", () => {
    const config = {
      dataSources: [
        {
          bulk: {
            format: "zip_csv",
            filters: { STATE: "${stateCode}" },
          },
        },
      ],
    };

    const result = resolveConfigPlaceholders(config, { stateCode: "NY" });

    expect(result.dataSources[0].bulk.filters.STATE).toBe("NY");
  });

  it("should resolve placeholders in arrays of strings", () => {
    const config = { hints: ["Filter by ${stateCode}", "No placeholder"] };
    const result = resolveConfigPlaceholders(config, { stateCode: "CA" });

    expect(result.hints[0]).toBe("Filter by CA");
    expect(result.hints[1]).toBe("No placeholder");
  });

  it("should leave non-string values untouched", () => {
    const config = {
      count: 42,
      enabled: true,
      nothing: null,
      state: "${stateCode}",
    };
    const result = resolveConfigPlaceholders(config, { stateCode: "CA" });

    expect(result.count).toBe(42);
    expect(result.enabled).toBe(true);
    expect(result.nothing).toBeNull();
    expect(result.state).toBe("CA");
  });

  it("should resolve multiple different placeholders", () => {
    const config = {
      state: "${stateCode}",
      county: "${countyFips}",
      label: "${stateCode}-${countyFips}",
    };
    const result = resolveConfigPlaceholders(config, {
      stateCode: "CA",
      countyFips: "06037",
    });

    expect(result.state).toBe("CA");
    expect(result.county).toBe("06037");
    expect(result.label).toBe("CA-06037");
  });

  it("should leave unresolved placeholders as-is", () => {
    const config = { state: "${stateCode}", fips: "${unknownVar}" };
    const result = resolveConfigPlaceholders(config, { stateCode: "CA" });

    expect(result.state).toBe("CA");
    expect(result.fips).toBe("${unknownVar}");
  });

  it("should return a deep clone (original not mutated)", () => {
    const config = {
      nested: { state: "${stateCode}" },
      list: ["${stateCode}"],
    };
    const result = resolveConfigPlaceholders(config, { stateCode: "CA" });

    expect(result.nested.state).toBe("CA");
    expect(config.nested.state).toBe("${stateCode}");
    expect(result.list[0]).toBe("CA");
    expect(config.list[0]).toBe("${stateCode}");
  });

  it("should handle empty variables map (no-op, returns clone)", () => {
    const config = { state: "${stateCode}" };
    const result = resolveConfigPlaceholders(config, {});

    expect(result.state).toBe("${stateCode}");
    expect(result).not.toBe(config); // still a clone
  });

  it("should handle config with no placeholders", () => {
    const config = { name: "Federal", count: 3 };
    const result = resolveConfigPlaceholders(config, { stateCode: "CA" });

    expect(result).toEqual(config);
    expect(result).not.toBe(config);
  });

  it("should resolve a realistic federal.json config structure", () => {
    const federalConfig = {
      regionId: "federal",
      regionName: "Federal",
      dataSources: [
        {
          url: "https://api.open.fec.gov/v1/schedules/schedule_a/",
          dataType: "campaign_finance",
          sourceType: "api",
          api: {
            queryParams: {
              sort: "-contribution_receipt_date",
              is_individual: "true",
              contributor_state: "${stateCode}",
            },
          },
          hints: ["${stateCode} placeholder is resolved at runtime"],
        },
        {
          url: "https://www.fec.gov/files/bulk-downloads/2026/indiv26.zip",
          dataType: "campaign_finance",
          sourceType: "bulk_download",
          bulk: {
            format: "zip_csv",
            filePattern: "itcont.txt",
            delimiter: "|",
            filters: { STATE: "${stateCode}" },
            columnMappings: { CMTE_ID: "committeeId" },
          },
          hints: ["${stateCode} placeholder is resolved at runtime"],
        },
        {
          url: "https://api.open.fec.gov/v1/schedules/schedule_e/",
          dataType: "campaign_finance",
          sourceType: "api",
          api: {
            queryParams: { sort: "-expenditure_date" },
          },
        },
      ],
    };

    const result = resolveConfigPlaceholders(federalConfig, {
      stateCode: "CA",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ds = result.dataSources as any[];

    // API contributions: contributor_state resolved
    expect(ds[0].api.queryParams.contributor_state).toBe("CA");
    // API contributions: other params unchanged
    expect(ds[0].api.queryParams.sort).toBe("-contribution_receipt_date");
    // Hints resolved
    expect(ds[0].hints[0]).toBe("CA placeholder is resolved at runtime");

    // Bulk download: STATE filter resolved
    expect(ds[1].bulk.filters.STATE).toBe("CA");
    // Bulk download: other fields unchanged
    expect(ds[1].bulk.delimiter).toBe("|");
    expect(ds[1].bulk.columnMappings.CMTE_ID).toBe("committeeId");

    // Independent expenditures: no placeholders, unchanged
    expect(ds[2].api.queryParams.sort).toBe("-expenditure_date");

    // Original not mutated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origDs = federalConfig.dataSources as any[];
    expect(origDs[0].api.queryParams.contributor_state).toBe("${stateCode}");
    expect(origDs[1].bulk.filters.STATE).toBe("${stateCode}");
  });
});
