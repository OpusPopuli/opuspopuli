import { SelfHealingService } from "../src/healing/self-healing.service";
import type {
  RawExtractionResult,
  StructuralManifest,
  DataType,
} from "@opuspopuli/common";

function createManifest(
  overrides: Partial<StructuralManifest> = {},
): StructuralManifest {
  return {
    id: "test-manifest",
    regionId: "test-region",
    sourceUrl: "https://example.com",
    dataType: "representatives" as DataType,
    version: 1,
    structureHash: "abc123",
    promptHash: "def456",
    extractionRules: {
      containerSelector: ".container",
      itemSelector: ".item",
      fieldMappings: [
        {
          fieldName: "name",
          selector: ".name",
          extractionMethod: "text",
          required: true,
        },
      ],
    },
    confidence: 0.8,
    successCount: 0,
    failureCount: 0,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function createResult(
  overrides: Partial<RawExtractionResult> = {},
): RawExtractionResult {
  return {
    items: [{ name: "John" }, { name: "Jane" }],
    success: true,
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe("SelfHealingService", () => {
  let healing: SelfHealingService;

  beforeEach(() => {
    healing = new SelfHealingService();
  });

  it("should not heal when extraction is valid", () => {
    const decision = healing.evaluate(createResult(), createManifest());

    expect(decision.shouldHeal).toBe(false);
    expect(decision.reason).toBe("Extraction passed validation");
    expect(decision.validation.valid).toBe(true);
  });

  it("should heal when extraction fails completely", () => {
    const decision = healing.evaluate(
      createResult({ success: false, items: [] }),
      createManifest(),
    );

    expect(decision.shouldHeal).toBe(true);
    expect(decision.reason).toContain("validation failed");
  });

  it("should heal when zero items extracted", () => {
    const decision = healing.evaluate(
      createResult({ items: [] }),
      createManifest(),
    );

    expect(decision.shouldHeal).toBe(true);
  });

  it("should heal when required fields are mostly missing", () => {
    const decision = healing.evaluate(
      createResult({
        items: [{ name: "" }, { name: "" }, { name: "" }, { name: "Valid" }],
      }),
      createManifest(),
    );

    expect(decision.shouldHeal).toBe(true);
  });

  it("should heal on dramatic item count drop", () => {
    const decision = healing.evaluate(
      createResult({ items: [{ name: "One" }] }),
      createManifest(),
      20,
    );

    expect(decision.shouldHeal).toBe(true);
    expect(decision.reason).toContain("dropped dramatically");
  });

  it("should NOT heal if healing was already attempted", () => {
    const decision = healing.evaluate(
      createResult({ success: false, items: [] }),
      createManifest(),
      undefined,
      true,
    );

    expect(decision.shouldHeal).toBe(false);
    expect(decision.reason).toContain("already attempted");
  });

  it("should return validation details in the decision", () => {
    const decision = healing.evaluate(
      createResult({ success: false, items: [] }),
      createManifest(),
    );

    expect(decision.validation).toBeDefined();
    expect(decision.validation.issues.length).toBeGreaterThan(0);
  });
});

describe("evaluateMapping (#966 W1)", () => {
  let healing: SelfHealingService;

  function createMapped(
    missRatio: number | undefined,
    items: unknown[] = [],
  ) {
    return {
      items,
      manifestVersion: 0,
      success: items.length > 0,
      warnings: [],
      errors: [],
      extractionTimeMs: 1,
      ...(missRatio !== undefined && {
        selectorFailures: [
          {
            kind: "schema_reject" as const,
            missRatio,
            schemaIssues: ["Proposition.externalId: Required"],
            message: "rejected",
          },
        ],
      }),
    };
  }

  beforeEach(() => {
    healing = new SelfHealingService();
  });

  it("heals when the schema rejected a majority of extracted items", () => {
    const decision = healing.evaluateMapping(
      createResult(),
      createMapped(0.9),
      createManifest(),
    );

    expect(decision.shouldHeal).toBe(true);
    expect(decision.reason).toContain("90%");
    expect(decision.reason).toContain("Proposition.externalId");
  });

  it("does not heal when healing was already attempted this run", () => {
    const decision = healing.evaluateMapping(
      createResult(),
      createMapped(1),
      createManifest(),
      true,
    );

    expect(decision.shouldHeal).toBe(false);
  });

  it("does not heal without a schema_reject failure", () => {
    const decision = healing.evaluateMapping(
      createResult(),
      createMapped(undefined, [{ ok: true }]),
      createManifest(),
    );

    expect(decision.shouldHeal).toBe(false);
  });

  it("does not heal at or below the 50% rejection threshold", () => {
    const decision = healing.evaluateMapping(
      createResult(),
      createMapped(0.5),
      createManifest(),
    );

    expect(decision.shouldHeal).toBe(false);
  });
});
