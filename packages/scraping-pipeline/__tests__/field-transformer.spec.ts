import { FieldTransformer } from "../src/extraction/field-transformer";

describe("FieldTransformer", () => {
  describe("trim", () => {
    it("should trim whitespace", () => {
      expect(FieldTransformer.apply("  hello world  ", { type: "trim" })).toBe(
        "hello world",
      );
    });
  });

  describe("lowercase", () => {
    it("should convert to lowercase", () => {
      expect(FieldTransformer.apply("HELLO WORLD", { type: "lowercase" })).toBe(
        "hello world",
      );
    });
  });

  describe("uppercase", () => {
    it("should convert to uppercase", () => {
      expect(FieldTransformer.apply("hello world", { type: "uppercase" })).toBe(
        "HELLO WORLD",
      );
    });
  });

  describe("strip_html", () => {
    it("should remove HTML tags", () => {
      expect(
        FieldTransformer.apply("<b>Bold</b> and <i>italic</i>", {
          type: "strip_html",
        }),
      ).toBe("Bold and italic");
    });

    it("should handle nested tags", () => {
      expect(
        FieldTransformer.apply("<div><p><a href='x'>Link</a></p></div>", {
          type: "strip_html",
        }),
      ).toBe("Link");
    });
  });

  describe("url_resolve", () => {
    it("should resolve relative URLs", () => {
      expect(
        FieldTransformer.apply(
          "/members/42",
          { type: "url_resolve" },
          "https://www.assembly.ca.gov",
        ),
      ).toBe("https://www.assembly.ca.gov/members/42");
    });

    it("should preserve absolute URLs", () => {
      expect(
        FieldTransformer.apply(
          "https://other.com/page",
          { type: "url_resolve" },
          "https://www.assembly.ca.gov",
        ),
      ).toBe("https://other.com/page");
    });

    it("should return value as-is when no base URL", () => {
      expect(
        FieldTransformer.apply("/members/42", { type: "url_resolve" }),
      ).toBe("/members/42");
    });
  });

  describe("regex_replace", () => {
    it("should apply regex replacement", () => {
      expect(
        FieldTransformer.apply("District: 30", {
          type: "regex_replace",
          params: { pattern: "District:\\s*", replacement: "District " },
        }),
      ).toBe("District 30");
    });

    it("should return value if no pattern provided", () => {
      expect(FieldTransformer.apply("test", { type: "regex_replace" })).toBe(
        "test",
      );
    });

    it("should handle global flag", () => {
      expect(
        FieldTransformer.apply("a-b-c", {
          type: "regex_replace",
          params: { pattern: "-", replacement: "_", flags: "g" },
        }),
      ).toBe("a_b_c");
    });
  });

  describe("name_format", () => {
    it("should convert 'Last, First' to 'First Last'", () => {
      expect(
        FieldTransformer.apply("Smith, John", { type: "name_format" }),
      ).toBe("John Smith");
    });

    it("should handle names without comma", () => {
      expect(
        FieldTransformer.apply("John Smith", { type: "name_format" }),
      ).toBe("John Smith");
    });

    it("should normalize whitespace", () => {
      expect(
        FieldTransformer.apply("  John   Smith  ", { type: "name_format" }),
      ).toBe("John Smith");
    });

    it("should handle extra whitespace around comma", () => {
      expect(
        FieldTransformer.apply("  Smith ,  John  ", { type: "name_format" }),
      ).toBe("John Smith");
    });
  });

  describe("date_parse", () => {
    it("should parse long date format (January 1, 2026)", () => {
      const result = FieldTransformer.apply("November 3, 2026", {
        type: "date_parse",
      });
      const date = new Date(result);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(10); // November = 10
      expect(date.getDate()).toBe(3);
    });

    it("should parse abbreviated month (Feb 17, 2026)", () => {
      const result = FieldTransformer.apply("Feb 17, 2026", {
        type: "date_parse",
      });
      const date = new Date(result);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(1); // February = 1
      expect(date.getDate()).toBe(17);
    });

    it("should parse US format MM/DD/YY", () => {
      const result = FieldTransformer.apply("02/17/26", { type: "date_parse" });
      const date = new Date(result);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(1);
      expect(date.getDate()).toBe(17);
    });

    it("should parse US format MM/DD/YYYY", () => {
      const result = FieldTransformer.apply("12/25/2025", {
        type: "date_parse",
      });
      const date = new Date(result);
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(11); // December = 11
      expect(date.getDate()).toBe(25);
    });

    it("should parse ISO format YYYY-MM-DD", () => {
      const result = FieldTransformer.apply("2026-03-15", {
        type: "date_parse",
      });
      const date = new Date(result);
      expect(date.getFullYear()).toBe(2026);
    });

    it("should return original string for unparseable dates", () => {
      const result = FieldTransformer.apply("not a date", {
        type: "date_parse",
      });
      expect(result).toBe("not a date");
    });
  });
});
