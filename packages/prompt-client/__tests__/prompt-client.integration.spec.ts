/**
 * Integration tests for PromptClientService
 *
 * Tests the full service lifecycle including:
 * - NestJS module initialization (onModuleInit / onModuleDestroy)
 * - 3-tier fallback chain: remote → database → hardcoded
 * - Cache behavior with ICache interface
 * - HMAC vs Bearer auth selection
 * - Circuit breaker recovery flow
 * - Metrics accumulation across multiple operations
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PromptClientService } from "../src/prompt-client.service.js";
import { DbService } from "@opuspopuli/relationaldb-provider";
import { PROMPT_CLIENT_CONFIG } from "../src/types.js";

describe("PromptClientService Integration", () => {
  const mockTemplate = (name: string, templateText: string, version = 1) => ({
    id: `id-${name}`,
    name,
    category: "rag" as const,
    description: "test",
    templateText,
    variables: [],
    version,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // -------------------------------------------------------------------------
  // Full fallback chain: remote → DB → hardcoded
  // -------------------------------------------------------------------------

  describe("3-tier fallback chain", () => {
    let service: PromptClientService;
    let mockDb: any;
    const originalFetch = globalThis.fetch;

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
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 1,
              circuitBreakerFailureThreshold: 1,
              circuitBreakerHalfOpenMs: 60000,
            },
          },
        ],
      }).compile();

      service = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await service.onModuleDestroy();
    });

    it("should use remote when available (tier 1)", async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "from remote",
            promptHash: "abc",
            promptVersion: "v5",
          }),
      });

      const result = await service.getRAGPrompt({
        context: "ctx",
        query: "q",
      });

      expect(result.promptText).toBe("from remote");
      expect(result.promptVersion).toBe("v5");

      const metrics = service.getMetrics();
      expect(metrics.remoteCalls).toBe(1);
      expect(metrics.dbFallbacks).toBe(0);
      expect(metrics.hardcodedFallbacks).toBe(0);
    });

    it("should fall back to DB when remote fails (tier 2)", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("connection refused"));

      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "DB template: {{CONTEXT}} - {{QUERY}}", 3),
      );

      const result = await service.getRAGPrompt({
        context: "test ctx",
        query: "test q",
      });

      expect(result.promptText).toContain("DB template: test ctx - test q");
      expect(result.promptVersion).toBe("v3");

      const metrics = service.getMetrics();
      expect(metrics.dbFallbacks).toBe(1);
      expect(metrics.hardcodedFallbacks).toBe(0);
    });

    it("should fall back to hardcoded when remote and DB both fail (tier 3)", async () => {
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error("connection refused"));

      // DB returns nothing
      mockDb.promptTemplate.findFirst.mockResolvedValue(null);

      const result = await service.getRAGPrompt({
        context: "fallback ctx",
        query: "fallback q",
      });

      expect(result.promptText).toContain("fallback ctx");
      expect(result.promptText).toContain("fallback q");
      expect(result.promptVersion).toBe("v0");

      const metrics = service.getMetrics();
      expect(metrics.dbFallbacks).toBe(1);
      expect(metrics.hardcodedFallbacks).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Custom ICache integration
  // -------------------------------------------------------------------------

  describe("custom ICache integration", () => {
    let service: PromptClientService;
    let mockDb: any;
    let customCache: any;

    beforeEach(async () => {
      mockDb = {
        promptTemplate: {
          findFirst: jest.fn(),
        },
      };

      customCache = {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
        has: jest.fn().mockResolvedValue(false),
        delete: jest.fn().mockResolvedValue(true),
        clear: jest.fn().mockResolvedValue(undefined),
        size: 0,
        keys: jest.fn().mockResolvedValue([]),
        destroy: jest.fn().mockResolvedValue(undefined),
      } as any;

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

      service = module.get(PromptClientService);
    });

    afterEach(async () => {
      await service.onModuleDestroy();
    });

    it("should use custom cache for template storage", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "{{CONTEXT}} {{QUERY}}"),
      );

      await service.getRAGPrompt({ context: "a", query: "b" });

      // Cache get was called (miss), then set was called (storing template)
      expect(customCache.get).toHaveBeenCalledWith("rag");
      expect(customCache.set).toHaveBeenCalledWith(
        "rag",
        expect.objectContaining({ name: "rag" }),
      );
    });

    it("should serve from custom cache on second request", async () => {
      const template = mockTemplate("rag", "cached: {{CONTEXT}} {{QUERY}}");

      // First call: cache miss → DB
      customCache.get.mockResolvedValueOnce(undefined);
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(template);

      await service.getRAGPrompt({ context: "a", query: "b" });

      // Second call: cache hit
      customCache.get.mockResolvedValueOnce(template);

      const result = await service.getRAGPrompt({ context: "c", query: "d" });

      expect(result.promptText).toBe("cached: c d");
      // DB only called once (first request)
      expect(mockDb.promptTemplate.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should delegate clearCache to custom cache", async () => {
      await service.clearCache();

      expect(customCache.clear).toHaveBeenCalled();
    });

    it("should delegate destroy to custom cache on module destroy", async () => {
      await service.onModuleDestroy();

      expect(customCache.destroy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Metrics accumulation across operations
  // -------------------------------------------------------------------------

  describe("metrics accumulation", () => {
    let service: PromptClientService;
    let mockDb: any;
    const originalFetch = globalThis.fetch;

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
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              retryMaxAttempts: 1,
              circuitBreakerFailureThreshold: 5, // High threshold to prevent circuit opening
            },
          },
        ],
      }).compile();

      service = module.get(PromptClientService);
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await service.onModuleDestroy();
    });

    it("should accumulate metrics across multiple operations", async () => {
      // 2 successful remote calls
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "remote",
            promptHash: "abc",
            promptVersion: "v1",
          }),
      });

      await service.getRAGPrompt({ context: "a", query: "b" });
      await service.getRAGPrompt({ context: "c", query: "d" });

      // 1 failed remote call → DB fallback
      globalThis.fetch = jest.fn().mockRejectedValue(new Error("timeout"));
      mockDb.promptTemplate.findFirst.mockResolvedValue(
        mockTemplate("rag", "fb: {{CONTEXT}} {{QUERY}}"),
      );

      await service.getRAGPrompt({ context: "e", query: "f" });

      const metrics = service.getMetrics();
      expect(metrics.remoteCalls).toBe(2);
      expect(metrics.dbFallbacks).toBe(1);
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(3);
      expect(metrics.avgRemoteLatencyMs).toBeGreaterThanOrEqual(0);
      expect(metrics.fallbackRate).toBeGreaterThan(0);
      expect(metrics.circuitBreakerState).toBe("closed");
    });
  });

  // -------------------------------------------------------------------------
  // Module lifecycle
  // -------------------------------------------------------------------------

  describe("module lifecycle", () => {
    it("should complete full init-use-destroy lifecycle in local mode", async () => {
      const mockDb = {
        promptTemplate: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
        ],
      }).compile();

      const service = module.get(PromptClientService);

      // Init (validates templates)
      await service.onModuleInit();

      // Use (with hardcoded fallbacks since DB returns null)
      const result = await service.getRAGPrompt({
        context: "lifecycle test",
        query: "question",
      });
      expect(result.promptText).toContain("lifecycle test");

      // Metrics reflect usage
      const metrics = service.getMetrics();
      expect(metrics.hardcodedFallbacks).toBeGreaterThan(0);

      // Destroy (cleans up cache)
      await service.onModuleDestroy();
    });

    it("should complete full init-use-destroy lifecycle in remote mode", async () => {
      const originalFetch = globalThis.fetch;
      const mockDb = {
        promptTemplate: {
          findFirst: jest.fn(),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PromptClientService,
          { provide: DbService, useValue: mockDb },
          {
            provide: PROMPT_CLIENT_CONFIG,
            useValue: {
              promptServiceUrl: "http://prompt-service:3005",
              promptServiceApiKey: "test-key",
              hmacNodeId: "node-123",
              retryMaxAttempts: 1,
            },
          },
        ],
      }).compile();

      const service = module.get(PromptClientService);

      // Init (skips validation in remote mode)
      await service.onModuleInit();
      expect(mockDb.promptTemplate.findFirst).not.toHaveBeenCalled();

      // Use with HMAC auth
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            promptText: "hmac response",
            promptHash: "hash",
            promptVersion: "v2",
          }),
      });

      const result = await service.getRAGPrompt({
        context: "hmac test",
        query: "question",
      });
      expect(result.promptText).toBe("hmac response");

      // Verify HMAC headers were sent
      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(fetchCall[1].headers["X-HMAC-Signature"]).toBeDefined();
      expect(fetchCall[1].headers["X-HMAC-Key-Id"]).toBe("node-123");
      expect(fetchCall[1].headers["Authorization"]).toBeUndefined();

      // Circuit breaker is healthy
      const health = service.getCircuitBreakerHealth();
      expect(health).not.toBeNull();
      expect(health!.isHealthy).toBe(true);

      // Destroy
      await service.onModuleDestroy();
      globalThis.fetch = originalFetch;
    });
  });

  // -------------------------------------------------------------------------
  // All three prompt types end-to-end
  // -------------------------------------------------------------------------

  describe("all prompt types end-to-end", () => {
    let service: PromptClientService;
    let mockDb: any;

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

    afterEach(async () => {
      await service.onModuleDestroy();
    });

    it("should compose structural analysis with all variables", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate(
            "structural-analysis",
            "Type: {{DATA_TYPE}}\nGoal: {{CONTENT_GOAL}}\nCat: {{CATEGORY}}\n{{HINTS_SECTION}}Schema: {{SCHEMA_DESCRIPTION}}\n{{HTML}}",
            2,
          ),
        )
        .mockResolvedValueOnce(
          mockTemplate("structural-schema-propositions", "proposition fields"),
        );

      const result = await service.getStructuralAnalysisPrompt({
        dataType: "propositions" as any,
        contentGoal: "Extract ballot measures",
        category: "elections",
        hints: ["Check tables", "Look for links"],
        html: "<table>data</table>",
      });

      expect(result.promptText).toContain("Type: propositions");
      expect(result.promptText).toContain("Goal: Extract ballot measures");
      expect(result.promptText).toContain("Cat: elections");
      expect(result.promptText).toContain("- Check tables");
      expect(result.promptText).toContain("- Look for links");
      expect(result.promptText).toContain("proposition fields");
      expect(result.promptText).toContain("<table>data</table>");
      expect(result.promptVersion).toBe("v2");
      expect(result.promptHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should compose document analysis with type-specific template", async () => {
      mockDb.promptTemplate.findFirst
        .mockResolvedValueOnce(
          mockTemplate("document-analysis-petition", "PETITION:\n{{TEXT}}", 4),
        )
        .mockResolvedValueOnce(
          mockTemplate(
            "document-analysis-base-instructions",
            "Respond JSON only.",
          ),
        );

      const result = await service.getDocumentAnalysisPrompt({
        documentType: "petition",
        text: "We the undersigned...",
      });

      expect(result.promptText).toContain("PETITION:");
      expect(result.promptText).toContain("We the undersigned...");
      expect(result.promptText).toContain("Respond JSON only.");
      expect(result.promptVersion).toBe("v4");
    });

    it("should compose RAG prompt with context and query", async () => {
      mockDb.promptTemplate.findFirst.mockResolvedValueOnce(
        mockTemplate("rag", "Context:\n{{CONTEXT}}\n\nQ: {{QUERY}}\n\nA:", 7),
      );

      const result = await service.getRAGPrompt({
        context: "The capital of France is Paris.",
        query: "What is the capital of France?",
      });

      expect(result.promptText).toContain("The capital of France is Paris.");
      expect(result.promptText).toContain("What is the capital of France?");
      expect(result.promptVersion).toBe("v7");
    });
  });
});
