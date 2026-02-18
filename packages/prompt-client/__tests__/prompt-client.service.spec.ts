import { Test, TestingModule } from "@nestjs/testing";
import { PromptClientService } from "../src/prompt-client.service.js";
import { DbService } from "@opuspopuli/relationaldb-provider";
import { PROMPT_CLIENT_CONFIG } from "../src/types.js";

describe("PromptClientService", () => {
  let service: PromptClientService;
  let mockDb: any;

  const mockTemplate = (name: string, templateText: string, version = 1) => ({
    id: "test-id",
    name,
    category: "structural_analysis",
    description: "test",
    templateText,
    variables: [],
    version,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    mockDb = {
      promptTemplate: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptClientService,
        { provide: DbService, useValue: mockDb },
      ],
    }).compile();

    service = module.get(PromptClientService);
  });

  afterEach(() => {
    service.clearCache();
  });

  describe("getStructuralAnalysisPrompt", () => {
    it("should compose structural analysis prompt from DB templates", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-analysis",
            "Analyze {{DATA_TYPE}} data.\n{{HINTS_SECTION}}Schema: {{SCHEMA_DESCRIPTION}}\n{{HTML}}",
          ),
        )
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-schema-propositions",
            "Proposition fields here",
          ),
        );

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "Extract ballot measures",
        html: "<div>test</div>",
      });

      expect(result.promptText).toContain("Analyze propositions data.");
      expect(result.promptText).toContain("Proposition fields here");
      expect(result.promptText).toContain("<div>test</div>");
      expect(result.promptHash).toBeDefined();
      expect(result.promptVersion).toBe("v1");
    });

    it("should include hints section when hints provided", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate("structural-analysis", "{{HINTS_SECTION}}"),
        )
        .mockResolvedValueOnce(
          mockTemplate("structural-schema-default", "default schema"),
        );

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "test",
        hints: ["Look for tables", "Check sidebar"],
        html: "<div/>",
      });

      expect(result.promptText).toContain("Hints from the region author");
      expect(result.promptText).toContain("- Look for tables");
      expect(result.promptText).toContain("- Check sidebar");
    });

    it("should fall back to default schema when type-specific not found", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate("structural-analysis", "Schema: {{SCHEMA_DESCRIPTION}}"),
        )
        // First call for type-specific returns null
        .mockResolvedValueOnce(null)
        // Fallback call
        .mockResolvedValueOnce(
          mockTemplate("structural-schema-default", "default schema"),
        );

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "unknown_type" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      expect(result.promptText).toContain("default schema");
    });
  });

  describe("getDocumentAnalysisPrompt", () => {
    it("should compose document analysis prompt with base instructions", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "document-analysis-petition",
            "Analyze petition:\n{{TEXT}}",
          ),
        )
        .mockResolvedValueOnce(
          mockTemplate(
            "document-analysis-base-instructions",
            "Respond with valid JSON only.",
          ),
        );

      const result = await service.getDocumentAnalysisPrompt({
        documentType: "petition",
        text: "We the people...",
      });

      expect(result.promptText).toContain("Analyze petition:");
      expect(result.promptText).toContain("We the people...");
      expect(result.promptText).toContain("Respond with valid JSON only.");
    });

    it("should fall back to generic when document type not found", async () => {
      mockDb.promptTemplate.findFirst
        // Type-specific not found
        .mockResolvedValueOnce(null)
        // Fallback to generic
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-generic", "Generic: {{TEXT}}"),
        )
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-base-instructions", "JSON only."),
        );

      const result = await service.getDocumentAnalysisPrompt({
        documentType: "unknown",
        text: "some text",
      });

      expect(result.promptText).toContain("Generic: some text");
    });
  });

  describe("getRAGPrompt", () => {
    it("should compose RAG prompt with context and query", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate(
          "rag",
          "Context:\n{{CONTEXT}}\n\nQuestion: {{QUERY}}\n\nAnswer:",
        ),
      );

      const result = await service.getRAGPrompt({
        context: "The sky is blue.",
        query: "What color is the sky?",
      });

      expect(result.promptText).toContain("The sky is blue.");
      expect(result.promptText).toContain("What color is the sky?");
      expect(result.promptVersion).toBe("v1");
    });
  });

  describe("caching", () => {
    it("should cache templates after first read", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("rag", "{{CONTEXT}} {{QUERY}}"),
      );

      // First call - hits DB
      await service.getRAGPrompt({ context: "a", query: "b" });
      // Second call - should use cache
      await service.getRAGPrompt({ context: "c", query: "d" });

      // findFirst only called once (cached after first call)
      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should clear cache on clearCache()", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "{{CONTEXT}} {{QUERY}}"),
      );

      await service.getRAGPrompt({ context: "a", query: "b" });
      service.clearCache();
      await service.getRAGPrompt({ context: "c", query: "d" });

      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("should throw when non-core template not found", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      // getPromptHash calls getTemplate with no fallbackName,
      // and "nonexistent-template" has no hardcoded fallback
      await expect(
        service.getPromptHash("nonexistent-template"),
      ).rejects.toThrow(
        'Prompt template "nonexistent-template" not found in database',
      );
    });
  });

  describe("fallback templates", () => {
    it("should return fallback when DB template missing for core template", async () => {
      // All DB lookups return null
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      const result = await service.getRAGPrompt({
        context: "The sky is blue.",
        query: "What color?",
      });

      expect(result.promptText).toContain("The sky is blue.");
      expect(result.promptText).toContain("What color?");
      expect(result.promptVersion).toBe("v0");
    });

    it("should use fallbackName's hardcoded fallback when primary not in DB", async () => {
      // structural-analysis found in DB, but schema type not found
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-analysis",
            "Schema: {{SCHEMA_DESCRIPTION}} {{DATA_TYPE}} {{CONTENT_GOAL}} {{HINTS_SECTION}} {{HTML}}",
          ),
        )
        // structural-schema-exotic: not in DB
        .mockResolvedValueOnce(null)
        // structural-schema-default: not in DB either
        .mockResolvedValueOnce(null);

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "exotic" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      // Should use the hardcoded structural-schema-default fallback
      expect(result.promptText).toContain(
        "Extract all relevant structured data fields",
      );
    });

    it("should cache fallback templates after first use", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      await service.getRAGPrompt({ context: "a", query: "b" });
      await service.getRAGPrompt({ context: "c", query: "d" });

      // DB queried only once for "rag" (cached after fallback returned)
      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("validateTemplates", () => {
    it("should return healthy when all core templates exist", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue({ id: "exists" });

      const result = await service.validateTemplates();

      expect(result.healthy).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("should report missing templates", async () => {
      // First 3 exist, last 2 don't
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce({ id: "1" })
        .mockResolvedValueOnce({ id: "2" })
        .mockResolvedValueOnce({ id: "3" })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.validateTemplates();

      expect(result.healthy).toBe(false);
      expect(result.missing).toEqual([
        "document-analysis-base-instructions",
        "rag",
      ]);
    });
  });

  describe("onModuleInit", () => {
    it("should skip validation when remote URL configured", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
            },
          },
        ],
      }).compile();

      const remoteService = module.get(PromptClientService);
      await remoteService.onModuleInit();

      // DB should not have been called for validation
      expect(mockDb.promptTemplate.findFirst).not.toHaveBeenCalled();
    });

    it("should complete without throwing when templates are missing", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      // Should warn but not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe("remote mode", () => {
    let remoteService: PromptClientService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-api-key",
            },
          },
        ],
      }).compile();

      remoteService = module.get(PromptClientService);
    });

    it("should throw if API key is missing when URL is set", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              // No API key
            },
          },
        ],
      }).compile();

      const noKeyService = module.get(PromptClientService);

      await expect(
        noKeyService.getRAGPrompt({ context: "a", query: "b" }),
      ).rejects.toThrow("API key is required");
    });

    it("should call remote service when URL is configured", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote prompt",
            promptHash: "abc123",
            promptVersion: "v2",
          }),
      });
      global.fetch = mockFetch;

      const result = await remoteService.getRAGPrompt({
        context: "test",
        query: "test",
      });

      expect(result.promptText).toBe("remote prompt");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://prompt-service:3005/prompts/rag",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        }),
      );
    });
  });
});
