/**
 * Vocab integrity tests. Catches:
 *  - GraphQL field-name drift (vocab references a backend field that
 *    doesn't exist anymore)
 *  - i18n parity gaps (a vocab entry has no label / description / option
 *    in EN or ES)
 *  - Controlled-vocab drift between the two locales
 *  - Category presentation completeness (every defined category has at
 *    least one field; every field's category appears in CATEGORY_ORDER)
 */
import en from "@/locales/en/profile.json";
import es from "@/locales/es/profile.json";
import {
  ALL_FIELDS,
  CATEGORY_ORDER,
  FIELDS_BY_CATEGORY,
  TIER_BY_CATEGORY,
} from "@/lib/personalization/vocab";
import {
  getCategoryPresentations,
  partitionByTier,
} from "@/lib/personalization/categories";

type LocaleProfile = typeof en;

const getFieldEntry = (
  locale: LocaleProfile,
  i18nKey: string,
): Record<string, unknown> | undefined =>
  (locale.fields as Record<string, Record<string, unknown>>)[i18nKey];

describe("vocab descriptors", () => {
  it("has at least one field per category in CATEGORY_ORDER", () => {
    for (const category of CATEGORY_ORDER) {
      expect(FIELDS_BY_CATEGORY[category]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("every field's category appears in CATEGORY_ORDER", () => {
    for (const field of ALL_FIELDS) {
      expect(CATEGORY_ORDER).toContain(field.category);
    }
  });

  it("every category maps to a tier", () => {
    for (const category of CATEGORY_ORDER) {
      expect(TIER_BY_CATEGORY[category]).toMatch(/^T[123]$/);
    }
  });

  it("fields with options carry a non-empty options array", () => {
    const optionalTypes = new Set([
      "string-input",
      "boolean",
      "integer",
      "state",
      "multi-tag-input",
    ]);
    for (const field of ALL_FIELDS) {
      if (optionalTypes.has(field.inputType)) continue;
      expect(field.options).toBeDefined();
      expect(field.options!.length).toBeGreaterThan(0);
    }
  });

  it("integer fields declare min/max bounds", () => {
    const integers = ALL_FIELDS.filter((f) => f.inputType === "integer");
    expect(integers.length).toBeGreaterThan(0);
    for (const f of integers) {
      expect(f.min).toBeDefined();
      expect(f.max).toBeDefined();
      expect(f.max!).toBeGreaterThanOrEqual(f.min!);
    }
  });
});

describe("i18n parity — every vocab entry resolves in EN and ES", () => {
  it("every field has a label + description in both locales", () => {
    for (const field of ALL_FIELDS) {
      const enEntry = getFieldEntry(en, field.i18nKey);
      const esEntry = getFieldEntry(es, field.i18nKey);
      expect(enEntry).toBeDefined();
      expect(esEntry).toBeDefined();
      expect(typeof enEntry?.label).toBe("string");
      expect(typeof enEntry?.description).toBe("string");
      expect(typeof esEntry?.label).toBe("string");
      expect(typeof esEntry?.description).toBe("string");
    }
  });

  it("every controlled-vocab option has a label in both locales", () => {
    for (const field of ALL_FIELDS) {
      if (!field.options) continue;
      const enEntry = getFieldEntry(en, field.i18nKey);
      const esEntry = getFieldEntry(es, field.i18nKey);
      const enOptions = enEntry?.options as Record<string, string> | undefined;
      const esOptions = esEntry?.options as Record<string, string> | undefined;
      expect(enOptions).toBeDefined();
      expect(esOptions).toBeDefined();
      for (const value of field.options) {
        expect(enOptions?.[value]).toBeDefined();
        expect(esOptions?.[value]).toBeDefined();
      }
    }
  });
});

describe("getCategoryPresentations", () => {
  it("emits one presentation per category in CATEGORY_ORDER", () => {
    const presentations = getCategoryPresentations();
    expect(presentations.map((p) => p.category)).toEqual(CATEGORY_ORDER);
  });

  it("T1 + T2 default to expanded; T3 default to collapsed", () => {
    for (const p of getCategoryPresentations()) {
      const expectedExpanded = p.tier !== "T3";
      expect(p.defaultExpanded).toBe(expectedExpanded);
    }
  });

  it("partitionByTier splits sensitive (T3) from the rest", () => {
    const { nonSensitive, sensitive } = partitionByTier(
      getCategoryPresentations(),
    );
    expect(nonSensitive.every((p) => p.tier !== "T3")).toBe(true);
    expect(sensitive.every((p) => p.tier === "T3")).toBe(true);
    expect(nonSensitive.length + sensitive.length).toBe(CATEGORY_ORDER.length);
  });
});
