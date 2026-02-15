import "reflect-metadata";
import { RegionService } from "../src/region.service";
import { IRegionProvider, DataType } from "@opuspopuli/common";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Inject: () => () => {},
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe("RegionService", () => {
  let service: RegionService;
  let mockProvider: jest.Mocked<IRegionProvider>;

  const mockRegionInfo = {
    id: "test-region",
    name: "Test Region",
    description: "A test region",
    timezone: "America/New_York",
    dataSourceUrls: ["https://example.com"],
  };

  const mockPropositions = [
    {
      externalId: "prop-1",
      title: "Test Proposition 1",
      summary: "Summary 1",
      fullText: "Full text 1",
      status: "pending" as const,
      electionDate: new Date("2024-11-05"),
      sourceUrl: "https://example.com/prop-1",
    },
    {
      externalId: "prop-2",
      title: "Test Proposition 2",
      summary: "Summary 2",
      status: "passed" as const,
    },
  ];

  const mockMeetings = [
    {
      externalId: "meeting-1",
      title: "City Council Meeting",
      body: "City Council",
      scheduledAt: new Date("2024-01-15T10:00:00Z"),
      location: "City Hall",
      agendaUrl: "https://example.com/agenda",
      videoUrl: "https://example.com/video",
    },
  ];

  const mockRepresentatives = [
    {
      externalId: "rep-1",
      name: "John Doe",
      chamber: "Senate",
      district: "District 1",
      party: "Independent",
      photoUrl: "https://example.com/photo.jpg",
      contactInfo: {
        email: "john@example.com",
        phone: "555-1234",
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    mockProvider = {
      getName: jest.fn().mockReturnValue("test-provider"),
      getRegionInfo: jest.fn().mockReturnValue(mockRegionInfo),
      getSupportedDataTypes: jest
        .fn()
        .mockReturnValue([
          DataType.PROPOSITIONS,
          DataType.MEETINGS,
          DataType.REPRESENTATIVES,
        ]),
      fetchPropositions: jest.fn().mockResolvedValue(mockPropositions),
      fetchMeetings: jest.fn().mockResolvedValue(mockMeetings),
      fetchRepresentatives: jest.fn().mockResolvedValue(mockRepresentatives),
    };

    service = new RegionService(mockProvider);
  });

  describe("getProviderName", () => {
    it("should return the provider name", () => {
      expect(service.getProviderName()).toBe("test-provider");
      expect(mockProvider.getName).toHaveBeenCalled();
    });
  });

  describe("getRegionInfo", () => {
    it("should return region info from provider", () => {
      const info = service.getRegionInfo();

      expect(info).toEqual(mockRegionInfo);
      expect(mockProvider.getRegionInfo).toHaveBeenCalled();
    });
  });

  describe("getSupportedDataTypes", () => {
    it("should return supported data types from provider", () => {
      const types = service.getSupportedDataTypes();

      expect(types).toEqual([
        DataType.PROPOSITIONS,
        DataType.MEETINGS,
        DataType.REPRESENTATIVES,
      ]);
      expect(mockProvider.getSupportedDataTypes).toHaveBeenCalled();
    });
  });

  describe("fetchPropositions", () => {
    it("should fetch propositions from provider", async () => {
      const propositions = await service.fetchPropositions();

      expect(propositions).toEqual(mockPropositions);
      expect(mockProvider.fetchPropositions).toHaveBeenCalled();
    });

    it("should throw error when fetch fails", async () => {
      mockProvider.fetchPropositions.mockRejectedValue(
        new Error("Fetch failed"),
      );

      await expect(service.fetchPropositions()).rejects.toThrow("Fetch failed");
    });
  });

  describe("fetchMeetings", () => {
    it("should fetch meetings from provider", async () => {
      const meetings = await service.fetchMeetings();

      expect(meetings).toEqual(mockMeetings);
      expect(mockProvider.fetchMeetings).toHaveBeenCalled();
    });

    it("should throw error when fetch fails", async () => {
      mockProvider.fetchMeetings.mockRejectedValue(new Error("Fetch failed"));

      await expect(service.fetchMeetings()).rejects.toThrow("Fetch failed");
    });
  });

  describe("fetchRepresentatives", () => {
    it("should fetch representatives from provider", async () => {
      const reps = await service.fetchRepresentatives();

      expect(reps).toEqual(mockRepresentatives);
      expect(mockProvider.fetchRepresentatives).toHaveBeenCalled();
    });

    it("should throw error when fetch fails", async () => {
      mockProvider.fetchRepresentatives.mockRejectedValue(
        new Error("Fetch failed"),
      );

      await expect(service.fetchRepresentatives()).rejects.toThrow(
        "Fetch failed",
      );
    });
  });

  describe("syncDataType", () => {
    it("should sync propositions", async () => {
      const result = await service.syncDataType(DataType.PROPOSITIONS);

      expect(result.dataType).toBe(DataType.PROPOSITIONS);
      expect(result.itemsProcessed).toBe(mockPropositions.length);
      expect(result.errors).toEqual([]);
      expect(result.syncedAt).toBeInstanceOf(Date);
      expect(mockProvider.fetchPropositions).toHaveBeenCalled();
    });

    it("should sync meetings", async () => {
      const result = await service.syncDataType(DataType.MEETINGS);

      expect(result.dataType).toBe(DataType.MEETINGS);
      expect(result.itemsProcessed).toBe(mockMeetings.length);
      expect(mockProvider.fetchMeetings).toHaveBeenCalled();
    });

    it("should sync representatives", async () => {
      const result = await service.syncDataType(DataType.REPRESENTATIVES);

      expect(result.dataType).toBe(DataType.REPRESENTATIVES);
      expect(result.itemsProcessed).toBe(mockRepresentatives.length);
      expect(mockProvider.fetchRepresentatives).toHaveBeenCalled();
    });
  });

  describe("syncAll", () => {
    it("should sync all supported data types", async () => {
      const results = await service.syncAll();

      expect(results).toHaveLength(3);
      expect(results[0].dataType).toBe(DataType.PROPOSITIONS);
      expect(results[1].dataType).toBe(DataType.MEETINGS);
      expect(results[2].dataType).toBe(DataType.REPRESENTATIVES);
      expect(mockProvider.fetchPropositions).toHaveBeenCalled();
      expect(mockProvider.fetchMeetings).toHaveBeenCalled();
      expect(mockProvider.fetchRepresentatives).toHaveBeenCalled();
    });

    it("should capture errors for failed data types without stopping", async () => {
      mockProvider.fetchMeetings.mockRejectedValue(
        new Error("Meetings unavailable"),
      );

      const results = await service.syncAll();

      expect(results).toHaveLength(3);
      // Propositions succeeded
      expect(results[0].dataType).toBe(DataType.PROPOSITIONS);
      expect(results[0].itemsProcessed).toBe(mockPropositions.length);
      expect(results[0].errors).toEqual([]);
      // Meetings failed
      expect(results[1].dataType).toBe(DataType.MEETINGS);
      expect(results[1].itemsProcessed).toBe(0);
      expect(results[1].errors).toEqual(["Meetings unavailable"]);
      // Representatives succeeded
      expect(results[2].dataType).toBe(DataType.REPRESENTATIVES);
      expect(results[2].itemsProcessed).toBe(mockRepresentatives.length);
    });
  });

  describe("getServiceInfo", () => {
    it("should return service information", () => {
      const info = service.getServiceInfo();

      expect(info.provider).toBe("test-provider");
      expect(info.region).toBe("Test Region");
      expect(info.timezone).toBe("America/New_York");
      expect(info.supportedDataTypes).toEqual([
        DataType.PROPOSITIONS,
        DataType.MEETINGS,
        DataType.REPRESENTATIVES,
      ]);
    });
  });
});
