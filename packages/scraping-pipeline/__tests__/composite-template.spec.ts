import { resolveCompositeTemplate } from "../src/extraction/composite-template";
import { FieldTransformer } from "../src/extraction/field-transformer";

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

  it("rejects a template with a brace group the syntax cannot parse", () => {
    // Templates are reproduced by the structural-analysis LLM from config
    // hints, so a stray space or hyphen is a live failure mode. Copying the
    // unparsed group through verbatim would emit a corrupt upsert key and
    // report it as fully resolved.
    const spaced = resolveCompositeTemplate(
      "california-sonoma-{electionDate : date}-measure-{letter}",
      { electionDate: "2026-11-03T00:00:00.000Z", letter: "e" },
    );
    expect(spaced.value).toBeUndefined();
    expect(spaced.missing).toContain("{electionDate : date}");

    const hyphenated = resolveCompositeTemplate("{election-date}", {
      electionDate: "2026-11-03T00:00:00.000Z",
    });
    expect(hyphenated.value).toBeUndefined();
  });

  it("does not read up the prototype chain", () => {
    // {constructor} / {toString} would otherwise stringify a built-in into
    // the key; typeof a function is not "object" so the object guard misses it.
    for (const path of ["toString", "constructor", "hasOwnProperty"]) {
      const { value } = resolveCompositeTemplate(`{${path}}`, { a: "x" });
      expect(value).toBeUndefined();
    }
  });

  describe(":date formatter is host-timezone independent", () => {
    // date_parse builds LOCAL midnight and serialises to UTC, so on a host at
    // a positive offset the UTC string is the PREVIOUS day. Naively slicing it
    // keyed Measure E to 2026-11-03 in Los Angeles but 2026-11-02 in Berlin —
    // the same measure landing as two rows after a host move. The invariant
    // that matters is the round trip, and it holds on whatever host runs this.
    it("round-trips date_parse output back to the source calendar day", () => {
      const iso = FieldTransformer.apply("November 3, 2026, General Election", {
        type: "date_parse",
      });
      expect(String(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const { value } = resolveCompositeTemplate("{d:date}", { d: iso });
      expect(value).toBe("2026-11-03");
    });

    it("treats exact UTC midnight as the day it names", () => {
      const { value } = resolveCompositeTemplate("{d:date}", {
        d: "2026-11-03T00:00:00.000Z",
      });
      expect(value).toBe("2026-11-03");
    });

    it("passes a bare YYYY-MM-DD through unchanged", () => {
      const { value } = resolveCompositeTemplate("{d:date}", {
        d: "2026-11-03",
      });
      expect(value).toBe("2026-11-03");
    });
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
