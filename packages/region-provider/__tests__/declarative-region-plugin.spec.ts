import "reflect-metadata";
import {
  DeclarativeRegionPlugin,
  type IPipelineService,
} from "../src/declarative/declarative-region-plugin";
import type {
  DeclarativeRegionConfig,
  ExtractionResult,
} from "@opuspopuli/common";
import { DataType } from "@opuspopuli/common";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Optional: () => () => {},
  Inject: () => () => {},
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

const createMockConfig = (
  overrides?: Partial<DeclarativeRegionConfig>,
): DeclarativeRegionConfig => ({
  regionId: "california",
  regionName: "California",
  description: "California civic data",
  timezone: "America/Los_Angeles",
  dataSources: [
    {
      url: "https://example.com/propositions",
      dataType: DataType.PROPOSITIONS,
      contentGoal: "Extract ballot measures",
    },
    {
      url: "https://example.com/assembly-meetings",
      dataType: DataType.MEETINGS,
      contentGoal: "Extract Assembly meetings",
      category: "Assembly",
    },
    {
      url: "https://example.com/senate-meetings",
      dataType: DataType.MEETINGS,
      contentGoal: "Extract Senate meetings",
      category: "Senate",
    },
    {
      url: "https://example.com/representatives",
      dataType: DataType.REPRESENTATIVES,
      contentGoal: "Extract representatives",
    },
  ],
  ...overrides,
});

const createCampaignFinanceConfig = (): DeclarativeRegionConfig =>
  createMockConfig({
    dataSources: [
      {
        url: "https://api.fec.gov/contributions",
        dataType: DataType.CAMPAIGN_FINANCE,
        contentGoal: "Extract contributions",
        category: "fec-contributions",
        sourceType: "api",
      },
      {
        url: "https://api.fec.gov/expenditures",
        dataType: DataType.CAMPAIGN_FINANCE,
        contentGoal: "Extract expenditures",
        category: "fec-expenditures",
        sourceType: "api",
      },
      {
        url: "https://example.com/propositions",
        dataType: DataType.PROPOSITIONS,
        contentGoal: "Extract ballot measures",
      },
    ],
  });

const createMockPipeline = (): jest.Mocked<IPipelineService> => ({
  execute: jest.fn(),
});

const createExtractionResult = <T>(items: T[]): ExtractionResult<T> => ({
  items,
  manifestVersion: 1,
  success: true,
  warnings: [],
  errors: [],
  extractionTimeMs: 100,
});

describe("DeclarativeRegionPlugin", () => {
  let config: DeclarativeRegionConfig;
  let pipeline: jest.Mocked<IPipelineService>;
  let plugin: DeclarativeRegionPlugin;

  beforeEach(() => {
    config = createMockConfig();
    pipeline = createMockPipeline();
    plugin = new DeclarativeRegionPlugin(config, pipeline);
  });

  describe("metadata methods", () => {
    it("should return the region ID as the name", () => {
      expect(plugin.getName()).toBe("california");
    });

    it("should return declarative version string", () => {
      expect(plugin.getVersion()).toBe("1.0.0-declarative");
    });

    it("should return region info from config", () => {
      const info = plugin.getRegionInfo();

      expect(info).toEqual({
        id: "california",
        name: "California",
        description: "California civic data",
        timezone: "America/Los_Angeles",
        dataSourceUrls: [
          "https://example.com/propositions",
          "https://example.com/assembly-meetings",
          "https://example.com/senate-meetings",
          "https://example.com/representatives",
        ],
      });
    });

    it("should return unique supported data types", () => {
      const types = plugin.getSupportedDataTypes();

      expect(types).toHaveLength(3);
      expect(types).toContain(DataType.PROPOSITIONS);
      expect(types).toContain(DataType.MEETINGS);
      expect(types).toContain(DataType.REPRESENTATIVES);
    });
  });

  describe("fetchPropositions", () => {
    it("should call pipeline.execute for proposition sources", async () => {
      const mockProps = [
        { externalId: "P-1", title: "Prop 1", summary: "S", status: "pending" },
      ];
      pipeline.execute.mockResolvedValue(createExtractionResult(mockProps));

      const result = await plugin.fetchPropositions();

      expect(pipeline.execute).toHaveBeenCalledTimes(1);
      expect(pipeline.execute).toHaveBeenCalledWith(
        config.dataSources[0],
        "california",
      );
      expect(result).toEqual(mockProps);
    });

    it("should return empty array when no proposition sources configured", async () => {
      const noPropsConfig = createMockConfig({
        dataSources: [
          {
            url: "https://example.com/meetings",
            dataType: DataType.MEETINGS,
            contentGoal: "meetings",
          },
        ],
      });
      plugin = new DeclarativeRegionPlugin(noPropsConfig, pipeline);

      const result = await plugin.fetchPropositions();

      expect(result).toEqual([]);
      expect(pipeline.execute).not.toHaveBeenCalled();
    });
  });

  describe("fetchMeetings", () => {
    it("should call pipeline.execute for all meeting sources and concatenate results", async () => {
      const assemblyMeetings = [
        { externalId: "M-1", title: "Assembly Meeting" },
      ];
      const senateMeetings = [{ externalId: "M-2", title: "Senate Meeting" }];

      pipeline.execute
        .mockResolvedValueOnce(createExtractionResult(assemblyMeetings))
        .mockResolvedValueOnce(createExtractionResult(senateMeetings));

      const result = await plugin.fetchMeetings();

      expect(pipeline.execute).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(assemblyMeetings[0]);
      expect(result[1]).toEqual(senateMeetings[0]);
    });
  });

  describe("fetchRepresentatives", () => {
    it("should call pipeline.execute for representative sources", async () => {
      const reps = [
        {
          externalId: "R-1",
          name: "Jane Doe",
          chamber: "Assembly",
          district: "42",
        },
      ];
      pipeline.execute.mockResolvedValue(createExtractionResult(reps));

      const result = await plugin.fetchRepresentatives();

      expect(pipeline.execute).toHaveBeenCalledTimes(1);
      expect(result).toEqual(reps);
    });
  });

  describe("error handling", () => {
    it("should continue fetching remaining sources when one fails", async () => {
      const senateMeetings = [{ externalId: "M-2", title: "Senate Meeting" }];

      pipeline.execute
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce(createExtractionResult(senateMeetings));

      const result = await plugin.fetchMeetings();

      expect(pipeline.execute).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(senateMeetings[0]);
    });

    it("should return empty array when all sources fail", async () => {
      pipeline.execute.mockRejectedValue(new Error("Network error"));

      const result = await plugin.fetchPropositions();

      expect(result).toEqual([]);
    });
  });

  describe("healthCheck", () => {
    it("should report unhealthy before initialization", async () => {
      const health = await plugin.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.message).toContain("not initialized");
    });

    it("should report healthy after initialization", async () => {
      await plugin.initialize();

      const health = await plugin.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.message).toContain("operational");
      expect(health.metadata).toEqual({
        regionId: "california",
        dataSourceCount: 4,
        supportedTypes: expect.arrayContaining([
          DataType.PROPOSITIONS,
          DataType.MEETINGS,
          DataType.REPRESENTATIVES,
        ]),
      });
    });
  });

  describe("fetchCampaignFinance", () => {
    let cfPlugin: DeclarativeRegionPlugin;
    let cfPipeline: jest.Mocked<IPipelineService>;

    beforeEach(() => {
      cfPipeline = createMockPipeline();
      cfPlugin = new DeclarativeRegionPlugin(
        createCampaignFinanceConfig(),
        cfPipeline,
      );
    });

    it("should separate mixed items into committees, contributions, expenditures, and independentExpenditures", async () => {
      const mixedItems = [
        { donorName: "Jane Smith", amount: 500, committeeId: "C001" },
        { payeeName: "Ad Agency", amount: 1000, committeeId: "C001" },
        {
          supportOrOppose: "S",
          committeeName: "PAC-1",
          amount: 5000,
          committeeId: "C002",
        },
        {
          sourceSystem: "fec",
          type: "pac",
          externalId: "COM-1",
          name: "Citizens PAC",
        },
      ];

      cfPipeline.execute
        .mockResolvedValueOnce(createExtractionResult(mixedItems.slice(0, 2)))
        .mockResolvedValueOnce(createExtractionResult(mixedItems.slice(2)));

      const result = await cfPlugin.fetchCampaignFinance();

      expect(result.contributions).toHaveLength(1);
      expect(result.contributions[0]).toMatchObject({
        donorName: "Jane Smith",
        amount: 500,
      });
      expect(result.expenditures).toHaveLength(1);
      expect(result.expenditures[0]).toMatchObject({
        payeeName: "Ad Agency",
      });
      expect(result.independentExpenditures).toHaveLength(1);
      expect(result.independentExpenditures[0]).toMatchObject({
        supportOrOppose: "S",
        committeeName: "PAC-1",
      });
      expect(result.committees).toHaveLength(1);
      expect(result.committees[0]).toMatchObject({
        sourceSystem: "fec",
        type: "pac",
      });
    });

    it("should return empty arrays when pipeline returns no items", async () => {
      cfPipeline.execute.mockResolvedValue(createExtractionResult([]));

      const result = await cfPlugin.fetchCampaignFinance();

      expect(result.committees).toEqual([]);
      expect(result.contributions).toEqual([]);
      expect(result.expenditures).toEqual([]);
      expect(result.independentExpenditures).toEqual([]);
    });

    it("should return empty result when no campaign finance sources configured", async () => {
      // Use the original config which has no campaign_finance sources
      const result = await plugin.fetchCampaignFinance();

      expect(result.committees).toEqual([]);
      expect(result.contributions).toEqual([]);
      expect(result.expenditures).toEqual([]);
      expect(result.independentExpenditures).toEqual([]);
      expect(pipeline.execute).not.toHaveBeenCalled();
    });
  });

  describe("fetchByDataType — multi-source", () => {
    it("should concatenate results from multiple sources of the same dataType", async () => {
      const meeting1 = [{ externalId: "M-1", title: "Assembly Meeting" }];
      const meeting2 = [{ externalId: "M-2", title: "Senate Meeting" }];

      pipeline.execute
        .mockResolvedValueOnce(createExtractionResult(meeting1))
        .mockResolvedValueOnce(createExtractionResult(meeting2));

      const result = await plugin.fetchMeetings();

      expect(result).toHaveLength(2);
      expect(pipeline.execute).toHaveBeenCalledTimes(2);
    });

    it("should continue on error from one source and still return items from others", async () => {
      pipeline.execute
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce(
          createExtractionResult([{ externalId: "M-2", title: "Senate" }]),
        );

      const result = await plugin.fetchMeetings();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ externalId: "M-2" });
    });

    it("should log warnings from pipeline results", async () => {
      pipeline.execute.mockResolvedValue({
        items: [{ externalId: "P-1", title: "Test" }],
        manifestVersion: 1,
        success: true,
        warnings: ["Partial data"],
        errors: [],
        extractionTimeMs: 100,
      });

      const result = await plugin.fetchPropositions();

      expect(result).toHaveLength(1);
    });

    it("should log errors from pipeline results", async () => {
      pipeline.execute.mockResolvedValue({
        items: [{ externalId: "P-1", title: "Test" }],
        manifestVersion: 1,
        success: true,
        warnings: [],
        errors: ["Non-fatal error"],
        extractionTimeMs: 100,
      });

      const result = await plugin.fetchPropositions();

      expect(result).toHaveLength(1);
    });
  });

  describe("getSupportedDataTypes", () => {
    it("should include campaign_finance when configured", () => {
      const cfPlugin = new DeclarativeRegionPlugin(
        createCampaignFinanceConfig(),
        createMockPipeline(),
      );

      const types = cfPlugin.getSupportedDataTypes();

      expect(types).toContain(DataType.CAMPAIGN_FINANCE);
      expect(types).toContain(DataType.PROPOSITIONS);
    });

    it("should deduplicate data types from multiple sources", () => {
      const cfPlugin = new DeclarativeRegionPlugin(
        createCampaignFinanceConfig(),
        createMockPipeline(),
      );

      const types = cfPlugin.getSupportedDataTypes();

      // campaign_finance appears in 2 sources, but should be deduplicated
      const campaignFinanceCount = types.filter(
        (t) => t === DataType.CAMPAIGN_FINANCE,
      ).length;
      expect(campaignFinanceCount).toBe(1);
    });
  });
});
