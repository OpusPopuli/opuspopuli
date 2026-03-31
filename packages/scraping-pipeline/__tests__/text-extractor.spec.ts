import { TextExtractorService } from "../src/extraction/text-extractor.service";
import type { TextExtractionRuleSet } from "@opuspopuli/common";

// Mock NestJS decorators
jest.mock("@nestjs/common", () => ({
  Injectable: () => (target: any) => target,
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe("TextExtractorService", () => {
  let extractor: TextExtractorService;

  beforeEach(() => {
    extractor = new TextExtractorService();
  });

  describe("extract", () => {
    it("should extract items from text using delimiter and regex patterns", () => {
      const text = `Meeting: Budget Committee
Date: April 5, 2026
Location: Room 101

Meeting: Education Committee
Date: April 6, 2026
Location: Room 202`;

      const rules: TextExtractionRuleSet = {
        itemDelimiter: "\\n\\n",
        fieldMappings: [
          {
            fieldName: "title",
            pattern: "Meeting:\\s*(.+)",
            required: true,
          },
          {
            fieldName: "scheduledAt",
            pattern: "Date:\\s*(.+)",
            required: true,
          },
          {
            fieldName: "location",
            pattern: "Location:\\s*(.+)",
            required: false,
          },
        ],
      };

      const result = extractor.extract(text, rules);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        title: "Budget Committee",
        scheduledAt: "April 5, 2026",
        location: "Room 101",
      });
      expect(result.items[1]).toMatchObject({
        title: "Education Committee",
        scheduledAt: "April 6, 2026",
        location: "Room 202",
      });
    });

    it("should narrow text using dataSectionStart and dataSectionEnd", () => {
      const text = `HEADER INFORMATION
Page 1 of 3

=== COMMITTEE HEARINGS ===
Meeting: Budget
Date: April 5

=== FOOTER ===
End of document`;

      const rules: TextExtractionRuleSet = {
        itemDelimiter: "\\n\\n",
        dataSectionStart: "=== COMMITTEE HEARINGS ===",
        dataSectionEnd: "=== FOOTER ===",
        fieldMappings: [
          { fieldName: "title", pattern: "Meeting:\\s*(.+)", required: true },
          {
            fieldName: "scheduledAt",
            pattern: "Date:\\s*(.+)",
            required: true,
          },
        ],
      };

      const result = extractor.extract(text, rules);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ title: "Budget" });
    });

    it("should skip header lines", () => {
      const text = `HEADER LINE 1
HEADER LINE 2
Meeting: Budget
Date: April 5`;

      const rules: TextExtractionRuleSet = {
        itemDelimiter: "\\n\\n",
        skipLines: 2,
        fieldMappings: [
          { fieldName: "title", pattern: "Meeting:\\s*(.+)", required: true },
          {
            fieldName: "scheduledAt",
            pattern: "Date:\\s*(.+)",
            required: true,
          },
        ],
      };

      const result = extractor.extract(text, rules);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
    });

    it("should use default values for optional fields", () => {
      const text = `Meeting: Budget Committee`;

      const rules: TextExtractionRuleSet = {
        itemDelimiter: "\\n\\n",
        fieldMappings: [
          { fieldName: "title", pattern: "Meeting:\\s*(.+)", required: true },
          {
            fieldName: "location",
            pattern: "Location:\\s*(.+)",
            required: false,
            defaultValue: "TBD",
          },
        ],
      };

      const result = extractor.extract(text, rules);

      expect(result.items[0]).toMatchObject({
        title: "Budget Committee",
        location: "TBD",
      });
    });

    it("should skip items missing required fields", () => {
      const text = `Title: Budget Committee

No title here
Date: April 5`;

      const rules: TextExtractionRuleSet = {
        itemDelimiter: "\\n\\n",
        fieldMappings: [
          { fieldName: "title", pattern: "Title:\\s*(.+)", required: true },
        ],
      };

      const result = extractor.extract(text, rules);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ title: "Budget Committee" });
    });

    it("should return empty result for empty text", () => {
      const rules: TextExtractionRuleSet = {
        itemDelimiter: "\\n\\n",
        fieldMappings: [
          { fieldName: "title", pattern: "Title:\\s*(.+)", required: true },
        ],
      };

      const result = extractor.extract("", rules);

      expect(result.success).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("should handle invalid regex gracefully by using literal split", () => {
      const text = `item1---item2---item3`;

      const rules: TextExtractionRuleSet = {
        itemDelimiter: "---",
        fieldMappings: [
          { fieldName: "value", pattern: "(\\w+)", required: true },
        ],
      };

      const result = extractor.extract(text, rules);

      expect(result.items).toHaveLength(3);
    });

    it("should support custom capture groups", () => {
      const text = `Name: John Smith (D-24)`;

      const rules: TextExtractionRuleSet = {
        itemDelimiter: "\\n\\n",
        fieldMappings: [
          {
            fieldName: "name",
            pattern: "Name:\\s*(.+?)\\s*\\(",
            captureGroup: 1,
            required: true,
          },
          {
            fieldName: "party",
            pattern: "\\(([A-Z])-",
            captureGroup: 1,
            required: false,
          },
          {
            fieldName: "district",
            pattern: "-([0-9]+)\\)",
            captureGroup: 1,
            required: false,
          },
        ],
      };

      const result = extractor.extract(text, rules);

      expect(result.items[0]).toMatchObject({
        name: "John Smith",
        party: "D",
        district: "24",
      });
    });
  });
});
