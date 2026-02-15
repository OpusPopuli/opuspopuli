import "reflect-metadata";
import {
  DataType,
  RegionInfo,
  Proposition,
  Meeting,
  Representative,
  PropositionStatus,
} from "@opuspopuli/common";
import { BaseRegionPlugin } from "../src/base/base-plugin";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

// Concrete implementation for testing
class TestPlugin extends BaseRegionPlugin {
  constructor() {
    super("test");
  }

  getName(): string {
    return "test";
  }

  getVersion(): string {
    return "1.0.0";
  }

  getRegionInfo(): RegionInfo {
    return {
      id: "test",
      name: "Test Region",
      description: "A test region",
      timezone: "America/New_York",
    };
  }

  getSupportedDataTypes(): DataType[] {
    return [DataType.PROPOSITIONS];
  }

  async fetchPropositions(): Promise<Proposition[]> {
    return [
      {
        externalId: "test-prop-1",
        title: "Test Proposition",
        summary: "Test summary",
        status: PropositionStatus.PENDING,
      },
    ];
  }

  async fetchMeetings(): Promise<Meeting[]> {
    return [];
  }

  async fetchRepresentatives(): Promise<Representative[]> {
    return [];
  }
}

describe("BaseRegionPlugin", () => {
  let plugin: TestPlugin;

  beforeEach(() => {
    jest.clearAllMocks();
    plugin = new TestPlugin();
  });

  describe("lifecycle", () => {
    it("should not be initialized before initialize() is called", async () => {
      const health = await plugin.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toBe("Plugin not initialized");
    });

    it("should be initialized after initialize() is called", async () => {
      await plugin.initialize();

      const health = await plugin.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.message).toBe("Plugin operational");
      expect(health.lastCheck).toBeInstanceOf(Date);
    });

    it("should accept config during initialization", async () => {
      const config = { apiKey: "test-key", baseUrl: "https://api.test.com" };
      await plugin.initialize(config);

      const health = await plugin.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it("should not be initialized after destroy() is called", async () => {
      await plugin.initialize();
      await plugin.destroy();

      const health = await plugin.healthCheck();
      expect(health.healthy).toBe(false);
    });
  });

  describe("abstract methods", () => {
    it("should return the plugin name", () => {
      expect(plugin.getName()).toBe("test");
    });

    it("should return the plugin version", () => {
      expect(plugin.getVersion()).toBe("1.0.0");
    });

    it("should return region info", () => {
      const info = plugin.getRegionInfo();
      expect(info.id).toBe("test");
      expect(info.name).toBe("Test Region");
    });

    it("should return supported data types", () => {
      const types = plugin.getSupportedDataTypes();
      expect(types).toContain(DataType.PROPOSITIONS);
    });

    it("should fetch propositions", async () => {
      const props = await plugin.fetchPropositions();
      expect(props).toHaveLength(1);
      expect(props[0].externalId).toBe("test-prop-1");
    });

    it("should fetch meetings", async () => {
      const meetings = await plugin.fetchMeetings();
      expect(meetings).toEqual([]);
    });

    it("should fetch representatives", async () => {
      const reps = await plugin.fetchRepresentatives();
      expect(reps).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("should allow re-initialization with new config", async () => {
      await plugin.initialize({ key: "first" });
      let health = await plugin.healthCheck();
      expect(health.healthy).toBe(true);

      await plugin.initialize({ key: "second" });
      health = await plugin.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it("should allow destroy without prior initialization", async () => {
      await plugin.destroy();

      const health = await plugin.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toBe("Plugin not initialized");
    });

    it("should store config when initialized with config", async () => {
      const config = { apiKey: "test-key", baseUrl: "https://api.test.com" };
      await plugin.initialize(config);

      expect((plugin as any).config).toEqual(config);
    });

    it("should have undefined config when initialized without config", async () => {
      await plugin.initialize();

      expect((plugin as any).config).toBeUndefined();
    });

    it("should set pluginName from constructor", () => {
      expect((plugin as any).pluginName).toBe("test");
    });
  });
});
