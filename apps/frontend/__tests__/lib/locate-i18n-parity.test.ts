/**
 * The copy a signed-out reader meets (#1456, #962) speaks English and
 * Spanish. A key missing from one language renders as the raw key to that
 * reader, and the disclaimers and the privacy promise are the strings that
 * can least afford to.
 */
import enCommon from "@/locales/en/common.json";
import esCommon from "@/locales/es/common.json";
import enLanding from "@/locales/en/landing.json";
import esLanding from "@/locales/es/landing.json";
import enRegion from "@/locales/en/region.json";
import esRegion from "@/locales/es/region.json";

type Tree = { [key: string]: string | Tree };

/** Every leaf path in a translation subtree, e.g. "problems.denied". */
function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : leaves(value, `${prefix}${key}.`),
  );
}

function at(tree: unknown, path: string): Tree {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node as Tree)?.[key], tree) as Tree;
}

const BLOCKS: Array<[string, unknown, unknown, string]> = [
  ["region", enRegion, esRegion, "locate"],
  ["region", enRegion, esRegion, "accountPrompt"],
  ["common", enCommon, esCommon, "footer"],
  ["common", enCommon, esCommon, "readingNotice"],
  ["common", enCommon, esCommon, "navigation"],
  ["common", enCommon, esCommon, "aiReceipt.badge"],
  ["landing", enLanding, esLanding, "counties.cta"],
];

describe.each(BLOCKS)("%s:%s copy (#1456)", (_ns, en, es, path) => {
  it("has the same keys in English and Spanish", () => {
    expect(leaves(at(es, path)).sort()).toEqual(leaves(at(en, path)).sort());
  });

  it("translates every string, leaving none blank", () => {
    for (const lang of [en, es]) {
      for (const leaf of leaves(at(lang, path))) {
        const value = at(lang, `${path}.${leaf}`) as unknown;
        expect(typeof value === "string" && value.trim()).toBeTruthy();
      }
    }
  });
});

describe("one-off strings (#1456)", () => {
  it("names the device-resolved seat in both languages", () => {
    expect(enRegion.layer.county.resolvedFromDevice).toBeTruthy();
    expect(esRegion.layer.county.resolvedFromDevice).toBeTruthy();
  });

  it("warns that AI text may contain errors, in both languages (#962)", () => {
    expect(enCommon.aiReceipt.badge.AI).toMatch(/may contain errors/);
    expect(esCommon.aiReceipt.badge.AI).toMatch(/puede contener errores/);
  });
});
