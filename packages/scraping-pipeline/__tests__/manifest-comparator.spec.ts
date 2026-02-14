import { ManifestComparator } from "../src/manifest/manifest-comparator";
import type { StructuralManifest, CivicDataType } from "@opuspopuli/common";

function createManifest(
  overrides?: Partial<StructuralManifest>,
): StructuralManifest {
  return {
    id: "test-id",
    regionId: "california",
    sourceUrl: "https://example.com",
    dataType: "propositions" as CivicDataType,
    version: 1,
    structureHash: "struct-hash-abc",
    promptHash: "prompt-hash-xyz",
    extractionRules: {
      containerSelector: "body",
      itemSelector: ".item",
      fieldMappings: [],
    },
    confidence: 0.8,
    successCount: 5,
    failureCount: 0,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("ManifestComparator", () => {
  it("should return canReuse=false with reason 'no_manifest' when no existing manifest", () => {
    const result = ManifestComparator.compare(undefined, "hash1", "hash2");

    expect(result.canReuse).toBe(false);
    expect(result.reason).toBe("no_manifest");
    expect(result.structureChanged).toBe(false);
    expect(result.promptChanged).toBe(false);
  });

  it("should return canReuse=true when both hashes match", () => {
    const manifest = createManifest({
      structureHash: "same-hash",
      promptHash: "same-prompt",
    });

    const result = ManifestComparator.compare(
      manifest,
      "same-hash",
      "same-prompt",
    );

    expect(result.canReuse).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.structureChanged).toBe(false);
    expect(result.promptChanged).toBe(false);
  });

  it("should detect structure change", () => {
    const manifest = createManifest({
      structureHash: "old-hash",
      promptHash: "same-prompt",
    });

    const result = ManifestComparator.compare(
      manifest,
      "new-hash",
      "same-prompt",
    );

    expect(result.canReuse).toBe(false);
    expect(result.reason).toBe("structure_changed");
    expect(result.structureChanged).toBe(true);
    expect(result.promptChanged).toBe(false);
  });

  it("should detect prompt change", () => {
    const manifest = createManifest({
      structureHash: "same-hash",
      promptHash: "old-prompt",
    });

    const result = ManifestComparator.compare(
      manifest,
      "same-hash",
      "new-prompt",
    );

    expect(result.canReuse).toBe(false);
    expect(result.reason).toBe("prompt_changed");
    expect(result.structureChanged).toBe(false);
    expect(result.promptChanged).toBe(true);
  });

  it("should detect both changes", () => {
    const manifest = createManifest({
      structureHash: "old-struct",
      promptHash: "old-prompt",
    });

    const result = ManifestComparator.compare(
      manifest,
      "new-struct",
      "new-prompt",
    );

    expect(result.canReuse).toBe(false);
    expect(result.reason).toBe("both_changed");
    expect(result.structureChanged).toBe(true);
    expect(result.promptChanged).toBe(true);
  });
});
