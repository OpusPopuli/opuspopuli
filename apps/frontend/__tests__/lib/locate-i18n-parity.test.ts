/**
 * The signed-out location lookup (#1456) speaks English and Spanish. A key
 * missing from one language renders as the raw key to that reader, and the
 * privacy promise is the string that can least afford to.
 */
import en from "@/locales/en/region.json";
import es from "@/locales/es/region.json";

type Tree = { [key: string]: string | Tree };

/** Every leaf path in a translation subtree, e.g. "problems.denied". */
function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${prefix}${key}`]
      : leaves(value, `${prefix}${key}.`),
  );
}

describe("location lookup copy (#1456)", () => {
  it("has the same keys in English and Spanish", () => {
    expect(leaves(es.locate as Tree).sort()).toEqual(
      leaves(en.locate as Tree).sort(),
    );
  });

  it("translates every string, leaving none blank", () => {
    for (const lang of [en, es]) {
      for (const path of leaves(lang.locate as Tree)) {
        const value = path
          .split(".")
          .reduce<unknown>((node, key) => (node as Tree)[key], lang.locate);
        expect(typeof value === "string" && value.trim()).toBeTruthy();
      }
    }
  });

  it("names the device-resolved seat in both languages", () => {
    expect(en.layer.county.resolvedFromDevice).toBeTruthy();
    expect(es.layer.county.resolvedFromDevice).toBeTruthy();
  });
});
