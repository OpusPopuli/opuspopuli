import { ExtractionValidator } from "../src/extraction/extraction-validator";
import type {
  RawExtractionResult,
  StructuralManifest,
  CivicDataType,
} from "@opuspopuli/common";

function createManifest(
  overrides: Partial<StructuralManifest> = {},
): StructuralManifest {
  return {
    id: "test-manifest",
    regionId: "test-region",
    sourceUrl: "https://example.com",
    dataType: "representatives" as CivicDataType,
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
        {
          fieldName: "party",
          selector: ".party",
          extractionMethod: "text",
          required: false,
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
    items: [
      { name: "John", party: "Democrat" },
      { name: "Jane", party: "Republican" },
    ],
    success: true,
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe("ExtractionValidator", () => {
  let validator: ExtractionValidator;

  beforeEach(() => {
    validator = new ExtractionValidator();
  });

  it("should pass validation for a healthy extraction", () => {
    const result = validator.validate(createResult(), createManifest());

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("should flag complete extraction failure", () => {
    const result = validator.validate(
      createResult({ success: false, items: [] }),
      createManifest(),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("failed"))).toBe(true);
  });

  it("should flag zero items extracted", () => {
    const result = validator.validate(
      createResult({ items: [], success: true }),
      createManifest(),
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("Zero items"))).toBe(
      true,
    );
  });

  it("should flag required fields missing in >50% of items (error)", () => {
    const result = validator.validate(
      createResult({
        items: [
          { name: "", party: "D" },
          { name: "", party: "R" },
          { name: "Valid", party: "I" },
        ],
      }),
      createManifest(),
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.severity === "error" && i.message.includes('"name"'),
      ),
    ).toBe(true);
  });

  it("should warn when required fields missing in 10-50% of items", () => {
    const items = [];
    for (let i = 0; i < 10; i++) {
      items.push({ name: i < 2 ? "" : `Person ${i}`, party: "D" });
    }
    const result = validator.validate(
      createResult({ items }),
      createManifest(),
    );

    expect(result.valid).toBe(true);
    expect(
      result.issues.some(
        (i) => i.severity === "warning" && i.message.includes('"name"'),
      ),
    ).toBe(true);
  });

  it("should flag dramatic item count drop (error)", () => {
    const result = validator.validate(
      createResult({ items: [{ name: "Only one", party: "D" }] }),
      createManifest(),
      10,
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.message.includes("dropped dramatically")),
    ).toBe(true);
  });

  it("should warn on moderate item count decrease", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      name: `P${i}`,
      party: "D",
    }));
    const result = validator.validate(
      createResult({ items }),
      createManifest(),
      10,
    );

    expect(result.valid).toBe(true);
    expect(
      result.issues.some(
        (i) =>
          i.severity === "warning" && i.message.includes("count decreased"),
      ),
    ).toBe(true);
  });

  it("should not flag count drift when no previous count", () => {
    const result = validator.validate(
      createResult({ items: [{ name: "One", party: "D" }] }),
      createManifest(),
    );

    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.message.includes("count"))).toBe(false);
  });

  it("should warn on excessive warnings count", () => {
    const warnings = Array.from({ length: 10 }, (_, i) => `Warning ${i}`);
    const result = validator.validate(
      createResult({ items: [{ name: "One", party: "D" }], warnings }),
      createManifest(),
    );

    expect(result.valid).toBe(true);
    expect(
      result.issues.some((i) => i.message.includes("High warning count")),
    ).toBe(true);
  });

  it("should handle manifest with no required fields gracefully", () => {
    const manifest = createManifest({
      extractionRules: {
        containerSelector: ".container",
        itemSelector: ".item",
        fieldMappings: [
          {
            fieldName: "name",
            selector: ".name",
            extractionMethod: "text",
            required: false,
          },
        ],
      },
    });

    const result = validator.validate(createResult(), manifest);
    expect(result.valid).toBe(true);
  });
});
