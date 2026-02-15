import "reflect-metadata";
import { ExampleRegionProvider } from "../src/providers/example.provider";
import { DataType } from "@opuspopuli/common";

// Mock NestJS Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe("ExampleRegionProvider", () => {
  let provider: ExampleRegionProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new ExampleRegionProvider();
  });

  describe("getName", () => {
    it('should return "example"', () => {
      expect(provider.getName()).toBe("example");
    });
  });

  describe("getRegionInfo", () => {
    it("should return region info with all required fields", () => {
      const info = provider.getRegionInfo();

      expect(info.id).toBe("example");
      expect(info.name).toBe("Example Region");
      expect(info.description).toBeDefined();
      expect(info.timezone).toBe("America/Los_Angeles");
      expect(info.dataSourceUrls).toBeDefined();
      expect(Array.isArray(info.dataSourceUrls)).toBe(true);
    });
  });

  describe("getSupportedDataTypes", () => {
    it("should return all civic data types", () => {
      const types = provider.getSupportedDataTypes();

      expect(types).toContain(DataType.PROPOSITIONS);
      expect(types).toContain(DataType.MEETINGS);
      expect(types).toContain(DataType.REPRESENTATIVES);
      expect(types).toHaveLength(3);
    });
  });

  describe("fetchPropositions", () => {
    it("should return an array of propositions", async () => {
      const propositions = await provider.fetchPropositions();

      expect(Array.isArray(propositions)).toBe(true);
      expect(propositions.length).toBeGreaterThan(0);
    });

    it("should return propositions with required fields", async () => {
      const propositions = await provider.fetchPropositions();
      const prop = propositions[0];

      expect(prop.externalId).toBeDefined();
      expect(prop.title).toBeDefined();
      expect(prop.summary).toBeDefined();
      expect(prop.status).toBeDefined();
    });

    it("should return propositions with valid status", async () => {
      const propositions = await provider.fetchPropositions();

      propositions.forEach((prop) => {
        expect(["pending", "passed", "failed", "withdrawn"]).toContain(
          prop.status,
        );
      });
    });
  });

  describe("fetchMeetings", () => {
    it("should return an array of meetings", async () => {
      const meetings = await provider.fetchMeetings();

      expect(Array.isArray(meetings)).toBe(true);
      expect(meetings.length).toBeGreaterThan(0);
    });

    it("should return meetings with required fields", async () => {
      const meetings = await provider.fetchMeetings();
      const meeting = meetings[0];

      expect(meeting.externalId).toBeDefined();
      expect(meeting.title).toBeDefined();
      expect(meeting.body).toBeDefined();
      expect(meeting.scheduledAt).toBeDefined();
    });

    it("should return meetings with valid date", async () => {
      const meetings = await provider.fetchMeetings();

      meetings.forEach((meeting) => {
        expect(meeting.scheduledAt instanceof Date).toBe(true);
        expect(isNaN(meeting.scheduledAt.getTime())).toBe(false);
      });
    });
  });

  describe("fetchRepresentatives", () => {
    it("should return an array of representatives", async () => {
      const reps = await provider.fetchRepresentatives();

      expect(Array.isArray(reps)).toBe(true);
      expect(reps.length).toBeGreaterThan(0);
    });

    it("should return representatives with required fields", async () => {
      const reps = await provider.fetchRepresentatives();
      const rep = reps[0];

      expect(rep.externalId).toBeDefined();
      expect(rep.name).toBeDefined();
      expect(rep.chamber).toBeDefined();
      expect(rep.district).toBeDefined();
      expect(rep.party).toBeDefined();
    });

    it("should return representatives with contact info", async () => {
      const reps = await provider.fetchRepresentatives();
      const repWithContact = reps.find((r) => r.contactInfo);

      expect(repWithContact).toBeDefined();
      if (repWithContact?.contactInfo) {
        expect(
          repWithContact.contactInfo.email ||
            repWithContact.contactInfo.phone ||
            repWithContact.contactInfo.address,
        ).toBeDefined();
      }
    });
  });
});
