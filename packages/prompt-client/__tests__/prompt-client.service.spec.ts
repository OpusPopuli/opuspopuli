import { Test, TestingModule } from "@nestjs/testing";
import { PromptClientService } from "../src/prompt-client.service.js";
import { DbService } from "@opuspopuli/relationaldb-provider";
import { PROMPT_CLIENT_CONFIG } from "../src/types.js";

/**
 * Mock the response shape of `GET /prompts/:name` from prompt-service
 * (post-#66). Returns a Response-like object that fetch mocks can resolve
 * with directly.
 */
function mockRemoteTemplateResponse(opts: {
  name: string;
  templateText: string;
  variables?: string[];
  version?: number;
  hash?: string;
  expiresInMs?: number;
}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        name: opts.name,
        templateText: opts.templateText,
        variables: opts.variables ?? [],
        promptHash: opts.hash ?? `hash-${opts.name}`,
        promptVersion: `v${opts.version ?? 1}`,
        expiresAt: new Date(
          Date.now() + (opts.expiresInMs ?? 3600000),
        ).toISOString(),
        experimentId: null,
        variantName: null,
      }),
  };
}

/** Mock the response shape of `GET /prompts/:name/hash`. */
function mockRemoteHashResponse(name: string, hash: string, version = 1) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        name,
        promptHash: hash,
        promptVersion: `v${version}`,
      }),
  };
}

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
        upsert: jest.fn().mockResolvedValue({}),
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

  afterEach(async () => {
    await service.clearCache();
    await service.onModuleDestroy();
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

  describe("getCivicsExtractionPrompt", () => {
    it("composes civics-extraction prompt with all interpolated fields", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate(
          "civics-extraction",
          "Region: {{REGION_ID}}\nSource: {{SOURCE_URL}}\nGoal: {{CONTENT_GOAL}}\nCategory: {{CATEGORY}}\n{{HINTS}}HTML:\n{{HTML}}",
        ),
      );

      const result = await service.getCivicsExtractionPrompt({
        regionId: "california",
        sourceUrl: "https://www.assembly.ca.gov/resources/glossary",
        contentGoal: "Extract the official Assembly glossary",
        category: "Assembly",
        hints: ["~150 terms organized A-Z"],
        html: "<html>...</html>",
      });

      expect(result.promptText).toContain("Region: california");
      expect(result.promptText).toContain(
        "Source: https://www.assembly.ca.gov/resources/glossary",
      );
      expect(result.promptText).toContain(
        "Goal: Extract the official Assembly glossary",
      );
      expect(result.promptText).toContain("Category: Assembly");
      expect(result.promptText).toContain("- ~150 terms organized A-Z");
      expect(result.promptText).toContain("HTML:\n<html>...</html>");
      expect(result.promptVersion).toBe("v1");
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("omits the hints section when no hints provided", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("civics-extraction", "{{HINTS}}END"),
      );

      const result = await service.getCivicsExtractionPrompt({
        regionId: "california",
        sourceUrl: "https://example.com",
        contentGoal: "extract",
        html: "<p/>",
      });

      // No hints → empty interpolation, no "Hints from the region author" header
      expect(result.promptText).toBe("END");
    });
  });

  describe("getBillAnalysisPrompt (#741)", () => {
    // The variable shaping below MUST stay byte-for-byte identical to the
    // bill-analysis descriptor in prompt-service (src/prompts/prompts.service.ts).
    // Both sides interpolate against the same template — drift in either
    // direction means the rendered prompt the LLM sees differs from what the
    // tests on either side validate. These tests are the cross-service
    // contract guard.

    const BASE = {
      regionId: "california",
      billNumber: "AB 1",
      sessionYear: "2025-2026",
      title: "An act to add Section 12345.",
      subject: "Housing",
      status: "Enrolled",
      authorName: "Wicks",
      officialSummary: "Prohibits local agencies from imposing certain fees.",
      fiscalImpactSummary: "Negligible state costs.",
      fullText: "<p>SECTION 1. ...</p>",
    };

    const TEMPLATE = [
      "Region: {{REGION_ID}}",
      "Bill: {{BILL_NUMBER}}",
      "Session: {{SESSION_YEAR}}",
      "Title: {{TITLE}}",
      "{{SUBJECT}}{{STATUS}}{{AUTHOR}}NOTICE",
      "{{OFFICIAL_SUMMARY_BLOCK}}{{FISCAL_IMPACT_BLOCK}}FULL:",
      "{{FULL_TEXT}}",
    ].join("\n");

    it("composes bill-analysis prompt with all interpolated fields", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-analysis", TEMPLATE),
      );

      const result = await service.getBillAnalysisPrompt(BASE);

      expect(result.promptText).toContain("Region: california");
      expect(result.promptText).toContain("Bill: AB 1");
      expect(result.promptText).toContain("Session: 2025-2026");
      expect(result.promptText).toContain(
        "Title: An act to add Section 12345.",
      );
      expect(result.promptText).toContain("Subject: Housing\n");
      expect(result.promptText).toContain("Status: Enrolled\n");
      expect(result.promptText).toContain("Primary author: Wicks\n");
      expect(result.promptText).toContain(BASE.officialSummary);
      expect(result.promptText).toContain(BASE.fiscalImpactSummary);
      expect(result.promptText).toContain("FULL:\n<p>SECTION 1. ...</p>");
      expect(result.promptVersion).toBe("v1");
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("omits optional-field headers when those fields are absent", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-analysis", TEMPLATE),
      );

      const result = await service.getBillAnalysisPrompt({
        regionId: BASE.regionId,
        billNumber: BASE.billNumber,
        sessionYear: BASE.sessionYear,
        title: BASE.title,
        fullText: BASE.fullText,
      });

      expect(result.promptText).not.toContain("Subject:");
      expect(result.promptText).not.toContain("Status:");
      expect(result.promptText).not.toContain("Primary author:");
      expect(result.promptText).not.toContain("## Official summary");
      expect(result.promptText).not.toContain("## Fiscal-impact summary");
    });

    it("wraps officialSummary in a fenced block below the SECURITY NOTICE marker", async () => {
      // Defense-in-depth: extracted strings from upstream scraping must be
      // presented to the LLM as untrusted content (fenced, after the security
      // warning), not as trusted metadata in the input header. Locks in the
      // layout so future template edits can't silently regress.
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-analysis", TEMPLATE),
      );

      const result = await service.getBillAnalysisPrompt(BASE);
      const text = result.promptText;

      const noticeIdx = text.indexOf("NOTICE");
      const officialIdx = text.indexOf(BASE.officialSummary);
      const fiscalIdx = text.indexOf(BASE.fiscalImpactSummary);
      const fenceBeforeOfficial = text.lastIndexOf("```text", officialIdx);
      const fenceBeforeFiscal = text.lastIndexOf("```text", fiscalIdx);

      expect(noticeIdx).toBeGreaterThan(0);
      expect(officialIdx).toBeGreaterThan(noticeIdx);
      expect(fiscalIdx).toBeGreaterThan(noticeIdx);
      expect(fenceBeforeOfficial).toBeGreaterThan(noticeIdx);
      expect(fenceBeforeOfficial).toBeLessThan(officialIdx);
      expect(fenceBeforeFiscal).toBeGreaterThan(noticeIdx);
      expect(fenceBeforeFiscal).toBeLessThan(fiscalIdx);
    });

    it("omits the fenced summary blocks entirely when their inputs are absent", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate(
          "bill-analysis",
          "BEFORE{{OFFICIAL_SUMMARY_BLOCK}}MIDDLE{{FISCAL_IMPACT_BLOCK}}AFTER",
        ),
      );

      const result = await service.getBillAnalysisPrompt({
        regionId: BASE.regionId,
        billNumber: BASE.billNumber,
        sessionYear: BASE.sessionYear,
        title: BASE.title,
        fullText: BASE.fullText,
      });

      expect(result.promptText).toBe("BEFOREMIDDLEAFTER");
    });

    it("returns the prompt template version verbatim for the version-bump re-enrich flow", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-analysis", TEMPLATE, 7),
      );

      const result = await service.getBillAnalysisPrompt(BASE);
      expect(result.promptVersion).toBe("v7");
    });
  });

  describe("getBillRelevanceExplanationPrompt (#745)", () => {
    // The variable shaping below MUST stay byte-for-byte identical to the
    // billRelevanceExplanation descriptor in prompt-service
    // (src/prompts/prompts.service.ts). Both sides interpolate against
    // the same template; drift in either direction means the rendered
    // prompt the LLM sees differs from what the tests on either side
    // validate. These tests are the cross-service contract guard.

    const BASE = {
      regionId: "california",
      billNumber: "AB 1",
      sessionYear: "2025-2026",
      title: "An act to add Section 12345.",
      plainEnglishSummary: "Caps ADU fees at $1000.",
      topics: ["housing"],
      whoItAffects: ["homeowners", "renters"],
      fiscalImpactLevel: "low" as const,
      fiscalImpactSummary: "Negligible state cost.",
      stakeholderImpact: "Homeowners benefit.",
      billSectionHint: "Section 12345",
      userInterestTags: ["housing"],
      userRankingFlags: ["isHomeowner", "isParent"],
      userRegionLabel: "94xxx",
    };

    const TEMPLATE = [
      "Region: {{REGION_ID}}",
      "Bill: {{BILL_NUMBER}}",
      "Session: {{SESSION_YEAR}}",
      "Title: {{TITLE}}",
      "Bill topics: {{BILL_TOPICS}}",
      "Bill affects: {{BILL_WHO_IT_AFFECTS}}",
      "{{FISCAL_IMPACT_LINE}}{{STAKEHOLDER_IMPACT_LINE}}{{BILL_SECTION_HINT_LINE}}",
      "User-declared interests (topic slugs): {{USER_INTEREST_TAGS}}",
      "User-declared life-context flags (TRUE-only): {{USER_RANKING_FLAGS}}",
      "{{USER_REGION_LINE}}NOTICE",
      "{{PLAIN_ENGLISH_SUMMARY_BLOCK}}",
    ].join("\n");

    it("composes bill-relevance-explanation prompt with all interpolated fields", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-relevance-explanation", TEMPLATE),
      );

      const result = await service.getBillRelevanceExplanationPrompt(BASE);

      expect(result.promptText).toContain("Region: california");
      expect(result.promptText).toContain("Bill: AB 1");
      expect(result.promptText).toContain("Session: 2025-2026");
      expect(result.promptText).toContain("Bill topics: housing");
      expect(result.promptText).toContain("Bill affects: homeowners, renters");
      expect(result.promptText).toContain(
        "Fiscal impact: low — Negligible state cost.\n",
      );
      expect(result.promptText).toContain(
        "Stakeholder impact: Homeowners benefit.\n",
      );
      expect(result.promptText).toContain(
        "Suggested section to cite: Section 12345\n",
      );
      expect(result.promptText).toContain(
        "User-declared interests (topic slugs): housing",
      );
      expect(result.promptText).toContain(
        "User-declared life-context flags (TRUE-only): isHomeowner, isParent",
      );
      expect(result.promptText).toContain("Approximate region: 94xxx\n");
      expect(result.promptText).toContain(BASE.plainEnglishSummary);
      expect(result.promptVersion).toBe("v1");
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("uses 'none' / 'none declared' sentinels when arrays are empty", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-relevance-explanation", TEMPLATE),
      );

      const result = await service.getBillRelevanceExplanationPrompt({
        regionId: BASE.regionId,
        billNumber: BASE.billNumber,
        sessionYear: BASE.sessionYear,
        title: BASE.title,
        plainEnglishSummary: BASE.plainEnglishSummary,
        topics: ["housing"],
        whoItAffects: [],
        userInterestTags: [],
        userRankingFlags: [],
      });

      expect(result.promptText).toContain("Bill affects: none");
      expect(result.promptText).toContain(
        "User-declared interests (topic slugs): none declared",
      );
      expect(result.promptText).toContain(
        "User-declared life-context flags (TRUE-only): none",
      );
    });

    it("omits optional-field section lines entirely when those fields are absent", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate(
          "bill-relevance-explanation",
          "PRE{{FISCAL_IMPACT_LINE}}{{STAKEHOLDER_IMPACT_LINE}}{{BILL_SECTION_HINT_LINE}}{{USER_REGION_LINE}}POST",
        ),
      );

      const result = await service.getBillRelevanceExplanationPrompt({
        regionId: BASE.regionId,
        billNumber: BASE.billNumber,
        sessionYear: BASE.sessionYear,
        title: BASE.title,
        plainEnglishSummary: BASE.plainEnglishSummary,
        topics: ["housing"],
        whoItAffects: [],
        userInterestTags: [],
        userRankingFlags: [],
      });

      expect(result.promptText).toBe("PREPOST");
    });

    it("renders fiscal-impact level alone when summary is omitted", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate(
          "bill-relevance-explanation",
          "ONLY{{FISCAL_IMPACT_LINE}}",
        ),
      );

      const result = await service.getBillRelevanceExplanationPrompt({
        ...BASE,
        fiscalImpactLevel: "high",
        fiscalImpactSummary: undefined,
      });

      expect(result.promptText).toBe("ONLYFiscal impact: high\n");
    });

    it("wraps plainEnglishSummary in a fenced block below the SECURITY NOTICE marker", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-relevance-explanation", TEMPLATE),
      );

      const result = await service.getBillRelevanceExplanationPrompt(BASE);
      const text = result.promptText;

      const noticeIdx = text.indexOf("NOTICE");
      const summaryIdx = text.indexOf(BASE.plainEnglishSummary);
      const fenceBeforeSummary = text.lastIndexOf("```text", summaryIdx);

      expect(noticeIdx).toBeGreaterThan(0);
      expect(summaryIdx).toBeGreaterThan(noticeIdx);
      expect(fenceBeforeSummary).toBeGreaterThan(noticeIdx);
      expect(fenceBeforeSummary).toBeLessThan(summaryIdx);
    });

    it("returns the prompt template version verbatim", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("bill-relevance-explanation", TEMPLATE, 3),
      );

      const result = await service.getBillRelevanceExplanationPrompt(BASE);
      expect(result.promptVersion).toBe("v3");
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
      await service.clearCache();
      await service.getRAGPrompt({ context: "c", query: "d" });

      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe("getPromptHash", () => {
    it("should return sha256 hash of template text", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("rag", "Template text for hashing"),
      );

      const hash = await service.getPromptHash("rag");

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("error handling", () => {
    it("should throw when non-core template not found", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

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
      await remoteService.onModuleDestroy();
    });

    it("should complete without throwing when templates are missing", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      // Should warn but not throw
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe("metrics", () => {
    it("should return initial metrics with zero counts", () => {
      const metrics = service.getMetrics();

      expect(metrics.totalRequests).toBe(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.remoteCalls).toBe(0);
      expect(metrics.dbFallbacks).toBe(0);
      expect(metrics.hardcodedFallbacks).toBe(0);
      expect(metrics.cacheHitRate).toBe(0);
      expect(metrics.fallbackRate).toBe(0);
      expect(metrics.circuitBreakerState).toBe("closed");
    });

    it("should track hardcoded fallback usage", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      await service.getRAGPrompt({ context: "a", query: "b" });
      const metrics = service.getMetrics();

      expect(metrics.hardcodedFallbacks).toBeGreaterThan(0);
    });

    it("should return null circuit breaker health when not in remote mode", () => {
      expect(service.getCircuitBreakerHealth()).toBeNull();
    });
  });

  describe("remote mode", () => {
    let remoteService: PromptClientService;
    const originalFetch = globalThis.fetch;

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
              retryMaxAttempts: 1, // Disable retries in tests for speed
            },
          },
        ],
      }).compile();

      remoteService = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await remoteService.onModuleDestroy();
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
      await noKeyService.onModuleDestroy();
    });

    it("should fetch the raw template via GET and interpolate locally", async () => {
      const mockFetch = jest.fn().mockResolvedValue(
        mockRemoteTemplateResponse({
          name: "rag",
          templateText: "Q={{QUERY}} C={{CONTEXT}}",
          version: 2,
        }),
      );
      globalThis.fetch = mockFetch;

      const result = await remoteService.getRAGPrompt({
        context: "ctx",
        query: "q",
      });

      // Local interpolation: raw template + local variable substitution.
      expect(result.promptText).toBe("Q=q C=ctx");
      // Hash is SHA-256 of the bare template text — same algorithm
      // server-side and client-side, so values match deterministically.
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.promptVersion).toBe("v2");

      // The wire call is GET /prompts/rag (not POST per-call).
      expect(mockFetch).toHaveBeenCalledWith(
        "http://prompt-service:3005/prompts/rag",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        }),
      );
    });

    it("should track remote call metrics on cache-miss fetch", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue(
        mockRemoteTemplateResponse({
          name: "rag",
          templateText: "{{CONTEXT}} {{QUERY}}",
        }),
      );

      await remoteService.getRAGPrompt({ context: "a", query: "b" });
      const metrics = remoteService.getMetrics();

      expect(metrics.remoteCalls).toBe(1);
      expect(metrics.avgRemoteLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should fall back to DB when remote fails", async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("fetch failed"));

      // Set up DB fallback
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "DB fallback: {{CONTEXT}} {{QUERY}}"),
      );

      const result = await remoteService.getRAGPrompt({
        context: "test",
        query: "test",
      });

      expect(result.promptText).toContain("DB fallback:");
      const metrics = remoteService.getMetrics();
      expect(metrics.dbFallbacks).toBe(1);
    });

    it("should return circuit breaker health in remote mode", () => {
      const health = remoteService.getCircuitBreakerHealth();

      expect(health).not.toBeNull();
      expect(health!.serviceName).toBe("PromptService");
      expect(health!.state).toBe("closed");
      expect(health!.isHealthy).toBe(true);
    });

    it("getPromptHash should call remote /hash endpoint", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "structural-analysis",
            promptHash: "remote-hash-value",
            promptVersion: "v7",
          }),
      });
      globalThis.fetch = fetchMock;

      const hash = await remoteService.getPromptHash("structural-analysis");

      expect(hash).toBe("remote-hash-value");
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/prompts/structural-analysis/hash"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("getPromptHash falls back to local when remote /hash fails", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "local template text"),
      );

      const hash = await remoteService.getPromptHash("rag");

      // Should fall back to hashing local template rather than throwing
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should NOT write remote responses into the local DB", async () => {
      // warmDbCache was removed long ago and the #729 refactor doesn't
      // reintroduce DB writes from the remote path — remote-cached entries
      // live only in the in-memory remoteCache.
      globalThis.fetch = jest.fn().mockResolvedValue(
        mockRemoteTemplateResponse({
          name: "rag",
          templateText: "{{CONTEXT}} {{QUERY}}",
          hash: "abc123",
          version: 2,
        }),
      );

      await remoteService.getRAGPrompt({ context: "test", query: "test" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockDb.promptTemplate.upsert).not.toHaveBeenCalled();
    });
  });

  describe("remote mode with HMAC", () => {
    let hmacService: PromptClientService;
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "hmac-secret-key",
              hmacNodeId: "node-uuid-1234",
              retryMaxAttempts: 1,
            },
          },
        ],
      }).compile();

      hmacService = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await hmacService.onModuleDestroy();
    });

    it("should use HMAC headers instead of Bearer when hmacNodeId is set", async () => {
      const mockFetch = jest.fn().mockResolvedValue(
        mockRemoteTemplateResponse({
          name: "rag",
          templateText: "{{CONTEXT}} {{QUERY}}",
          hash: "def456",
        }),
      );
      globalThis.fetch = mockFetch;

      await hmacService.getRAGPrompt({ context: "test", query: "test" });

      const call = mockFetch.mock.calls[0];
      const headers = call[1].headers;

      // Should have HMAC headers
      expect(headers["X-HMAC-Signature"]).toBeDefined();
      expect(headers["X-HMAC-Timestamp"]).toBeDefined();
      expect(headers["X-HMAC-Key-Id"]).toBe("node-uuid-1234");

      // Should NOT have Bearer auth
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("should produce valid HMAC signature format", async () => {
      const mockFetch = jest.fn().mockResolvedValue(
        mockRemoteTemplateResponse({
          name: "rag",
          templateText: "{{CONTEXT}} {{QUERY}}",
        }),
      );
      globalThis.fetch = mockFetch;

      await hmacService.getRAGPrompt({ context: "ctx", query: "q" });

      const headers = mockFetch.mock.calls[0][1].headers;

      // Signature should be valid base64
      const decoded = Buffer.from(headers["X-HMAC-Signature"], "base64");
      expect(decoded.length).toBe(32); // SHA-256 = 32 bytes

      // Timestamp should be a valid number
      const ts = Number.parseInt(headers["X-HMAC-Timestamp"], 10);
      expect(ts).toBeGreaterThan(0);
    });
  });

  describe("circuit breaker behavior", () => {
    let cbService: PromptClientService;
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 1,
              circuitBreakerFailureThreshold: 2,
              circuitBreakerHalfOpenMs: 60000,
            },
          },
        ],
      }).compile();

      cbService = module.get(PromptClientService);

      // Set up DB fallback for all calls
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "fallback: {{CONTEXT}} {{QUERY}}"),
      );
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await cbService.onModuleDestroy();
    });

    it("should open circuit after consecutive failures", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("500 Internal Server Error"));

      // Trigger failures to open the circuit (threshold = 2)
      await cbService.getRAGPrompt({ context: "a", query: "b" });
      await cbService.getRAGPrompt({ context: "c", query: "d" });

      const health = cbService.getCircuitBreakerHealth();
      expect(health!.state).toBe("open");
      expect(health!.isHealthy).toBe(false);
    });

    it("should fall back to DB when circuit is open", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("500 Internal Server Error"));

      // Open the circuit
      await cbService.getRAGPrompt({ context: "a", query: "b" });
      await cbService.getRAGPrompt({ context: "c", query: "d" });

      // Next call should fail fast (circuit open) and fall back to DB
      const result = await cbService.getRAGPrompt({
        context: "fallback test",
        query: "question",
      });

      expect(result.promptText).toContain("fallback:");
    });

    it("should recover after circuit breaker resets", async () => {
      // Use a very short half-open timeout for testing
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 1,
              circuitBreakerFailureThreshold: 1,
              circuitBreakerHalfOpenMs: 100,
            },
          },
        ],
      }).compile();

      const resetService = module.get(PromptClientService);

      // Break the circuit
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("fail"));
      await resetService.getRAGPrompt({ context: "a", query: "b" });
      expect(resetService.getCircuitBreakerHealth()!.state).toBe("open");

      // Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Successful request should reset the circuit
      globalThis.fetch = jest.fn().mockResolvedValue(
        mockRemoteTemplateResponse({
          name: "rag",
          templateText: "recovered: {{CONTEXT}} {{QUERY}}",
        }),
      );

      const result = await resetService.getRAGPrompt({
        context: "c",
        query: "d",
      });

      expect(result.promptText).toBe("recovered: c d");
      expect(resetService.getCircuitBreakerHealth()!.state).toBe("closed");
      await resetService.onModuleDestroy();
    });
  });

  describe("remote mode - all endpoints", () => {
    let remoteService: PromptClientService;
    const originalFetch = globalThis.fetch;

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
              retryMaxAttempts: 1,
            },
          },
        ],
      }).compile();

      remoteService = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await remoteService.onModuleDestroy();
    });

    it("should fetch BOTH main template and schema sub-template for structural-analysis", async () => {
      // composeStructuralAnalysis pulls 'structural-analysis' (main) and
      // 'structural-schema-<dataType>' (schema sub). After #729, each
      // goes through getTemplate → fetchRawTemplate → GET /:name.
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "structural-analysis",
            templateText:
              "Analyze {{DATA_TYPE}}. Schema: {{SCHEMA_DESCRIPTION}}. HTML: {{HTML}}{{HINTS_SECTION}}{{CONTENT_GOAL}}{{CATEGORY}}",
            hash: "hash-main",
            version: 3,
          }),
        )
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "structural-schema-propositions",
            templateText: "PROP_SCHEMA",
          }),
        );
      globalThis.fetch = mockFetch;

      const result = await remoteService.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      // Local interpolation: main template with PROP_SCHEMA substituted in.
      expect(result.promptText).toContain("Analyze propositions");
      expect(result.promptText).toContain("Schema: PROP_SCHEMA");
      expect(result.promptText).toContain("HTML: <div/>");
      // Hash is SHA-256 of the main template — deterministic.
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);

      // Two GETs: one for the main template, one for the schema sub.
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://prompt-service:3005/prompts/structural-analysis",
        expect.objectContaining({ method: "GET" }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "http://prompt-service:3005/prompts/structural-schema-propositions",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should fetch BOTH main template and base instructions for document-analysis", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "document-analysis-petition",
            templateText: "Analyze: {{TEXT}}",
            hash: "hash-petition",
            version: 2,
          }),
        )
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "document-analysis-base-instructions",
            templateText: "JSON ONLY.",
          }),
        );
      globalThis.fetch = mockFetch;

      const result = await remoteService.getDocumentAnalysisPrompt({
        documentType: "petition",
        text: "doc text",
      });

      // composeDocumentAnalysis interpolates the main template and
      // appends base instructions with a newline separator.
      expect(result.promptText).toBe("Analyze: doc text\nJSON ONLY.");
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe(
        "http://prompt-service:3005/prompts/document-analysis-petition",
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        "http://prompt-service:3005/prompts/document-analysis-base-instructions",
      );
    });

    it("should fall back to DB for structural-analysis when remote fails", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("network error"));

      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-analysis",
            "Analyze {{DATA_TYPE}}.\n{{HINTS_SECTION}}Schema: {{SCHEMA_DESCRIPTION}}\n{{HTML}}",
          ),
        )
        .mockResolvedValueOnce(
          mockTemplate("structural-schema-default", "default schema"),
        );

      const result = await remoteService.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "test",
        html: "<div/>",
      });

      expect(result.promptText).toContain("Analyze propositions");
      const metrics = remoteService.getMetrics();
      // dbFallbacks counts per-TEMPLATE-FETCH after the #729 refactor
      // (was per-request before). Structural-analysis composes from
      // 2 templates (main + schema sub) → 2 DB hits.
      expect(metrics.dbFallbacks).toBe(2);
    });

    it("should fall back to DB for document-analysis when remote fails", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("network error"));

      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-petition", "Analyze: {{TEXT}}"),
        )
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-base-instructions", "JSON only."),
        );

      const result = await remoteService.getDocumentAnalysisPrompt({
        documentType: "petition",
        text: "doc text",
      });

      expect(result.promptText).toContain("Analyze: doc text");
      const metrics = remoteService.getMetrics();
      // 2 DB hits: main petition template + base instructions sub.
      expect(metrics.dbFallbacks).toBe(2);
    });

    it("should treat HTTP error responses as failures and fall back", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "DB: {{CONTEXT}} {{QUERY}}"),
      );

      const result = await remoteService.getRAGPrompt({
        context: "ctx",
        query: "q",
      });

      expect(result.promptText).toContain("DB: ctx q");
    });

    it("should treat 4xx HTTP errors as non-retryable", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });
      globalThis.fetch = mockFetch;

      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "fallback: {{CONTEXT}} {{QUERY}}"),
      );

      // With retryMaxAttempts: 1, the 400 should not be retried
      await remoteService.getRAGPrompt({ context: "a", query: "b" });

      // fetch called only once (no retries for 4xx)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry behavior", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should retry on server errors and invoke onRetry callback", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 3,
              retryBaseDelayMs: 10,
              retryMaxDelayMs: 50,
            },
          },
        ],
      }).compile();

      const retryService = module.get(PromptClientService);

      // Fail twice, then succeed
      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(new Error("500 Internal Server Error"))
        .mockRejectedValueOnce(new Error("503 Service Unavailable"))
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "rag",
            templateText: "success: {{CONTEXT}} {{QUERY}}",
          }),
        );
      globalThis.fetch = mockFetch;

      const result = await retryService.getRAGPrompt({
        context: "a",
        query: "b",
      });

      // After 2 retries the third call succeeds, returning the raw template
      // which is then interpolated locally.
      expect(result.promptText).toBe("success: a b");
      expect(mockFetch).toHaveBeenCalledTimes(3);

      await retryService.onModuleDestroy();
    });
  });

  describe("CircuitOpenError skips retry", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("should not retry when circuit is open", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 3,
              retryBaseDelayMs: 10,
              circuitBreakerFailureThreshold: 1,
              circuitBreakerHalfOpenMs: 60000,
            },
          },
        ],
      }).compile();

      const svc = module.get(PromptClientService);

      // Break the circuit with one failure
      const mockFetch = jest.fn().mockRejectedValue(new Error("server down"));
      globalThis.fetch = mockFetch;

      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "fallback: {{CONTEXT}} {{QUERY}}"),
      );

      await svc.getRAGPrompt({ context: "a", query: "b" });
      expect(svc.getCircuitBreakerHealth()!.state).toBe("open");

      // Reset fetch mock to track next call
      mockFetch.mockClear();

      // This call should hit CircuitOpenError and NOT retry (fail fast)
      const result = await svc.getRAGPrompt({
        context: "fast fallback",
        query: "q",
      });

      expect(result.promptText).toContain("fallback:");
      // fetch should NOT have been called (circuit open prevents it)
      expect(mockFetch).not.toHaveBeenCalled();

      await svc.onModuleDestroy();
    });
  });

  describe("remote template cache (#729)", () => {
    let cacheService: PromptClientService;
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 1,
            },
          },
        ],
      }).compile();
      cacheService = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await cacheService.onModuleDestroy();
    });

    it("serves a second call from cache without any network round-trip", async () => {
      const mockFetch = jest.fn().mockResolvedValue(
        mockRemoteTemplateResponse({
          name: "rag",
          templateText: "Cached: {{CONTEXT}} {{QUERY}}",
          expiresInMs: 60_000,
        }),
      );
      globalThis.fetch = mockFetch;

      await cacheService.getRAGPrompt({ context: "first", query: "q1" });
      await cacheService.getRAGPrompt({ context: "second", query: "q2" });

      // Only one network call — second request served from cache.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const metrics = cacheService.getMetrics();
      expect(metrics.remoteCalls).toBe(1);
      expect(metrics.templateCacheHits).toBe(1);
      expect(metrics.cacheHits).toBeGreaterThanOrEqual(1);
    });

    it("revalidates via /:name/hash when cache is stale and reuses unchanged templates", async () => {
      // Initial fetch with an already-expired entry (TTL in the past).
      const mockFetch = jest
        .fn()
        // First request: full template, expired immediately.
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "rag",
            templateText: "Stale: {{CONTEXT}} {{QUERY}}",
            hash: "stable-hash",
            expiresInMs: -1,
          }),
        )
        // Second request triggers a hash check — returns SAME hash.
        .mockResolvedValueOnce(mockRemoteHashResponse("rag", "stable-hash"));
      globalThis.fetch = mockFetch;

      await cacheService.getRAGPrompt({ context: "a", query: "b" });
      const second = await cacheService.getRAGPrompt({
        context: "c",
        query: "d",
      });

      // Hash-revalidation succeeded → second call reuses cached template
      // (no full template refetch).
      expect(second.promptText).toBe("Stale: c d");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toContain("/prompts/rag/hash");

      const metrics = cacheService.getMetrics();
      expect(metrics.templateCacheHits).toBe(1); // the second call
    });

    it("refetches when /:name/hash returns a different hash", async () => {
      const mockFetch = jest
        .fn()
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "rag",
            templateText: "Old: {{CONTEXT}} {{QUERY}}",
            hash: "old-hash",
            expiresInMs: -1,
          }),
        )
        // Hash check returns a DIFFERENT hash → cache is invalid.
        .mockResolvedValueOnce(mockRemoteHashResponse("rag", "new-hash"))
        // Full refetch returns the new template.
        .mockResolvedValueOnce(
          mockRemoteTemplateResponse({
            name: "rag",
            templateText: "New: {{CONTEXT}} {{QUERY}}",
            hash: "new-hash",
            version: 2,
            expiresInMs: 60_000,
          }),
        );
      globalThis.fetch = mockFetch;

      await cacheService.getRAGPrompt({ context: "a", query: "b" });
      const second = await cacheService.getRAGPrompt({
        context: "c",
        query: "d",
      });

      expect(second.promptText).toBe("New: c d");
      expect(second.promptVersion).toBe("v2");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("onModuleInit", () => {
    it("should log success when all templates are found", async () => {
      // All DB lookups return a valid template
      mockDb.promptTemplate.findFirst.mockResolvedValue({ id: "exists" });

      await service.onModuleInit();

      // No error thrown, and validation ran (5 core templates queried)
      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(5);
    });
  });

  describe("onModuleDestroy", () => {
    it("should call destroy on the template cache", async () => {
      // onModuleDestroy is called in afterEach; verify it doesn't throw
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it("should call destroy on custom cache implementation", async () => {
      const customCache = {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(true),
        clear: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: { cache: customCache },
          },
        ],
      }).compile();

      const customService = module.get(PromptClientService);
      await customService.onModuleDestroy();

      expect(customCache.destroy).toHaveBeenCalled();
    });
  });
});
