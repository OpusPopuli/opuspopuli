import { ManifestExtractorService } from "../src/extraction/manifest-extractor.service";
import type { StructuralManifest, DataType } from "@opuspopuli/common";

// Helper to create a minimal manifest for testing
function createTestManifest(
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
      containerSelector: "body",
      itemSelector: ".member-card",
      fieldMappings: [],
    },
    confidence: 0.8,
    successCount: 0,
    failureCount: 0,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("ManifestExtractorService", () => {
  let extractor: ManifestExtractorService;

  beforeEach(() => {
    extractor = new ManifestExtractorService();
  });

  describe("basic extraction", () => {
    it("should extract text fields from matched elements", () => {
      const html = `
        <div class="container">
          <div class="member-card">
            <h3><a>John Smith</a></h3>
            <p class="district">District 30</p>
            <p class="party">Democrat</p>
          </div>
          <div class="member-card">
            <h3><a>Jane Doe</a></h3>
            <p class="district">District 5</p>
            <p class="party">Republican</p>
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".container",
          itemSelector: ".member-card",
          fieldMappings: [
            {
              fieldName: "name",
              selector: "h3 a",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "district",
              selector: ".district",
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
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        name: "John Smith",
        district: "District 30",
        party: "Democrat",
      });
      expect(result.items[1]).toEqual({
        name: "Jane Doe",
        district: "District 5",
        party: "Republican",
      });
    });

    it("should extract attribute values", () => {
      const html = `
        <div class="list">
          <div class="item">
            <a href="/page/1">Link 1</a>
            <img src="/photo1.jpg" />
          </div>
          <div class="item">
            <a href="/page/2">Link 2</a>
            <img src="/photo2.jpg" />
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "link",
              selector: "a",
              extractionMethod: "attribute",
              attribute: "href",
              required: true,
            },
            {
              fieldName: "photo",
              selector: "img",
              extractionMethod: "attribute",
              attribute: "src",
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        link: "/page/1",
        photo: "/photo1.jpg",
      });
      expect(result.items[1]).toEqual({
        link: "/page/2",
        photo: "/photo2.jpg",
      });
    });

    it("should extract using regex", () => {
      const html = `
        <ul class="measures">
          <li class="measure"><a>ACA 13 (Ward) Voting thresholds</a></li>
          <li class="measure"><a>SB 42 (Author) Description here</a></li>
        </ul>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".measures",
          itemSelector: ".measure",
          fieldMappings: [
            {
              fieldName: "measureId",
              selector: "a",
              extractionMethod: "regex",
              regexPattern: "^([A-Z]+ \\d+)",
              regexGroup: 1,
              required: true,
            },
            {
              fieldName: "fullText",
              selector: "a",
              extractionMethod: "text",
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].measureId).toBe("ACA 13");
      expect(result.items[1].measureId).toBe("SB 42");
    });

    it("should extract fields when itemSelector selects the target element itself", () => {
      // Reproduces issue #554: itemSelector selects <a> tags directly,
      // and field mappings also target "a" — .find() only searches descendants
      // so it misses the element itself. The fix uses .filter() as fallback.
      const html = `
        <div id="main-content-normal">
          <h2>November 3, 2026, Statewide Ballot Measures</h2>
          <p><a href="/elections/ballot-measures/pdf/aca-13.pdf">ACA 13 (Ward) Voting thresholds. (Res. Ch. 176, 2023)</a></p>
          <p><a href="/elections/ballot-measures/pdf/sca-1-24.pdf">SCA 1 (Newman) Elections: recall of state officers.</a></p>
          <p><a href="/elections/ballot-measures/pdf/sb-42.pdf">SB 42 (Umberg) Political Reform Act of 1974.</a></p>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: "#main-content-normal",
          itemSelector: "p > a[href*='ballot-measures/pdf']",
          fieldMappings: [
            {
              fieldName: "externalId",
              selector: "a",
              extractionMethod: "regex",
              regexPattern: "^([A-Z]+ \\d+)",
              regexGroup: 1,
              required: true,
            },
            {
              fieldName: "title",
              selector: "a",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "detailUrl",
              selector: "a",
              extractionMethod: "attribute",
              attribute: "href",
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].externalId).toBe("ACA 13");
      expect(result.items[0].title).toContain("ACA 13");
      expect(result.items[0].detailUrl).toBe(
        "/elections/ballot-measures/pdf/aca-13.pdf",
      );
      expect(result.items[1].externalId).toBe("SCA 1");
      expect(result.items[2].externalId).toBe("SB 42");
    });

    it("should handle constant extraction method with defaultValue", () => {
      const html = `
        <div class="list">
          <div class="item"><span class="name">Person A</span></div>
          <div class="item"><span class="name">Person B</span></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "name",
              selector: ".name",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "chamber",
              selector: "",
              extractionMethod:
                "constant" as import("@opuspopuli/common").ExtractionMethod,
              required: false,
              defaultValue: "Senate",
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].chamber).toBe("Senate");
      expect(result.items[1].chamber).toBe("Senate");
    });

    it("should handle null selector gracefully", () => {
      const html = `
        <div class="list">
          <div class="item"><span class="name">Person</span></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "name",
              selector: ".name",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "extra",
              selector: null as unknown as string,
              extractionMethod: "text",
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Person");
      expect(result.items[0].extra).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should return failure when container not found", () => {
      const html = "<div class='other'>content</div>";

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".missing-container",
          itemSelector: ".item",
          fieldMappings: [],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Container not found");
    });

    it("should return failure when no items found", () => {
      const html = "<div class='container'><p>No items here</p></div>";

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".container",
          itemSelector: ".nonexistent",
          fieldMappings: [],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("No items found");
    });

    it("should skip items where all required fields are missing", () => {
      const html = `
        <div class="list">
          <div class="item"><span class="name">Valid</span></div>
          <div class="item"><span class="other">No name</span></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
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
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Valid");
    });

    it("should use default values for missing optional fields", () => {
      const html = `
        <div class="list">
          <div class="item"><span class="name">Person</span></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
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
              defaultValue: "Unknown",
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.items[0]).toEqual({ name: "Person", party: "Unknown" });
    });
  });

  describe("transforms", () => {
    it("should apply name_format transform", () => {
      const html = `
        <div class="list">
          <div class="item"><span class="name">Smith, John</span></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "name",
              selector: ".name",
              extractionMethod: "text",
              required: true,
              transform: { type: "name_format" },
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.items[0].name).toBe("John Smith");
    });

    it("should apply url_resolve transform", () => {
      const html = `
        <div class="list">
          <div class="item"><a class="link" href="/members/42">Profile</a></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "profileUrl",
              selector: ".link",
              extractionMethod: "attribute",
              attribute: "href",
              required: false,
              transform: { type: "url_resolve" },
            },
          ],
        },
      });

      const result = extractor.extract(
        html,
        manifest,
        "https://www.assembly.ca.gov",
      );

      expect(result.items[0].profileUrl).toBe(
        "https://www.assembly.ca.gov/members/42",
      );
    });
  });

  describe("preprocessing", () => {
    it("should remove elements specified in preprocessing", () => {
      const html = `
        <div class="list">
          <div class="item"><span class="name">Keep</span></div>
          <div class="ad-banner">Remove me</div>
          <div class="item"><span class="name">Also Keep</span></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "name",
              selector: ".name",
              extractionMethod: "text",
              required: true,
            },
          ],
          preprocessing: [{ type: "remove_elements", selector: ".ad-banner" }],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
    });
  });

  describe("container-scoped field mappings", () => {
    it("should extract fields from the container when scope is 'container'", () => {
      const html = `
        <div class="content">
          <h2>November 3, 2026, Statewide Ballot Measures</h2>
          <p><a href="/measure1.pdf">ACA 13 (Ward) Voting thresholds</a></p>
          <p><a href="/measure2.pdf">SCA 1 (Newman) Elections: recall</a></p>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".content",
          itemSelector: "p",
          fieldMappings: [
            {
              fieldName: "title",
              selector: "a",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "electionDate",
              selector: "h2",
              extractionMethod: "regex",
              regexPattern: "(\\w+ \\d+, \\d{4})",
              required: false,
              scope: "container",
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        title: "ACA 13 (Ward) Voting thresholds",
        electionDate: "November 3, 2026",
      });
      expect(result.items[1]).toEqual({
        title: "SCA 1 (Newman) Elections: recall",
        electionDate: "November 3, 2026",
      });
    });

    it("should default to item scope when scope is not specified", () => {
      const html = `
        <div class="content">
          <h2>Heading outside items</h2>
          <div class="item"><h2>Item heading</h2></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".content",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "heading",
              selector: "h2",
              extractionMethod: "text",
              required: true,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({ heading: "Item heading" });
    });
  });

  describe("structured extraction (arrays of nested objects)", () => {
    it("should extract arrays of structured objects using children selectors", () => {
      const html = `
        <div class="list">
          <div class="member">
            <h3 class="name">Jane Smith</h3>
            <div class="office --capitol">
              <h4 class="office-title">Capitol Office</h4>
              <p class="address">1021 O Street</p>
              <p class="phone">(916) 555-1234</p>
            </div>
            <div class="office --district">
              <h4 class="office-title">District Office</h4>
              <p class="address">100 Main St</p>
              <p class="phone">(415) 555-6789</p>
            </div>
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".member",
          fieldMappings: [
            {
              fieldName: "name",
              selector: ".name",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "contactInfo.offices",
              selector: ".office",
              extractionMethod: "structured",
              children: {
                name: ".office-title",
                address: ".address",
                phone: ".phone",
              },
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Jane Smith");
      const contactInfo = result.items[0].contactInfo as Record<
        string,
        unknown
      >;
      const offices = contactInfo.offices as Record<string, string>[];
      expect(offices).toHaveLength(2);
      expect(offices[0]).toEqual({
        name: "Capitol Office",
        address: "1021 O Street",
        phone: "(916) 555-1234",
      });
      expect(offices[1]).toEqual({
        name: "District Office",
        address: "100 Main St",
        phone: "(415) 555-6789",
      });
    });

    it("should support attribute extraction in children via |attr: suffix", () => {
      const html = `
        <div class="list">
          <div class="member">
            <div class="committee">
              <a href="https://judiciary.example.gov">Judiciary</a>
              <span class="role">Chair</span>
            </div>
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".member",
          fieldMappings: [
            {
              fieldName: "committees",
              selector: ".committee",
              extractionMethod: "structured",
              children: {
                name: "a",
                role: ".role",
                url: "a|attr:href",
              },
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      const committees = result.items[0].committees as Record<string, string>[];
      expect(committees).toHaveLength(1);
      expect(committees[0]).toEqual({
        name: "Judiciary",
        role: "Chair",
        url: "https://judiciary.example.gov",
      });
    });

    it("should support _regex children selector for extracting from text", () => {
      const html = `
        <div class="list">
          <div class="member">
            <div class="office">Capitol, 1021 O Street Sacramento; Phone: (916) 651-4001</div>
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".member",
          fieldMappings: [
            {
              fieldName: "offices",
              selector: ".office",
              extractionMethod: "structured",
              children: {
                phone: "_regex:Phone:\\s*([\\d()\\s-]+)",
              },
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      const offices = result.items[0].offices as Record<string, string>[];
      expect(offices).toHaveLength(1);
      expect(offices[0].phone).toBe("(916) 651-4001");
    });

    it("should skip invalid regex patterns gracefully in children", () => {
      const html = `
        <div class="list">
          <div class="member">
            <div class="info">Phone: (555) 123-4567</div>
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".member",
          fieldMappings: [
            {
              fieldName: "items",
              selector: ".info",
              extractionMethod: "structured",
              children: {
                bad: "_regex:(invalid[regex",
                phone: "_regex:Phone:\\s*([\\d()\\s-]+)",
              },
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);
      const items = result.items[0].items as Record<string, string>[];
      expect(items).toHaveLength(1);
      // Invalid regex is skipped, valid regex extracts
      expect(items[0].phone).toBe("(555) 123-4567");
      expect(items[0].bad).toBeUndefined();
    });

    it("should return empty array when structured mapping has no selector or children", () => {
      const html = `<div class="list"><div class="member">x</div></div>`;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".member",
          fieldMappings: [
            {
              fieldName: "name",
              selector: ".member",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "items",
              selector: "",
              extractionMethod: "structured",
              children: { foo: "bar" },
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);
      expect(result.items[0].items).toBeUndefined();
    });

    it("should return empty array when no matches and not mark required field missing incorrectly", () => {
      const html = `
        <div class="list">
          <div class="member"><h3 class="name">Jane Smith</h3></div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".list",
          itemSelector: ".member",
          fieldMappings: [
            {
              fieldName: "name",
              selector: ".name",
              extractionMethod: "text",
              required: true,
            },
            {
              fieldName: "contactInfo.offices",
              selector: ".office",
              extractionMethod: "structured",
              children: { name: ".title" },
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Jane Smith");
      // offices key shouldn't be set when the array is empty
      expect(result.items[0].contactInfo).toBeUndefined();
    });
  });

  describe("dot-notation field names", () => {
    it("should set nested values using dot notation", () => {
      const html = `
        <div class="container">
          <div class="item">
            <span class="email">jane@example.gov</span>
            <span class="website">https://jane.example.gov</span>
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".container",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "contactInfo.email",
              selector: ".email",
              extractionMethod: "text",
              required: false,
            },
            {
              fieldName: "contactInfo.website",
              selector: ".website",
              extractionMethod: "text",
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);

      expect(result.items[0].contactInfo).toEqual({
        email: "jane@example.gov",
        website: "https://jane.example.gov",
      });
    });

    it("should merge multiple dot-notation fields under the same parent", () => {
      const html = `
        <div class="container">
          <div class="item">
            <span class="a">1</span>
            <span class="b">2</span>
            <span class="c">3</span>
          </div>
        </div>
      `;

      const manifest = createTestManifest({
        extractionRules: {
          containerSelector: ".container",
          itemSelector: ".item",
          fieldMappings: [
            {
              fieldName: "nested.a",
              selector: ".a",
              extractionMethod: "text",
              required: false,
            },
            {
              fieldName: "nested.b",
              selector: ".b",
              extractionMethod: "text",
              required: false,
            },
            {
              fieldName: "nested.c",
              selector: ".c",
              extractionMethod: "text",
              required: false,
            },
          ],
        },
      });

      const result = extractor.extract(html, manifest);
      expect(result.items[0].nested).toEqual({ a: "1", b: "2", c: "3" });
    });
  });
});
