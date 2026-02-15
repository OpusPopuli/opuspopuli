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
});
