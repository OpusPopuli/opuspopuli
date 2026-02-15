import { ConfigValidator } from "../src/validation/config-validator";
import { DataType } from "@opuspopuli/common";
import type { DeclarativeRegionConfig } from "@opuspopuli/common";

function createValidConfig(
  overrides?: Partial<DeclarativeRegionConfig>,
): DeclarativeRegionConfig {
  return {
    regionId: "california",
    regionName: "California",
    description: "California civic data",
    timezone: "America/Los_Angeles",
    dataSources: [
      {
        url: "https://www.sos.ca.gov/elections/ballot-measures",
        dataType: DataType.PROPOSITIONS,
        contentGoal:
          "Extract qualified ballot measures with ID, title, summary",
      },
    ],
    ...overrides,
  };
}

describe("ConfigValidator", () => {
  describe("valid configs", () => {
    it("should accept a minimal valid config", () => {
      const result = ConfigValidator.validate(createValidConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept a config with all optional fields", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          rateLimit: { requestsPerSecond: 2, burstSize: 5 },
          cacheTtlMs: 900000,
          requestTimeoutMs: 30000,
          dataSources: [
            {
              url: "https://www.sos.ca.gov/elections",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "Extract ballot measures with full details",
              category: "State",
              hints: ["Measures are grouped by election date"],
              rateLimitOverride: 0.5,
            },
          ],
        }),
      );
      expect(result.valid).toBe(true);
    });

    it("should accept multiple data sources", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          dataSources: [
            {
              url: "https://www.sos.ca.gov/elections",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "Extract ballot measures from SoS",
            },
            {
              url: "https://www.assembly.ca.gov/members",
              dataType: DataType.REPRESENTATIVES,
              contentGoal: "Extract assembly members from official directory",
              category: "Assembly",
            },
            {
              url: "https://www.senate.ca.gov/senators",
              dataType: DataType.REPRESENTATIVES,
              contentGoal: "Extract senators from official directory",
              category: "Senate",
            },
          ],
        }),
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid configs", () => {
    it("should reject empty regionId", () => {
      const result = ConfigValidator.validate(
        createValidConfig({ regionId: "" }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "regionId")).toBe(true);
    });

    it("should reject regionId with uppercase", () => {
      const result = ConfigValidator.validate(
        createValidConfig({ regionId: "California" }),
      );
      expect(result.valid).toBe(false);
    });

    it("should reject regionId starting with number", () => {
      const result = ConfigValidator.validate(
        createValidConfig({ regionId: "1california" }),
      );
      expect(result.valid).toBe(false);
    });

    it("should reject empty dataSources", () => {
      const result = ConfigValidator.validate(
        createValidConfig({ dataSources: [] }),
      );
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("At least one")),
      ).toBe(true);
    });

    it("should reject invalid URL", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          dataSources: [
            {
              url: "not-a-url",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "Some content goal here that is long enough",
            },
          ],
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("URL"))).toBe(true);
    });

    it("should reject too-short contentGoal", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          dataSources: [
            {
              url: "https://example.com",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "short",
            },
          ],
        }),
      );
      expect(result.valid).toBe(false);
    });

    it("should reject missing required fields", () => {
      const result = ConfigValidator.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("semantic validations", () => {
    it("should warn about HTTP URLs (not HTTPS)", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          dataSources: [
            {
              url: "http://www.example.com/page",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "Extract data from this insecure page source",
            },
          ],
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("HTTPS"))).toBe(true);
    });

    it("should detect duplicate data sources", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          dataSources: [
            {
              url: "https://example.com/page",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "Extract data from this source page first time",
            },
            {
              url: "https://example.com/page",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "Extract data from this source page second time",
            },
          ],
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(
        true,
      );
    });

    it("should allow same URL with different data types", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          dataSources: [
            {
              url: "https://example.com/page",
              dataType: DataType.PROPOSITIONS,
              contentGoal: "Extract propositions from this shared page",
            },
            {
              url: "https://example.com/page",
              dataType: DataType.MEETINGS,
              contentGoal: "Extract meetings from this shared page also",
            },
          ],
        }),
      );
      expect(result.valid).toBe(true);
    });

    it("should allow same URL+dataType with different categories", () => {
      const result = ConfigValidator.validate(
        createValidConfig({
          dataSources: [
            {
              url: "https://example.com/reps",
              dataType: DataType.REPRESENTATIVES,
              contentGoal: "Extract assembly members from directory page",
              category: "Assembly",
            },
            {
              url: "https://example.com/reps",
              dataType: DataType.REPRESENTATIVES,
              contentGoal: "Extract senate members from directory page also",
              category: "Senate",
            },
          ],
        }),
      );
      expect(result.valid).toBe(true);
    });
  });
});
