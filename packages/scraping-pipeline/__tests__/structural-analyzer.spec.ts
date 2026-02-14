import { StructuralAnalyzerService } from "../src/analysis/structural-analyzer.service";
import { PromptClientService } from "../src/analysis/prompt-client.service";
import {
  CivicDataType,
  type ILLMProvider,
  type DataSourceConfig,
} from "@opuspopuli/common";

function createMockLLM(responseText?: string): jest.Mocked<ILLMProvider> {
  const validJson = JSON.stringify({
    containerSelector: ".members-list",
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
    ],
    analysisNotes: "The page uses a card-based layout for each member.",
  });

  return {
    getName: jest.fn().mockReturnValue("ollama"),
    getModelName: jest.fn().mockReturnValue("llama3"),
    generate: jest.fn().mockResolvedValue({
      text: responseText ?? validJson,
      tokensUsed: 500,
      finishReason: "stop",
    }),
    isAvailable: jest.fn().mockResolvedValue(true),
    generateEmbedding: jest.fn(),
  } as unknown as jest.Mocked<ILLMProvider>;
}

function createSource(
  overrides: Partial<DataSourceConfig> = {},
): DataSourceConfig {
  return {
    url: "https://www.assembly.ca.gov/members",
    dataType: CivicDataType.REPRESENTATIVES,
    contentGoal: "Extract all assembly members",
    ...overrides,
  };
}

const SIMPLE_HTML = `
<html><body>
  <div class="members-list">
    <div class="member-card">
      <h3><a href="/member/1">John Smith</a></h3>
      <p class="district">District 30</p>
      <p class="party">Democrat</p>
    </div>
    <div class="member-card">
      <h3><a href="/member/2">Jane Doe</a></h3>
      <p class="district">District 5</p>
      <p class="party">Republican</p>
    </div>
  </div>
</body></html>
`;

describe("StructuralAnalyzerService", () => {
  let analyzer: StructuralAnalyzerService;
  let mockLLM: jest.Mocked<ILLMProvider>;
  let promptClient: PromptClientService;

  beforeEach(() => {
    mockLLM = createMockLLM();
    promptClient = new PromptClientService();
    analyzer = new StructuralAnalyzerService(mockLLM, promptClient);
  });

  describe("analyze", () => {
    it("should produce a manifest with extraction rules", async () => {
      const manifest = await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(manifest.extractionRules.containerSelector).toBe(".members-list");
      expect(manifest.extractionRules.itemSelector).toBe(".member-card");
      expect(manifest.extractionRules.fieldMappings).toHaveLength(2);
    });

    it("should set LLM metadata on the manifest", async () => {
      const manifest = await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(manifest.llmProvider).toBe("ollama");
      expect(manifest.llmModel).toBe("llama3");
      expect(manifest.llmTokensUsed).toBe(500);
      expect(manifest.analysisTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should compute structure hash from the HTML", async () => {
      const manifest = await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(manifest.structureHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should set prompt hash from prompt service response", async () => {
      const manifest = await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(manifest.promptHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should set sourceUrl from the data source", async () => {
      const manifest = await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(manifest.sourceUrl).toBe("https://www.assembly.ca.gov/members");
    });

    it("should call LLM with low temperature", async () => {
      await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(mockLLM.generate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ temperature: 0.1 }),
      );
    });

    it("should handle LLM response wrapped in markdown code block", async () => {
      const wrappedJson =
        '```json\n{"containerSelector":".list","itemSelector":".item","fieldMappings":[{"fieldName":"name","selector":".name","extractionMethod":"text","required":true}]}\n```';
      mockLLM = createMockLLM(wrappedJson);
      analyzer = new StructuralAnalyzerService(mockLLM, promptClient);

      const manifest = await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(manifest.extractionRules.containerSelector).toBe(".list");
    });

    it("should throw on invalid JSON from LLM", async () => {
      mockLLM = createMockLLM("This is not JSON at all");
      analyzer = new StructuralAnalyzerService(mockLLM, promptClient);

      await expect(
        analyzer.analyze(SIMPLE_HTML, createSource()),
      ).rejects.toThrow("Failed to parse LLM output");
    });

    it("should throw when containerSelector is missing", async () => {
      const badJson = JSON.stringify({
        itemSelector: ".item",
        fieldMappings: [
          { fieldName: "x", selector: ".x", extractionMethod: "text" },
        ],
      });
      mockLLM = createMockLLM(badJson);
      analyzer = new StructuralAnalyzerService(mockLLM, promptClient);

      await expect(
        analyzer.analyze(SIMPLE_HTML, createSource()),
      ).rejects.toThrow("containerSelector");
    });

    it("should throw when itemSelector is missing", async () => {
      const badJson = JSON.stringify({
        containerSelector: ".list",
        fieldMappings: [
          { fieldName: "x", selector: ".x", extractionMethod: "text" },
        ],
      });
      mockLLM = createMockLLM(badJson);
      analyzer = new StructuralAnalyzerService(mockLLM, promptClient);

      await expect(
        analyzer.analyze(SIMPLE_HTML, createSource()),
      ).rejects.toThrow("itemSelector");
    });

    it("should throw when fieldMappings is empty", async () => {
      const badJson = JSON.stringify({
        containerSelector: ".list",
        itemSelector: ".item",
        fieldMappings: [],
      });
      mockLLM = createMockLLM(badJson);
      analyzer = new StructuralAnalyzerService(mockLLM, promptClient);

      await expect(
        analyzer.analyze(SIMPLE_HTML, createSource()),
      ).rejects.toThrow("fieldMappings");
    });
  });

  describe("HTML simplification", () => {
    it("should strip scripts and styles from HTML before analysis", async () => {
      const htmlWithScripts = `
        <html><body>
          <script>alert('hi')</script>
          <style>.foo { color: red; }</style>
          <div class="content"><p>Real content</p></div>
        </body></html>
      `;

      await analyzer.analyze(htmlWithScripts, createSource());

      const prompt = mockLLM.generate.mock.calls[0][0];
      expect(prompt).not.toContain("alert('hi')");
      expect(prompt).not.toContain("color: red");
      expect(prompt).toContain("Real content");
    });

    it("should strip data-* attributes", async () => {
      const htmlWithData = `
        <html><body>
          <div data-track="click" data-id="123" class="content">
            <p>Text</p>
          </div>
        </body></html>
      `;

      await analyzer.analyze(htmlWithData, createSource());

      const prompt = mockLLM.generate.mock.calls[0][0];
      expect(prompt).not.toContain("data-track");
      expect(prompt).not.toContain("data-id");
      expect(prompt).toContain('class="content"');
    });
  });

  describe("smart truncation", () => {
    it("should truncate very long HTML", async () => {
      const longHtml = `<html><body>${"<p>x</p>".repeat(5000)}</body></html>`;

      await analyzer.analyze(longHtml, createSource());

      const prompt = mockLLM.generate.mock.calls[0][0];
      // The HTML in the prompt should be truncated
      expect(prompt.length).toBeLessThan(longHtml.length);
    });
  });

  describe("confidence estimation", () => {
    it("should estimate higher confidence with more field mappings", async () => {
      const manyFields = JSON.stringify({
        containerSelector: ".list",
        itemSelector: ".item",
        fieldMappings: [
          {
            fieldName: "a",
            selector: ".a",
            extractionMethod: "text",
            required: true,
          },
          {
            fieldName: "b",
            selector: ".b",
            extractionMethod: "text",
            required: false,
          },
          {
            fieldName: "c",
            selector: ".c",
            extractionMethod: "text",
            required: false,
          },
          {
            fieldName: "d",
            selector: ".d",
            extractionMethod: "text",
            required: false,
          },
          {
            fieldName: "e",
            selector: ".e",
            extractionMethod: "text",
            required: false,
          },
        ],
        analysisNotes:
          "A detailed analysis of the page structure and layout patterns.",
      });
      mockLLM = createMockLLM(manyFields);
      analyzer = new StructuralAnalyzerService(mockLLM, promptClient);

      const manifest = await analyzer.analyze(SIMPLE_HTML, createSource());

      expect(manifest.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("getCurrentPromptHash", () => {
    it("should return a SHA-256 hash", async () => {
      const hash = await analyzer.getCurrentPromptHash(
        CivicDataType.PROPOSITIONS,
      );
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
