import { DomainMapperService } from "../src/mapping/domain-mapper.service";
import {
  DataType,
  type RawExtractionResult,
  type DataSourceConfig,
} from "@opuspopuli/common";

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://example.com",
    dataType: DataType.PROPOSITIONS,
    contentGoal: "Extract data",
    ...overrides,
  };
}

function createRawResult(
  overrides: Partial<RawExtractionResult> = {},
): RawExtractionResult {
  return {
    items: [],
    success: true,
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe("DomainMapperService", () => {
  let mapper: DomainMapperService;

  beforeEach(() => {
    mapper = new DomainMapperService();
  });

  describe("propositions", () => {
    it("should map valid proposition records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "PROP-36",
              title: "Criminal Law Reform",
              summary: "A measure to reform criminal sentencing",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "PROP-36",
        title: "Criminal Law Reform",
      });
    });

    it("should reject propositions missing required fields", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ summary: "No ID or title" }],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("should use title as summary when summary is empty", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "SB-42",
              title: "Education Budget",
              summary: "",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.items[0]).toMatchObject({
        summary: "Education Budget",
      });
    });

    it("should coerce electionDate strings to Date", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ACA-13",
              title: "Voting Thresholds",
              electionDate: "2026-11-03",
            },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.items[0]).toHaveProperty("electionDate");
    });
  });

  describe("meetings", () => {
    it("should map valid meeting records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "MTG-001",
              title: "Budget Committee Hearing",
              scheduledAt: "2026-03-15T10:00:00Z",
              location: "Room 4202",
            },
          ],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        externalId: "MTG-001",
        title: "Budget Committee Hearing",
        location: "Room 4202",
      });
    });

    it("should inject category as body when not in record", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "MTG-002",
              title: "Floor Session",
              scheduledAt: "2026-03-15T10:00:00Z",
            },
          ],
        }),
        createSource({
          dataType: DataType.MEETINGS,
          category: "Assembly",
        }),
      );

      expect(result.items[0]).toMatchObject({ body: "Assembly" });
    });

    it("should reject meetings missing scheduledAt", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "MTG-003", title: "No Date" }],
        }),
        createSource({ dataType: DataType.MEETINGS }),
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe("representatives", () => {
    it("should map valid representative records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ca-assembly-30",
              name: "Jane Doe",
              district: "District 30",
              party: "Democrat",
            },
          ],
        }),
        createSource({ dataType: DataType.REPRESENTATIVES }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        externalId: "ca-assembly-30",
        name: "Jane Doe",
        district: "District 30",
        party: "Democrat",
      });
    });

    it("should inject category as chamber", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "ca-senate-1",
              name: "John Smith",
              district: "District 1",
              party: "Republican",
            },
          ],
        }),
        createSource({
          dataType: DataType.REPRESENTATIVES,
          category: "Senate",
        }),
      );

      expect(result.items[0]).toMatchObject({ chamber: "Senate" });
    });

    it("should reject representatives missing name", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "ca-1", district: "1", party: "D" }],
        }),
        createSource({ dataType: DataType.REPRESENTATIVES }),
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("should skip items that fail mapping and add warnings", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            { externalId: "PROP-1", title: "Valid" },
            { invalid: true },
            { externalId: "PROP-2", title: "Also Valid" },
          ],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.success).toBe(true);
    });

    it("should return success=false when all items fail", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ bad: true }, { also: "bad" }],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("should preserve existing warnings and errors", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "P1", title: "Valid" }],
          warnings: ["existing warning"],
          errors: ["existing error"],
        }),
        createSource({ dataType: DataType.PROPOSITIONS }),
      );

      expect(result.warnings).toContain("existing warning");
      expect(result.errors).toContain("existing error");
    });

    it("should return null for unknown data type", () => {
      const result = mapper.map(
        createRawResult({
          items: [{ externalId: "X", name: "Test" }],
        }),
        createSource({ dataType: "unknown" as DataType }),
      );

      expect(result.items).toHaveLength(0);
    });
  });
});
