import * as cheerio from "cheerio";
import { extractStructuredArray } from "../src/extraction/structured-extractor.js";

const officeHtml = `
<div>
  <div class="office">
    <h4 class="office-title">Capitol Office</h4>
    <p class="address">1021 O Street, Suite 6510, Sacramento, CA 95814; (916) 651-4016</p>
  </div>
  <div class="office">
    <h4 class="office-title">District Office</h4>
    <p class="address">5201 California Avenue, Suite 220, Bakersfield, CA 93309; (661) 395-2620</p>
  </div>
  <div class="office">
    <h4 class="office-title">Field Office</h4>
    <p class="address">100 Main Street, Anywhere, CA 90210</p>
  </div>
</div>
`;

describe("extractStructuredArray", () => {
  describe("string-shortcut child selectors (legacy)", () => {
    it("extracts text from descendant via plain selector", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        name: "h4.office-title",
        address: "p.address",
      });
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        name: "Capitol Office",
        address:
          "1021 O Street, Suite 6510, Sacramento, CA 95814; (916) 651-4016",
      });
    });

    it("extracts via _regex: shortcut (capture group 1)", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        phone: "_regex:(\\(\\d{3}\\)\\s*\\d{3}-\\d{4})",
      });
      // The third office has no phone — gets dropped because no fields extracted
      expect(result).toHaveLength(2);
      expect(result[0].phone).toBe("(916) 651-4016");
      expect(result[1].phone).toBe("(661) 395-2620");
    });

    it("extracts attribute via |attr: shortcut", () => {
      const $ = cheerio.load(`
        <div>
          <div class="row"><a href="https://a.example/">A</a></div>
          <div class="row"><a href="https://b.example/">B</a></div>
        </div>
      `);
      const result = extractStructuredArray($, $("body"), ".row", {
        href: "a|attr:href",
      });
      expect(result).toEqual([
        { href: "https://a.example/" },
        { href: "https://b.example/" },
      ]);
    });
  });

  describe("object-form ChildFieldConfig", () => {
    it("extracts text from selector with regex_replace transform stripping phone from address", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        address: {
          selector: "p.address",
          extractionMethod: "text",
          transform: {
            type: "regex_replace",
            params: {
              pattern: "\\s*;\\s*\\(\\d{3}\\)\\s*\\d{3}-\\d{4}.*$",
              replacement: "",
            },
          },
        },
      });
      expect(result).toHaveLength(3);
      expect(result[0].address).toBe(
        "1021 O Street, Suite 6510, Sacramento, CA 95814",
      );
      expect(result[1].address).toBe(
        "5201 California Avenue, Suite 220, Bakersfield, CA 93309",
      );
      // Office without phone passes through unchanged
      expect(result[2].address).toBe("100 Main Street, Anywhere, CA 90210");
    });

    it("extracts via regex with explicit regexGroup", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        phone: {
          extractionMethod: "regex",
          regexPattern: "\\((\\d{3})\\)\\s*(\\d{3})-(\\d{4})",
          regexGroup: 0, // full match
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0].phone).toBe("(916) 651-4016");
    });

    it("regexGroup defaults to 1 when omitted", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        areaCode: {
          extractionMethod: "regex",
          regexPattern: "\\((\\d{3})\\)",
          // regexGroup omitted → defaults to 1
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0].areaCode).toBe("916");
      expect(result[1].areaCode).toBe("661");
    });

    it("extracts attribute via object form", () => {
      const $ = cheerio.load(`
        <div>
          <div class="row"><a href="/path-a">A</a></div>
          <div class="row"><a href="/path-b">B</a></div>
        </div>
      `);
      const result = extractStructuredArray($, $("body"), ".row", {
        href: {
          selector: "a",
          extractionMethod: "attribute",
          attribute: "href",
        },
      });
      expect(result).toEqual([{ href: "/path-a" }, { href: "/path-b" }]);
    });

    it("applies url_resolve transform with baseUrl", () => {
      const $ = cheerio.load(`
        <div>
          <div class="row"><a href="/a">A</a></div>
        </div>
      `);
      const result = extractStructuredArray(
        $,
        $("body"),
        ".row",
        {
          link: {
            selector: "a",
            extractionMethod: "attribute",
            attribute: "href",
            transform: { type: "url_resolve" },
          },
        },
        "https://example.com/base/",
      );
      expect(result[0].link).toBe("https://example.com/a");
    });

    it("regex against a narrowed sub-selector", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        phone: {
          selector: "p.address",
          extractionMethod: "regex",
          regexPattern: "\\(\\d{3}\\)\\s*\\d{3}-\\d{4}",
          regexGroup: 0,
        },
      });
      expect(result[0].phone).toBe("(916) 651-4016");
    });
  });

  describe("mixed string + object children (the real CA Senate manifest shape)", () => {
    it("extracts name, address-with-phone-stripped, and phone all in one pass", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        name: "h4.office-title", // string shortcut
        address: {
          selector: "p.address",
          extractionMethod: "text",
          transform: {
            type: "regex_replace",
            params: {
              pattern: "\\s*;\\s*\\(\\d{3}\\)\\s*\\d{3}-\\d{4}.*$",
              replacement: "",
            },
          },
        },
        phone: {
          selector: "p.address",
          extractionMethod: "regex",
          regexPattern: "\\(\\d{3}\\)\\s*\\d{3}-\\d{4}",
          regexGroup: 0,
        },
      });
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        name: "Capitol Office",
        address: "1021 O Street, Suite 6510, Sacramento, CA 95814",
        phone: "(916) 651-4016",
      });
      expect(result[1]).toEqual({
        name: "District Office",
        address: "5201 California Avenue, Suite 220, Bakersfield, CA 93309",
        phone: "(661) 395-2620",
      });
      // Office without phone: name + address present, phone absent (regex didn't match)
      expect(result[2]).toEqual({
        name: "Field Office",
        address: "100 Main Street, Anywhere, CA 90210",
      });
    });
  });

  describe("edge cases", () => {
    it("returns empty array when selector matches nothing", () => {
      const $ = cheerio.load(officeHtml);
      expect(
        extractStructuredArray($, $("body"), ".nope", { name: "h4" }),
      ).toEqual([]);
    });

    it("returns empty array when children are empty", () => {
      const $ = cheerio.load(officeHtml);
      expect(extractStructuredArray($, $("body"), ".office", {})).toEqual([]);
    });

    it("invalid regex pattern returns no value (does not throw)", () => {
      const $ = cheerio.load(officeHtml);
      const result = extractStructuredArray($, $("body"), ".office", {
        phone: { extractionMethod: "regex", regexPattern: "(unclosed" },
      });
      expect(result).toEqual([]);
    });
  });
});
