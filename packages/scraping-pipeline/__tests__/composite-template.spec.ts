import { resolveCompositeTemplate } from "../src/extraction/composite-template";

/**
 * Composite templates build a field (in practice `externalId`) from values the
 * item already has — the HTML counterpart of BulkDownloadConfig.compositeKey.
 * See #1164: measures pages carry the election date once per page, so the
 * discriminating half of the key is page-scoped and the other half item-scoped.
 */
describe("resolveCompositeTemplate (#1164)", () => {
  it("interpolates plain placeholders", () => {
    const { value, missing } = resolveCompositeTemplate(
      "sonoma-{letter}-{year}",
      { letter: "e", year: "2026" },
    );
    expect(value).toBe("sonoma-e-2026");
    expect(missing).toEqual([]);
  });

  it("date formatter trims an ISO timestamp to the calendar day", () => {
    // date_parse emits a full ISO string; raw interpolation would leak
    // "T00:00:00.000Z" into the upsert key.
    const { value } = resolveCompositeTemplate(
      "california-sonoma-{electionDate:date}-measure-{letter:lower}",
      { electionDate: "2026-11-03T00:00:00.000Z", letter: "AB" },
    );
    expect(value).toBe("california-sonoma-2026-11-03-measure-ab");
  });

  it("supports lower, upper, trim and slug formatters", () => {
    const data = {
      a: "MiXeD",
      b: "MiXeD",
      c: "  padded  ",
      d: "City of Rohnert Park — Sales Tax",
    };
    expect(
      resolveCompositeTemplate("{a:lower}|{b:upper}|{c:trim}|{d:slug}", data)
        .value,
    ).toBe("mixed|MIXED|padded|city-of-rohnert-park-sales-tax");
  });

  it("resolves dot-nested paths", () => {
    const { value } = resolveCompositeTemplate("{contactInfo.phone}", {
      contactInfo: { phone: "555-1234" },
    });
    expect(value).toBe("555-1234");
  });

  it("yields nothing when a placeholder is missing — never a half-built key", () => {
    const { value, missing } = resolveCompositeTemplate(
      "california-sonoma-{electionDate:date}-measure-{letter}",
      { letter: "e" },
    );
    // "california-sonoma--measure-e" would be a corrupt upsert key.
    expect(value).toBeUndefined();
    expect(missing).toEqual(["electionDate"]);
  });

  it("treats empty-string and null values as missing", () => {
    expect(
      resolveCompositeTemplate("{a}-{b}", { a: "", b: "x" }).value,
    ).toBeUndefined();
    expect(
      resolveCompositeTemplate("{a}-{b}", { a: null, b: "x" }).value,
    ).toBeUndefined();
  });

  it("rejects object/array values as key parts", () => {
    const { value, missing } = resolveCompositeTemplate("{offices}", {
      offices: [{ name: "Sacramento" }],
    });
    expect(value).toBeUndefined();
    expect(missing).toEqual(["offices"]);
  });

  it("reports every missing placeholder, not just the first", () => {
    const { missing } = resolveCompositeTemplate("{a}-{b}-{c}", { b: "x" });
    expect(missing).toEqual(["a", "c"]);
  });

  it("leaves non-placeholder braces untouched", () => {
    const { value } = resolveCompositeTemplate("{a} {not a placeholder}", {
      a: "x",
    });
    expect(value).toBe("x {not a placeholder}");
  });

  it("passes through an unknown formatter rather than dropping the value", () => {
    const { value } = resolveCompositeTemplate("{a:bogus}", { a: "Keep" });
    expect(value).toBe("Keep");
  });

  it("coerces numeric values", () => {
    const { value } = resolveCompositeTemplate("district-{district}", {
      district: 5,
    });
    expect(value).toBe("district-5");
  });
});
