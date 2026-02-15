import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverRegionConfigs } from "../src/loader/region-config-discovery";

describe("discoverRegionConfigs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "region-configs-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const validConfig = {
    name: "test-region",
    displayName: "Test Region",
    description: "A test region",
    version: "1.0.0",
    config: {
      regionId: "test-region",
      regionName: "Test Region",
      description: "A test region",
      timezone: "UTC",
      dataSources: [
        {
          url: "https://example.com/data",
          dataType: "propositions",
          contentGoal: "Extract test data",
        },
      ],
    },
  };

  it("discovers valid JSON files from a directory", async () => {
    await writeFile(
      join(tempDir, "test-region.json"),
      JSON.stringify(validConfig),
    );

    const configs = await discoverRegionConfigs(tempDir);

    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe("test-region");
    expect(configs[0].displayName).toBe("Test Region");
    expect(configs[0].version).toBe("1.0.0");
    expect(configs[0].config.regionId).toBe("test-region");
    expect(configs[0].config.dataSources).toHaveLength(1);
  });

  it("discovers multiple JSON files", async () => {
    await writeFile(
      join(tempDir, "region-a.json"),
      JSON.stringify({ ...validConfig, name: "region-a" }),
    );
    await writeFile(
      join(tempDir, "region-b.json"),
      JSON.stringify({ ...validConfig, name: "region-b" }),
    );

    const configs = await discoverRegionConfigs(tempDir);

    expect(configs).toHaveLength(2);
    const names = configs.map((c) => c.name).sort();
    expect(names).toEqual(["region-a", "region-b"]);
  });

  it("returns empty array for nonexistent directory", async () => {
    const configs = await discoverRegionConfigs("/nonexistent/path");
    expect(configs).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const configs = await discoverRegionConfigs(tempDir);
    expect(configs).toEqual([]);
  });

  it("ignores non-JSON files", async () => {
    await writeFile(join(tempDir, "readme.txt"), "not json");
    await writeFile(join(tempDir, "config.yaml"), "yaml: true");
    await writeFile(join(tempDir, "valid.json"), JSON.stringify(validConfig));

    const configs = await discoverRegionConfigs(tempDir);
    expect(configs).toHaveLength(1);
  });

  it("throws on invalid JSON", async () => {
    await writeFile(join(tempDir, "bad.json"), "{ not valid json }}}");

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      "Invalid JSON in region config file: bad.json",
    );
  });

  it("throws when name is missing", async () => {
    const { name: _, ...noName } = validConfig;
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(noName));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'missing required field "name"',
    );
  });

  it("throws when displayName is missing", async () => {
    const { displayName: _, ...noDisplay } = validConfig;
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(noDisplay));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'missing required field "displayName"',
    );
  });

  it("throws when version is missing", async () => {
    const { version: _, ...noVersion } = validConfig;
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(noVersion));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'missing required field "version"',
    );
  });

  it("throws when description is missing", async () => {
    const { description: _, ...noDesc } = validConfig;
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(noDesc));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'missing required field "description"',
    );
  });

  it("throws when config is missing", async () => {
    const { config: _, ...noConfig } = validConfig;
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(noConfig));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'missing required field "config"',
    );
  });

  it("throws when config.regionId is missing", async () => {
    const bad = {
      ...validConfig,
      config: { ...validConfig.config, regionId: undefined },
    };
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(bad));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'missing required field "config.regionId"',
    );
  });

  it("throws when config.dataSources is empty", async () => {
    const bad = {
      ...validConfig,
      config: { ...validConfig.config, dataSources: [] },
    };
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(bad));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'must have at least one entry in "config.dataSources"',
    );
  });

  it("throws when a data source is missing url", async () => {
    const bad = {
      ...validConfig,
      config: {
        ...validConfig.config,
        dataSources: [{ dataType: "propositions", contentGoal: "Extract" }],
      },
    };
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(bad));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'dataSources[0] is missing required field "url"',
    );
  });

  it("throws when a data source is missing dataType", async () => {
    const bad = {
      ...validConfig,
      config: {
        ...validConfig.config,
        dataSources: [{ url: "https://example.com", contentGoal: "Extract" }],
      },
    };
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(bad));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'dataSources[0] is missing required field "dataType"',
    );
  });

  it("throws when a data source is missing contentGoal", async () => {
    const bad = {
      ...validConfig,
      config: {
        ...validConfig.config,
        dataSources: [{ url: "https://example.com", dataType: "propositions" }],
      },
    };
    await writeFile(join(tempDir, "bad.json"), JSON.stringify(bad));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      'dataSources[0] is missing required field "contentGoal"',
    );
  });

  it("preserves optional fields in config", async () => {
    const configWithOptionals = {
      ...validConfig,
      config: {
        ...validConfig.config,
        rateLimit: { requestsPerSecond: 2, burstSize: 5 },
        cacheTtlMs: 60000,
        requestTimeoutMs: 15000,
        dataSources: [
          {
            url: "https://example.com",
            dataType: "propositions",
            contentGoal: "Extract data",
            category: "Government",
            hints: ["Look for tables", "Check headers"],
          },
        ],
      },
    };
    await writeFile(
      join(tempDir, "full.json"),
      JSON.stringify(configWithOptionals),
    );

    const configs = await discoverRegionConfigs(tempDir);

    expect(configs[0].config.rateLimit).toEqual({
      requestsPerSecond: 2,
      burstSize: 5,
    });
    expect(configs[0].config.cacheTtlMs).toBe(60000);
    expect(configs[0].config.dataSources[0].category).toBe("Government");
    expect(configs[0].config.dataSources[0].hints).toEqual([
      "Look for tables",
      "Check headers",
    ]);
  });

  it("throws when root value is not an object", async () => {
    await writeFile(join(tempDir, "bad.json"), JSON.stringify([1, 2, 3]));

    await expect(discoverRegionConfigs(tempDir)).rejects.toThrow(
      "must be a JSON object",
    );
  });
});
