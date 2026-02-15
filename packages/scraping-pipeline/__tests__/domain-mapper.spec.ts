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

  describe("campaign finance — committees", () => {
    it("should map valid committee records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "C001",
              name: "Citizens for Progress",
              type: "pac",
              status: "active",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "committee",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "C001",
        name: "Citizens for Progress",
        sourceSystem: "fec",
      });
    });
  });

  describe("campaign finance — contributions", () => {
    it("should map valid contribution records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CONT-1",
              committeeId: "C001",
              donorName: "Jane Smith",
              donorType: "IND",
              amount: "500",
              date: "2026-01-15",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        externalId: "CONT-1",
        donorName: "Jane Smith",
        amount: 500,
      });
    });

    it("should construct donorName from firstName+lastName", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CONT-2",
              committeeId: "C001",
              donorLastName: "Smith",
              donorFirstName: "Jane",
              amount: "250",
              date: "2026-02-01",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        donorName: "Smith, Jane",
      });
    });

    it("should normalize donor type abbreviations", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "CONT-3",
              committeeId: "C001",
              donorName: "Test Donor",
              donorType: "IND",
              amount: "100",
              date: "2026-01-01",
              sourceSystem: "cal_access",
            },
            {
              externalId: "CONT-4",
              committeeId: "C001",
              donorName: "Test PAC",
              donorType: "COM",
              amount: "5000",
              date: "2026-01-01",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ donorType: "individual" });
      expect(result.items[1]).toMatchObject({ donorType: "committee" });
    });

    it("should reject contributions missing required fields", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              // Missing committeeId, donorName, amount, date
              externalId: "CONT-BAD",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "contribution",
        }),
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe("campaign finance — expenditures", () => {
    it("should map valid expenditure records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "EXP-1",
              committeeId: "C001",
              payeeName: "Ad Agency LLC",
              amount: "10000",
              date: "2026-03-01",
              purposeDescription: "TV ads",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "expenditure",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        payeeName: "Ad Agency LLC",
        amount: 10000,
      });
    });

    it("should normalize support/oppose values", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "EXP-2",
              committeeId: "C001",
              payeeName: "Firm",
              amount: "5000",
              date: "2026-01-01",
              supportOrOppose: "S",
              sourceSystem: "cal_access",
            },
            {
              externalId: "EXP-3",
              committeeId: "C001",
              payeeName: "Other Firm",
              amount: "3000",
              date: "2026-01-01",
              supportOrOppose: "O",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "expenditure",
        }),
      );

      expect(result.items[0]).toMatchObject({ supportOrOppose: "support" });
      expect(result.items[1]).toMatchObject({ supportOrOppose: "oppose" });
    });
  });

  describe("campaign finance — independent expenditures", () => {
    it("should map valid independent expenditure records", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "IE-1",
              committeeId: "C001",
              committeeName: "Super PAC",
              candidateName: "Jane Doe",
              supportOrOppose: "S",
              amount: "50000",
              date: "2026-06-01",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "independent-expenditure",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        committeeName: "Super PAC",
        candidateName: "Jane Doe",
        supportOrOppose: "support",
        amount: 50000,
      });
    });
  });

  describe("campaign finance — category routing", () => {
    it("should default to contribution mapping when category is unrecognized", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "X-1",
              committeeId: "C001",
              donorName: "Default Donor",
              amount: "100",
              date: "2026-01-01",
              sourceSystem: "fec",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "unknown-category",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        donorName: "Default Donor",
      });
    });

    it("should route s496 category to independent expenditures", () => {
      const result = mapper.map(
        createRawResult({
          items: [
            {
              externalId: "IE-S496",
              committeeId: "C001",
              committeeName: "Late IE PAC",
              supportOrOppose: "O",
              amount: "25000",
              date: "2026-10-01",
              sourceSystem: "cal_access",
            },
          ],
        }),
        createSource({
          dataType: DataType.CAMPAIGN_FINANCE,
          category: "cal-access-s496",
        }),
      );

      expect(result.success).toBe(true);
      expect(result.items[0]).toMatchObject({
        committeeName: "Late IE PAC",
        supportOrOppose: "oppose",
      });
    });
  });
});
